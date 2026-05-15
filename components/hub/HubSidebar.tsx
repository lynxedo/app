'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Room = {
  id: string
  name: string
  is_private: boolean
}

export default function HubSidebar({
  rooms,
  userEmail,
}: {
  rooms: Room[]
  userEmail: string
}) {
  const pathname = usePathname()

  return (
    <aside className="w-60 flex-none bg-[#1A3D5C] flex flex-col h-full">
      {/* Workspace header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="font-bold text-white text-sm tracking-wide">Heroes Lawn Care</div>
        <div className="text-xs text-white/50 mt-0.5 truncate">{userEmail}</div>
      </div>

      {/* Rooms list */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="text-xs font-semibold text-white/40 uppercase tracking-wider px-2 mb-1">
          Rooms
        </div>

        {rooms.map(room => {
          const isActive = pathname === `/hub/${room.id}`
          return (
            <Link
              key={room.id}
              href={`/hub/${room.id}`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-[#2E7EB8] text-white font-medium'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-white/40">{room.is_private ? '🔒' : '#'}</span>
              <span className="truncate">{room.name}</span>
            </Link>
          )
        })}
      </nav>

      {/* Dashboard back link */}
      <div className="flex-none border-t border-white/10 px-4 py-3">
        <Link
          href="/dashboard"
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          ← Dashboard
        </Link>
      </div>
    </aside>
  )
}
