import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'
import {
  ASSISTANT_NAME_MAX,
  getAssistantPersona,
  setAssistantPersonaAvatar,
  setAssistantPersonaName,
} from '@/lib/ai-persona'

// Persists the shared AI-assistant identity — its display name (JSON POST) and
// its avatar (multipart POST). This is the ONE place either is set: both writes
// go through lib/ai-persona.ts, which fans the name + avatar out to every bot row
// that wears the persona (the Hub bot AND the phone/text receptionist) and keeps
// voice_receptionist_settings.receptionist_name in step, so a user only ever sees
// one assistant. See lib/ai-persona.ts for the source-of-truth rationale.
//
// All writes use the service-role client (a normal session can't UPDATE a bot
// row), are scoped to the caller's own company, and are gated to AI admins.
// Mirrors app/api/profile/avatar/route.ts for the avatar half.

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

async function requireAiAdmin() {
  const check = await requireAdminArea('ai')
  // `ok` does not narrow company_id/user — guard them explicitly.
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id, userId: check.user?.id ?? null }
}

export async function POST(request: Request) {
  const ctx = await requireAiAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const contentType = request.headers.get('content-type') ?? ''

  // ── Avatar upload (multipart/form-data) ────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
      return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP, and GIF are allowed' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })
    }

    const persona = await getAssistantPersona(admin, ctx.companyId)
    if (!persona.botUserIds.length) {
      return NextResponse.json(
        { error: 'No assistant bot user exists for this company yet' },
        { status: 409 }
      )
    }

    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
    // One object shared by every persona row, keyed on the primary (Hub bot) id
    // — but with a per-upload suffix, so replacing the avatar produces a NEW key.
    //
    // A stable key meant every upload overwrote the same object at the same URL:
    // the picture changed while its address didn't, so anything holding a cached
    // copy kept showing the old face (the admin panel showed the previous avatar
    // for hours while rooms and DMs showed the new one, purely by luck of which
    // cache entry was populated when). It also destroyed the previous image.
    // A fresh key makes every change a new URL, which caches can't shadow.
    const key = `avatars/${persona.primaryBotUserId}-${Date.now()}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    await getR2Client().send(new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    }))

    // Store the R2 key on every persona row — served via
    // /api/profile/avatar/[userId], so the Hub bot and the receptionist resolve
    // to the same image.
    const { botUserIds } = await setAssistantPersonaAvatar(admin, ctx.companyId, key)

    return NextResponse.json({
      ok: true,
      avatar_url: key,
      serve_url: `/api/profile/avatar/${persona.primaryBotUserId}`,
      bot_user_ids: botUserIds,
    })
  }

  // ── Name update (JSON) ─────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name must be a non-empty string' }, { status: 400 })
  if (name.length > ASSISTANT_NAME_MAX) {
    return NextResponse.json(
      { error: `Name too long (${ASSISTANT_NAME_MAX} max)` },
      { status: 400 }
    )
  }

  let result: { botUserIds: string[]; receptionistSynced: boolean }
  try {
    result = await setAssistantPersonaName(admin, ctx.companyId, name, ctx.userId)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  if (!result.botUserIds.length && !result.receptionistSynced) {
    return NextResponse.json(
      { error: 'No assistant bot user exists for this company yet' },
      { status: 409 }
    )
  }

  return NextResponse.json({
    ok: true,
    display_name: name,
    bot_user_ids: result.botUserIds,
    receptionist_synced: result.receptionistSynced,
  })
}
