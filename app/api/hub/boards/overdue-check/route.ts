import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { getHubBotUserId } from '@/lib/guardian-post'
import { selectInChunks } from '@/lib/supabase/chunked-in'
import {
  bucketDueItems,
  loadBoardAudience,
  loadBoardPrefs,
  pickBoardRecipients,
  type BoardAudience,
  type BoardNotifyPrefs,
} from '@/lib/board-notify'

// Called by VPS cron (every ~15 min) — DOES send real Guardian DMs + pushes:
//   curl -s -X POST https://lynxedo.com/api/hub/boards/overdue-check \
//     -H "x-cron-secret: $CRON_SECRET"
//
// Two alerts come out of here, each sent at most once per deadline:
//   • a heads-up on the morning a task is DUE (from DUE_HEADS_UP_AT, Central)
//   • the OVERDUE alert when the deadline itself passes
// Changing a task's due date/time re-arms both (cleared in the item PUT route).
//
// Who hears about them is each person's own choice, made from the 🔔 in the
// board header: every task on the board, only the ones they're on, or nothing.
// The default is "only mine", which is exactly who this cron alerted before
// that setting existed.

type AdminClient = ReturnType<typeof createAdminClient>

// Local time of day at which the "due today" heads-up goes out. Early enough to
// act on before the working day, late enough not to arrive overnight.
const DUE_HEADS_UP_AT = '07:00'

// Find-or-create the 1:1 DM conversation between a user and their company's Hub bot.
async function ensureGuardianDm(
  admin: AdminClient,
  userId: string,
  companyId: string,
  botUserId: string,
): Promise<string | null> {
  const { data: mine } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)
  const myIds = (mine ?? []).map((m: { conversation_id: string }) => m.conversation_id)

  if (myIds.length > 0) {
    const { data: withGuardian } = await admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', botUserId)
      .in('conversation_id', myIds)
    const sharedIds = (withGuardian ?? []).map((m: { conversation_id: string }) => m.conversation_id)
    if (sharedIds.length > 0) {
      // Prefer a true 1:1 (exactly two members) so we don't post into a group.
      const { data: members } = await admin
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', sharedIds)
      const counts: Record<string, number> = {}
      for (const m of (members ?? []) as { conversation_id: string; user_id: string }[]) {
        counts[m.conversation_id] = (counts[m.conversation_id] ?? 0) + 1
      }
      const exact = sharedIds.find(id => counts[id] === 2)
      if (exact) {
        await admin
          .from('conversation_members')
          .update({ archived_at: null })
          .eq('conversation_id', exact)
          .eq('user_id', userId)
        return exact
      }
    }
  }

  const { data: conv, error } = await admin
    .from('conversations')
    .insert({ company_id: companyId })
    .select('id')
    .single()
  if (error || !conv) return null
  await admin.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: userId },
    { conversation_id: conv.id, user_id: botUserId },
  ])
  return conv.id
}

// Current America/Chicago wall-clock as a 'YYYY-MM-DD HH:MM' string. Comparing
// this lexically against an item's due 'YYYY-MM-DD HH:MM' is chronologically
// correct and DST-safe (both are wall-clock in the same zone — no instant math).
function nowCentralKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

type Item = {
  id: string
  content: string
  due_date: string
  due_time: string | null
  board_id: string
  overdue_notified_at: string | null
  due_notified_at: string | null
}

type Bucket = 'overdue' | 'due_today'

/** One person's share of one bucket. */
type Pending = { items: Item[]; allMine: boolean }

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Open tasks with a deadline that still owe at least one of the two alerts.
  const { data: candidates, error } = await admin
    .from('board_items')
    .select('id, content, due_date, due_time, board_id, overdue_notified_at, due_notified_at')
    .eq('done', false)
    .not('due_date', 'is', null)
    .or('overdue_notified_at.is.null,due_notified_at.is.null')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!candidates || candidates.length === 0) return NextResponse.json({ checked: 0, notified: 0 })

  const all = candidates as Item[]
  // Disjoint by construction — a task past its time is overdue, never also a
  // "due today" heads-up, so one deadline is never announced twice.
  const { overdue, dueToday } = bucketDueItems(all, nowCentralKey(), DUE_HEADS_UP_AT)

  if (overdue.length === 0 && dueToday.length === 0) {
    return NextResponse.json({ checked: all.length, overdue: 0, due_today: 0, notified: 0 })
  }

  const touched = [...overdue, ...dueToday]
  const touchedIds = [...new Set(touched.map(i => i.id))]

  // Assignees for everything in play — both the "Only tasks assigned to me"
  // test and the wording of each DM depend on them. Chunked: the ids ride in
  // the PostgREST URL, and a first run after a quiet spell can carry hundreds.
  const assigneeRows = await selectInChunks<{ board_item_id: string; user_id: string }>(
    touchedIds,
    batch => admin.from('board_item_assignees').select('board_item_id, user_id').in('board_item_id', batch),
  )
  const assigneesByItem: Record<string, Set<string>> = {}
  for (const r of assigneeRows) {
    ;(assigneesByItem[r.board_item_id] ??= new Set()).add(r.user_id)
  }

  // One audience + prefs read per board, however many of its tasks are in play.
  const boardCache = new Map<string, { audience: BoardAudience; prefs: Map<string, BoardNotifyPrefs> } | null>()
  async function boardCtx(boardId: string) {
    if (!boardCache.has(boardId)) {
      const audience = await loadBoardAudience(admin, boardId)
      boardCache.set(boardId, audience ? { audience, prefs: await loadBoardPrefs(admin, boardId) } : null)
    }
    return boardCache.get(boardId) ?? null
  }

  // bucket → userId → their pending items
  const perUser: Record<Bucket, Record<string, Pending>> = { overdue: {}, due_today: {} }
  const boardNameById: Record<string, string> = {}
  const notifiedIds: Record<Bucket, Set<string>> = { overdue: new Set(), due_today: new Set() }

  for (const [bucket, items] of [['overdue', overdue], ['due_today', dueToday]] as [Bucket, Item[]][]) {
    for (const it of items) {
      const ctx = await boardCtx(it.board_id)
      if (!ctx) continue
      boardNameById[it.board_id] = ctx.audience.name

      const assignees = assigneesByItem[it.id] ?? new Set<string>()
      // No actorId — nobody "did" a deadline passing, so an assignee who set
      // the date still hears about it.
      const recipients = pickBoardRecipients(ctx.audience, ctx.prefs, {
        kind: 'due',
        involvedIds: assignees,
      })
      if (recipients.length === 0) continue

      for (const uid of recipients) {
        const slot = (perUser[bucket][uid] ??= { items: [], allMine: true })
        slot.items.push(it)
        if (!assignees.has(uid)) slot.allMine = false
      }
      notifiedIds[bucket].add(it.id)
    }
  }

  let notified = 0
  // Recipients usually share a company, so resolve each company's Hub bot once.
  const botByCompany = new Map<string, string | null>()

  for (const bucket of ['overdue', 'due_today'] as Bucket[]) {
    for (const [userId, { items: userItems, allMine }] of Object.entries(perUser[bucket])) {
      const { data: prof } = await admin.from('user_profiles').select('company_id').eq('id', userId).maybeSingle()
      if (!prof?.company_id) continue

      const companyId = prof.company_id as string
      if (!botByCompany.has(companyId)) {
        botByCompany.set(companyId, await getHubBotUserId(admin, companyId))
      }
      const botUserId = botByCompany.get(companyId) ?? null

      const n = userItems.length
      const lines = userItems.map(it => {
        const name = boardNameById[it.board_id]
        return `• ${it.content}${name ? `  (${name})` : ''}`
      })
      // "of yours" only when every task listed really is theirs — someone who
      // asked to hear about the whole board is not being told these are their
      // tasks.
      const whose = allMine ? (n === 1 ? 'a task of yours is' : `${n} of your tasks are`) : (n === 1 ? 'a task is' : `${n} tasks are`)
      const state = bucket === 'overdue' ? 'overdue' : 'due today'
      const content = `Heads up — ${whose} ${state}:\n${lines.join('\n')}`

      // No bot for this company → skip the DM (the push below still goes out, so
      // the person is still told; we just don't post as another tenant's bot).
      const convId = botUserId
        ? await ensureGuardianDm(admin, userId, companyId, botUserId)
        : null
      if (convId && botUserId) {
        await admin.from('messages').insert({
          company_id: companyId,
          conversation_id: convId,
          sender_id: botUserId,
          content,
        })
        await admin
          .from('conversation_members')
          .update({ archived_at: null })
          .eq('conversation_id', convId)
          .eq('user_id', userId)
          .not('archived_at', 'is', null)
      }

      const title = bucket === 'overdue'
        ? (n === 1 ? 'A task is overdue' : `${n} tasks overdue`)
        : (n === 1 ? 'A task is due today' : `${n} tasks due today`)

      await sendHubPush([userId], {
        title,
        body: userItems.map(i => i.content).join(', ').slice(0, 120),
        url: `/hub/board/${userItems[0].board_id}`,
        type: 'board',
      }, { isDm: true }).catch((e: Error) => console.error('[overdue-check] push failed:', e.message))

      notified++
    }
  }

  // Mark only the tasks somebody was actually told about, so a task nobody has
  // asked to hear about yet still alerts once someone opts in or is assigned.
  // An overdue alert also stamps the due-today marker: the deadline has passed,
  // so the morning heads-up for it is moot.
  const stamp = new Date().toISOString()
  await selectInChunks(
    [...notifiedIds.overdue],
    batch => admin.from('board_items')
      .update({ overdue_notified_at: stamp, due_notified_at: stamp })
      .in('id', batch)
      .select('id'),
  )
  await selectInChunks(
    [...notifiedIds.due_today],
    batch => admin.from('board_items')
      .update({ due_notified_at: stamp })
      .in('id', batch)
      .select('id'),
  )

  return NextResponse.json({
    checked: all.length,
    overdue: overdue.length,
    due_today: dueToday.length,
    notified,
  })
}
