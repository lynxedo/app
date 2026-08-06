// The shared AI-assistant PERSONA — the one name + avatar every AI surface wears.
//
// Lynxedo runs TWO bot users, and they stay two rows on purpose: their ids are
// stamped across attribution history (calls.handled_by, txt_messages.sent_by,
// drip sends, the Guardian audit log), so merging them would rewrite that
// history for no visible gain.
//   • the Hub bot        — companies.hub_bot_user_id: answers questions in Hub and is
//                          the face on the automated system posts in
//                          lib/guardian-post.ts (LSA leads, overdue tasks, …).
//   • the receptionist   — voice_receptionist_settings.text_bot_user_id: the AI
//     text bot             phone receptionist, who also signs automated texts.
// To a user those are ONE assistant, so they must share a name and a face. This
// module is the single place that reads and writes that shared persona.
//
// ── Source of truth for the NAME ────────────────────────────────────────────
// `voice_receptionist_settings.receptionist_name` is the source of truth; the
// bot rows' `hub_users.display_name` is a write-through mirror of it.
//
// Why that direction and not the reverse: receptionist_name is what the phone
// receptionist SPEAKS to a customer ("Hi, this is Amber") and what the Call Log
// credits her calls to, so a stale value there is customer-visible — strictly
// worse than a stale in-Hub sender label. It is also already the per-company
// anchor every voice/text path resolves through (lib/voice-receptionist-settings,
// lib/amber-text), and for existing tenants it already holds the real persona
// name while the Hub bot row still says "Guardian" — so reading FROM it means
// adopting the shared persona never renames the assistant out from under the
// customers who already talk to her.
//
// Divergence is prevented by having exactly ONE writer: setAssistantPersonaName()
// below, called only by /api/admin/guardian/bot-identity. Specifically:
//   • The Receptionist panel no longer edits the name at all, and
//     /api/admin/voice-receptionist-settings no longer accepts it from a client.
//   • That route instead seeds receptionist_name from this persona when its row
//     has no name yet, so a company configuring its receptionist for the first
//     time inherits the persona instead of starting a second one.
//   • setAssistantPersonaName only UPDATEs voice_receptionist_settings — it never
//     inserts a row, because `enabled` defaults to FALSE while the no-row
//     resolver fails OPEN (see resolveVoiceReceptionistSettings), so creating a
//     row here could silently switch a tenant's receptionist off.
// When no receptionist row exists yet the name falls back to the Hub bot row's
// display_name (a tenant that has never configured a receptionist still has a
// named Hub bot), and finally to DEFAULT_RECEPTIONIST_NAME.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getHubBotUserId } from '@/lib/guardian-post'
import { DEFAULT_RECEPTIONIST_NAME } from '@/lib/voice-receptionist'

/** Max length of the persona name (matches the receptionist_name input cap). */
export const ASSISTANT_NAME_MAX = 40

export type AssistantPersona = {
  /** The name every AI surface shows in Hub and speaks / signs to customers. */
  name: string
  /** Shared avatar: an R2 key (or legacy absolute URL); null → default bot art. */
  avatarUrl: string | null
  /**
   * The hub_users rows that wear this persona — 0, 1, or 2 of them, Hub bot
   * first. A company with no receptionist configured has one; a company whose
   * bot rows don't exist (nothing seeded) has none.
   */
  botUserIds: string[]
  /**
   * The id the admin UI renders the avatar from and the avatar object key is
   * named after — the company's Hub bot when it exists, else the first persona
   * row. Empty string when the company has no bot at all (never another tenant's
   * id); callers should treat '' as "nothing to render / nothing to save".
   */
  primaryBotUserId: string
}

type BotRow = { id: string; display_name: string | null; avatar_url: string | null }

/**
 * Load the persona's bot rows + the company's receptionist settings in one pass.
 *
 * Company-scoped and bot-scoped on purpose: candidates are filtered by
 * `company_id` AND `is_bot`, so an admin can only ever touch their own company's
 * bot rows — and a misconfigured text_bot_user_id pointing at a human can never
 * rename that person.
 */
async function loadPersonaRows(
  admin: SupabaseClient,
  companyId: string
): Promise<{
  rows: BotRow[]
  storedName: string
  hasReceptionistRow: boolean
  hubBotUserId: string | null
}> {
  const { data: vrs } = await admin
    .from('voice_receptionist_settings')
    .select('receptionist_name, text_bot_user_id')
    .eq('company_id', companyId)
    .maybeSingle()
  const settings = (vrs as { receptionist_name?: string | null; text_bot_user_id?: string | null } | null) ?? null

  // The Hub bot is resolved per company (companies.hub_bot_user_id) — using the
  // legacy constant here is what made a second tenant's identity endpoint 409:
  // that row belongs to Heroes, so it never matched their company filter below
  // and the persona came back with zero rows to name or give a face to.
  const hubBotUserId = await getHubBotUserId(admin, companyId)

  const candidates = [hubBotUserId, settings?.text_bot_user_id ?? null].filter(
    (id, i, all): id is string => Boolean(id) && all.indexOf(id) === i
  )

  const { data } = await admin
    .from('hub_users')
    .select('id, display_name, avatar_url')
    .in('id', candidates)
    .eq('company_id', companyId)
    .eq('is_bot', true)

  // Keep the Hub bot first so it stays the primary/avatar-key row.
  const found = ((data as BotRow[] | null) ?? []).slice()
  const rows = candidates
    .map((id) => found.find((r) => r.id === id))
    .filter((r): r is BotRow => Boolean(r))

  return {
    rows,
    storedName: (settings?.receptionist_name || '').trim(),
    hasReceptionistRow: Boolean(settings),
    hubBotUserId,
  }
}

function personaFromRows(
  rows: BotRow[],
  storedName: string,
  hubBotUserId: string | null,
): AssistantPersona {
  const hubBot = rows.find((r) => r.id === hubBotUserId) ?? rows[0] ?? null
  const fallbackName = (hubBot?.display_name || '').trim()
  const avatarRow = rows.find((r) => r.avatar_url) ?? null
  return {
    name: storedName || fallbackName || DEFAULT_RECEPTIONIST_NAME,
    avatarUrl: hubBot?.avatar_url ?? avatarRow?.avatar_url ?? null,
    botUserIds: rows.map((r) => r.id),
    // Empty when the company has no bot at all — never another tenant's row, which
    // would make the admin UI request a foreign company's avatar.
    primaryBotUserId: hubBot?.id ?? hubBotUserId ?? '',
  }
}

/** The company's current shared assistant persona (name + avatar + bot rows). */
export async function getAssistantPersona(
  admin: SupabaseClient,
  companyId: string
): Promise<AssistantPersona> {
  const { rows, storedName, hubBotUserId } = await loadPersonaRows(admin, companyId)
  return personaFromRows(rows, storedName, hubBotUserId)
}

/**
 * Rename the assistant everywhere: `display_name` on every persona bot row
 * (Hub chat, DMs, notifications, the outbound-text signature rendered by
 * lib/ai-text-identity) plus a write-through to `receptionist_name` (what the
 * phone receptionist speaks and what the Call Log credits).
 *
 * Returns which rows were touched so the caller can report it. Safe when a
 * company has only one bot row, or none: it updates what exists.
 */
export async function setAssistantPersonaName(
  admin: SupabaseClient,
  companyId: string,
  name: string,
  updatedBy?: string | null
): Promise<{ botUserIds: string[]; receptionistSynced: boolean }> {
  const trimmed = name.trim()
  const { rows, hasReceptionistRow } = await loadPersonaRows(admin, companyId)
  const ids = rows.map((r) => r.id)

  if (ids.length) {
    const { error } = await admin
      .from('hub_users')
      .update({ display_name: trimmed })
      .in('id', ids)
      .eq('company_id', companyId)
    if (error) throw new Error(error.message)
  }

  // Write-through, UPDATE only — never an upsert (see the header note about
  // `enabled` defaulting to false while the no-row resolver fails open).
  let receptionistSynced = false
  if (hasReceptionistRow) {
    const { error } = await admin
      .from('voice_receptionist_settings')
      .update({
        receptionist_name: trimmed,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy ?? null,
      })
      .eq('company_id', companyId)
    if (error) throw new Error(error.message)
    receptionistSynced = true
  }

  return { botUserIds: ids, receptionistSynced }
}

/**
 * Point every persona bot row at the same avatar object, so one upload gives the
 * Hub bot and the receptionist the same face.
 */
export async function setAssistantPersonaAvatar(
  admin: SupabaseClient,
  companyId: string,
  avatarKey: string
): Promise<{ botUserIds: string[] }> {
  const { rows } = await loadPersonaRows(admin, companyId)
  const ids = rows.map((r) => r.id)
  if (!ids.length) return { botUserIds: [] }

  const { error } = await admin
    .from('hub_users')
    .update({ avatar_url: avatarKey })
    .in('id', ids)
    .eq('company_id', companyId)
  if (error) throw new Error(error.message)

  return { botUserIds: ids }
}
