import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'

// Guardian bot hub_users id (see app/api/hub/messages/route.ts CLAUDE_BOT_ID).
const GUARDIAN_BOT_ID = '00000000-0000-0000-0001-000000000001'

// Called by VPS cron (every ~15 min) — DOES send real Guardian DMs + pushes:
//   curl -s -X POST https://lynxedo.com/api/hub/boards/overdue-check \
//     -H "x-cron-secret: $CRON_SECRET"
// Each overdue task DMs its assignees exactly once (overdue_notified_at marker);
// changing a task's due date/time re-arms it (cleared in the item PUT route).

type AdminClient = ReturnType<typeof createAdminClient>

// Find-or-create the 1:1 DM conversation between a user and the Guardian bot.
async function ensureGuardianDm(admin: AdminClient, userId: string, companyId: string): Promise<string | null> {
  const { data: mine } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)
  const myIds = (mine ?? []).map((m: { conversation_id: string }) => m.conversation_id)

  if (myIds.length > 0) {
    const { data: withGuardian } = await admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', GUARDIAN_BOT_ID)
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
    { conversation_id: conv.id, user_id: GUARDIAN_BOT_ID },
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

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Candidate tasks: open, with a due date, not yet alerted.
  const { data: candidates, error } = await admin
    .from('board_items')
    .select('id, content, due_date, due_time, board_id')
    .eq('done', false)
    .is('overdue_notified_at', null)
    .not('due_date', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!candidates || candidates.length === 0) return NextResponse.json({ checked: 0, notified: 0 })

  const nowKey = nowCentralKey()
  type Item = { id: string; content: string; due_date: string; due_time: string | null; board_id: string }
  const overdue = (candidates as Item[]).filter(it => {
    const t = it.due_time ? it.due_time.slice(0, 5) : '23:59' // no time → due end of day
    return `${it.due_date} ${t}` <= nowKey
  })
  if (overdue.length === 0) return NextResponse.json({ checked: candidates.length, notified: 0 })

  const overdueIds = overdue.map(i => i.id)

  // Assignees + board names for the overdue set.
  const [{ data: assigneeRows }, { data: boardRows }] = await Promise.all([
    admin.from('board_item_assignees').select('board_item_id, user_id').in('board_item_id', overdueIds),
    admin.from('boards').select('id, name').in('id', [...new Set(overdue.map(i => i.board_id))]),
  ])
  const boardName: Record<string, string> = {}
  for (const b of (boardRows ?? []) as { id: string; name: string }[]) boardName[b.id] = b.name

  // Group overdue tasks per assignee → one consolidated DM each.
  const perUser: Record<string, Item[]> = {}
  for (const row of (assigneeRows ?? []) as { board_item_id: string; user_id: string }[]) {
    const it = overdue.find(i => i.id === row.board_item_id)
    if (!it) continue
    ;(perUser[row.user_id] ??= []).push(it)
  }

  let notified = 0
  for (const [userId, userItems] of Object.entries(perUser)) {
    const { data: prof } = await admin.from('user_profiles').select('company_id').eq('id', userId).single()
    if (!prof?.company_id) continue

    const lines = userItems.map(it => `• ${it.content}${boardName[it.board_id] ? `  (${boardName[it.board_id]})` : ''}`)
    const intro = userItems.length === 1
      ? 'Heads up — a task of yours is overdue:'
      : `Heads up — ${userItems.length} of your tasks are overdue:`
    const content = `${intro}\n${lines.join('\n')}`

    const convId = await ensureGuardianDm(admin, userId, prof.company_id)
    if (convId) {
      await admin.from('messages').insert({
        company_id: prof.company_id,
        conversation_id: convId,
        sender_id: GUARDIAN_BOT_ID,
        content,
      })
      await admin
        .from('conversation_members')
        .update({ archived_at: null })
        .eq('conversation_id', convId)
        .eq('user_id', userId)
        .not('archived_at', 'is', null)
    }

    await sendHubPush([userId], {
      title: userItems.length === 1 ? 'A task is overdue' : `${userItems.length} tasks overdue`,
      body: userItems.map(i => i.content).join(', ').slice(0, 120),
      url: `/hub/board/${userItems[0].board_id}`,
    }, { isDm: true }).catch((e: Error) => console.error('[overdue-check] push failed:', e.message))

    notified++
  }

  // Mark only the tasks we actually alerted on (those with ≥1 assignee), so an
  // unassigned-but-overdue task still alerts once someone is assigned to it.
  const notifiedItemIds = overdueIds.filter(id =>
    (assigneeRows ?? []).some((r: { board_item_id: string }) => r.board_item_id === id),
  )
  if (notifiedItemIds.length > 0) {
    await admin.from('board_items').update({ overdue_notified_at: new Date().toISOString() }).in('id', notifiedItemIds)
  }

  return NextResponse.json({ checked: candidates.length, overdue: overdue.length, notified })
}
