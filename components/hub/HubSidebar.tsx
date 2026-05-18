'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { HubUser } from './MessageFeed'
import StatusPicker from './StatusPicker'
import NotifPrefsModal from './NotifPrefsModal'
import ClientsSidebar from './ClientsSidebar'
import HubSearchOverlay from './HubSearchOverlay'

type Room = { id: string; name: string; is_private: boolean }

type Conversation = {
  id: string
  participants: HubUser[]
  last_message?: string
}

type Board = { id: string; name: string; is_private: boolean; is_personal: boolean; created_by: string }

type ContextMenu = {
  x: number
  y: number
  id: string
  type: 'room' | 'conv'
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
  initialPinnedIds = [],
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
  initialPinnedIds?: string[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const isClientsView = pathname.startsWith('/hub/clients')

  const [sidebarRooms, setSidebarRooms] = useState<Room[]>(rooms)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [showNewPM, setShowNewPM] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [showNewRoom, setShowNewRoom] = useState(false)
  const [showNewBoard, setShowNewBoard] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [allowMemberCreate, setAllowMemberCreate] = useState(true)

  // New room form state
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomDesc, setNewRoomDesc] = useState('')
  const [newRoomPrivate, setNewRoomPrivate] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)

  // New board form state
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardPrivate, setNewBoardPrivate] = useState(false)
  const [newBoardPersonal, setNewBoardPersonal] = useState(false)
  const [creatingBoard, setCreatingBoard] = useState(false)

  // Unread state
  const [unreadRoomIds, setUnreadRoomIds] = useState<Set<string>>(new Set())
  const [unreadConvIds, setUnreadConvIds] = useState<Set<string>>(new Set())

  // Favorites / pinning state
  const [pinnedIds, setPinnedIds] = useState<string[]>(initialPinnedIds)

  // Search
  const [showSearch, setShowSearch] = useState(false)

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Long-press tracking
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTargetRef = useRef<{ id: string; type: 'room' | 'conv' } | null>(null)

  const loadConversations = useCallback(() => {
    fetch('/api/hub/conversations')
      .then(r => r.json())
      .then(d => setConversations(d.conversations ?? []))
      .catch(() => {})
  }, [])

  const loadBoards = useCallback(() => {
    fetch('/api/hub/boards')
      .then(r => r.json())
      .then(d => setBoards(d.boards ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])
  useEffect(() => { loadBoards() }, [loadBoards])

  // Refresh conversations when Quick Compose creates a new one
  useEffect(() => {
    window.addEventListener('hub-conversation-created', loadConversations)
    return () => window.removeEventListener('hub-conversation-created', loadConversations)
  }, [loadConversations])

  useEffect(() => {
    fetch('/api/hub/settings')
      .then(r => r.json())
      .then(d => setAllowMemberCreate(d.allow_member_room_creation ?? true))
      .catch(() => {})
  }, [])

  // Load unread status on mount
  useEffect(() => {
    fetch('/api/hub/read-receipts')
      .then(r => r.json())
      .then(d => {
        setUnreadRoomIds(new Set(d.unread_room_ids ?? []))
        setUnreadConvIds(new Set(d.unread_conv_ids ?? []))
      })
      .catch(() => {})
  }, [])

  // Realtime: mark rooms/convs unread when new messages arrive
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('sidebar-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as { room_id: string | null; conversation_id: string | null; sender_id: string; parent_id: string | null }
          // Ignore thread replies and messages sent by this user
          if (msg.parent_id || msg.sender_id === currentUserId) return
          const activeRoomMatch = pathname.match(/^\/hub\/([^/]+)$/)
          const activePmMatch = pathname.match(/^\/hub\/pm\/([^/]+)$/)
          if (msg.room_id) {
            // Don't mark unread if user is currently viewing this room
            if (activeRoomMatch?.[1] === msg.room_id) return
            setUnreadRoomIds(prev => new Set([...prev, msg.room_id!]))
          } else if (msg.conversation_id) {
            if (activePmMatch?.[1] === msg.conversation_id) return
            setUnreadConvIds(prev => new Set([...prev, msg.conversation_id!]))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentUserId, pathname])

  // Mark as read when the user navigates to a room or PM
  useEffect(() => {
    const roomMatch = pathname.match(/^\/hub\/([^/]+)$/)
    const pmMatch = pathname.match(/^\/hub\/pm\/([^/]+)$/)
    if (roomMatch) {
      const roomId = roomMatch[1]
      setUnreadRoomIds(prev => { const next = new Set(prev); next.delete(roomId); return next })
      fetch('/api/hub/read-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId }),
      }).catch(() => {})
    } else if (pmMatch) {
      const convId = pmMatch[1]
      setUnreadConvIds(prev => { const next = new Set(prev); next.delete(convId); return next })
      fetch('/api/hub/read-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId }),
      }).catch(() => {})
    }
  }, [pathname])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

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

  async function createBoard() {
    if (!newBoardName.trim() || creatingBoard) return
    setCreatingBoard(true)
    const res = await fetch('/api/hub/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBoardName.trim(), is_private: newBoardPrivate || newBoardPersonal, is_personal: newBoardPersonal }),
    })
    const data = await res.json()
    setCreatingBoard(false)
    if (res.ok) {
      setBoards(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setShowNewBoard(false)
      setNewBoardName(''); setNewBoardPrivate(false); setNewBoardPersonal(false)
      router.push(`/hub/board/${data.id}`)
    }
  }

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Pin / unpin
  function togglePin(id: string) {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_pinned_ids: next }),
      }).catch(() => {})
      return next
    })
    setContextMenu(null)
  }

  // Context menu trigger
  function openContextMenu(e: React.MouseEvent, id: string, type: 'room' | 'conv') {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, id, type })
  }

  // Long press handlers for mobile
  function onTouchStart(id: string, type: 'room' | 'conv') {
    longPressTargetRef.current = { id, type }
    longPressTimerRef.current = setTimeout(() => {
      const target = longPressTargetRef.current
      if (!target) return
      // Show context menu in center of screen for mobile
      setContextMenu({ x: window.innerWidth / 2 - 80, y: window.innerHeight / 2 - 40, id: target.id, type: target.type })
    }, 500)
  }

  function onTouchEnd() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTargetRef.current = null
  }

  const otherUsers = hubUsers.filter(u => u.id !== currentUserId && !u.is_bot)
  const displayName = currentUserDisplayName ?? userEmail.split('@')[0]

  // Sort rooms: unread first, then alpha
  const sortedRooms = [...sidebarRooms].sort((a, b) => {
    const aUnread = unreadRoomIds.has(a.id)
    const bUnread = unreadRoomIds.has(b.id)
    if (aUnread && !bUnread) return -1
    if (!aUnread && bUnread) return 1
    return a.name.localeCompare(b.name)
  })

  // Sort conversations: unread first
  const sortedConvs = [...conversations].sort((a, b) => {
    const aUnread = unreadConvIds.has(a.id)
    const bUnread = unreadConvIds.has(b.id)
    if (aUnread && !bUnread) return -1
    if (!aUnread && bUnread) return 1
    return 0
  })

  // Build favorites list
  const pinnedSet = new Set(pinnedIds)
  const favoriteRooms = sortedRooms.filter(r => pinnedSet.has(r.id))
  const favoriteConvs = sortedConvs.filter(c => pinnedSet.has(c.id))
  const hasFavorites = favoriteRooms.length > 0 || favoriteConvs.length > 0

  function renderRoom(room: Room, showPrefix = true) {
    const isActive = pathname === `/hub/${room.id}`
    const hasUnread = unreadRoomIds.has(room.id)
    return (
      <Link
        key={room.id}
        href={`/hub/${room.id}`}
        onClick={() => onClose?.()}
        onContextMenu={e => openContextMenu(e, room.id, 'room')}
        onTouchStart={() => onTouchStart(room.id, 'room')}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchEnd}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
          isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`}
      >
        {showPrefix && <span className="text-white/40 text-xs flex-none">{room.is_private ? '🔒' : '#'}</span>}
        <span className="truncate flex-1">{room.name}</span>
        {hasUnread && !isActive && (
          <span className="flex-none w-2 h-2 rounded-full bg-[#f97316]" />
        )}
      </Link>
    )
  }

  function renderConv(conv: Conversation, showPrefix = true) {
    const label = convLabel(conv, currentUserId)
    const isActive = pathname === `/hub/pm/${conv.id}`
    const hasUnread = unreadConvIds.has(conv.id)
    return (
      <Link
        key={conv.id}
        href={`/hub/pm/${conv.id}`}
        onClick={() => onClose?.()}
        onContextMenu={e => openContextMenu(e, conv.id, 'conv')}
        onTouchStart={() => onTouchStart(conv.id, 'conv')}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchEnd}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
          isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`}
      >
        {showPrefix && <span className="text-white/30 text-xs flex-none">💬</span>}
        <span className="truncate flex-1">{label}</span>
        {hasUnread && !isActive && (
          <span className="flex-none w-2 h-2 rounded-full bg-[#f97316]" />
        )}
      </Link>
    )
  }

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

        {/* Search bar */}
        <div className="flex-none px-3 pt-2 pb-1">
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-white/40 hover:text-white/60 transition-colors"
          >
            <svg className="w-3.5 h-3.5 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search
          </button>
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

          {/* Favorites */}
          {hasFavorites && (
            <div>
              <div className="px-2 mb-1">
                <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Favorites</span>
              </div>
              {favoriteRooms.map(room => renderRoom(room, false))}
              {favoriteConvs.map(conv => renderConv(conv, false))}
            </div>
          )}

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
            {sortedRooms.map(room => renderRoom(room))}
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
            {sortedConvs.map(conv => renderConv(conv))}
          </div>

          {/* Boards */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Boards</span>
              <button
                onClick={() => { setShowNewBoard(true); setNewBoardName(''); setNewBoardPrivate(false); setNewBoardPersonal(false) }}
                className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
                title="New board"
              >
                +
              </button>
            </div>
            {boards.length === 0 && (
              <p className="text-xs text-white/30 px-2 py-1">No boards yet</p>
            )}
            {boards.map(board => {
              const isActive = pathname === `/hub/board/${board.id}`
              return (
                <Link
                  key={board.id}
                  href={`/hub/board/${board.id}`}
                  onClick={() => onClose?.()}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${
                    isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="text-white/40 text-xs flex-none">
                    {board.is_personal ? '👤' : board.is_private ? '🔒' : '☑'}
                  </span>
                  <span className="truncate flex-1">{board.name}</span>
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
                  {([['small', 'S'], ['default', 'M'], ['large', 'L']] as const).map(([size, label]) => (
                    <button
                      key={size}
                      onClick={() => {
                        onTextSizeChange(size)
                        window.dispatchEvent(new CustomEvent('hub-text-size-change', { detail: size }))
                        onClose?.()
                        fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub_text_size: size }) })
                      }}
                      className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${(textSize ?? 'default') === size ? 'bg-white/15 text-white' : 'text-white/30 hover:text-white/60 hover:bg-white/10'}`}
                    >
                      {label}
                    </button>
                  ))}
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

      {showSearch && (
        <HubSearchOverlay
          onClose={() => setShowSearch(false)}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          conversations={conversations}
        />
      )}

      {/* Context menu for pin/unpin */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[100] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => togglePin(contextMenu.id)}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center gap-2"
          >
            {pinnedSet.has(contextMenu.id) ? (
              <>
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Remove from Favorites
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                Add to Favorites
              </>
            )}
          </button>
        </div>
      )}

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

      {/* New Board modal */}
      {showNewBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Board</h2>
              <button onClick={() => setShowNewBoard(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                autoFocus
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createBoard()}
                placeholder="Board name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer select-none">
                <div
                  onClick={() => { setNewBoardPersonal(v => !v); if (!newBoardPersonal) setNewBoardPrivate(false) }}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-none cursor-pointer ${newBoardPersonal ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newBoardPersonal ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                Personal (only you)
              </label>
              {!newBoardPersonal && (
                <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer select-none">
                  <div
                    onClick={() => setNewBoardPrivate(v => !v)}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-none cursor-pointer ${newBoardPrivate ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newBoardPrivate ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  Private (invite only)
                </label>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewBoard(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createBoard}
                disabled={!newBoardName.trim() || creatingBoard}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creatingBoard ? 'Creating…' : 'Create'}
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
