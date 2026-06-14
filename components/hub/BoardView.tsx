'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast, useConfirm, Spinner, EmptyState } from '@/components/ui'

type HubUser = { id: string; display_name: string; avatar_url?: string | null }

type Comment = {
  id: string
  content: string
  created_at: string
  created_by: string
  creator?: { id: string; display_name: string; avatar_url?: string | null } | null
}

type Attachment = {
  id: string
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  width_px?: number | null
  height_px?: number | null
  created_at: string
  uploaded_by: string
  uploader?: { display_name: string } | null
}

type BoardItem = {
  id: string
  content: string
  done: boolean
  done_at: string | null
  priority: 'none' | 'low' | 'medium' | 'high'
  due_date: string | null
  assignee_id: string | null
  created_by: string
  created_at: string
  assignee?: HubUser | null
  creator?: HubUser | null
  comment_count?: number
  attachment_count?: number
}

type Board = {
  id: string
  name: string
  is_private: boolean
  is_personal: boolean
  created_by: string
}

const PRIORITY_CONFIG = {
  none:   { label: 'None',   dot: 'bg-white/20',   text: 'text-white/30' },
  low:    { label: 'Low',    dot: 'bg-blue-400',    text: 'text-blue-400' },
  medium: { label: 'Medium', dot: 'bg-yellow-400',  text: 'text-yellow-400' },
  high:   { label: 'High',   dot: 'bg-red-400',     text: 'text-red-400' },
}

function priorityDot(priority: string) {
  const cfg = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.none
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-none ${cfg.dot}`} title={cfg.label} />
}

function formatDue(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return { label: 'Today', color: 'text-yellow-400' }
  if (diff === 1) return { label: 'Tomorrow', color: 'text-blue-400' }
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, color: 'text-red-400' }
  if (diff <= 7) return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), color: 'text-white/60' }
  return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: 'text-white/60' }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── Comments + Attachments panel ──────────────────────────────────────────────

function CommentsPanel({
  boardId,
  item,
  currentUserId,
  onClose,
  onCommentAdded,
  onAttachmentAdded,
}: {
  boardId: string
  item: BoardItem
  currentUserId: string
  onClose: () => void
  onCommentAdded: () => void
  onAttachmentAdded: () => void
}) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [comments, setComments] = useState<Comment[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState<'notes' | 'files'>('notes')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/hub/boards/${boardId}/items/${item.id}/comments`).then(r => r.json()),
      fetch(`/api/hub/boards/${boardId}/items/${item.id}/attachments`).then(r => r.json()),
    ]).then(([cd, ad]) => {
      setComments(cd.comments ?? [])
      setAttachments(ad.attachments ?? [])
    }).catch(() => {})
    inputRef.current?.focus()
  }, [boardId, item.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments])

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    const res = await fetch(`/api/hub/boards/${boardId}/items/${item.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.trim() }),
    })
    const data = await res.json()
    setSending(false)
    if (res.ok) {
      setComments(prev => [...prev, data])
      setText('')
      onCommentAdded()
    }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    const uploadRes = await fetch('/api/hub/upload', { method: 'POST', body: form })
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({ error: 'Upload failed' }))
      toast.error(err.error ?? 'Upload failed')
      setUploading(false)
      return
    }
    const { storage_path, filename, mime_type, size_bytes, width_px, height_px } = await uploadRes.json()
    const res = await fetch(`/api/hub/boards/${boardId}/items/${item.id}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path, filename, mime_type, size_bytes, width_px, height_px }),
    })
    const att = await res.json()
    setUploading(false)
    if (res.ok) {
      setAttachments(prev => [...prev, att])
      setTab('files')
      onAttachmentAdded()
    }
  }

  async function deleteAttachment(id: string) {
    if (!(await confirmDialog({ message: 'Remove this attachment?', danger: true }))) return
    await fetch(`/api/hub/boards/${boardId}/items/${item.id}/attachments?attachmentId=${id}`, { method: 'DELETE' })
    setAttachments(prev => prev.filter(a => a.id !== id))
    onAttachmentAdded()
  }

  return (
    <div className="flex flex-col fixed inset-0 z-50 md:relative md:inset-auto md:z-auto h-[100dvh] md:h-full border-l border-gray-800 md:w-80 md:flex-none bg-gray-950">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">Task Detail</div>
          <p className="text-sm text-white leading-snug line-clamp-2">{item.content}</p>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors flex-none mt-0.5" aria-label="Close">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex-none flex border-b border-gray-800">
        <button
          onClick={() => setTab('notes')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'notes' ? 'text-white border-b-2 border-brand' : 'text-white/40 hover:text-white/70'}`}
        >
          Notes {comments.length > 0 && <span className="ml-1 text-brand">({comments.length})</span>}
        </button>
        <button
          onClick={() => setTab('files')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'files' ? 'text-white border-b-2 border-brand' : 'text-white/40 hover:text-white/70'}`}
        >
          Files {attachments.length > 0 && <span className="ml-1 text-brand">({attachments.length})</span>}
        </button>
      </div>

      {/* Notes tab */}
      {tab === 'notes' && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {comments.length === 0 && (
              <EmptyState size="sm" title="No notes yet. Add one below." />
            )}
            {comments.map(c => {
              const creator = c.creator
              const initials = creator ? creator.display_name.slice(0, 2).toUpperCase() : '?'
              return (
                <div key={c.id} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white flex-none">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-white">{creator?.display_name ?? 'Unknown'}</span>
                      <span className="text-xs text-white/30">{formatTime(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-white/80 leading-snug">{c.content}</p>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
          <div className="flex-none border-t border-gray-800 px-4 py-3">
            <div className="flex items-start gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus-within:border-brand transition-colors">
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }}
                placeholder="Add a note…"
                rows={1}
                className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none resize-none"
              />
              {text.trim() && (
                <button
                  onClick={send}
                  disabled={sending}
                  className="flex-none bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-xs font-medium px-2.5 py-1 rounded-lg transition-colors"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Files tab */}
      {tab === 'files' && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {attachments.length === 0 && !uploading && (
              <EmptyState size="sm" title="No files attached. Upload one below." />
            )}
            {uploading && (
              <div className="flex items-center gap-2 py-2 text-xs text-white/50">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Uploading…
              </div>
            )}
            {attachments.map(att => {
              const isImage = att.mime_type.startsWith('image/')
              const isVideo = att.mime_type.startsWith('video/')
              return (
                <div key={att.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/5 border border-white/10 group">
                  <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center flex-none text-white/50 text-xs font-bold">
                    {isImage ? '🖼' : isVideo ? '🎬' : '📄'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={`/api/hub/files/board/${att.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-white hover:text-brand truncate block transition-colors"
                    >
                      {att.filename}
                    </a>
                    <div className="text-xs text-white/30">{formatBytes(att.size_bytes)}</div>
                  </div>
                  <button
                    onClick={() => deleteAttachment(att.id)}
                    className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all p-1 rounded"
                    title="Remove"
                    aria-label="Remove"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex-none border-t border-gray-800 px-4 py-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) uploadFile(f)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-white/20 hover:border-brand text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              Attach a file
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main BoardView ─────────────────────────────────────────────────────────────

export default function BoardView({
  board,
  hubUsers,
  currentUserId,
}: {
  board: Board
  hubUsers: HubUser[]
  currentUserId: string
}) {
  const [items, setItems] = useState<BoardItem[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showDatePicker, setShowDatePicker] = useState<string | null>(null)
  const [showAssignPicker, setShowAssignPicker] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [threadItem, setThreadItem] = useState<BoardItem | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const loadItems = useCallback(() => {
    setLoading(true)
    fetch(`/api/hub/boards/${board.id}/items?filter=${filter}`)
      .then(r => r.json())
      .then(d => { setItems(d.items ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [board.id, filter])

  useEffect(() => { loadItems() }, [loadItems])

  function closePopups() {
    setOpenMenuId(null)
    setShowDatePicker(null)
    setShowAssignPicker(null)
  }

  async function addItem() {
    if (!composing.trim() || submitting) return
    setSubmitting(true)
    const res = await fetch(`/api/hub/boards/${board.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: composing.trim() }),
    })
    const item = await res.json()
    setSubmitting(false)
    setComposing('')
    if (res.ok && filter === 'open') setItems(prev => [...prev, item])
  }

  async function toggleDone(item: BoardItem) {
    const next = !item.done
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, done: next, done_at: next ? new Date().toISOString() : null } : i))
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: next }),
    })
    loadItems()
  }

  async function saveEdit(item: BoardItem) {
    if (!editContent.trim()) return
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, content: editContent.trim() } : i))
    setEditingId(null)
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent.trim() }),
    })
  }

  async function setPriority(item: BoardItem, priority: string) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, priority: priority as BoardItem['priority'] } : i))
    closePopups()
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    })
  }

  async function setDueDate(item: BoardItem, due_date: string | null) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, due_date } : i))
    setShowDatePicker(null)
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date }),
    })
  }

  async function setAssignee(item: BoardItem, assignee_id: string | null) {
    const assignee = hubUsers.find(u => u.id === assignee_id) ?? null
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, assignee_id, assignee } : i))
    setShowAssignPicker(null)
    await fetch(`/api/hub/boards/${board.id}/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id }),
    })
  }

  async function deleteItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
    closePopups()
    if (threadItem?.id === id) setThreadItem(null)
    await fetch(`/api/hub/boards/${board.id}/items/${id}`, { method: 'DELETE' })
  }

  // Bump counts in local state after a comment or attachment is added/removed
  function bumpCommentCount(itemId: string, delta: number) {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, comment_count: Math.max(0, (i.comment_count ?? 0) + delta) } : i))
  }
  function bumpAttachmentCount(itemId: string) {
    // Reload items to get fresh counts (attachment adds/removes can go either way)
    loadItems()
  }

  return (
    <div className="flex h-full" onClick={closePopups}>
      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex-none px-6 py-4 border-b border-gray-800 flex items-center justify-between max-md:pl-14">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <h1 className="text-lg font-semibold text-white">{board.name}</h1>
            </div>
            {board.is_private && <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">Private</span>}
            {board.is_personal && <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">Personal</span>}
          </div>
          <div className="flex bg-white/10 rounded-lg p-0.5 gap-0.5">
            {(['open', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={e => { e.stopPropagation(); setFilter(f) }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === f ? 'bg-brand text-white' : 'text-white/50 hover:text-white'}`}
              >
                {f === 'open' ? 'Open' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading && <div className="py-8 text-center"><Spinner size={6} /></div>}
          {!loading && items.length === 0 && (
            <EmptyState size="lg" title={filter === 'open' ? 'No open tasks. Add one below.' : 'No tasks yet.'} />
          )}

          {items.map(item => {
            const isEditing = editingId === item.id
            const isThreadOpen = threadItem?.id === item.id
            const commentCount = item.comment_count ?? 0
            const attachmentCount = item.attachment_count ?? 0

            return (
              <div
                key={item.id}
                className={`group flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  isThreadOpen ? 'bg-brand/5 border-brand/30' :
                  item.done ? 'bg-white/[0.02] border-white/5' : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
                onClick={e => e.stopPropagation()}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleDone(item)}
                  className={`mt-0.5 w-5 h-5 rounded border-2 flex-none flex items-center justify-center transition-colors ${
                    item.done ? 'bg-brand border-brand' : 'border-white/30 hover:border-brand'
                  }`}
                >
                  {item.done && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="flex items-start gap-2">
                      <textarea
                        autoFocus
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(item) }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        rows={2}
                        className="flex-1 bg-gray-800 border border-brand rounded-lg px-3 py-1.5 text-sm text-white outline-none resize-none"
                      />
                      <div className="flex flex-col gap-1">
                        <button onClick={() => saveEdit(item)} className="text-xs bg-brand hover:bg-brand-hover text-white px-2.5 py-1 rounded-lg transition-colors">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-white/40 hover:text-white/70 px-2.5 py-1 rounded-lg transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className={`text-sm leading-snug ${item.done ? 'line-through text-white/30' : 'text-white'}`}>
                      {item.content}
                    </p>
                  )}

                  {/* Meta row */}
                  {!isEditing && (
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {/* Priority */}
                      <div className="relative">
                        <button
                          onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === `p-${item.id}` ? null : `p-${item.id}`) }}
                          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                        >
                          {priorityDot(item.priority)}
                          <span className={PRIORITY_CONFIG[item.priority as keyof typeof PRIORITY_CONFIG]?.text ?? 'text-white/30'}>
                            {item.priority === 'none' ? 'Priority' : PRIORITY_CONFIG[item.priority as keyof typeof PRIORITY_CONFIG]?.label}
                          </span>
                        </button>
                        {openMenuId === `p-${item.id}` && (
                          <div className="absolute left-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[120px]" onClick={e => e.stopPropagation()}>
                            {(['none', 'low', 'medium', 'high'] as const).map(p => (
                              <button key={p} onClick={() => setPriority(item, p)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">
                                <span className={`w-2 h-2 rounded-full ${PRIORITY_CONFIG[p].dot}`} />
                                {PRIORITY_CONFIG[p].label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Due date */}
                      <div className="relative">
                        <button
                          onClick={e => { e.stopPropagation(); setShowDatePicker(showDatePicker === item.id ? null : item.id) }}
                          className="flex items-center gap-1 text-xs hover:text-white/70 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {item.due_date ? (
                            <span className={formatDue(item.due_date).color}>{formatDue(item.due_date).label}</span>
                          ) : (
                            <span className="text-white/30">Due date</span>
                          )}
                        </button>
                        {showDatePicker === item.id && (
                          <div className="absolute left-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3" onClick={e => e.stopPropagation()}>
                            <input
                              type="date"
                              defaultValue={item.due_date ?? ''}
                              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-brand"
                              onChange={e => setDueDate(item, e.target.value || null)}
                            />
                            {item.due_date && (
                              <button onClick={() => setDueDate(item, null)} className="block mt-2 text-xs text-white/40 hover:text-white/70 w-full text-left">Clear</button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Assignee */}
                      <div className="relative">
                        <button
                          onClick={e => { e.stopPropagation(); setShowAssignPicker(showAssignPicker === item.id ? null : item.id) }}
                          className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
                        >
                          {item.assignee ? (
                            <>
                              <div className="w-4 h-4 rounded-full bg-brand flex items-center justify-center text-[9px] font-bold text-white flex-none">
                                {item.assignee.display_name.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="text-white/60">{item.assignee.display_name.split(' ')[0]}</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span>Assign</span>
                            </>
                          )}
                        </button>
                        {showAssignPicker === item.id && (
                          <div className="absolute left-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px] max-h-48 overflow-y-auto" onClick={e => e.stopPropagation()}>
                            {item.assignee && (
                              <button onClick={() => setAssignee(item, null)} className="w-full px-3 py-2 text-xs text-white/50 hover:bg-gray-800 text-left">Unassign</button>
                            )}
                            {hubUsers.filter(u => !u.id.includes('bot')).map(u => (
                              <button
                                key={u.id}
                                onClick={() => setAssignee(item, u.id)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-800 ${item.assignee_id === u.id ? 'text-white' : 'text-gray-300'}`}
                              >
                                <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[10px] font-bold text-white flex-none">
                                  {u.display_name.slice(0, 1).toUpperCase()}
                                </div>
                                {u.display_name.split(' ')[0]}
                                {item.assignee_id === u.id && <span className="ml-auto text-brand">✓</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Note count chip */}
                      {commentCount > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); setThreadItem(threadItem?.id === item.id ? null : item) }}
                          className="flex items-center gap-1 text-xs text-brand hover:text-white transition-colors"
                          title="View notes"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          {commentCount}
                        </button>
                      )}

                      {/* Attachment count chip */}
                      {attachmentCount > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); setThreadItem(threadItem?.id === item.id ? null : item) }}
                          className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors"
                          title="View files"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          {attachmentCount}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                {!isEditing && (
                  <div className="flex items-center gap-0.5 flex-none">
                    {/* Edit */}
                    <button
                      onClick={e => { e.stopPropagation(); setEditingId(item.id); setEditContent(item.content) }}
                      className="p-1.5 rounded text-white/25 hover:text-white/70 hover:bg-white/10 transition-colors"
                      title="Edit task"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>

                    {/* Notes / Discussion */}
                    <button
                      onClick={e => { e.stopPropagation(); setThreadItem(threadItem?.id === item.id ? null : item) }}
                      className={`p-1.5 rounded transition-colors ${isThreadOpen ? 'text-brand bg-brand/10' : 'text-white/25 hover:text-white/70 hover:bg-white/10'}`}
                      title="Notes & Files"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </button>

                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); deleteItem(item.id) }}
                      className="p-1.5 rounded text-white/25 hover:text-red-400 hover:bg-white/10 transition-colors"
                      title="Delete task"
                      aria-label="Remove"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Composer */}
        <div className="flex-none border-t border-gray-800 px-6 py-4">
          <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus-within:border-brand transition-colors">
            <svg className="w-4 h-4 text-white/30 mt-0.5 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <textarea
              ref={composerRef}
              value={composing}
              onChange={e => setComposing(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addItem() }
              }}
              placeholder="Add a task… (Enter to save)"
              rows={1}
              className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none resize-none"
            />
            {composing.trim() && (
              <button
                onClick={addItem}
                disabled={submitting}
                className="flex-none bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-xs font-medium px-3 py-1 rounded-lg transition-colors"
              >
                Add
              </button>
            )}
          </div>
          <p className="text-xs text-white/20 mt-1.5 pl-1">Press Enter to add · Shift+Enter for new line</p>
        </div>
      </div>

      {/* Notes & Files panel */}
      {threadItem && (
        <CommentsPanel
          boardId={board.id}
          item={threadItem}
          currentUserId={currentUserId}
          onClose={() => setThreadItem(null)}
          onCommentAdded={() => bumpCommentCount(threadItem.id, 1)}
          onAttachmentAdded={() => bumpAttachmentCount(threadItem.id)}
        />
      )}
    </div>
  )
}
