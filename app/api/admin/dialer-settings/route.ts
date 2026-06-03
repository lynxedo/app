import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const check = await requireAdminArea('dialer')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('dialer_settings')
    .select('*')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

const ALLOWED_FIELDS = [
  'ring_timeout_sec',
  'voicemail_recipient_user_ids',
  'inbound_route_user_id',
  'ivr_enabled',
  'ivr_config',
  'business_hours',
  'holidays',
  'recording_enabled',
  'recording_consent_notice',
  'recording_pause_auto_resume_sec',
] as const

function sanitizeUuidArray(raw: unknown): string[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const v of raw) {
    if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) out.push(v)
  }
  return [...new Set(out)]
}

function sanitizeUuidOrNull(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  if (typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw)) return raw
  return undefined
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ALLOWED_FIELDS) {
    if (!(k in body)) continue
    if (k === 'voicemail_recipient_user_ids') {
      const arr = sanitizeUuidArray(body[k])
      if (arr === null) {
        return NextResponse.json(
          { error: `${k} must be an array of uuid strings` },
          { status: 400 },
        )
      }
      patch[k] = arr
    } else if (k === 'inbound_route_user_id') {
      const id = sanitizeUuidOrNull(body[k])
      if (id !== undefined) patch[k] = id
    } else if (k === 'ring_timeout_sec') {
      const n = Number(body[k])
      if (!Number.isInteger(n) || n < 5 || n > 120) {
        return NextResponse.json(
          { error: 'ring_timeout_sec must be an integer between 5 and 120' },
          { status: 400 },
        )
      }
      patch[k] = n
    } else if (k === 'recording_enabled') {
      patch[k] = Boolean(body[k])
    } else if (k === 'recording_consent_notice') {
      const v = body[k]
      if (v === null || v === '') {
        patch[k] = null
      } else if (typeof v === 'string') {
        patch[k] = v.slice(0, 500)
      }
    } else if (k === 'recording_pause_auto_resume_sec') {
      const n = Number(body[k])
      if (Number.isInteger(n) && n >= 10 && n <= 600) patch[k] = n
    } else if (k === 'ivr_enabled') {
      patch[k] = Boolean(body[k])
    } else if (k === 'ivr_config') {
      const cfg = body[k]
      // Light-touch validation: must be an object with a `trees` object inside.
      // The admin UI is the source of truth for shape; deeper validation here
      // would just duplicate that effort and make schema evolution harder.
      if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
        return NextResponse.json(
          { error: 'ivr_config must be an object' },
          { status: 400 },
        )
      }
      const trees = (cfg as { trees?: unknown }).trees
      if (trees !== undefined && (typeof trees !== 'object' || Array.isArray(trees) || trees === null)) {
        return NextResponse.json(
          { error: 'ivr_config.trees must be an object' },
          { status: 400 },
        )
      }
      patch[k] = cfg
    } else if (k === 'business_hours') {
      // Shape mirrors dialer_dnd_schedule: {enabled, tz, days: {mon:[{from,to}],...}}
      const bh = body[k]
      if (bh === null) {
        patch[k] = {}
      } else if (typeof bh !== 'object' || Array.isArray(bh)) {
        return NextResponse.json(
          { error: 'business_hours must be an object' },
          { status: 400 },
        )
      } else {
        patch[k] = bh
      }
    } else if (k === 'holidays') {
      // Array of {kind:'date',date} or {kind:'recurring',month,day} entries.
      const list = body[k]
      if (list === null) {
        patch[k] = []
      } else if (!Array.isArray(list)) {
        return NextResponse.json(
          { error: 'holidays must be an array' },
          { status: 400 },
        )
      } else {
        const sanitized: unknown[] = []
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue
          const e = entry as Record<string, unknown>
          if (e.kind === 'date') {
            if (typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
              sanitized.push({
                kind: 'date',
                date: e.date,
                ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim().slice(0, 80) } : {}),
              })
            }
          } else if (e.kind === 'recurring') {
            const month = Number(e.month)
            const day = Number(e.day)
            if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31) {
              sanitized.push({
                kind: 'recurring',
                month,
                day,
                ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim().slice(0, 80) } : {}),
              })
            }
          }
        }
        patch[k] = sanitized
      }
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('dialer_settings')
    .upsert({ company_id: ctx.companyId, ...patch }, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
