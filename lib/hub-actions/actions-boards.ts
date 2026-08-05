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

export const listTasksAction: HubAction = {
  name: 'list_tasks',
  description:
    'Open board tasks assigned to you (or, if you name someone, to that teammate). Shows what is due ' +
    'and what is overdue. Use this for "what\'s on my plate?", "anything overdue?", or "what does ' +
    'Kathryn have open?".',
  input_schema: {
    type: 'object',
    properties: {
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

    const boards = await visibleBoards(ctx)
    if (boards.length === 0) return 'There are no task boards you can see.'
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

    const orParts = [`assignee_id.eq.${targetUserId}`]
    if (joinIds.length) orParts.push(`id.in.(${joinIds.slice(0, 100).join(',')})`)
    q = q.or(orParts.join(','))

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
        return `• [${board}] ${i.content || '(no text)'} — ${due}${pri}${i.done ? ' · done' : ''}`
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
    const needle = boardName.toLowerCase()
    let matches = boards.filter((b) => b.name.toLowerCase() === needle)
    if (matches.length === 0) matches = boards.filter((b) => b.name.toLowerCase().includes(needle))
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
