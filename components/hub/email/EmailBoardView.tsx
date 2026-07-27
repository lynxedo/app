'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner, EmptyState, useToast } from '@/components/ui'
import {
  LIGHT_SURFACE_STYLE,
  WAITING_LABELS,
  participantName,
  relativeTime,
  type EmailThread,
  type InboxTag,
  type WaitingState,
} from '@/components/hub/email/emailFormat'

/**
 * Kanban "board" view of the SHARED inbox (a main email pane, so it wears the
 * always-light LIGHT_SURFACE_STYLE regardless of the user's Hub theme).
 *
 * Cards are drag-and-dropped between columns; the drop mutates the thread on the
 * server via the same single-thread routes the sidebar/reader use:
 *   • Outcome tag — swap the thread's outcome tag (DELETE existing outcome ids,
 *     POST the target); type tags left untouched.
 *   • Status — POST /close or /reopen.
 *   • Waiting — POST /waiting {waiting_state} (null for "Not waiting").
 *
 * Drops are optimistic: the card moves immediately, the route fires, and on any
 * failure the whole board reverts to its pre-drop snapshot.
 */

type GroupMode = 'outcome' | 'status' | 'waiting'
type BoardColumn = { key: string; label: string; color?: string }

const GROUP_OPTIONS: { id: GroupMode; label: string }[] = [
  { id: 'outcome', label: 'Outcome tag' },
  { id: 'status', label: 'Status' },
  { id: 'waiting', label: 'Waiting' },
]

// Stable "no outcome" / "not waiting" column keys (never collide with a uuid tag id).
const NO_OUTCOME = '__none__'
const NOT_WAITING = '__not_waiting__'

export default function EmailBoardView() {
  const router = useRouter()
  const toast = useToast()

  const [threads, setThreads] = useState<EmailThread[]>([])
  const [tagCatalog, setTagCatalog] = useState<InboxTag[]>([])
  const [loading, setLoading] = useState(true)
  const [groupMode, setGroupMode] = useState<GroupMode>('outcome')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverColumn, setHoverColumn] = useState<string | null>(null)

  // Latest threads for drop handlers (avoids stale closures across rapid drops).
  const threadsRef = useRef<EmailThread[]>([])
  threadsRef.current = threads

  // Load the shared inbox (broad pull) + the tag catalog once.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch('/api/hub/email/threads?scope=all&limit=200')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .catch(() => ({ threads: [] })),
      fetch('/api/hub/email/tags')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .catch(() => ({ tags: [] })),
    ])
      .then(([threadData, tagData]) => {
        if (cancelled) return
        setThreads((threadData?.threads || []) as EmailThread[])
        setTagCatalog((tagData?.tags || []) as InboxTag[])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const tagById = useMemo(() => new Map(tagCatalog.map((t) => [t.id, t] as const)), [tagCatalog])

  const outcomeTags = useMemo(
    () =>
      tagCatalog
        .filter((t) => t.active && t.kind === 'outcome')
        .sort((a, b) => a.sort_order - b.sort_order),
    [tagCatalog]
  )
  const outcomeTagIds = useMemo(() => new Set(outcomeTags.map((t) => t.id)), [outcomeTags])

  // The columns for the current group mode.
  const columns: BoardColumn[] = useMemo(() => {
    if (groupMode === 'status') {
      return [
        { key: 'open', label: 'Open' },
        { key: 'closed', label: 'Closed' },
      ]
    }
    if (groupMode === 'waiting') {
      return [
        { key: NOT_WAITING, label: 'Not waiting' },
        ...(Object.keys(WAITING_LABELS) as WaitingState[]).map((w) => ({
          key: w,
          label: WAITING_LABELS[w],
        })),
      ]
    }
    // outcome
    return [
      { key: NO_OUTCOME, label: 'No outcome' },
      ...outcomeTags.map((t) => ({ key: t.id, label: t.name, color: t.color })),
    ]
  }, [groupMode, outcomeTags])

  // Which column a thread belongs to in the current mode.
  const columnKeyOf = useCallback(
    (t: EmailThread): string => {
      if (groupMode === 'status') return t.status === 'closed' ? 'closed' : 'open'
      if (groupMode === 'waiting') return t.waiting_state || NOT_WAITING
      const first = (t.tags || []).find((id) => outcomeTagIds.has(id))
      return first || NO_OUTCOME
    },
    [groupMode, outcomeTagIds]
  )

  // Group threads into { columnKey → threads } once per render.
  const byColumn = useMemo(() => {
    const map: Record<string, EmailThread[]> = {}
    for (const c of columns) map[c.key] = []
    for (const t of threads) {
      const key = columnKeyOf(t)
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return map
  }, [threads, columns, columnKeyOf])

  // Apply a drop: optimistic move + the server route call(s); revert on failure.
  const moveThread = useCallback(
    async (threadId: string, targetKey: string) => {
      const t = threadsRef.current.find((x) => x.id === threadId)
      if (!t) return
      if (columnKeyOf(t) === targetKey) return // already there

      const snapshot = threadsRef.current
      let optimistic: EmailThread
      const calls: (() => Promise<Response>)[] = []
      const base = `/api/hub/email/threads/${t.id}`
      const jsonInit = (body: unknown, method: string): RequestInit => ({
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (groupMode === 'status') {
        if (targetKey === 'closed') {
          optimistic = { ...t, status: 'closed' }
          calls.push(() => fetch(`${base}/close`, { method: 'POST' }))
        } else {
          optimistic = { ...t, status: t.assigned_to_user_id ? 'assigned' : 'open' }
          calls.push(() => fetch(`${base}/reopen`, { method: 'POST' }))
        }
      } else if (groupMode === 'waiting') {
        const ws: WaitingState | null = targetKey === NOT_WAITING ? null : (targetKey as WaitingState)
        optimistic = { ...t, waiting_state: ws }
        calls.push(() => fetch(`${base}/waiting`, jsonInit({ waiting_state: ws }, 'POST')))
      } else {
        // outcome — remove any existing outcome tag ids, then add the target (unless "No outcome").
        const existingOutcome = (t.tags || []).filter((id) => outcomeTagIds.has(id))
        const kept = (t.tags || []).filter((id) => !outcomeTagIds.has(id))
        const nextTags = targetKey === NO_OUTCOME ? kept : [...kept, targetKey]
        optimistic = { ...t, tags: nextTags }
        for (const rid of existingOutcome) {
          calls.push(() => fetch(`${base}/tags`, jsonInit({ tagId: rid }, 'DELETE')))
        }
        if (targetKey !== NO_OUTCOME) {
          calls.push(() => fetch(`${base}/tags`, jsonInit({ tagId: targetKey }, 'POST')))
        }
      }

      setThreads((prev) => prev.map((x) => (x.id === t.id ? optimistic : x)))

      try {
        // Sequential: the tags route is a read-modify-write on inbox_threads.tags,
        // so parallel add/remove would clobber each other.
        for (const call of calls) {
          const res = await call()
          if (!res.ok) throw new Error('request failed')
        }
      } catch {
        setThreads(snapshot)
        toast.error("Couldn't move that conversation")
      }
    },
    [groupMode, outcomeTagIds, columnKeyOf, toast]
  )

  function onCardDragStart(e: React.DragEvent, threadId: string) {
    setDraggingId(threadId)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', threadId)
    } catch {
      /* some browsers restrict setData; the draggingId state is the fallback */
    }
  }

  function onColumnDrop(e: React.DragEvent, targetKey: string) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    setHoverColumn(null)
    if (id) moveThread(id, targetKey)
  }

  const card = (t: EmailThread) => {
    const rowTags = (t.tags || [])
      .map((id) => tagById.get(id))
      .filter((x): x is InboxTag => !!x)
    const waiting = t.waiting_state || null
    return (
      <div
        key={t.id}
        draggable
        onDragStart={(e) => onCardDragStart(e, t.id)}
        onDragEnd={() => {
          setDraggingId(null)
          setHoverColumn(null)
        }}
        onClick={() => router.push(`/hub/email/${t.id}`)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            router.push(`/hub/email/${t.id}`)
          }
        }}
        className={`cursor-pointer select-none rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm transition hover:border-gray-300 hover:shadow ${
          draggingId === t.id ? 'opacity-50' : ''
        }`}
        title="Open conversation"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[13px] font-medium text-gray-900">
            {participantName(t.from_name, t.from_email)}
          </span>
          <span className="flex-none text-[10px] text-gray-400">
            {relativeTime(t.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-gray-600">
          {t.subject || '(no subject)'}
        </div>
        {(waiting || rowTags.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {waiting && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" aria-hidden />
                {WAITING_LABELS[waiting]}
              </span>
            )}
            {rowTags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: tag.color || '#64748b', color: '#fff' }}
                title={tag.name}
              >
                {tag.name}
              </span>
            ))}
            {rowTags.length > 3 && (
              <span className="px-1 py-0.5 text-[9px] text-gray-400">+{rowTags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="email-light-surface flex min-h-0 flex-1 flex-col bg-gray-100 text-gray-900"
      style={LIGHT_SURFACE_STYLE}
    >
      {/* Header — title + Group by selector. */}
      <div className="flex flex-none items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-3">
        <h1 className="text-base font-semibold text-gray-900">Board</h1>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Group by
          <select
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value as GroupMode)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner size={6} />
        </div>
      ) : threads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState title="No conversations." hint="The shared inbox is empty." size="lg" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-5 py-4">
          {columns.map((col) => {
            const items = byColumn[col.key] || []
            const isHover = hoverColumn === col.key
            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (hoverColumn !== col.key) setHoverColumn(col.key)
                }}
                onDragLeave={(e) => {
                  // Only clear when the pointer actually leaves the column box.
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setHoverColumn((prev) => (prev === col.key ? null : prev))
                  }
                }}
                onDrop={(e) => onColumnDrop(e, col.key)}
                className={`flex w-72 flex-none flex-col rounded-xl border bg-gray-50 transition ${
                  isHover ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-none items-center gap-2 border-b border-gray-200 px-3 py-2">
                  {col.color && (
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ backgroundColor: col.color }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate text-[13px] font-medium text-gray-700">{col.label}</span>
                  <span className="ml-auto flex-none rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {items.length}
                  </span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {items.length === 0 ? (
                    <div className="px-1 py-6 text-center text-[11px] text-gray-400">
                      Drop here
                    </div>
                  ) : (
                    items.map(card)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
