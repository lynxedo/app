'use client'

import { useState, useEffect, useRef } from 'react'

type Member = {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: string
}

export default function RoomMembersButton({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hub/rooms/${roomId}/members`)
      if (res.ok) {
        const data = await res.json()
        const list: Member[] = (data.members ?? []).slice().sort((a: Member, b: Member) =>
          (a.display_name || '').localeCompare(b.display_name || '')
        )
        setMembers(list)
      } else {
        setError('Could not load members')
      }
    } catch {
      setError('Could not load members')
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    if (!open && members === null) load()
    setOpen(o => !o)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="text-gray-400 hover:text-white p-1 rounded transition-colors"
        title="Room members"
        aria-label="Room members"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          className="w-5 h-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
            Members{members ? ` · ${members.length}` : ''}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="px-3 py-3 text-sm text-gray-500">Loading…</div>
            )}
            {!loading && error && (
              <div className="px-3 py-3 text-sm text-red-400">{error}</div>
            )}
            {!loading && !error && members?.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-500">No members</div>
            )}
            {!loading && !error && members?.map(m => (
              <div
                key={m.user_id}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
              >
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.avatar_url}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover flex-none"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gray-700 flex-none flex items-center justify-center text-xs text-gray-300">
                    {(m.display_name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="truncate">{m.display_name || 'Unknown'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
