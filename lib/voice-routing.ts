// AI Voice Receptionist — Level 5 (frontline receptionist) routing directory.
//
// At Level 5 the receptionist answers EVERY call as the front door (replacing
// the IVR). To get callers to the right person/department she reads a
// per-company routing directory: each entry has a label, a plain-English "what
// they handle" description (her triage text), and one destination encoded the
// same way the IVR encodes a node destination (see lib/twilio-voice.ts
// renderIvrDestination) so call-time transfers reuse the existing dial plumbing.
//
// This module is the data layer: types, the loader, and the input sanitizer for
// the admin write route. Nothing here dials Twilio or changes call behavior —
// the front-door branch + the call-time transfer live in later increments and
// are gated on the (not-yet-selectable) Level 5.

import type { SupabaseClient } from '@supabase/supabase-js'

// Entry kind — a specific person, or a function/department.
export type RoutingEntryKind = 'person' | 'department'

// How the entry is reached, mirroring the IVR's destination kinds. Exactly one
// per entry; dest_value carries the matching identifier (or '' for voicemail).
//   user       -> dest_value = Hub user id (uuid)  -> <Client>{id}</Client>
//   cell       -> dest_value = E.164 number        -> <Number>{e164}</Number>
//   ring_group -> dest_value = ring group id       -> ring-group route
//   extension  -> dest_value = dialer_extension     -> resolves to a user
//   voicemail  -> dest_value = '' (company box)
export type RoutingDestKind = 'user' | 'cell' | 'ring_group' | 'extension' | 'voicemail'

export type RoutingEntryRow = {
  id: string
  company_id: string
  label: string
  kind: RoutingEntryKind
  description: string
  dest_kind: RoutingDestKind
  dest_value: string
  enabled: boolean
  sort_order: number
}

/** DB-ready upsert shape (no id; upsert matches the (company_id, label) key
 *  and keeps the existing row's id). */
export type RoutingEntryInput = Omit<RoutingEntryRow, 'id'> & { updated_at: string }

export const ROUTING_ENTRY_COLUMNS =
  'id, company_id, label, kind, description, dest_kind, dest_value, enabled, sort_order'

// What Amber does when a transfer she attempts goes unanswered (Ben, Jul 15).
//   offer_callback — return to the caller, keep helping if she can, else promise
//                    a callback + take a detailed message (Heroes default)
//   message        — take a message and end warmly
//   voicemail      — send the caller to the company voicemail
export type TransferMissBehavior = 'offer_callback' | 'message' | 'voicemail'

export const TRANSFER_MISS_BEHAVIORS: TransferMissBehavior[] = [
  'offer_callback',
  'message',
  'voicemail',
]

// ── Reads (service-role admin client) ───────────────────────────────────────

/** All routing-directory entries for a company, in display order. */
export async function getRoutingDirectory(
  admin: SupabaseClient,
  companyId: string,
): Promise<RoutingEntryRow[]> {
  const { data } = await admin
    .from('voice_routing_directory')
    .select(ROUTING_ENTRY_COLUMNS)
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  return ((data as RoutingEntryRow[] | null) ?? []).map(normalizeRow)
}

function normalizeRow(r: RoutingEntryRow): RoutingEntryRow {
  return {
    ...r,
    kind: r.kind === 'department' ? 'department' : 'person',
    description: typeof r.description === 'string' ? r.description : '',
    dest_kind: (['user', 'cell', 'ring_group', 'extension', 'voicemail'] as const).includes(
      r.dest_kind,
    )
      ? r.dest_kind
      : 'voicemail',
    dest_value: typeof r.dest_value === 'string' ? r.dest_value : '',
    enabled: r.enabled !== false,
  }
}

// ── Input sanitization (used by the admin write route) ──────────────────────

/**
 * Sanitize one routing entry from client JSON into a DB-ready row. Returns null
 * when there's no label (nothing to key on) or the destination is incomplete
 * (a non-voicemail kind with no value). Never throws on junk input.
 */
export function sanitizeRoutingEntry(
  raw: unknown,
  companyId: string,
  sortOrder: number,
): RoutingEntryInput | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (!label) return null

  const dest_kind: RoutingDestKind = (
    ['user', 'cell', 'ring_group', 'extension', 'voicemail'] as const
  ).includes(o.dest_kind as RoutingDestKind)
    ? (o.dest_kind as RoutingDestKind)
    : 'voicemail'

  const dest_value =
    dest_kind === 'voicemail'
      ? ''
      : typeof o.dest_value === 'string'
        ? o.dest_value.trim().slice(0, 200)
        : ''

  // A non-voicemail destination with no value is unusable — drop it so we never
  // store an entry Amber can't route to.
  if (dest_kind !== 'voicemail' && !dest_value) return null

  return {
    company_id: companyId,
    label: label.slice(0, 120),
    kind: o.kind === 'department' ? 'department' : 'person',
    description: typeof o.description === 'string' ? o.description.trim().slice(0, 600) : '',
    dest_kind,
    dest_value,
    enabled: o.enabled === undefined ? true : Boolean(o.enabled),
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  }
}

/** Coerce a stored transfer_miss_behavior into a valid value (default offer_callback). */
export function normalizeTransferMissBehavior(raw: unknown): TransferMissBehavior {
  return TRANSFER_MISS_BEHAVIORS.includes(raw as TransferMissBehavior)
    ? (raw as TransferMissBehavior)
    : 'offer_callback'
}

/**
 * Match what the receptionist says the caller wants ("billing", "Kathryn", "the
 * service department") to a directory entry. Enabled entries only. Tries, in
 * order: exact label → label/query substring either way → shared word against
 * the label → shared word against the "what they handle" description. Returns
 * the best entry or null (the caller then gets a message taken instead of a
 * transfer to the wrong place).
 */
export function matchRoutingEntry(
  entries: RoutingEntryRow[],
  query: string,
): RoutingEntryRow | null {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return null
  const enabled = entries.filter((e) => e.enabled)
  if (!enabled.length) return null

  const exact = enabled.find((e) => e.label.toLowerCase() === q)
  if (exact) return exact

  const sub = enabled.find((e) => {
    const l = e.label.toLowerCase()
    return l.includes(q) || q.includes(l)
  })
  if (sub) return sub

  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const qWords = words(q)
  const overlaps = (s: string) => [...words(s)].some((w) => qWords.has(w))

  const byLabel = enabled.find((e) => overlaps(e.label))
  if (byLabel) return byLabel
  return enabled.find((e) => e.description && overlaps(e.description)) ?? null
}
