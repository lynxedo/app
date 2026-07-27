'use client'

/**
 * Workspace-tab twin for a Board (`/hub/board/[boardId]`). Boards have no rail
 * entry and no single-board GET route, so this resolves the board's metadata
 * from the `GET /api/hub/boards` LIST (the same call the Hub sidebar uses — no
 * new endpoint) and renders the real BoardView. BoardView self-fetches its
 * items, so it only needs {board, hubUsers, currentUserId}.
 *
 * ⚠ Like the other twins, a backgrounded board tab doesn't live-refresh — items
 * reload on mount/revisit, not via a subscription (acceptable for v1).
 */

import { useEffect, useState, type ComponentProps } from 'react'
import BoardView from '@/components/hub/BoardView'

type BoardViewProps = ComponentProps<typeof BoardView>
type Board = BoardViewProps['board']

export default function BoardTab({
  boardId,
  hubUsers,
  currentUserId,
}: {
  boardId: string
  hubUsers: BoardViewProps['hubUsers']
  currentUserId: string
}) {
  const [board, setBoard] = useState<Board | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    fetch('/api/hub/boards')
      .then(r => (r.ok ? r.json() : { boards: [] }))
      .then(d => {
        if (!alive) return
        const found = (d.boards ?? []).find((b: Board) => b.id === boardId) ?? null
        setBoard(found)
        setState(found ? 'ready' : 'notfound')
      })
      .catch(() => { if (alive) setState('notfound') })
    return () => { alive = false }
  }, [boardId])

  if (state === 'loading') return <div className="flex-1 min-h-0 p-6 text-sm text-white/50">Loading board…</div>
  if (state === 'notfound' || !board) return <div className="flex-1 min-h-0 p-6 text-sm text-white/60">This board isn’t available.</div>
  return <BoardView board={board} hubUsers={hubUsers} currentUserId={currentUserId} />
}
