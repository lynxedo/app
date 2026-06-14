'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/ui'

type ScheduledRow = {
  id: string
  content: string
  send_at: string
  room_id: string | null
  conversation_id: string | null
  parent_id: string | null
  files: { filename: string }[] | null
  target_label: string
}

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ScheduledMessagesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<ScheduledRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editSendAt, setEditSendAt] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const minDateTime = (() => {
    const d = new Date(Date.now() + 60_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })()

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/hub/scheduled-messages')
      if (!res.ok) throw new Error('Failed to load scheduled messages')
      const json = await res.json()
      setRows(json.scheduled ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const startEdit = (row: ScheduledRow) => {
    setEditingId(row.id)
    setEditContent(row.content ?? '')
    setEditSendAt(toLocalDatetimeInputValue(row.send_at))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
    setEditSendAt('')
  }

  const saveEdit = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/hub/scheduled-messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editContent,
          send_at: new Date(editSendAt).toISOString(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to save')
      }
      cancelEdit()
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setBusyId(null)
    }
  }

  const sendNow = async (id: string) => {
    if (!confirm('Send this message now?')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/hub/scheduled-messages/${id}/send-now`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to send')
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this scheduled message? This cannot be undone.')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/hub/scheduled-messages/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to delete')
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Scheduled messages</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-gray-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-400">No scheduled messages.</p>
          )}
          {!loading && rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map(row => {
                const isEditing = editingId === row.id
                const isBusy = busyId === row.id
                return (
                  <li key={row.id} className="bg-gray-800/60 border border-gray-700 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-400">
                          {row.parent_id ? 'Thread reply in ' : 'To '}
                          <span className="text-gray-200 font-medium">{row.target_label}</span>
                        </p>
                        <p className="text-xs text-amber-300 mt-0.5">🕐 {formatWhen(row.send_at)}</p>
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          rows={3}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8] resize-none"
                          placeholder="Message"
                        />
                        <input
                          type="datetime-local"
                          min={minDateTime}
                          value={editSendAt}
                          onChange={e => setEditSendAt(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(row.id)}
                            disabled={isBusy || (!editContent.trim() && !(row.files && row.files.length > 0)) || !editSendAt}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#2E7EB8] hover:bg-[#2470a8] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-300 hover:text-white hover:bg-gray-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-white whitespace-pre-wrap break-words mb-2">
                          {row.content || <span className="text-gray-500 italic">(no text)</span>}
                        </p>
                        {row.files && row.files.length > 0 && (
                          <p className="text-xs text-gray-400 mb-2">📎 {row.files.length} attachment{row.files.length === 1 ? '' : 's'}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            disabled={isBusy}
                            className="px-2.5 py-1 text-xs rounded-md text-gray-300 hover:text-white hover:bg-gray-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => sendNow(row.id)}
                            disabled={isBusy}
                            className="px-2.5 py-1 text-xs rounded-md text-emerald-300 hover:text-white hover:bg-emerald-700/40"
                          >
                            Send now
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(row.id)}
                            disabled={isBusy}
                            className="px-2.5 py-1 text-xs rounded-md text-red-300 hover:text-white hover:bg-red-700/40"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
