'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { HubUser } from './MessageFeed'

type Room = { id: string; name: string; is_private: boolean }

export default function HubQuickCompose({
  onClose,
  rooms,
  hubUsers,
  currentUserId,
  onConversationCreated,
}: {
  onClose: () => void
  rooms: Room[]
  hubUsers: HubUser[]
  currentUserId: string
  onConversationCreated?: () => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => { inputRef.current?.focus() }, [])

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

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-none border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <svg className="w-5 h-5 text-gray-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Jump to a room or message someone…"
          className="flex-1 bg-transparent text-white text-base outline-none placeholder-gray-500"
        />
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
                  {room.is_private ? '🔒' : '#'}
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

        {filteredRooms.length === 0 && filteredUsers.length === 0 && q && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {!q && (
          <p className="text-xs text-gray-600 text-center pt-4 pb-2">
            Click a room to jump · Click a name to message · Use the + checkbox to build a group DM
          </p>
        )}
      </div>
    </div>
  )
}
