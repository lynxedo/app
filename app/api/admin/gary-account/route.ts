import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { GARY_SERVICES, GARY_SERVICE_LABEL, GARY_SIGNATURE, getGaryBot, getGarySettings, saveGarySettings } from '@/lib/gary'
import { WINBACK_SKIP_LABEL, buildWinbackPreview } from '@/lib/gary-winback'

// Admin → AI → Gary's account. Session 1 (Oct 15 2026): Gary's identity, the
// settings his list reads, and the PREVIEW of who he'd contact. Nothing sends.

export const dynamic = 'force-dynamic'

async function guard() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return null
  return { companyId: auth.company_id, userId: auth.user.id }
}

export async function GET() {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()

  try {
    const settings = await getGarySettings(admin, g.companyId)
    const [bot, preview] = await Promise.all([
      getGaryBot(admin, g.companyId, settings.botUserId),
      buildWinbackPreview(admin, g.companyId, settings),
    ])
    return NextResponse.json({
      bot: bot ? { id: bot.id, name: bot.displayName, hasAvatar: Boolean(bot.avatarUrl) } : null,
      signature: GARY_SIGNATURE,
      settings: { services: settings.services, recentTouchDays: settings.recentTouchDays },
      serviceChoices: GARY_SERVICES.map((s) => ({ key: s, label: GARY_SERVICE_LABEL[s] })),
      skipLabels: WINBACK_SKIP_LABEL,
      preview,
    })
  } catch (e) {
    console.error('[gary-account] GET failed', e)
    return NextResponse.json({ error: "Couldn't build Gary's list. Try again in a minute." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { services?: unknown; recentTouchDays?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  try {
    await saveGarySettings(createAdminClient(), g.companyId, g.userId, body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save that." }, { status: 400 })
  }
}
