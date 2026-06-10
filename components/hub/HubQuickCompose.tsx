'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LockIcon } from './railCatalog'
import type { HubUser } from './MessageFeed'

type Room = { id: string; name: string; is_private: boolean }
type Conversation = { id: string; participants: { id: string; display_name: string; avatar_url?: string | null }[] }

type MessageResult = {
  id: string
  content: string
  created_at: string
  room_id: string | null
  conversation_id: string | null
  parent_id: string | null
  sender: { display_name: string; avatar_url: string | null } | null
  room: { name: string } | null
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function highlight(text: string, query: string) {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.length > 120 ? text.slice(0, 120) + '…' : text
  const start = Math.max(0, idx - 40)
  const snippet = (start > 0 ? '…' : '') + text.slice(start, idx + query.length + 80)
  const qIdx = snippet.toLowerCase().indexOf(query.toLowerCase())
  if (qIdx === -1) return snippet
  return (
    <>
      {snippet.slice(0, qIdx)}
      <mark className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">{snippet.slice(qIdx, qIdx + query.length)}</mark>
      {snippet.slice(qIdx + query.length)}
    </>
  )
}

export default function HubQuickCompose({
  onClose,
  rooms,
  hubUsers,
  currentUserId,
  conversations = [],
  onConversationCreated,
}: {
  onClose: () => void
  rooms: Room[]
  hubUsers: HubUser[]
  currentUserId: string
  conversations?: Conversation[]
  onConversationCreated?: () => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [messageResults, setMessageResults] = useState<MessageResult[]>([])
  const [searchingMessages, setSearchingMessages] = useState(false)
  const [searchedMessages, setSearchedMessages] = useState(false)
  const debounced = useDebounce(query.trim(), 300)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Keyword search across all rooms + DMs the user is a member of
  // (the API is RLS-scoped, so it only ever returns messages they can read).
  useEffect(() => {
    if (debounced.length < 2) {
      setMessageResults([])
      setSearchedMessages(false)
      setSearchingMessages(false)
      return
    }
    let cancelled = false
    setSearchingMessages(true)
    fetch(`/api/hub/search?q=${encodeURIComponent(debounced)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setMessageResults(d.results ?? []); setSearchedMessages(true) } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSearchingMessages(false) })
    return () => { cancelled = true }
  }, [debounced])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = query.trim().toLowerCase()
  // Include self so the user can pick themselves to open the self-DM. Bots stay hidden.
  const otherUsers = hubUsers.filter(u => !u.is_bot)
  const filteredRooms = rooms.filter(r => !q || r.name.toLowerCase().includes(q))
  const filteredUsers = otherUsers.filter(u => !q || u.display_name.toLowerCase().includes(q))

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function openDM(singleUserId?: string) {
    const ids = singleUserId ? [singleUserId] : selectedIds
    if (ids.length === 0 || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/hub/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_ids: ids }),
      })
      const data = await res.json()
      if (data.id) {
        onConversationCreated?.()
        router.push(`/hub/pm/${data.id}`)
        onClose()
      }
    } finally {
      setCreating(false)
    }
  }

  const selectedNames = selectedIds
    .map(id => otherUsers.find(u => u.id === id)?.display_name.split(' ')[0])
    .filter(Boolean)
    .join(', ')

  function convLabel(convId: string) {
    const conv = conversations.find(c => c.id === convId)
    if (!conv) return 'Direct message'
    const others = conv.participants.filter(p => p.id !== currentUserId)
    if (others.length === 0) return 'Just you'
    return others.map(p => (p.display_name || '?').split(' ')[0]).join(', ')
  }

  function openMessageResult(r: MessageResult) {
    if (r.room_id) router.push(`/hub/${r.room_id}`)
    else if (r.conversation_id) router.push(`/hub/pm/${r.conversation_id}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* Header — pad the top past the iOS status bar / notch */}
      <div className="flex-none border-b border-gray-800 px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
        <svg className="w-5 h-5 text-gray-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search rooms, people, and messages…"
          className="flex-1 bg-transparent text-white text-base outline-none placeholder-gray-500"
        />
        {searchingMessages && (
          <div className="w-4 h-4 border-2 border-[#2E7EB8] border-t-transparent rounded-full animate-spin flex-none" />
        )}
        <button
          onClick={onClose}
          className="flex-none text-gray-500 hover:text-gray-300 transition-colors text-sm px-2 py-1 rounded hover:bg-gray-800"
        >
          ESC
        </button>
      </div>

      {/* Group DM action bar — appears when 2+ people selected */}
      {selectedIds.length >= 2 && (
        <div className="flex-none border-b border-gray-800 px-4 py-2 flex items-center justify-between bg-[#1A3D5C]/40">
          <span className="text-sm text-gray-300 truncate mr-3">
            {selectedIds.length} people: {selectedNames}
          </span>
          <button
            onClick={() => openDM()}
            disabled={creating}
            className="flex-none px-4 py-1.5 bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 rounded-lg text-sm text-white font-medium transition-colors"
          >
            {creating ? 'Opening…' : 'Start Group DM'}
          </button>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">

        {/* Rooms */}
        {filteredRooms.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rooms</span>
            </div>
            {filteredRooms.map(room => (
              <button
                key={room.id}
                onClick={() => { router.push(`/hub/${room.id}`); onClose() }}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-800/60 transition-colors flex items-center gap-3"
              >
                <div className="flex-none w-8 h-8 rounded-lg bg-[#1A3D5C] flex items-center justify-center text-sm text-white/60 font-medium">
                  {room.is_private ? <LockIcon className="w-4 h-4" /> : '#'}
                </div>
                <span className="text-sm text-white">{room.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* People */}
        {filteredUsers.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                People
                {selectedIds.length === 0 && (
                  <span className="ml-2 normal-case font-normal text-gray-600">· check + to add to a group DM</span>
                )}
              </span>
            </div>
            {filteredUsers.map(user => {
              const isSelected = selectedIds.includes(user.id)
              return (
                <div
                  key={user.id}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors group ${isSelected ? 'bg-[#2E7EB8]/10' : 'hover:bg-gray-800/60'}`}
                >
                  {/* Avatar */}
                  <div className="flex-none w-8 h-8 rounded-full bg-[#1A3D5C] flex items-center justify-center text-sm font-bold text-white">
                    {user.display_name.slice(0, 1).toUpperCase()}
                  </div>

                  {/* Name — click to open 1:1 DM */}
                  <button
                    className="flex-1 text-sm text-white text-left truncate"
                    onClick={() => openDM(user.id)}
                    disabled={creating}
                  >
                    {user.display_name}
                  </button>

                  {/* Checkbox — click to toggle into group DM */}
                  <button
                    onClick={() => toggleUser(user.id)}
                    title={isSelected ? 'Remove from group' : 'Add to group DM'}
                    className={`flex-none w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-[#2E7EB8] border-[#2E7EB8]'
                        : 'border-gray-600 opacity-0 group-hover:opacity-100 focus:opacity-100'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Messages — keyword matches across every room + DM the user is in */}
        {messageResults.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Messages</span>
            </div>
            <div className="divide-y divide-gray-800/60">
              {messageResults.map(r => {
                const location = r.room
                  ? `#${r.room.name}`
                  : r.conversation_id
                  ? convLabel(r.conversation_id)
                  : null
                return (
                  <button
                    key={r.id}
                    onClick={() => openMessageResult(r)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-800/60 transition-colors flex items-start gap-3"
                  >
                    <div className="flex-none w-8 h-8 rounded-full bg-[#1A3D5C] flex items-center justify-center text-xs font-bold text-white mt-0.5">
                      {r.sender ? r.sender.display_name.slice(0, 1).toUpperCase() : '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-sm font-medium text-white truncate">
                          {r.sender?.display_name ?? 'Unknown'}
                        </span>
                        {location && (
                          <span className="text-xs text-gray-500 truncate">{location}</span>
                        )}
                        {r.parent_id && (
                          <span className="text-[10px] text-gray-600 flex-none">in thread</span>
                        )}
                        <span className="text-xs text-gray-600 ml-auto flex-none">
                          {relativeTime(r.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed">
                        {highlight(r.content, debounced)}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {filteredRooms.length === 0 && filteredUsers.length === 0 && messageResults.length === 0 && q && !searchingMessages && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">
              {searchedMessages || q.length < 2
                ? <>No results for &ldquo;{query}&rdquo;</>
                : 'Searching…'}
            </p>
          </div>
        )}

        {!q && (
          <p className="text-xs text-gray-600 text-center pt-4 pb-2">
            Click a room to jump · Click a name to message · Type a keyword to search messages
          </p>
        )}
      </div>
    </div>
  )
}
