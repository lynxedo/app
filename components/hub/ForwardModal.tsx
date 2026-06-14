'use client'

import { useState, useEffect, useRef } from 'react'
import { LockIcon } from './railCatalog'
import { Button } from '@/components/ui'

type Room = { id: string; name: string; is_private: boolean }
type Participant = { id: string; display_name: string }
type ConvRaw = { id: string; participants: Participant[] }
type ConvDisplay = { id: string; label: string }

export type ForwardTarget =
  | { type: 'room'; id: string; name: string }
  | { type: 'conversation'; id: string; label: string }

interface ForwardModalProps {
  currentUserId: string
  onClose: () => void
  onForward: (target: ForwardTarget, comment: string) => Promise<void>
  messagePreview: string
}

export default function ForwardModal({ currentUserId, onClose, onForward, messagePreview }: ForwardModalProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [conversations, setConversations] = useState<ConvDisplay[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ForwardTarget | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    Promise.all([
      fetch('/api/hub/rooms-list').then(r => r.json()).catch(() => ({ rooms: [] })),
      fetch('/api/hub/conversations').then(r => r.json()).catch(() => ({ conversations: [] })),
    ]).then(([rd, cd]) => {
      setRooms(rd.rooms ?? [])
      const convs: ConvDisplay[] = (cd.conversations ?? []).map((c: ConvRaw) => {
        const others = c.participants.filter(p => p.id !== currentUserId)
        const label = others.length === 0
          ? 'Just you'
          : others.map(p => p.display_name.split(' ')[0]).join(', ')
        return { id: c.id, label }
      })
      setConversations(convs)
    })
  }, [currentUserId])

  const q = search.toLowerCase()
  const filteredRooms = rooms.filter(r => r.name.toLowerCase().includes(q))
  const filteredConvs = conversations.filter(c => c.label.toLowerCase().includes(q))

  async function handleSend() {
    if (!selected || sending) return
    setSending(true)
    await onForward(selected, comment.trim())
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <h2 className="font-semibold text-white">Forward Message</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
        </div>

        {/* Preview of message being forwarded */}
        <div className="px-5 py-3 border-b border-gray-800 flex-none">
          <div className="bg-gray-800/60 border-l-2 border-gray-600 rounded-r-lg px-3 py-2 text-sm text-gray-400 line-clamp-2">
            {messagePreview || <span className="italic">Attachment</span>}
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-800 flex-none">
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search rooms and conversations…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
          />
        </div>

        {/* Destination list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {filteredRooms.length > 0 && (
            <>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Rooms</div>
              {filteredRooms.map(room => {
                const target: ForwardTarget = { type: 'room', id: room.id, name: room.name }
                const isSelected = selected?.id === room.id
                return (
                  <button
                    key={room.id}
                    onClick={() => setSelected(isSelected ? null : target)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      isSelected ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-none transition-colors ${
                      isSelected ? 'bg-[#2E7EB8] border-[#2E7EB8]' : 'border-gray-600'
                    }`}>
                      {isSelected && <span className="text-white text-xs">✓</span>}
                    </div>
                    <span className="text-gray-400 text-xs">{room.is_private ? <LockIcon className="w-3 h-3" /> : '#'}</span>
                    <span className="truncate">{room.name}</span>
                  </button>
                )
              })}
            </>
          )}

          {filteredConvs.length > 0 && (
            <>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-3 mb-1">Direct Messages</div>
              {filteredConvs.map(conv => {
                const target: ForwardTarget = { type: 'conversation', id: conv.id, label: conv.label }
                const isSelected = selected?.id === conv.id
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelected(isSelected ? null : target)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      isSelected ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-none transition-colors ${
                      isSelected ? 'bg-[#2E7EB8] border-[#2E7EB8]' : 'border-gray-600'
                    }`}>
                      {isSelected && <span className="text-white text-xs">✓</span>}
                    </div>
                    <span className="text-gray-400 text-xs">💬</span>
                    <span className="truncate">{conv.label}</span>
                  </button>
                )
              })}
            </>
          )}

          {filteredRooms.length === 0 && filteredConvs.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">No results</p>
          )}
        </div>

        {/* Optional comment — only shows when a destination is selected */}
        {selected && (
          <div className="px-5 py-3 border-t border-gray-800 flex-none">
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Add a comment (optional)"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
            />
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800 flex gap-3 flex-none">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            fullWidth
            loading={sending}
            disabled={!selected}
            onClick={handleSend}
          >
            {sending ? 'Forwarding…' : 'Forward'}
          </Button>
        </div>
      </div>
    </div>
  )
}
