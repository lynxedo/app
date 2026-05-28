import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callHeroesTool } from '@/lib/hub-claude'

// System default — used when daily_log_settings.on_my_way_template is NULL.
// Configurable per-company under /hub/admin/daily-log.
const DEFAULT_TEMPLATE = "Hi {first_name}, this is {tech_name} from Heroes Lawn Care. I'm on my way — should be there in about {eta} minutes."

function renderTemplate(
  template: string,
  ctx: { first_name: string; tech_name: string; eta: number },
): string {
  return template
    .replace(/\{first_name\}/g, ctx.first_name || 'there')
    .replace(/\{tech_name\}/g, ctx.tech_name || 'Heroes')
    .replace(/\{eta\}/g, String(ctx.eta))
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Body: { eta_minutes: number }
  const body = await request.json().catch(() => ({})) as { eta_minutes?: unknown }
  const etaRaw = Number(body.eta_minutes)
  if (!Number.isFinite(etaRaw) || etaRaw < 1 || etaRaw > 240) {
    return NextResponse.json({ error: 'eta_minutes must be 1–240' }, { status: 400 })
  }
  const eta = Math.round(etaRaw)

  const admin = createAdminClient()

  // Look up stop + verify company scope.
  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('id, client_name, client_phone, daily_log_entries!inner(company_id)')
    .eq('id', id)
    .single()
  if (!stop) {
    return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  }
  const entry = Array.isArray(stop.daily_log_entries)
    ? stop.daily_log_entries[0]
    : stop.daily_log_entries
  if (!entry || entry.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  }
  if (!stop.client_phone) {
    return NextResponse.json({ error: 'No phone number on file for this stop.' }, { status: 422 })
  }

  // Check do-not-text against txt_contacts (canonical contacts table) and
  // fall back to hub_contacts for any legacy rows the optimizer captured.
  const rawDigits = stop.client_phone.replace(/\D/g, '')
  const possiblePhones = [stop.client_phone, rawDigits]
  if (rawDigits.length === 10) possiblePhones.push(`+1${rawDigits}`, `1${rawDigits}`)

  const { data: txtMatch } = await admin
    .from('txt_contacts')
    .select('do_not_text')
    .eq('company_id', profile.company_id)
    .in('phone', possiblePhones)
    .limit(1)
    .maybeSingle()
  if (txtMatch?.do_not_text) {
    return NextResponse.json({ error: 'Customer is on the do-not-text list.' }, { status: 422 })
  }

  const { data: hubMatch } = await admin
    .from('hub_contacts')
    .select('do_not_text')
    .eq('company_id', profile.company_id)
    .in('phone', possiblePhones)
    .limit(1)
    .maybeSingle()
  if (hubMatch?.do_not_text) {
    return NextResponse.json({ error: 'Customer is on the do-not-text list.' }, { status: 422 })
  }

  // Resolve template + tech name + customer first name.
  const { data: settings } = await admin
    .from('daily_log_settings')
    .select('on_my_way_template')
    .eq('company_id', profile.company_id)
    .maybeSingle()

  const template = settings?.on_my_way_template?.trim() || DEFAULT_TEMPLATE

  const { data: hubUser } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', user.id)
    .single()
  const techName = hubUser?.display_name?.split(/\s+/)[0] || 'your tech'

  const firstName = stop.client_name.trim().split(/\s+/)[0] || ''

  const message = renderTemplate(template, { first_name: firstName, tech_name: techName, eta })

  // Send via Heroes MCP send_text (same path Hub Clients SMS uses).
  // The MCP tool returns a string starting with ✅ on success or ❌ on failure.
  let sent = false
  let sendError: string | null = null
  try {
    const phoneForSend = rawDigits.length === 10 ? rawDigits : rawDigits
    const nameParts = stop.client_name.trim().split(/\s+/)
    const last = nameParts.slice(1).join(' ') || undefined
    const result = await callHeroesTool('send_text', {
      to: phoneForSend,
      message,
      first_name: firstName,
      ...(last ? { last_name: last } : {}),
    })
    sent = result.startsWith('✅')
    if (!sent) {
      sendError = result.replace(/^❌\s*/, '').slice(0, 200) || 'Send failed'
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : 'Send failed'
  }

  if (!sent) {
    return NextResponse.json({ error: sendError ?? 'Send failed' }, { status: 502 })
  }

  // Stamp the stop only on success.
  const nowIso = new Date().toISOString()
  const { data: updated, error: updErr } = await admin
    .from('daily_log_stops')
    .update({
      on_my_way_sent_at: nowIso,
      on_my_way_eta_minutes: eta,
    })
    .eq('id', stop.id)
    .select('id, on_my_way_sent_at, on_my_way_eta_minutes')
    .single()

  if (updErr) {
    // SMS went out but we couldn't stamp — surface a warning so the tech
    // doesn't accidentally re-send. The customer still got the message.
    return NextResponse.json({
      stop: { id: stop.id, on_my_way_sent_at: nowIso, on_my_way_eta_minutes: eta },
      message_sent: true,
      stamp_warning: updErr.message,
    })
  }

  return NextResponse.json({
    stop: updated,
    message_sent: true,
    rendered_message: message,
  })
}
