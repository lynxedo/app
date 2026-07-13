// AI Voice Receptionist — Level 4 scheduling config (loader + input sanitizer).
//
// A subscriber configures WHICH Jobber line items the receptionist may schedule
// and the rules for each (mode, duration, capacity, arrival windows, offered
// days, assigned tech, lead time, horizon, commitment). One row per schedulable
// line item in `voice_scheduling_services`; a per-company master switch
// (`scheduling_enabled`) lives on `voice_receptionist_settings`.
//
// This module is read by the admin route (increment 1) and, later, by the
// call-time availability engine + booking endpoints (increments 2–3). Nothing
// here writes to Jobber or changes call behavior on its own.

import type { SupabaseClient } from '@supabase/supabase-js'

export type SchedulingMode = 'appointment' | 'recurring'
export type SchedulingCommitment = 'request' | 'direct'

/** An offered arrival window, "HH:MM" 24-hour, start < end. */
export type TimeFrame = { start: string; end: string }

export type SchedulableServiceRow = {
  id: string
  company_id: string
  line_item: string
  mode: SchedulingMode
  enabled: boolean
  duration_minutes: number
  max_per_day: number
  time_frames: TimeFrame[]
  offered_days: number[] // 0=Sun..6=Sat; [] = any day
  assigned_user_ids: string[] // Jobber user encoded ids (= teamMemberIdsToAssign)
  lead_days: number
  horizon_days: number
  commitment: SchedulingCommitment
  frequencies: string[]
  sort_order: number
}

/** DB-ready insert/upsert shape (no id/timestamps — upsert matches on the
 *  (company_id, line_item) unique key and keeps the existing row's id). */
export type SchedulableServiceInput = Omit<SchedulableServiceRow, 'id'> & { updated_at: string }

export const SCHEDULING_SERVICE_COLUMNS =
  'id, company_id, line_item, mode, enabled, duration_minutes, max_per_day, time_frames, offered_days, assigned_user_ids, lead_days, horizon_days, commitment, frequencies, sort_order'

export const SCHEDULING_DEFAULTS = {
  mode: 'appointment' as SchedulingMode,
  duration_minutes: 60,
  max_per_day: 4,
  time_frames: [{ start: '08:00', end: '12:00' }] as TimeFrame[],
  offered_days: [] as number[],
  lead_days: 1,
  horizon_days: 30,
  commitment: 'request' as SchedulingCommitment,
}

// ── Reads (service-role admin client) ───────────────────────────────────────

/** Per-company master switch. Missing row / column → false (safe default). */
export async function getSchedulingEnabled(
  admin: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('voice_receptionist_settings')
    .select('scheduling_enabled')
    .eq('company_id', companyId)
    .maybeSingle()
  return Boolean((data as { scheduling_enabled?: boolean } | null)?.scheduling_enabled)
}

/** All schedulable-service config rows for a company, in display order. */
export async function getSchedulableServices(
  admin: SupabaseClient,
  companyId: string,
): Promise<SchedulableServiceRow[]> {
  const { data } = await admin
    .from('voice_scheduling_services')
    .select(SCHEDULING_SERVICE_COLUMNS)
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('line_item', { ascending: true })
  return ((data as SchedulableServiceRow[] | null) ?? []).map(normalizeRow)
}

/** Coerce a raw DB row into the typed shape (defensive against nulls in jsonb). */
function normalizeRow(r: SchedulableServiceRow): SchedulableServiceRow {
  return {
    ...r,
    time_frames: Array.isArray(r.time_frames) ? r.time_frames : [],
    offered_days: Array.isArray(r.offered_days) ? r.offered_days : [],
    assigned_user_ids: Array.isArray(r.assigned_user_ids) ? r.assigned_user_ids : [],
    frequencies: Array.isArray(r.frequencies) ? r.frequencies : [],
  }
}

// ── Input sanitization (used by the admin write route) ──────────────────────

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt
}

export function sanitizeTimeFrames(raw: unknown): TimeFrame[] {
  if (!Array.isArray(raw)) return []
  const out: TimeFrame[] = []
  for (const r of raw) {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const start = typeof o.start === 'string' ? o.start : ''
    const end = typeof o.end === 'string' ? o.end : ''
    if (TIME_RE.test(start) && TIME_RE.test(end) && start < end) out.push({ start, end })
  }
  return out.slice(0, 6)
}

/**
 * Sanitize one service config from client JSON into a DB-ready row. Returns null
 * when there's no line_item (nothing to key on). Never throws on junk input.
 */
export function sanitizeSchedulableService(
  raw: unknown,
  companyId: string,
  sortOrder: number,
): SchedulableServiceInput | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const line_item = typeof o.line_item === 'string' ? o.line_item.trim() : ''
  if (!line_item) return null

  const offered_days = Array.isArray(o.offered_days)
    ? [...new Set(o.offered_days.map((d) => Math.round(Number(d))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : []
  const assigned_user_ids = Array.isArray(o.assigned_user_ids)
    ? o.assigned_user_ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200).slice(0, 50)
    : []
  const frequencies = Array.isArray(o.frequencies)
    ? o.frequencies.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 8)
    : []

  return {
    company_id: companyId,
    line_item: line_item.slice(0, 200),
    mode: o.mode === 'recurring' ? 'recurring' : 'appointment',
    enabled: o.enabled === undefined ? true : Boolean(o.enabled),
    duration_minutes: clampInt(o.duration_minutes, 1, 480, SCHEDULING_DEFAULTS.duration_minutes),
    max_per_day: clampInt(o.max_per_day, 1, 100, SCHEDULING_DEFAULTS.max_per_day),
    time_frames: sanitizeTimeFrames(o.time_frames),
    offered_days,
    assigned_user_ids,
    lead_days: clampInt(o.lead_days, 0, 60, SCHEDULING_DEFAULTS.lead_days),
    horizon_days: clampInt(o.horizon_days, 1, 365, SCHEDULING_DEFAULTS.horizon_days),
    commitment: o.commitment === 'direct' ? 'direct' : 'request',
    frequencies,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  }
}
