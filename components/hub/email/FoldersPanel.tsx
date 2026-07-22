'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import { LIGHT_SURFACE_STYLE } from './emailFormat'

type ManageFolder = {
  id: string
  provider_folder_id: string
  name: string | null
  system_folder: string | null
  hidden: boolean
  total_count: number
}

/**
 * Folder visibility manager (slide-over, light theme). Managers choose which
 * mailbox folders appear in the inbox folder picker; hidden folders still sync.
 * The Inbox + Drafts system folders are omitted — they're covered by the built-in
 * Inbox view and Drafts view. Manager-gated server-side.
 */
export default function FoldersPanel({
  open,
  account,
  onClose,
  onChanged,
}: {
  open: boolean
  account: 'shared' | 'personal'
  onClose: () => void
  onChanged?: () => void
}) {
  const [folders, setFolders] = useState<ManageFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setForbidden(false)
    try {
      const res = await fetch(`/api/hub/email/folders?account=${account}&manage=1`)
      if (res.status === 403) {
        setForbidden(true)
        setFolders([])
        return
      }
      if (res.ok) setFolders((await res.json()).folders || [])
    } finally {
      setLoading(false)
    }
  }, [account])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function toggle(f: ManageFolder) {
    if (busy) return
    const next = !f.hidden
    setBusy(f.id)
    setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, hidden: next } : x))) // optimistic
    try {
      const res = await fetch('/api/hub/email/folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, id: f.id, hidden: next }),
      })
      if (!res.ok) {
        setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, hidden: !next } : x))) // revert
      } else {
        onChanged?.()
      }
    } catch {
      setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, hidden: !next } : x)))
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  // Inbox + Drafts are handled by the built-in views — don't offer to hide those.
  const listed = folders.filter((f) => {
    const s = (f.system_folder || '').toLowerCase()
    return s !== 'inbox' && s !== 'drafts'
  })

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="email-light-surface relative h-full w-full max-w-md bg-white text-gray-900 shadow-2xl flex flex-col"
        style={LIGHT_SURFACE_STYLE}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold">Folders</h2>
            <p className="text-xs text-gray-500">
              Choose which folders show in the picker. Hidden folders still sync.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center">
              <Spinner size={6} />
            </div>
          ) : forbidden ? (
            <div className="p-6 text-sm text-gray-600">
              <p className="font-medium text-gray-900 mb-1">Manager access required</p>
              <p>Only inbox managers can manage folders.</p>
            </div>
          ) : listed.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No other folders on this mailbox yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {listed.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{f.name || '(unnamed)'}</div>
                    <div className="text-[11px] text-gray-400">
                      {f.system_folder ? `${f.system_folder} · ` : ''}
                      {f.total_count} items
                      {f.hidden ? ' · hidden' : ''}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 flex-none cursor-pointer">
                    <span className="text-xs text-gray-500">{f.hidden ? 'Hidden' : 'Shown'}</span>
                    <input
                      type="checkbox"
                      checked={!f.hidden}
                      disabled={busy === f.id}
                      onChange={() => toggle(f)}
                      className="h-4 w-4"
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
