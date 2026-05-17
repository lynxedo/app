'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { HubUser } from './MessageFeed'
import StatusPicker from './StatusPicker'
import NotifPrefsModal from './NotifPrefsModal'
import ClientsSidebar from './ClientsSidebar'

type Room = { id: string; name: string; is_private: boolean }

type Conversation = {
  id: string
  participants: HubUser[]
  last_message?: string
}

function convLabel(conv: Conversation, currentUserId: string) {
  const others = conv.participants.filter(p => p.id !== currentUserId)
  if (others.length === 0) return 'Just you'
  return others.map(p => p.display_name.split(' ')[0]).join(', ')
}

export default function HubSidebar({
  rooms,
  userEmail,
  currentUserId,
  hubUsers,
  currentUserStatus,
  currentUserDisplayName,
  isAdmin,
  onClose,
  textSize,
  onTextSizeChange,
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  isAdmin?: boolean
  onClose?: () => void
  textSize?: string
  onTextSizeChange?: (size: string) => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const isClientsView = pathname.startsWith('/hub/clients')
  const [sidebarRooms, setSidebarRooms] = useState<Room[]>(rooms)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [showNewPM, setShowNewPM] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [showNewRoom, setShowNewRoom] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [allowMemberCreate, setAllowMemberCreate] = useState(true)

  // New room form state
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomDesc, setNewRoomDesc] = useState('')
  const [newRoomPrivate, setNewRoomPrivate] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)

  const loadConversations = useCallback(() => {
    fetch('/api/hub/conversations')
      .then(r => r.json())
      .then(d => setConversations(d.conversations ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  // Load hub settings to know if this member can create rooms
  useEffect(() => {
    fetch('/api/hub/settings')
      .then(r => r.json())
      .then(d => setAllowMemberCreate(d.allow_member_room_creation ?? true))
      .catch(() => {})
  }, [])

  const canCreateRoom = isAdmin || allowMemberCreate

  async function createConversation() {
    if (selectedIds.length === 0 || creating) return
    setCreating(true)
    const res = await fetch('/api/hub/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_ids: selectedIds }),
    })
    const data = await res.json()
    setCreating(false)
    setShowNewPM(false)
    setSelectedIds([])
    if (data.id) {
      loadConversations()
      router.push(`/hub/pm/${data.id}`)
    }
  }

  async function createRoom() {
    if (!newRoomName.trim() || creatingRoom) return
    setCreatingRoom(true)
    const res = await fetch('/api/hub/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newRoomName.trim(), description: newRoomDesc.trim() || null, is_private: newRoomPrivate }),
    })
    const data = await res.json()
    setCreatingRoom(false)
    if (res.ok) {
      const newRoom = { id: data.id, name: data.name, is_private: data.is_private }
      setSidebarRooms(prev => [...prev, newRoom].sort((a, b) => a.name.localeCompare(b.name)))
      setShowNewRoom(false)
      setNewRoomName(''); setNewRoomDesc(''); setNewRoomPrivate(false)
      router.push(`/hub/${data.id}`)
    }
  }

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const otherUsers = hubUsers.filter(u => u.id !== currentUserId && !u.is_bot)
  const displayName = currentUserDisplayName ?? userEmail.split('@')[0]

  return (
    <>
      <aside className="w-60 flex-none bg-[#1A3D5C] flex flex-col h-full h-[100dvh] pb-16 md:pb-0">
        {/* Workspace header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="font-bold text-white text-sm tracking-wide">Heroes Lawn Care</div>
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden text-white/40 hover:text-white/70 transition-colors p-1 rounded"
              aria-label="Close sidebar"
            >
              ✕
            </button>
          )}
        </div>

        {/* Teams / Clients switcher */}
        <div className="flex-none px-3 py-2 border-b border-white/10">
          <div className="flex bg-white/10 rounded-lg p-0.5 gap-0.5">
            <Link
              href="/hub"
              className={`flex-1 text-center text-xs font-medium py-1.5 rounded-md transition-colors ${
                !isClientsView ? 'bg-[#2E7EB8] text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Teams
            </Link>
            <Link
              href="/hub/clients"
              className={`flex-1 text-center text-xs font-medium py-1.5 rounded-md transition-colors ${
                isClientsView ? 'bg-[#2E7EB8] text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Clients
            </Link>
          </div>
        </div>

        {/* Clients sidebar content */}
        {isClientsView ? (
          <ClientsSidebar onClose={onClose} />
        ) : (

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {/* Rooms */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Rooms</span>
              {canCreateRoom && (
                <button
                  onClick={() => { setShowNewRoom(true); setNewRoomName(''); setNewRoomDesc(''); setNewRoomPrivate(false) }}
                  className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
                  title="New room"
                >
                  +
                </button>
              )}
            </div>
            {sidebarRooms.map(room => {
              const isActive = pathname === `/hub/${room.id}`
              return (
                <Link
                  key={room.id}
                  href={`/hub/${room.id}`}
                  onClick={() => onClose?.()}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
                    isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="text-white/40 text-xs">{room.is_private ? '🔒' : '#'}</span>
                  <span className="truncate">{room.name}</span>
                </Link>
              )
            })}
          </div>

          {/* Direct Messages */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Direct Messages</span>
              <button
                onClick={() => { setShowNewPM(true); setSelectedIds([]) }}
                className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
                title="New direct message"
              >
                +
              </button>
            </div>
            {conversations.length === 0 && (
              <p className="text-xs text-white/30 px-2 py-1">No messages yet</p>
            )}
            {conversations.map(conv => {
              const label = convLabel(conv, currentUserId)
              const isActive = pathname === `/hub/pm/${conv.id}`
              return (
                <Link
                  key={conv.id}
                  href={`/hub/pm/${conv.id}`}
                  onClick={() => onClose?.()}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
                    isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="text-white/30 text-xs">💬</span>
                  <span className="truncate">{label}</span>
                </Link>
              )
            })}
          </div>

          {/* Pages */}
          <div>
            <div className="px-2 mb-1">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Pages</span>
            </div>
            <Link
              href="/hub/pages/company-news"
              onClick={() => onClose?.()}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
                pathname === '/hub/pages/company-news' ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-xs">📰</span>
              <span className="truncate">Company News</span>
            </Link>
          </div>

          {/* Files */}
          <div>
            <div className="px-2 mb-1">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Files</span>
            </div>
            <Link
              href="/hub/files"
              onClick={() => onClose?.()}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
                pathname === '/hub/files' ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-xs">📁</span>
              <span className="truncate">Files</span>
            </Link>
          </div>
        </nav>
        )} {/* end teams-only block */}

        {/* Footer: user status + dashboard link */}
        <div className="flex-none border-t border-white/10">
          <StatusPicker
            currentStatus={currentUserStatus ?? null}
            displayName={displayName}
            userEmail={userEmail}
          />
          <div className="px-4 pb-3 flex items-center justify-between">
            <Link href="/dashboard" className="text-xs text-white/40 hover:text-white/70 transition-colors">
              ← Dashboard
            </Link>
            <div className="flex items-center gap-2">
              {onTextSizeChange && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => {
                      const next = textSize === 'large' ? 'default' : 'small'
                      onTextSizeChange(next)
                      onClose?.()
                      fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub_text_size: next }) })
                    }}
                    title="Smaller text"
                    className="text-white/30 hover:text-white/60 transition-colors text-xs font-bold px-2 py-1 rounded hover:bg-white/10"
                  >
                    A−
                  </button>
                  <button
                    onClick={() => {
                      const next = textSize === 'small' ? 'default' : 'large'
                      onTextSizeChange(next)
                      onClose?.()
                      fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub_text_size: next }) })
                    }}
                    title="Larger text"
                    className="text-white/30 hover:text-white/60 transition-colors text-sm font-bold px-2 py-1 rounded hover:bg-white/10"
                  >
                    A+
                  </button>
                </div>
              )}
              {isAdmin && (
                <Link
                  href="/admin/hub"
                  className="text-white/30 hover:text-white/60 transition-colors"
                  title="Hub admin"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </Link>
              )}
              <button
                onClick={() => setShowNotifPrefs(true)}
                className="text-white/30 hover:text-white/60 transition-colors"
                title="Notification preferences"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {showNotifPrefs && <NotifPrefsModal onClose={() => setShowNotifPrefs(false)} />}

      {/* New Room modal */}
      {showNewRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Room</h2>
              <button onClick={() => setShowNewRoom(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                autoFocus
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRoom()}
                placeholder="Room name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <input
                value={newRoomDesc}
                onChange={e => setNewRoomDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer select-none">
                <div
                  onClick={() => setNewRoomPrivate(v => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-none cursor-pointer ${newRoomPrivate ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newRoomPrivate ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                Private room
              </label>
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewRoom(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createRoom}
                disabled={!newRoomName.trim() || creatingRoom}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creatingRoom ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New DM modal */}
      {showNewPM && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Direct Message</h2>
              <button onClick={() => setShowNewPM(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 max-h-72 overflow-y-auto space-y-1">
              {otherUsers.length === 0 && <p className="text-sm text-gray-500">No other team members found.</p>}
              {otherUsers.map(user => {
                const checked = selectedIds.includes(user.id)
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      checked ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-none transition-colors ${
                      checked ? 'bg-[#2E7EB8] border-[#2E7EB8]' : 'border-gray-600'
                    }`}>
                      {checked && <span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white flex-none">
                      {user.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="truncate">{user.display_name}</span>
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewPM(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createConversation}
                disabled={selectedIds.length === 0 || creating}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creating ? 'Opening…' : 'Open'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
