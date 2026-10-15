// Gary — the outbound sales agent (PRD: Drive Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md).
//
// Amber is the inside rep (answers whoever contacts us). Gary is the outside rep:
// he goes back to people who raised their hand and didn't buy, and later finds
// new commercial accounts. Session 1 (Oct 15 2026) is identity + settings + a
// preview-only win-back list — Gary sends NOTHING yet.
//
// Ben's rules that live in code, not settings:
//   • Never mowing, never pet waste. They are not even offered as choices.
//   • Email by default; text only someone already in our system whom we have
//     texted before (lib/gary-winback.ts decides the channel).
//   • No AI phone calls — a phone-only person goes on a call list for a person.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

export const GARY_SERVICES = ['irrigation', 'lawn_health', 'aeration', 'drainage', 'mosquito'] as const
export type GaryService = (typeof GARY_SERVICES)[number]

export const GARY_SERVICE_LABEL: Record<GaryService, string> = {
  irrigation: 'Irrigation',
  lawn_health: 'Fertilization & weed control',
  aeration: 'Aeration',
  drainage: 'Drainage',
  mosquito: 'Mosquito',
}

/** The Jobber department a service is done under (jobs.dept_prefix / quote service codes). */
export const GARY_SERVICE_DEPT: Record<GaryService, string> = {
  irrigation: 'IR',
  drainage: 'IR',
  lawn_health: 'WF',
  aeration: 'WF',
  mosquito: 'MO',
}

export const GARY_SIGNATURE = 'Gary, Heroes Lawn Care'

export type GarySettings = {
  botUserId: string | null
  services: GaryService[]
  recentTouchDays: number
  /** Who may approve Gary's emails. Empty → company admins. */
  approverIds: string[]
  /** Most emails Gary may send in one Central-time day. */
  dailyEmailCap: number
  /** Off = nothing reaches a real customer (tests still go to the approver). */
  customerSending: boolean
  /** Days after the FIRST message that follow-up 2 and the last try (3) are due. */
  followUpDays: [number, number]
}

const DEFAULTS: GarySettings = {
  botUserId: null,
  services: [...GARY_SERVICES],
  recentTouchDays: 30,
  approverIds: [],
  dailyEmailCap: 20,
  customerSending: false,
  followUpDays: [7, 21],
}

/** [follow-up 2, last try] in days after the first message; null if invalid. */
function cleanFollowUpDays(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null
  const [a, b] = v.map((x) => Math.round(Number(x)))
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || a > 60 || b <= a || b > 90) return null
  return [a, b]
}

function cleanServices(v: unknown): GaryService[] {
  if (!Array.isArray(v)) return [...DEFAULTS.services]
  return GARY_SERVICES.filter((s) => v.includes(s))
}

export async function getGarySettings(admin: Admin, companyId: string): Promise<GarySettings> {
  const { data, error } = await admin
    .from('gary_settings')
    .select('bot_user_id, services, recent_touch_days, approver_ids, daily_email_cap, customer_sending, follow_up_days')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw new Error(`gary_settings: ${error.message}`)
  if (!data) return { ...DEFAULTS, services: [...DEFAULTS.services], approverIds: [] }
  return {
    botUserId: data.bot_user_id ?? null,
    services: cleanServices(data.services),
    recentTouchDays: Number.isFinite(data.recent_touch_days) ? data.recent_touch_days : DEFAULTS.recentTouchDays,
    approverIds: Array.isArray(data.approver_ids) ? data.approver_ids : [],
    dailyEmailCap: Number.isFinite(data.daily_email_cap) ? data.daily_email_cap : DEFAULTS.dailyEmailCap,
    customerSending: data.customer_sending === true,
    followUpDays: cleanFollowUpDays(data.follow_up_days) ?? DEFAULTS.followUpDays,
  }
}

export async function saveGarySettings(
  admin: Admin,
  companyId: string,
  userId: string,
  patch: {
    services?: unknown
    recentTouchDays?: unknown
    approverIds?: string[]
    dailyEmailCap?: unknown
    customerSending?: unknown
    followUpDays?: unknown
  },
): Promise<void> {
  const row: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString(), updated_by: userId }
  if (patch.services !== undefined) row.services = cleanServices(patch.services)
  if (patch.recentTouchDays !== undefined) {
    const n = Math.round(Number(patch.recentTouchDays))
    if (!Number.isFinite(n) || n < 1 || n > 365) throw new Error('Days must be between 1 and 365')
    row.recent_touch_days = n
  }
  if (patch.customerSending !== undefined) row.customer_sending = patch.customerSending === true
  if (patch.followUpDays !== undefined) {
    const days = cleanFollowUpDays(patch.followUpDays)
    if (!days) throw new Error('Follow-up days must be 1–60, and the last try later than the first follow-up (up to 90)')
    row.follow_up_days = days
  }
  // The route validates approverIds against the people who may approve.
  if (patch.approverIds !== undefined) row.approver_ids = patch.approverIds
  if (patch.dailyEmailCap !== undefined) {
    const n = Math.round(Number(patch.dailyEmailCap))
    if (!Number.isFinite(n) || n < 1 || n > 200) throw new Error('The daily limit must be between 1 and 200')
    row.daily_email_cap = n
  }
  const { error } = await admin.from('gary_settings').upsert(row, { onConflict: 'company_id' })
  if (error) throw new Error(error.message)
}

/**
 * Gary's Hub identity for this company: the bot row named in gary_settings,
 * verified to be a bot of THIS company (a misconfigured id must never let Gary
 * speak as a person or as another tenant's bot).
 */
export async function getGaryBot(
  admin: Admin,
  companyId: string,
  botUserId: string | null,
): Promise<{ id: string; displayName: string; avatarUrl: string | null } | null> {
  if (!botUserId) return null
  const { data } = await admin
    .from('hub_users')
    .select('id, display_name, avatar_url')
    .eq('id', botUserId)
    .eq('company_id', companyId)
    .eq('is_bot', true)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, displayName: data.display_name || 'Gary', avatarUrl: data.avatar_url ?? null }
}

// ── What a lead or quote was about ─────────────────────────────────────────
//
// Lead `service` values are a mix of Jobber-style codes (IRR SC, WF - Lawn
// Health, MOS) and Amber's free-text summaries; quotes carry Jobber department
// codes (IR / WF / MO / PW) plus a title. One classifier reads both.

export type ServiceRead = {
  services: GaryService[]
  /** Something Gary must never sell was asked about (mowing / pet waste). */
  excluded: ('mowing' | 'pet_waste')[]
}

const RX = {
  pet_waste: /pet\s*waste|\bPW\b|poop|dog\s*waste/i,
  mowing: /\bmow(ing|ed)?\b|lawn\s*mainten?ance\s*(crew|mow)/i,
  drainage: /drain/i,
  aeration: /aerat|\bAER\b/i,
  mosquito: /mosquito|\bMOS\b/i,
  irrigation: /\bIRR?\b|irrigat|sprinkler|backflow|rachio|\bzones?\b|valve|controller|drip\s*(line|bed)|spigot|winteri[sz]|\bwire\b/i,
  lawn_health:
    /\bWF\b|lawn\s*health|ferti|weed|crabgrass|torpedo|fung|brown\s*patch|grub|insect|fire\s*ant|lawn\s*(treat|care)|root\s*rot|\bRRR\b|\bLH[BPC]?\b|\bPHC\b|\btrees?\b|\bshrubs?\b|bare\s*spot|pre-?em/i,
}

export function readServices(texts: (string | null | undefined)[], deptCodes: string[] = []): ServiceRead {
  const text = texts.filter(Boolean).join(' · ')
  const found = new Set<GaryService>()
  const excluded = new Set<'mowing' | 'pet_waste'>()

  if (RX.pet_waste.test(text)) excluded.add('pet_waste')
  if (RX.mowing.test(text)) excluded.add('mowing')
  if (RX.drainage.test(text)) found.add('drainage')
  if (RX.aeration.test(text)) found.add('aeration')
  if (RX.mosquito.test(text)) found.add('mosquito')
  // "Drain install" lives in the IR department; don't also call it irrigation
  // unless the words say sprinkler/irrigation.
  if (RX.irrigation.test(text.replace(/\bIR\s+drain/gi, 'drain'))) found.add('irrigation')
  if (RX.lawn_health.test(text)) found.add('lawn_health')

  // Department codes fill in when the words were vague (a quote titled "Guy").
  const codes = deptCodes.map((c) => c.toUpperCase())
  if (codes.includes('PW')) excluded.add('pet_waste')
  if (codes.includes('MO')) found.add('mosquito') // MO = mosquito at Heroes, not mowing
  if (codes.includes('IR') && !found.has('irrigation') && !found.has('drainage')) found.add('irrigation')
  if (codes.includes('WF') && !found.has('lawn_health') && !found.has('aeration')) found.add('lawn_health')

  return { services: GARY_SERVICES.filter((s) => found.has(s)), excluded: [...excluded] }
}

/** May this person approve Gary's emails? The picked approvers, else company admins. */
export async function isGaryApprover(admin: Admin, companyId: string, userId: string, settings: GarySettings): Promise<boolean> {
  if (settings.approverIds.length) return settings.approverIds.includes(userId)
  const { data } = await admin.from('user_profiles').select('role, company_id').eq('id', userId).maybeSingle()
  return data?.role === 'admin' && data?.company_id === companyId
}
