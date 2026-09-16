// Radio — press-and-hold voice in 1-on-1 Hub DMs. Shared constants and row shapes.
// Design: Hub/HUB_RADIO_PRD.md. Tables: supabase/2026-09-16_radio_foundation.sql.
//
// TODO regen types — radio_* tables are not yet in lib/database.types.ts, so the
// row shapes live here (same situation as drip_audio_assets, jobber_quotes).

/** A channel closes itself after this long with nobody talking. Computed on read. */
export const RADIO_CHANNEL_TTL_MS = 60 * 60 * 1000
/** An unanswered invite is a moment, not a standing request — no ringing, no retry. */
export const RADIO_INVITE_TTL_MS = 2 * 60 * 1000
/** Piece lengths — Phase 0 confirmed 2s then 5s. Tune here, nowhere else. */
export const RADIO_PIECE_FIRST_MS = 2000
export const RADIO_PIECE_REST_MS = 5000
/** One press-and-hold. Longer than this belongs in a phone call. */
export const RADIO_HOLD_CAP_MS = 60_000
/** A 5s piece is ~160KB at 16kHz WAV; 1MB leaves room for the 48kHz test format. */
export const RADIO_MAX_PIECE_BYTES = 1024 * 1024
export const RADIO_PIECE_MIMES = new Set([
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/mp4', 'audio/ogg',
])

export type RadioStatus = 'pending' | 'active' | 'declined' | 'closed' | 'expired'

export type RadioSessionRow = {
  id: string
  company_id: string
  conversation_id: string
  initiator_id: string
  recipient_id: string
  status: RadioStatus
  created_at: string
  accepted_at: string | null
  last_activity_at: string
  closed_at: string | null
  closed_by: string | null
}

export type RadioTransmissionRow = {
  id: string
  session_id: string
  sender_id: string
  started_at: string
  ended_at: string | null
  piece_count: number | null
  duration_ms: number | null
}

export type RadioPieceRow = {
  id: string
  transmission_id: string
  seq: number
  r2_key: string
  mime: string
  duration_ms: number | null
  bytes: number | null
  created_at: string
}

/** Realtime topic for everything inside one channel. */
export function radioTopic(sessionId: string) { return `radio:${sessionId}` }
/** Per-person topic for things that happen before they're on a session topic — the invite. */
export function radioUserTopic(userId: string) { return `radio-user:${userId}` }

/** 'active' rows go stale silently; 'pending' invites do too. Read the row through this. */
export function radioEffectiveStatus(s: Pick<RadioSessionRow, 'status' | 'last_activity_at' | 'created_at'>, now = Date.now()): RadioStatus {
  if (s.status === 'active' && now - Date.parse(s.last_activity_at) > RADIO_CHANNEL_TTL_MS) return 'expired'
  if (s.status === 'pending' && now - Date.parse(s.created_at) > RADIO_INVITE_TTL_MS) return 'expired'
  return s.status
}

export function isRadioSessionLive(s: Pick<RadioSessionRow, 'status' | 'last_activity_at' | 'created_at'>, now = Date.now()) {
  return radioEffectiveStatus(s, now) === 'active'
}

/** When an active channel will close if nobody talks — for the "closes at 3:42" hint. */
export function radioExpiresAt(s: Pick<RadioSessionRow, 'status' | 'last_activity_at'>): string | null {
  if (s.status !== 'active') return null
  return new Date(Date.parse(s.last_activity_at) + RADIO_CHANNEL_TTL_MS).toISOString()
}
