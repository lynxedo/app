// Board (task list) actions: list_tasks, create_task.
//
// ⚠ board_items stores the task text in `content`, NOT `title` — the stale
// db/schema.sql baseline also omits due_time / recurrence, which are live.

import type { ActionContext, HubAction } from './types'
import { limitArg, str, uuidArg } from './types'
import { dayLabel, lines, opsYmd, resolveDateArg } from './format'

const PRIORITIES = new Set(['none', 'low', 'medium', 'high'])

/** Boards this actor can legitimately see: company boards minus other people's private ones. */
async function visibleBoards(ctx: ActionContext): Promise<Array<{ id: string; name: string }>> {
  const { data: boards } = await ctx.admin
    .from('boards')
    .select('id, name, is_private, is_personal, created_by')
    .eq('company_id', ctx.actor.companyId)
  const rows = (boards || []) as Array<{
    id: string
    name: string | null
    is_private: boolean | null
    is_personal: boolean | null
    created_by: string | null
  }>

  const restricted = rows.filter((b) => b.is_private || b.is_personal).map((b) => b.id)
  const memberOf = new Set<string>()
  if (restricted.length) {
    const { data: memberships } = await ctx.admin
      .from('board_members')
      .select('board_id')
      .eq('user_id', ctx.actor.userId)
      .in('board_id', restricted.slice(0, 200))
    for (const m of (memberships || []) as Array<{ board_id: string }>) memberOf.add(m.board_id)
  }

  return rows
    .filter((b) => {
      if (!b.is_private && !b.is_personal) return true
      return b.created_by === ctx.actor.userId || memberOf.has(b.id)
    })
    .map((b) => ({ id: b.id, name: (b.name || 'Untitled board').trim() }))
}

/** Exact name first, then partial — the same rule create_task always used. */
function matchBoards(boards: Array<{ id: string; name: string }>, raw: string): Array<{ id: string; name: string }> {
  const needle = raw.toLowerCase()
  const exact = boards.filter((b) => b.name.toLowerCase() === needle)
  return exact.length ? exact : boards.filter((b) => b.name.toLowerCase().includes(needle))
}

/** One teammate by (partial) name, or a message saying why not. */
async function findTeammate(
  ctx: ActionContext,
  name: string,
): Promise<{ ok: true; id: string; label: string } | { ok: false; message: string }> {
  const { data } = await ctx.admin
    .from('hub_users')
    .select('id, display_name')
    .eq('company_id', ctx.actor.companyId)
    .ilike('display_name', `%${name.replace(/[%_]/g, '')}%`)
    .limit(5)
  const rows = (data || []) as Array<{ id: string; display_name: string | null }>
  if (rows.length === 0) return { ok: false, message: `No teammate named "${name}".` }
  const exact = rows.filter((r) => (r.display_name || '').trim().toLowerCase() === name.trim().toLowerCase())
  const pickRows = exact.length === 1 ? exact : rows
  if (pickRows.length > 1) {
    return { ok: false, message: `"${name}" matches ${rows.map((p) => p.display_name).join(', ')}. Ask which one.` }
  }
  return { ok: true, id: pickRows[0].id, label: (pickRows[0].display_name || '').trim() }
}

export const listTasksAction: HubAction = {
  name: 'list_tasks',
  description:
    'Open board tasks assigned to you (or, if you name someone, to that teammate). Shows what is due ' +
    'and what is overdue. Use this for "what\'s on my plate?", "anything overdue?", or "what does ' +
    'Kathryn have open?". Pass board_name to see every open task on one board instead. Each task comes ' +
    'with a task_id for update_task.',
  input_schema: {
    type: 'object',
    properties: {
      board_name: {
        type: 'string',
        description: 'List every task on this board (partial names work) instead of one person\'s tasks.',
      },
      assignee_name: {
        type: 'string',
        description: "A teammate's name to look up instead of yourself. Omit for your own tasks.",
      },
      include_done: { type: 'boolean', description: 'Include completed tasks (default false).' },
      limit: { type: 'number', description: 'Max tasks (default 20, max 50).' },
    },
    required: [],
  },
  kind: 'read',
  gate: null,
  consentLabel: 'read your task lists',
  run: async (ctx, args) => {
    const includeDone = args.include_done === true || args.include_done === 'true'
    const limit = limitArg(args, 20, 50)
    const assigneeName = str(args, 'assignee_name')
    const boardFilter = str(args, 'board_name')

    let targetUserId = ctx.actor.userId
    let targetLabel = 'you'
    if (assigneeName) {
      const { data: matches } = await ctx.admin
        .from('hub_users')
        .select('id, display_name')
        .eq('company_id', ctx.actor.companyId)
        .ilike('display_name', `%${assigneeName.replace(/[%_]/g, '')}%`)
        .limit(5)
      const people = (matches || []) as Array<{ id: string; display_name: string | null }>
      if (people.length === 0) return `No teammate named "${assigneeName}" in this company.`
      if (people.length > 1) {
        return `More than one teammate matches "${assigneeName}": ${people.map((p) => p.display_name).join(', ')}. Ask which one.`
      }
      targetUserId = people[0].id
      targetLabel = (people[0].display_name || 'they').trim()
    }

    const allBoards = await visibleBoards(ctx)
    if (allBoards.length === 0) return 'There are no task boards you can see.'
    let boards = allBoards
    if (boardFilter) {
      const found = matchBoards(allBoards, boardFilter)
      if (found.length === 0) {
        return `No board matches "${boardFilter}". Boards you can see: ${allBoards.map((b) => b.name).join(', ')}.`
      }
      if (found.length > 1) return `"${boardFilter}" matches ${found.map((b) => b.name).join(', ')}. Ask which one.`
      boards = found
      if (!assigneeName) targetLabel = `the ${found[0].name} board`
    }
    const boardNameById = new Map(boards.map((b) => [b.id, b.name]))

    // Assignment lives in two places: the legacy single assignee_id column and
    // the board_item_assignees join added with multi-assignee support. Check both.
    const { data: joinRows } = await ctx.admin
      .from('board_item_assignees')
      .select('board_item_id')
      .eq('user_id', targetUserId)
      .limit(500)
    const joinIds = ((joinRows || []) as Array<{ board_item_id: string }>).map((r) => r.board_item_id)

    let q = ctx.admin
      .from('board_items')
      .select('id, board_id, content, done, priority, due_date, due_time, assignee_id, created_at')
      .eq('company_id', ctx.actor.companyId)
      .in('board_id', boards.map((b) => b.id).slice(0, 200))
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit)
    if (!includeDone) q = q.eq('done', false)

    // A board listing shows everyone's tasks on it; otherwise, one person's.
    if (!boardFilter || assigneeName) {
      const orParts = [`assignee_id.eq.${targetUserId}`]
      if (joinIds.length) orParts.push(`id.in.(${joinIds.slice(0, 100).join(',')})`)
      q = q.or(orParts.join(','))
    }

    const { data } = await q
    const items = (data || []) as Array<{
      id: string
      board_id: string
      content: string | null
      done: boolean | null
      priority: string | null
      due_date: string | null
      due_time: string | null
    }>

    if (items.length === 0) {
      return targetLabel === 'you'
        ? 'You have no open tasks assigned on any board you can see.'
        : `${targetLabel} has no open tasks on the boards you can see.`
    }

    const today = opsYmd()
    const overdue = items.filter((i) => !i.done && i.due_date && i.due_date < today)
    return lines(
      `${items.length} task${items.length === 1 ? '' : 's'} for ${targetLabel}` +
        (overdue.length ? ` — ${overdue.length} overdue.` : '.'),
      ...items.map((i) => {
        const board = boardNameById.get(i.board_id) || 'a board'
        const due = i.due_date
          ? `${i.due_date < today && !i.done ? 'OVERDUE ' : 'due '}${dayLabel(i.due_date)}${i.due_time ? ` ${i.due_time.slice(0, 5)}` : ''}`
          : 'no due date'
        const pri = i.priority && i.priority !== 'none' ? ` · ${i.priority} priority` : ''
        return `• [${board}] ${i.content || '(no text)'} — ${due}${pri}${i.done ? ' · done' : ''} · task_id ${i.id}`
      }),
    )
  },
}

export const createTaskAction: HubAction = {
  name: 'create_task',
  description:
    'Create a task on a board. Use this when the user asks to add a to-do, a reminder, or a follow-up. ' +
    'If they do not say which board, call list_tasks or ask — do not guess a board. The task is ' +
    'attributed to you as the creator.',
  input_schema: {
    type: 'object',
    properties: {
      board_name: {
        type: 'string',
        description: 'The board to add it to, by name (e.g. "Development", "Office"). Partial names work.',
      },
      content: { type: 'string', description: 'The task text.' },
      assignee_name: { type: 'string', description: "Teammate to assign it to. Omit to leave unassigned." },
      due_date: { type: 'string', description: 'Optional due date: "today", "tomorrow", or YYYY-MM-DD.' },
      priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'Optional priority.' },
    },
    required: ['board_name', 'content'],
  },
  kind: 'write',
  gate: null,
  consentLabel: 'create tasks on your boards',
  run: async (ctx, args) => {
    const boardName = str(args, 'board_name')
    const content = str(args, 'content')
    if (!boardName) return 'Which board should this go on? List the boards or ask the user.'
    if (!content) return 'Provide the task text.'
    if (content.length > 1000) return 'That task text is too long — keep it under about 1000 characters.'

    const boards = await visibleBoards(ctx)
    if (boards.length === 0) return 'There are no task boards you can add to.'
    const matches = matchBoards(boards, boardName)
    if (matches.length === 0) {
      return `No board matches "${boardName}". Boards you can use: ${boards.map((b) => b.name).join(', ')}.`
    }
    if (matches.length > 1) {
      return `"${boardName}" matches more than one board: ${matches.map((b) => b.name).join(', ')}. Ask which one.`
    }
    const board = matches[0]

    let assigneeId: string | null = null
    let assigneeLabel = ''
    const assigneeName = str(args, 'assignee_name')
    if (assigneeName) {
      const { data: people } = await ctx.admin
        .from('hub_users')
        .select('id, display_name')
        .eq('company_id', ctx.actor.companyId)
        .ilike('display_name', `%${assigneeName.replace(/[%_]/g, '')}%`)
        .limit(5)
      const rows = (people || []) as Array<{ id: string; display_name: string | null }>
      if (rows.length === 0) return `No teammate named "${assigneeName}". Create it unassigned, or ask who they mean.`
      if (rows.length > 1) {
        return `"${assigneeName}" matches ${rows.map((p) => p.display_name).join(', ')}. Ask which one.`
      }
      assigneeId = rows[0].id
      assigneeLabel = (rows[0].display_name || '').trim()
    }

    const dueRaw = str(args, 'due_date')
    const dueDate = dueRaw ? resolveDateArg(dueRaw) : null
    if (dueRaw && !dueDate) {
      return `I couldn't read "${dueRaw}" as a date. Use "today", "tomorrow", or YYYY-MM-DD.`
    }

    const priorityRaw = str(args, 'priority').toLowerCase()
    const priority = PRIORITIES.has(priorityRaw) ? priorityRaw : 'none'

    const { data: created, error } = await ctx.admin
      .from('board_items')
      .insert({
        board_id: board.id,
        company_id: ctx.actor.companyId,
        content,
        priority,
        recurrence: 'none',
        due_date: dueDate,
        assignee_id: assigneeId,
        created_by: ctx.actor.userId,
      })
      .select('id')
      .maybeSingle()

    if (error || !created) return "I couldn't create that task just now."

    // Mirror into the multi-assignee join table so the task shows up in the
    // assignee's My Tasks view, which reads the join.
    if (assigneeId) {
      void ctx.admin
        .from('board_item_assignees')
        .insert({ board_item_id: (created as { id: string }).id, user_id: assigneeId })
        .then(undefined, () => {})
    }

    return lines(
      `Task added to ${board.name}: "${content}"`,
      assigneeLabel ? `Assigned to ${assigneeLabel}.` : 'Left unassigned.',
      dueDate ? `Due ${dayLabel(dueDate)}.` : null,
      priority !== 'none' ? `Priority: ${priority}.` : null,
    )
  },
}

const RECURRENCES = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly'])

/** Same roll-forward the board screen uses when a recurring task is ticked off. */
function advanceDueDate(dueDate: string, recurrence: string): string {
  const d = new Date(dueDate + 'T00:00:00Z')
  switch (recurrence) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break
    case 'biweekly': d.setUTCDate(d.getUTCDate() + 14); break
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break
    default: return dueDate
  }
  return d.toISOString().slice(0, 10)
}

export const updateTaskAction: HubAction = {
  name: 'update_task',
  description:
    'Change an existing board task: mark it done or reopen it, reassign it, change its text, due date or ' +
    'priority. Needs the task_id from list_tasks. Marking a RECURRING task done rolls it forward to its ' +
    'next due date (exactly like ticking it on the board) rather than closing it.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'The task_id from list_tasks.' },
      done: { type: 'boolean', description: 'true to complete it, false to reopen it.' },
      content: { type: 'string', description: 'New task text.' },
      assignee_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replace who it is assigned to. [] leaves it unassigned.',
      },
      due_date: { type: 'string', description: '"today", "tomorrow", YYYY-MM-DD, or "none" to clear it.' },
      priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
    },
    required: ['task_id'],
  },
  kind: 'write',
  gate: null,
  consentLabel: 'update tasks on your boards',
  run: async (ctx, args) => {
    const taskId = uuidArg(args, 'task_id')
    if (!taskId) return 'Give me the task_id from list_tasks.'

    const { data: row } = await ctx.admin
      .from('board_items')
      .select('id, board_id, content, done, due_date, recurrence')
      .eq('id', taskId)
      .eq('company_id', ctx.actor.companyId)
      .maybeSingle()
    const item = row as { id: string; board_id: string; content: string | null; done: boolean | null; due_date: string | null; recurrence: string | null } | null
    // A task on a private board this person can't see doesn't exist, as far as they're concerned.
    const boards = await visibleBoards(ctx)
    if (!item || !boards.some((b) => b.id === item.board_id)) return "There's no task with that id on a board you can see."

    const update: Record<string, unknown> = {}
    const said: string[] = []

    const content = str(args, 'content')
    if (content) {
      if (content.length > 1000) return 'That task text is too long — keep it under about 1000 characters.'
      update.content = content
      said.push(`text → "${content}"`)
    }
    const dueRaw = str(args, 'due_date')
    if (dueRaw) {
      if (dueRaw.toLowerCase() === 'none') {
        update.due_date = null
        said.push('due date cleared')
      } else {
        const due = resolveDateArg(dueRaw)
        if (!due) return `I couldn't read "${dueRaw}" as a date. Use "today", "tomorrow", or YYYY-MM-DD.`
        update.due_date = due
        said.push(`due ${dayLabel(due)}`)
      }
      update.overdue_notified_at = null
      update.due_notified_at = null
    }
    const priority = str(args, 'priority').toLowerCase()
    if (priority) {
      if (!PRIORITIES.has(priority)) return 'priority must be none, low, medium or high.'
      update.priority = priority
      said.push(`priority ${priority}`)
    }

    let assigneeIds: string[] | null = null
    if (Array.isArray(args.assignee_names)) {
      assigneeIds = []
      const labels: string[] = []
      for (const n of args.assignee_names) {
        if (typeof n !== 'string' || !n.trim()) continue
        const who = await findTeammate(ctx, n)
        if (!who.ok) return `${who.message} Nothing was changed.`
        assigneeIds.push(who.id)
        labels.push(who.label)
      }
      said.push(labels.length ? `assigned to ${labels.join(', ')}` : 'unassigned')
    }

    let recurred: string | null = null
    if (args.done === true || args.done === 'true') {
      const rec = item.recurrence && RECURRENCES.has(item.recurrence) ? item.recurrence : 'none'
      if (rec !== 'none' && item.due_date) {
        recurred = advanceDueDate(item.due_date, rec)
        await ctx.admin.from('board_item_comments').insert({
          board_item_id: item.id,
          company_id: ctx.actor.companyId,
          content: `✅ Completed ${dayLabel(item.due_date)} by ${ctx.actor.displayName}`,
          created_by: ctx.actor.userId,
        })
        Object.assign(update, { done: false, done_at: null, due_date: recurred, overdue_notified_at: null, due_notified_at: null })
        said.push(`completed — it repeats ${rec}, so it's now due ${dayLabel(recurred)}`)
      } else {
        Object.assign(update, { done: true, done_at: new Date().toISOString() })
        said.push('marked done')
      }
    } else if (args.done === false || args.done === 'false') {
      Object.assign(update, { done: false, done_at: null })
      said.push('reopened')
    }

    if (Object.keys(update).length === 0 && assigneeIds === null) {
      return 'Nothing to change — say what should change on that task.'
    }

    if (Object.keys(update).length) {
      const { error } = await ctx.admin
        .from('board_items')
        .update(update)
        .eq('id', item.id)
        .eq('company_id', ctx.actor.companyId)
      if (error) return `The board refused that change (${error.message}). Nothing was changed.`
    }
    if (assigneeIds !== null) {
      // Both places assignment lives, kept in step (see list_tasks).
      await ctx.admin.from('board_item_assignees').delete().eq('board_item_id', item.id)
      if (assigneeIds.length) {
        await ctx.admin
          .from('board_item_assignees')
          .insert(assigneeIds.map((uid) => ({ board_item_id: item.id, user_id: uid })))
      }
      await ctx.admin
        .from('board_items')
        .update({ assignee_id: assigneeIds[0] ?? null })
        .eq('id', item.id)
        .eq('company_id', ctx.actor.companyId)
    }

    return `Updated "${item.content || 'task'}": ${said.join('; ')}.`
  },
}
