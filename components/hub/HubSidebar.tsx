'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { HubUser } from './MessageFeed'
import StatusPicker from './StatusPicker'
import NotifPrefsModal from './NotifPrefsModal'

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
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [showNewPM, setShowNewPM] = useState(false)
  const [showNotifPrefs, setShowNotifPrefs] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  const loadConversations = useCallback(() => {
    fetch('/api/hub/conversations')
      .then(r => r.json())
      .then(d => setConversations(d.conversations ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

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

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const otherUsers = hubUsers.filter(u => u.id !== currentUserId && !u.is_bot)
  const displayName = currentUserDisplayName ?? userEmail.split('@')[0]

  return (
    <>
      <aside className="w-60 flex-none bg-[#1A3D5C] flex flex-col h-full">
        {/* Workspace header */}
        <div className="px-4 py-3 border-b border-white/10">
          <div className="font-bold text-white text-sm tracking-wide">Heroes Lawn Care</div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {/* Rooms */}
          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-wider px-2 mb-1">Rooms</div>
            {rooms.map(room => {
              const isActive = pathname === `/hub/${room.id}`
              return (
                <Link
                  key={room.id}
                  href={`/hub/${room.id}`}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
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
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
                    isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="text-white/30 text-xs">💬</span>
                  <span className="truncate">{label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

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
      </aside>

      {showNotifPrefs && <NotifPrefsModal onClose={() => setShowNotifPrefs(false)} />}

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
