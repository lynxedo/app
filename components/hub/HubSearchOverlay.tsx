'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { HubUser } from './MessageFeed'

type SearchResult = {
  id: string
  content: string
  created_at: string
  room_id: string | null
  conversation_id: string | null
  sender: { display_name: string; avatar_url: string | null } | null
  room: { name: string } | null
}

type Conversation = {
  id: string
  participants: HubUser[]
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
  if (idx === -1) return text
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

export default function HubSearchOverlay({
  onClose,
  currentUserId,
  hubUsers,
  conversations,
}: {
  onClose: () => void
  currentUserId: string
  hubUsers: HubUser[]
  conversations: Conversation[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounced = useDebounce(query, 300)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    fetch(`/api/hub/search?q=${encodeURIComponent(debounced)}`)
      .then(r => r.json())
      .then(d => { setResults(d.results ?? []); setSearched(true) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [debounced])

  function convLabel(convId: string) {
    const conv = conversations.find(c => c.id === convId)
    if (!conv) return 'Direct Message'
    const others = conv.participants.filter(p => p.id !== currentUserId)
    if (others.length === 0) return 'Just you'
    return others.map(p => p.display_name.split(' ')[0]).join(', ')
  }

  function navigate(result: SearchResult) {
    if (result.room_id) {
      router.push(`/hub/${result.room_id}`)
    } else if (result.conversation_id) {
      router.push(`/hub/pm/${result.conversation_id}`)
    }
    onClose()
  }

  const initials = (name: string) => name.slice(0, 1).toUpperCase()

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* Search header */}
      <div className="flex-none border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <svg className="w-5 h-5 text-gray-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search messages…"
          className="flex-1 bg-transparent text-white text-base outline-none placeholder-gray-500"
        />
        {loading && (
          <div className="w-4 h-4 border-2 border-[#2E7EB8] border-t-transparent rounded-full animate-spin flex-none" />
        )}
        <button
          onClick={onClose}
          className="flex-none text-gray-500 hover:text-gray-300 transition-colors text-sm px-2 py-1 rounded hover:bg-gray-800"
        >
          ESC
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length > 0 && (
          <div className="divide-y divide-gray-800/60">
            {results.map(r => {
              const location = r.room
                ? `#${r.room.name}`
                : r.conversation_id
                ? convLabel(r.conversation_id)
                : null

              return (
                <button
                  key={r.id}
                  onClick={() => navigate(r)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-800/60 transition-colors flex items-start gap-3"
                >
                  {/* Avatar */}
                  <div className="flex-none w-8 h-8 rounded-full bg-[#1A3D5C] flex items-center justify-center text-xs font-bold text-white mt-0.5">
                    {r.sender ? initials(r.sender.display_name) : '?'}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Meta row */}
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm font-medium text-white truncate">
                        {r.sender?.display_name ?? 'Unknown'}
                      </span>
                      {location && (
                        <span className="text-xs text-gray-500 truncate">{location}</span>
                      )}
                      <span className="text-xs text-gray-600 ml-auto flex-none">
                        {relativeTime(r.created_at)}
                      </span>
                    </div>
                    {/* Message content */}
                    <p className="text-sm text-gray-300 leading-relaxed">
                      {highlight(r.content, debounced)}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {searched && results.length === 0 && debounced.length >= 2 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">No messages found for &ldquo;{debounced}&rdquo;</p>
          </div>
        )}

        {!searched && debounced.length < 2 && query.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <p className="text-sm">Type to search rooms, DMs, and messages</p>
          </div>
        )}
      </div>
    </div>
  )
}
