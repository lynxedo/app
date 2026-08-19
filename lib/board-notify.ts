import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Per-person notification settings for a Hub Board.
 *
 * Every person on a board picks their own — set from the 🔔 in the board header,
 * never from Settings or Admin — and one person's choice never changes what
 * anybody else receives.
 *
 * Four things a board can tell you about, each All / Only mine / Off:
 *   new_tasks  a task was added
 *   replies    someone wrote a note on a task
 *   files      someone attached a file to a task
 *   due        a task is due today, or has gone overdue
 *
 * @mentions are NOT in the list. Being named is a direct address, so it always
 * notifies — the same rule rooms and DMs follow.
 */

type Admin = ReturnType<typeof createAdminClient>

export const BOARD_NOTIFY_KINDS = ['new_tasks', 'replies', 'files', 'due'] as const
export type BoardNotifyKind = (typeof BOARD_NOTIFY_KINDS)[number]

export const BOARD_NOTIFY_LEVELS = ['all', 'mine', 'off'] as const
export type BoardNotifyLevel = (typeof BOARD_NOTIFY_LEVELS)[number]

export type BoardNotifyPrefs = Record<BoardNotifyKind, BoardNotifyLevel>

/**
 * What someone gets when they have never opened the panel. These reproduce the
 * behaviour that shipped before this feature EXACTLY, so no existing board
 * changes what it sends until a person chooses otherwise:
 *   new_tasks 'all'  — a new task already pushed to every board member
 *   replies   'off'  — a note notified nobody but the people it @mentioned
 *   files     'off'  — an attachment notified nobody at all
 *   due       'mine' — the overdue cron already DM'd the assignees only
 */
export const BOARD_NOTIFY_DEFAULTS: BoardNotifyPrefs = {
  new_tasks: 'all',
  replies: 'off',
  files: 'off',
  due: 'mine',
}

export function isBoardNotifyLevel(v: unknown): v is BoardNotifyLevel {
  return typeof v === 'string' && (BOARD_NOTIFY_LEVELS as readonly string[]).includes(v)
}

/** Coerce an untrusted object into a complete, valid prefs set. */
export function sanitizeBoardNotifyPrefs(input: unknown): BoardNotifyPrefs {
  const src = (input ?? {}) as Record<string, unknown>
  const out = { ...BOARD_NOTIFY_DEFAULTS }
  for (const kind of BOARD_NOTIFY_KINDS) {
    if (isBoardNotifyLevel(src[kind])) out[kind] = src[kind]
  }
  return out
}

export type BoardAudience = {
  id: string
  name: string
  companyId: string
  isPrivate: boolean
  createdBy: string
  /**
   * Everyone allowed to open this board — mirrors the boards_select RLS policy.
   * Nobody outside this set is ever notified, whatever their saved settings
   * say, because a board notification quotes the task's own text.
   */
  visibleIds: Set<string>
  /**
   * Who is considered "on the board" when they have saved nothing: its creator
   * plus its member rows. A public board carries no member rows, so its wider
   * audience only hears about it once someone opts in — which is what keeps
   * this change silent for boards nobody has configured.
   */
  defaultIds: Set<string>
}

/** Load a board plus the two audience sets above. Null when the board is gone. */
export async function loadBoardAudience(admin: Admin, boardId: string): Promise<BoardAudience | null> {
  const { data: board } = await admin
    .from('boards')
    .select('id, name, company_id, is_private, created_by')
    .eq('id', boardId)
    .maybeSingle()
  if (!board) return null

  const { data: memberRows } = await admin
    .from('board_members')
    .select('user_id')
    .eq('board_id', boardId)
  const memberIds = ((memberRows ?? []) as { user_id: string }[]).map(m => m.user_id)

  const defaultIds = new Set<string>([board.created_by as string, ...memberIds])

  let visibleIds: Set<string>
  if (board.is_private) {
    visibleIds = new Set(defaultIds)
  } else {
    // A public board is readable by the whole company (boards_select), so its
    // audience is every teammate — not just the member rows, of which a public
    // board usually has none.
    const { data: companyUsers } = await admin
      .from('hub_users')
      .select('id')
      .eq('company_id', board.company_id)
    visibleIds = new Set<string>([
      ...defaultIds,
      ...((companyUsers ?? []) as { id: string }[]).map(u => u.id),
    ])
  }

  return {
    id: board.id as string,
    name: (board.name as string) ?? 'a board',
    companyId: board.company_id as string,
    isPrivate: !!board.is_private,
    createdBy: board.created_by as string,
    visibleIds,
    defaultIds,
  }
}

/** Everyone who has saved settings on this board, by user id. */
export async function loadBoardPrefs(admin: Admin, boardId: string): Promise<Map<string, BoardNotifyPrefs>> {
  const { data } = await admin
    .from('board_notification_prefs')
    .select('user_id, new_tasks, replies, files, due')
    .eq('board_id', boardId)
  const map = new Map<string, BoardNotifyPrefs>()
  for (const row of (data ?? []) as (Record<string, unknown> & { user_id: string })[]) {
    map.set(row.user_id, sanitizeBoardNotifyPrefs(row))
  }
  return map
}

/**
 * Who should be told about one thing that happened on a board.
 *
 * Pure so it can be exercised directly. Three rules, in order:
 *   1. never the person who did it, and never anyone who can't open the board;
 *   2. someone who saved settings gets what they asked for — including opting
 *      IN to a public board they aren't a member of;
 *   3. everyone else falls back to BOARD_NOTIFY_DEFAULTS, applied only to the
 *      board's default audience, which is exactly what shipped before.
 */
export function pickBoardRecipients(
  audience: BoardAudience,
  prefs: Map<string, BoardNotifyPrefs>,
  opts: { kind: BoardNotifyKind; actorId?: string | null; involvedIds?: Iterable<string> },
): string[] {
  const involved = new Set(opts.involvedIds ?? [])
  const candidates = new Set<string>([...audience.defaultIds, ...prefs.keys()])
  const out: string[] = []

  for (const userId of candidates) {
    if (opts.actorId && userId === opts.actorId) continue
    if (!audience.visibleIds.has(userId)) continue

    const level = prefs.get(userId)?.[opts.kind] ?? BOARD_NOTIFY_DEFAULTS[opts.kind]
    if (level === 'off') continue
    if (level === 'mine' && !involved.has(userId)) continue

    out.push(userId)
  }
  return out
}

/**
 * Everyone with a stake in one task: its assignees, whoever created it, and
 * anyone who has replied to it. This is what "Only tasks I'm on" means — reply
 * to a task and you keep hearing the rest of that conversation.
 */
export async function involvedOnItem(admin: Admin, itemId: string): Promise<Set<string>> {
  const [{ data: assignees }, { data: item }, { data: commenters }] = await Promise.all([
    admin.from('board_item_assignees').select('user_id').eq('board_item_id', itemId),
    admin.from('board_items').select('created_by').eq('id', itemId).maybeSingle(),
    admin.from('board_item_comments').select('created_by').eq('board_item_id', itemId),
  ])
  const set = new Set<string>()
  for (const a of (assignees ?? []) as { user_id: string }[]) set.add(a.user_id)
  for (const c of (commenters ?? []) as { created_by: string }[]) set.add(c.created_by)
  if (item?.created_by) set.add(item.created_by as string)
  return set
}

/** Convenience for the single-event routes: load, resolve, return. */
export async function boardNotifyRecipients(
  admin: Admin,
  opts: { boardId: string; kind: BoardNotifyKind; actorId?: string | null; involvedIds?: Iterable<string> },
): Promise<{ audience: BoardAudience; recipientIds: string[] } | null> {
  const audience = await loadBoardAudience(admin, opts.boardId)
  if (!audience) return null
  const prefs = await loadBoardPrefs(admin, opts.boardId)
  return { audience, recipientIds: pickBoardRecipients(audience, prefs, opts) }
}

// ── Deadlines ───────────────────────────────────────────────────────────────

/**
 * A task carrying a deadline. Kept structural so the cron's own row type
 * satisfies it without a cast.
 */
export type DueItem = {
  due_date: string
  due_time: string | null
  overdue_notified_at?: string | null
  due_notified_at?: string | null
}

/**
 * A task's deadline as a 'YYYY-MM-DD HH:MM' wall-clock key, matching the format
 * the cron builds for "now". Comparing the two lexically is chronologically
 * correct and DST-safe — both are wall-clock in the same zone, no instant math.
 *
 * A task with no time of day is due at the END of its day, not the start, so
 * "due Thursday" doesn't go overdue at one minute past midnight on Thursday.
 */
export function dueKey(it: DueItem): string {
  return `${it.due_date} ${it.due_time ? it.due_time.slice(0, 5) : '23:59'}`
}

/**
 * Split tasks into the two deadline alerts, each owed at most once.
 *
 *  overdue   the deadline has passed and the overdue alert hasn't been sent
 *  dueToday  due later today, the heads-up hour has arrived, not yet sent
 *
 * A task whose time has already passed is only ever in `overdue` — the two
 * buckets are disjoint by construction, so one deadline never announces twice
 * in the same run.
 *
 * @param nowKey     current wall-clock as 'YYYY-MM-DD HH:MM' in the business zone
 * @param headsUpAt  'HH:MM' local time the morning heads-up may start going out
 */
export function bucketDueItems<T extends DueItem>(
  items: T[],
  nowKey: string,
  headsUpAt: string,
): { overdue: T[]; dueToday: T[] } {
  const today = nowKey.slice(0, 10)
  const clock = nowKey.slice(11)
  const overdue = items.filter(it => !it.overdue_notified_at && dueKey(it) <= nowKey)
  const dueToday = items.filter(it =>
    !it.due_notified_at &&
    it.due_date === today &&
    clock >= headsUpAt &&
    dueKey(it) > nowKey,
  )
  return { overdue, dueToday }
}
