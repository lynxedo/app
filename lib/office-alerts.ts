import { createAdminClient } from '@/lib/supabase/admin'
import { postGuardianToRoom } from '@/lib/guardian-post'
import { broadcastMessageInserted } from '@/lib/hub-message-broadcast'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Where automated alerts land. Ben created a dedicated "Office Alerts" room on
 * 2026-08-19 so the working "office" room stops being a feed of robot posts.
 *
 * Resolved BY NAME per company rather than by a hardcoded uuid. The three alert
 * sources (AI receptionist wrap-up, Google LSA poll, Angi webhook) each carried
 * their own copy of Heroes' office-room uuid, which meant a second tenant's LSA
 * lead would have posted into HEROES' room — the FK is satisfied, so it would
 * have looked legitimate. Resolving per company closes that.
 */
const ALERTS_ROOM_NAME = 'Office Alerts'

/** The room alerts used to go to. Kept ONLY as a fallback (see resolve below). */
const LEGACY_ALERTS_ROOM_NAME = 'office'

/**
 * Cache per company for the lifetime of the process — the name rarely changes.
 *
 * Only SUCCESSFUL lookups are cached. Caching a miss would turn one transient
 * database hiccup into "this company posts no alerts again until the next
 * deploy" — a silent failure on the speed-to-lead path, which is the one thing
 * these alerts exist to protect.
 */
const roomIdCache = new Map<string, string>()

/**
 * The room this company's automated alerts belong in.
 *
 * Order: env override → a room named "Office Alerts" → the legacy "office" room.
 *
 * The legacy fallback is deliberate: losing a speed-to-lead alert entirely is far
 * worse than posting it in the old room, so a renamed/missing alerts room degrades
 * to yesterday's behaviour instead of silence. It warns when it falls back.
 *
 * Returns null when neither room exists for the company — callers skip the post
 * rather than reaching for another tenant's room.
 */
export async function getOfficeAlertsRoomId(
  admin: SupabaseAdmin,
  companyId: string,
): Promise<string | null> {
  const override = process.env.OFFICE_ALERTS_ROOM_ID
  if (override) return override

  const cached = roomIdCache.get(companyId)
  if (cached) return cached

  const { data: rooms, error } = await admin
    .from('rooms')
    .select('id, name')
    .eq('company_id', companyId)
    .is('archived_at', null)
  if (error) {
    console.error(`[office-alerts] room lookup failed for company ${companyId}:`, error.message)
    return null
  }

  const list = (rooms ?? []) as { id: string; name: string }[]
  const match = (want: string) =>
    list.find((r) => (r.name ?? '').trim().toLowerCase() === want.toLowerCase())?.id ?? null

  const alertsRoom = match(ALERTS_ROOM_NAME)
  const resolved = alertsRoom ?? match(LEGACY_ALERTS_ROOM_NAME)

  if (!alertsRoom) {
    console.warn(
      resolved
        ? `[office-alerts] no "${ALERTS_ROOM_NAME}" room for company ${companyId} — falling back to "${LEGACY_ALERTS_ROOM_NAME}"`
        : `[office-alerts] no alerts room for company ${companyId} — skipping alert`,
    )
  }

  if (resolved) roomIdCache.set(companyId, resolved)
  return resolved
}

export type OfficeAlert = {
  /** The one-line headline. This is the whole room post. */
  title: string
  /** Everything else — posted as a single threaded reply under the title. */
  details: Array<string | null | undefined | false>
}

/**
 * Post an alert as a headline in the alerts room with the detail in a thread.
 *
 * Ben's rule: the room reads as a scannable list of "who called and about what",
 * and anything you'd need in order to act on it sits one tap away in the thread.
 *
 * Best-effort by contract — every caller ingests a lead or a call first and alerts
 * second, so a messaging hiccup must never fail the ingest. Errors are logged and
 * swallowed; the return value says what (if anything) was posted.
 */
export async function postOfficeAlert(
  admin: SupabaseAdmin,
  companyId: string,
  alert: OfficeAlert,
): Promise<{ titleMessageId: string; replyMessageId: string | null } | null> {
  try {
    const roomId = await getOfficeAlertsRoomId(admin, companyId)
    if (!roomId) return null

    const title = alert.title.replace(/\s*\n[\s\S]*$/, '').trim()
    if (!title) return null

    const detailBody = alert.details
      .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      .join('\n')

    const titleMessageId = await postGuardianToRoom(roomId, title, { admin })
    if (!titleMessageId) return null

    // The reply is posted AFTER the title exists, so a failure here leaves a
    // headline with no thread — visible and obviously incomplete — rather than
    // an orphaned detail post with nothing to hang off.
    let replyMessageId: string | null = null
    if (detailBody) {
      replyMessageId = await postGuardianToRoom(roomId, detailBody, {
        admin,
        parentId: titleMessageId,
      })
    }

    // Live delivery. broadcastMessageInserted bumps the headline's reply count in
    // the feed and pushes the reply into an already-open thread panel.
    const senderId = await resolveSenderId(admin, titleMessageId)
    if (senderId) {
      await broadcastMessageInserted({
        messageId: titleMessageId,
        roomId,
        conversationId: null,
        parentId: null,
        senderId,
      }).catch(() => {})
      if (replyMessageId) {
        await broadcastMessageInserted({
          messageId: replyMessageId,
          roomId,
          conversationId: null,
          parentId: titleMessageId,
          senderId,
        }).catch(() => {})
      }
    }

    return { titleMessageId, replyMessageId }
  } catch (e) {
    console.error('[office-alerts] post failed:', (e as Error).message)
    return null
  }
}

async function resolveSenderId(admin: SupabaseAdmin, messageId: string): Promise<string | null> {
  const { data } = await admin
    .from('messages')
    .select('sender_id')
    .eq('id', messageId)
    .maybeSingle<{ sender_id: string | null }>()
  return data?.sender_id ?? null
}
