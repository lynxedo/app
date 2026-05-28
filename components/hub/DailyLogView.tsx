'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type HubUser = { id: string; display_name: string; avatar_url?: string | null; is_bot?: boolean }

type AttachmentItem = {
  key: string
  name: string
  type: string
}

type DailyLogUpdate = {
  id: string
  content: string
  media_urls?: AttachmentItem[] | null
  created_at: string
  created_by: string
  creator?: HubUser | null
}

type DailyLogEntry = {
  id: string
  log_date: string
  office_notes: string | null
  route_sheet_url: string | null
  route_sheet_name: string | null
  created_at: string
  tech: HubUser | null
  creator: HubUser | null
  completer: HubUser | null
  completed_at: string | null
  completed_by: string | null
  closer: HubUser | null
  closed_at: string | null
  closed_by: string | null
  secondary_tech_user_ids: string[]
  secondary_techs: HubUser[]
  updates: DailyLogUpdate[]
  subscriber_ids: string[]
}

function formatDateHeading(dateStr: string) {
  // dateStr is YYYY-MM-DD — parse as local date to avoid TZ shifting
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function offsetDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function UserAvatar({ user, size = 7 }: { user: HubUser | null; size?: number }) {
  if (!user) return null
  const initials = user.display_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={`w-${size} h-${size} rounded-full bg-[#2E7EB8] flex items-center justify-center text-white font-semibold text-xs flex-none`}>
      {initials}
    </div>
  )
}

// ── Board Picker ─────────────────────────────────────────────────────────────

function BoardPicker({
  content,
  onDone,
  onCancel,
}: {
  content: string
  onDone: () => void
  onCancel: () => void
}) {
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([])
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch('/api/hub/boards')
      .then(r => r.json())
      .then(d => setBoards(d.boards ?? []))
      .catch(() => {})
  }, [])

  async function pick(boardId: string) {
    setAdding(true)
    await fetch(`/api/hub/boards/${boardId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    setAdding(false)
    onDone()
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl min-w-[200px] py-1">
      <div className="px-3 py-1.5 text-xs text-white/40 font-semibold uppercase tracking-wider border-b border-gray-800">
        Add to Board
      </div>
      {boards.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-500">No boards yet</p>
      )}
      {boards.map(board => (
        <button
          key={board.id}
          disabled={adding}
          onClick={() => pick(board.id)}
          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {board.name}
        </button>
      ))}
      <div className="border-t border-gray-800 mt-1">
        <button
          onClick={onCancel}
          className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Entry Card ───────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  currentUserId,
  isAdmin,
  hubUsers,
  onDeleted,
  onUpdated,
}: {
  entry: DailyLogEntry
  currentUserId: string
  isAdmin: boolean
  hubUsers: HubUser[]
  onDeleted: (id: string) => void
  onUpdated: (entry: DailyLogEntry) => void
}) {
  const [updates, setUpdates] = useState<DailyLogUpdate[]>(entry.updates)
  const [updateText, setUpdateText] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentItem[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [sendingUpdate, setSendingUpdate] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState(entry.office_notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [boardPickerUpdateId, setBoardPickerUpdateId] = useState<string | null>(null)
  const [notesBoardOpen, setNotesBoardOpen] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(entry.subscriber_ids.includes(currentUserId))
  const [togglingSubscribe, setTogglingSubscribe] = useState(false)
  const [togglingComplete, setTogglingComplete] = useState(false)
  const [togglingClose, setTogglingClose] = useState(false)
  const [addingSecondary, setAddingSecondary] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const updatesBottomRef = useRef<HTMLDivElement>(null)

  const canEdit = isAdmin || entry.creator?.id === currentUserId
  const isOnEntry =
    entry.tech?.id === currentUserId ||
    entry.secondary_tech_user_ids.includes(currentUserId)
  const canToggleComplete = isAdmin || isOnEntry
  const canToggleClose = isAdmin // gated to admin / can_admin_daily_log (resolved upstream)
  const isComplete = Boolean(entry.completed_at)
  const isClosed = Boolean(entry.closed_at)

  async function toggleComplete() {
    if (togglingComplete) return
    setTogglingComplete(true)
    const method = isComplete ? 'DELETE' : 'POST'
    const res = await fetch(`/api/hub/daily-log/${entry.id}/complete`, { method })
    setTogglingComplete(false)
    if (!res.ok) return
    if (isComplete) {
      onUpdated({ ...entry, completed_at: null, completed_by: null, completer: null })
    } else {
      const now = new Date().toISOString()
      onUpdated({
        ...entry,
        completed_at: now,
        completed_by: currentUserId,
        completer: { id: currentUserId, display_name: 'You' },
      })
    }
  }

  async function toggleClose() {
    if (togglingClose) return
    setTogglingClose(true)
    const method = isClosed ? 'DELETE' : 'POST'
    const res = await fetch(`/api/hub/daily-log/${entry.id}/close`, { method })
    setTogglingClose(false)
    if (!res.ok) return
    if (isClosed) {
      onUpdated({ ...entry, closed_at: null, closed_by: null, closer: null })
    } else {
      const now = new Date().toISOString()
      onUpdated({
        ...entry,
        closed_at: now,
        closed_by: currentUserId,
        closer: { id: currentUserId, display_name: 'You' },
      })
    }
  }

  async function addSecondaryTech(techId: string) {
    if (!techId) return
    const next = [...entry.secondary_tech_user_ids, techId]
    const res = await fetch(`/api/hub/daily-log/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secondary_tech_user_ids: next }),
    })
    if (res.ok) {
      const newTech = hubUsers.find(u => u.id === techId)
      onUpdated({
        ...entry,
        secondary_tech_user_ids: next,
        secondary_techs: newTech ? [...entry.secondary_techs, newTech] : entry.secondary_techs,
      })
      setAddingSecondary(false)
    }
  }

  async function removeSecondaryTech(techId: string) {
    const next = entry.secondary_tech_user_ids.filter(id => id !== techId)
    const res = await fetch(`/api/hub/daily-log/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secondary_tech_user_ids: next }),
    })
    if (res.ok) {
      onUpdated({
        ...entry,
        secondary_tech_user_ids: next,
        secondary_techs: entry.secondary_techs.filter(t => t.id !== techId),
      })
    }
  }

  async function toggleSubscribe() {
    setTogglingSubscribe(true)
    const method = isSubscribed ? 'DELETE' : 'POST'
    await fetch(`/api/hub/daily-log/${entry.id}/subscribe`, { method })
    setIsSubscribed(v => !v)
    setTogglingSubscribe(false)
  }

  useEffect(() => {
    setUpdates(entry.updates)
  }, [entry.updates])

  async function handleAttachFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const fileArr = Array.from(files)
    setUploadingCount(c => c + fileArr.length)
    await Promise.all(fileArr.map(async (file) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/hub/daily-log/${entry.id}/updates/upload`, { method: 'POST', body: fd })
      if (res.ok) {
        const item: AttachmentItem = await res.json()
        setPendingAttachments(prev => [...prev, item])
      }
      setUploadingCount(c => c - 1)
    }))
  }

  async function submitUpdate() {
    const hasText = updateText.trim().length > 0
    const hasFiles = pendingAttachments.length > 0
    if ((!hasText && !hasFiles) || sendingUpdate || uploadingCount > 0) return
    setSendingUpdate(true)
    const res = await fetch(`/api/hub/daily-log/${entry.id}/updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: updateText.trim(), media_urls: pendingAttachments }),
    })
    const data = await res.json()
    setSendingUpdate(false)
    if (res.ok) {
      setUpdates(prev => [...prev, data])
      setUpdateText('')
      setPendingAttachments([])
      setTimeout(() => updatesBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  async function deleteUpdate(updateId: string) {
    await fetch(`/api/hub/daily-log/${entry.id}/updates/${updateId}`, { method: 'DELETE' })
    setUpdates(prev => prev.filter(u => u.id !== updateId))
  }

  async function saveNotes() {
    setSavingNotes(true)
    const res = await fetch(`/api/hub/daily-log/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ office_notes: notesText }),
    })
    setSavingNotes(false)
    if (res.ok) {
      setEditingNotes(false)
      onUpdated({ ...entry, office_notes: notesText || null })
    }
  }

  async function uploadRouteSheet(file: File) {
    setUploading(true)
    setUploadError('')
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/hub/daily-log/${entry.id}/upload`, { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (res.ok) {
      onUpdated({ ...entry, route_sheet_url: data.route_sheet_url, route_sheet_name: data.route_sheet_name })
    } else {
      setUploadError(data.error ?? 'Upload failed')
    }
  }

  async function deleteEntry() {
    await fetch(`/api/hub/daily-log/${entry.id}`, { method: 'DELETE' })
    onDeleted(entry.id)
  }

  // Techs already on this entry (primary + secondaries) — excluded from add-second picker
  const onEntryIds = new Set<string>([
    entry.tech?.id ?? '',
    ...entry.secondary_tech_user_ids,
  ])

  return (
    <div className={`bg-gray-900 border rounded-2xl overflow-hidden transition-all ${
      isComplete ? 'border-emerald-700/50' : 'border-gray-700/60'
    } ${isClosed ? 'opacity-60' : ''}`}>
      {/* Card header */}
      <div className={`border-b ${
        isComplete ? 'bg-emerald-900/20 border-emerald-700/40' : 'bg-gray-800/60 border-gray-700/50'
      }`}>
        {/* Row 1 — tech info + actions */}
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <UserAvatar user={entry.tech} size={8} />
            <span className="font-semibold text-white text-sm">
              {entry.tech?.display_name ?? 'Unknown Tech'}
            </span>
            {/* Secondary techs as chips */}
            {entry.secondary_techs.map(t => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/60 text-xs text-gray-300"
                title="Secondary tech"
              >
                + {t.display_name}
                {canEdit && (
                  <button
                    onClick={() => removeSecondaryTech(t.id)}
                    className="text-gray-500 hover:text-red-400 ml-0.5"
                    title="Remove"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {/* Add second tech */}
            {canEdit && (
              addingSecondary ? (
                <select
                  autoFocus
                  onBlur={() => setAddingSecondary(false)}
                  onChange={e => addSecondaryTech(e.target.value)}
                  defaultValue=""
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-0.5 text-xs text-white outline-none focus:border-[#2E7EB8]"
                >
                  <option value="" disabled>+ Add tech…</option>
                  {hubUsers
                    .filter(u => !u.is_bot && !onEntryIds.has(u.id))
                    .sort((a, b) => a.display_name.localeCompare(b.display_name))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                </select>
              ) : (
                <button
                  onClick={() => setAddingSecondary(true)}
                  className="text-xs text-gray-500 hover:text-[#2E7EB8] transition-colors"
                  title="Add a second tech who rode on this route"
                >
                  + tech
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-none">
          {/* Follow / Unfollow */}
          <button
            onClick={toggleSubscribe}
            disabled={togglingSubscribe}
            title={isSubscribed ? 'Unfollow — you will stop receiving notifications for this entry' : 'Follow — get notified when updates are posted'}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
              isSubscribed
                ? 'border-[#2E7EB8] text-[#2E7EB8] hover:bg-[#2E7EB8]/10'
                : 'border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
            }`}
          >
            <svg className="w-3 h-3 flex-none" fill={isSubscribed ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {isSubscribed ? 'Following' : 'Follow'}
          </button>

          {/* Delete (admin / creator only) */}
          {canEdit && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Remove?</span>
                <button
                  onClick={deleteEntry}
                  className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded"
                title="Remove entry"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )
          )}
          </div>
        </div>

        {/* Row 2 — status checkboxes */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-3 pt-2">
          {/* Route Completed (tech) */}
          <label
            className={`flex items-center gap-2 text-xs transition-colors ${
              canToggleComplete ? 'cursor-pointer hover:text-emerald-300' : 'cursor-not-allowed opacity-50'
            } ${isComplete ? 'text-emerald-300' : 'text-gray-400'}`}
            title={
              !canToggleComplete
                ? 'Only the techs on this route or an admin can mark it complete'
                : isComplete
                  ? 'Click to unmark'
                  : 'Tech: mark when the route is finished'
            }
          >
            <span
              className={`flex items-center justify-center w-5 h-5 rounded border flex-none ${
                isComplete
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-gray-900 border-gray-600 text-transparent'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <input
              type="checkbox"
              checked={isComplete}
              onChange={toggleComplete}
              disabled={!canToggleComplete || togglingComplete}
              className="sr-only"
            />
            <span className="font-medium">
              Route Completed
              {isComplete && entry.completer && (
                <span className="text-gray-500 font-normal"> · by {entry.completer.display_name}</span>
              )}
            </span>
          </label>

          {/* Closed (office) */}
          <label
            className={`flex items-center gap-2 text-xs transition-colors ${
              canToggleClose ? 'cursor-pointer hover:text-sky-300' : 'cursor-not-allowed opacity-50'
            } ${isClosed ? 'text-sky-300' : 'text-gray-400'}`}
            title={
              !canToggleClose
                ? 'Only admins or daily-log managers can close entries'
                : isClosed
                  ? 'Click to reopen — clears closed status'
                  : 'Office: mark when you have reviewed updates and handled anything required'
            }
          >
            <span
              className={`flex items-center justify-center w-5 h-5 rounded border flex-none ${
                isClosed
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-gray-900 border-gray-600 text-transparent'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <input
              type="checkbox"
              checked={isClosed}
              onChange={toggleClose}
              disabled={!canToggleClose || togglingClose}
              className="sr-only"
            />
            <span className="font-medium">
              Closed
              {isClosed && entry.closer && (
                <span className="text-gray-500 font-normal"> · by {entry.closer.display_name}</span>
              )}
            </span>
          </label>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Route Sheet */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Route Sheet</span>
            {canEdit && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-xs text-[#2E7EB8] hover:text-blue-300 transition-colors disabled:opacity-40"
              >
                {uploading ? 'Uploading…' : entry.route_sheet_url ? 'Replace' : '+ Upload PDF'}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) uploadRouteSheet(f)
                e.target.value = ''
              }}
            />
          </div>
          {uploadError && <p className="text-xs text-red-400 mb-1">{uploadError}</p>}
          {entry.route_sheet_url ? (
            <a
              href={`/api/hub/daily-log/${entry.id}/route-sheet`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700/80 border border-gray-700 rounded-xl transition-colors group"
            >
              <svg className="w-5 h-5 text-red-400 flex-none" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM12 14h-2v2h2v-2zm0-4h-2v3h2v-3z" />
              </svg>
              <span className="text-sm text-gray-300 group-hover:text-white truncate flex-1">
                {entry.route_sheet_name ?? 'Route Sheet'}
              </span>
              <svg className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ) : (
            <p className="text-sm text-gray-600 italic">No route sheet attached</p>
          )}
        </div>

        {/* Office Notes */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Office Notes</span>
            {canEdit && !editingNotes && (
              <button
                onClick={() => { setEditingNotes(true); setNotesText(entry.office_notes ?? '') }}
                className="text-xs text-[#2E7EB8] hover:text-blue-300 transition-colors"
              >
                {entry.office_notes ? 'Edit' : '+ Add notes'}
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                rows={3}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8] resize-none"
                placeholder="Instructions, notes for the tech…"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="px-3 py-1.5 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {savingNotes ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingNotes(false)}
                  className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : entry.office_notes ? (
            <div className="relative group">
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{entry.office_notes}</p>
              {canEdit && (
                <div className="absolute top-0 right-0 hidden group-hover:flex items-center gap-1">
                  <div className="relative">
                    <button
                      onClick={() => setNotesBoardOpen(v => !v)}
                      className="text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                      title="Add to Board"
                    >
                      ☑ Board
                    </button>
                    {notesBoardOpen && (
                      <BoardPicker
                        content={entry.office_notes ?? ''}
                        onDone={() => setNotesBoardOpen(false)}
                        onCancel={() => setNotesBoardOpen(false)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-600 italic">No notes</p>
          )}
        </div>

        {/* Updates */}
        <div>
          <span className="text-xs font-semibold text-white/40 uppercase tracking-wider block mb-2">
            Updates {updates.length > 0 && `(${updates.length})`}
          </span>
          <div className="space-y-2">
            {updates.map(u => {
              const canDeleteUpdate = isAdmin || u.created_by === currentUserId
              return (
                <div key={u.id} className="flex gap-2.5 group">
                  <UserAvatar user={u.creator ?? null} size={6} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-white/70">
                        {u.creator?.display_name ?? 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-600">{formatTime(u.created_at)}</span>
                    </div>
                    {u.content && (
                      <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{u.content}</p>
                    )}
                    {(u.media_urls ?? []).length > 0 && (
                      <div className={`flex flex-col gap-1.5 ${u.content ? 'mt-1.5' : ''}`}>
                        {(u.media_urls ?? []).map((att, i) => {
                          const isImage = att.type.startsWith('image/')
                          const mediaUrl = `/api/hub/daily-log/media/${att.key}`
                          if (isImage) {
                            return (
                              <a key={i} href={mediaUrl} target="_blank" rel="noopener noreferrer" className="block">
                                <img
                                  src={mediaUrl}
                                  alt={att.name}
                                  className="max-h-48 max-w-[280px] rounded-lg object-cover border border-gray-700"
                                />
                              </a>
                            )
                          }
                          return (
                            <a
                              key={i}
                              href={mediaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors group max-w-[280px]"
                            >
                              <svg className="w-4 h-4 text-gray-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                              <span className="text-xs text-gray-300 group-hover:text-white truncate flex-1">{att.name}</span>
                              <svg className="w-3 h-3 text-gray-500 group-hover:text-gray-300 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex-none flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                    {/* Push to Board */}
                    <div className="relative">
                      <button
                        onClick={() => setBoardPickerUpdateId(prev => prev === u.id ? null : u.id)}
                        className="text-gray-600 hover:text-white transition-colors p-1 rounded"
                        title="Add to Board"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                      </button>
                      {boardPickerUpdateId === u.id && (
                        <BoardPicker
                          content={u.content}
                          onDone={() => setBoardPickerUpdateId(null)}
                          onCancel={() => setBoardPickerUpdateId(null)}
                        />
                      )}
                    </div>
                    {/* Delete */}
                    {canDeleteUpdate && (
                      <button
                        onClick={() => deleteUpdate(u.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded"
                        title="Delete update"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={updatesBottomRef} />
          </div>

          {/* Add update composer */}
          <div className="mt-3 space-y-2">
            {/* Pending attachment chips */}
            {(pendingAttachments.length > 0 || uploadingCount > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {pendingAttachments.map((att, i) => (
                  <div
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 max-w-[200px]"
                  >
                    <svg className="w-3 h-3 text-gray-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <span className="truncate">{att.name}</span>
                    <button
                      onClick={() => setPendingAttachments(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-500 hover:text-red-400 flex-none ml-0.5"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {uploadingCount > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-500">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading…
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 items-end">
              {/* Attach button */}
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                disabled={sendingUpdate}
                className="p-2 rounded-xl text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-40 flex-none"
                title="Attach files"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => {
                  handleAttachFiles(e.target.files)
                  e.target.value = ''
                }}
              />

              <textarea
                value={updateText}
                onChange={e => setUpdateText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submitUpdate()
                  }
                }}
                rows={1}
                placeholder="Post an update…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8] resize-none"
                style={{ minHeight: '2.5rem' }}
              />
              <button
                onClick={submitUpdate}
                disabled={(!updateText.trim() && pendingAttachments.length === 0) || sendingUpdate || uploadingCount > 0}
                className="px-3 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-sm font-medium transition-colors disabled:opacity-40 flex-none"
              >
                {sendingUpdate ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Main View ────────────────────────────────────────────────────────────────

export default function DailyLogView({
  currentUserId,
  isAdmin,
  isTech,
  hubUsers,
}: {
  currentUserId: string
  isAdmin: boolean
  isTech: boolean
  hubUsers: HubUser[]
}) {
  const [date, setDate] = useState(todayStr())
  const [entries, setEntries] = useState<DailyLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [myDayOnly, setMyDayOnly] = useState(isTech)

  // New entry form
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [newTechId, setNewTechId] = useState('')
  const [newSecondaryIds, setNewSecondaryIds] = useState<string[]>([])
  const [newNotes, setNewNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const dateInputRef = useRef<HTMLInputElement>(null)

  const loadEntries = useCallback(async (d: string) => {
    setLoading(true)
    const res = await fetch(`/api/hub/daily-log?date=${d}`)
    const data = await res.json()
    setLoading(false)
    setEntries(data.entries ?? [])
  }, [])

  useEffect(() => {
    loadEntries(date)
  }, [date, loadEntries])

  function goDate(days: number) {
    setDate(prev => offsetDate(prev, days))
  }

  const isToday = date === todayStr()

  const visibleEntries = myDayOnly
    ? entries.filter(
        e =>
          e.tech?.id === currentUserId ||
          (e.secondary_tech_user_ids ?? []).includes(currentUserId),
      )
    : entries

  async function createEntry() {
    if (!newTechId || creating) return
    setCreating(true)
    setCreateError('')
    const res = await fetch('/api/hub/daily-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        log_date: date,
        tech_user_id: newTechId,
        secondary_tech_user_ids: newSecondaryIds,
        office_notes: newNotes.trim() || null,
      }),
    })
    const data = await res.json()
    setCreating(false)
    if (res.ok) {
      setEntries(prev => [...prev, { ...data, subscriber_ids: data.subscriber_ids ?? [] }])
      setShowAddEntry(false)
      setNewTechId('')
      setNewSecondaryIds([])
      setNewNotes('')
    } else {
      setCreateError(data.error ?? 'Failed to create entry')
    }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Header bar */}
      <div className="flex-none px-4 md:px-6 py-4 border-b border-gray-800 bg-gray-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Date navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => goDate(-1)}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              title="Previous day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-white text-sm sm:text-base">
                {isToday ? 'Today · ' : ''}{formatDateHeading(date)}
              </h1>
              {/* Calendar jump */}
              <div className="relative">
                <button
                  onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
                  title="Jump to date"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={date}
                  onChange={e => e.target.value && setDate(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full cursor-pointer"
                  tabIndex={-1}
                />
              </div>
            </div>

            <button
              onClick={() => goDate(1)}
              disabled={isToday}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-30"
              title="Next day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {!isToday && (
              <button
                onClick={() => setDate(todayStr())}
                className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                Today
              </button>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* My Day / All toggle */}
            <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
              <button
                onClick={() => setMyDayOnly(true)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  myDayOnly ? 'bg-[#2E7EB8] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                My Day
              </button>
              <button
                onClick={() => setMyDayOnly(false)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  !myDayOnly ? 'bg-[#2E7EB8] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                All Techs
              </button>
            </div>

            {/* Add entry button (admin/office) */}
            {isAdmin && (
              <button
                onClick={() => setShowAddEntry(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-xs font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Tech
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-gray-500 text-sm">
              {myDayOnly
                ? 'No log entry for you on this day.'
                : 'No entries for this day yet.'}
            </p>
            {isAdmin && (
              <button
                onClick={() => setShowAddEntry(true)}
                className="mt-3 text-sm text-[#2E7EB8] hover:text-blue-300 transition-colors"
              >
                + Add a technician entry
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleEntries.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                hubUsers={hubUsers}
                onDeleted={id => setEntries(prev => prev.filter(e => e.id !== id))}
                onUpdated={updated => setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Entry modal */}
      {showAddEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">Add Tech — {formatDateHeading(date)}</h2>
              <button onClick={() => { setShowAddEntry(false); setCreateError(''); setNewSecondaryIds([]) }} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Primary Technician</label>
                <select
                  value={newTechId}
                  onChange={e => {
                    setNewTechId(e.target.value)
                    setNewSecondaryIds(prev => prev.filter(id => id !== e.target.value))
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8] appearance-none"
                >
                  <option value="">Select a tech…</option>
                  {hubUsers
                    .filter(u => !u.is_bot)
                    .filter(u => !entries.some(e => e.tech?.id === u.id))
                    .sort((a, b) => a.display_name.localeCompare(b.display_name))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Second Tech <span className="text-gray-600 font-normal">(optional — for two techs on the same route)</span>
                </label>
                {newSecondaryIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {newSecondaryIds.map(id => {
                      const u = hubUsers.find(h => h.id === id)
                      if (!u) return null
                      return (
                        <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-700 text-xs text-gray-200">
                          {u.display_name}
                          <button
                            type="button"
                            onClick={() => setNewSecondaryIds(prev => prev.filter(x => x !== id))}
                            className="text-gray-400 hover:text-red-400"
                          >
                            ×
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
                <select
                  value=""
                  onChange={e => {
                    if (e.target.value) setNewSecondaryIds(prev => [...prev, e.target.value])
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8] appearance-none"
                >
                  <option value="">+ Add another tech…</option>
                  {hubUsers
                    .filter(u => !u.is_bot)
                    .filter(u => u.id !== newTechId && !newSecondaryIds.includes(u.id))
                    .sort((a, b) => a.display_name.localeCompare(b.display_name))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Office Notes (optional)</label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  rows={3}
                  placeholder="Instructions, route notes…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8] resize-none"
                />
              </div>
              {createError && <p className="text-xs text-red-400">{createError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => { setShowAddEntry(false); setCreateError(''); setNewSecondaryIds([]) }}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createEntry}
                disabled={!newTechId || creating}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creating ? 'Creating…' : 'Create Entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
