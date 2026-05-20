'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Status = 'available' | 'busy' | 'dnd' | null

const STATUS_OPTIONS: { value: Status; label: string; dot: string; description: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-green-400', description: 'Ready to chat' },
  { value: 'busy', label: 'Busy', dot: 'bg-yellow-400', description: 'Minimizing interruptions' },
  { value: 'dnd', label: 'Do Not Disturb', dot: 'bg-red-500', description: 'Suppress non-mention notifications' },
  { value: null, label: 'Clear status', dot: 'bg-gray-500', description: '' },
]

export function StatusDot({ status }: { status: string | null | undefined }) {
  if (!status || status === 'available') return <span className="w-2.5 h-2.5 rounded-full bg-green-400 ring-1 ring-[#1A3D5C] flex-none" />
  if (status === 'busy') return <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 ring-1 ring-[#1A3D5C] flex-none" />
  if (status === 'dnd') return <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-[#1A3D5C] flex-none" />
  return <span className="w-2.5 h-2.5 rounded-full bg-gray-500 ring-1 ring-[#1A3D5C] flex-none" />
}

export default function StatusPicker({
  currentStatus,
  displayName,
  userEmail,
  isAdmin = false,
}: {
  currentStatus: string | null
  displayName: string
  userEmail: string
  isAdmin?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>(currentStatus as Status)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function setMyStatus(newStatus: Status) {
    setSaving(true)
    await fetch('/api/hub/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setStatus(newStatus)
    setSaving(false)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors text-left"
        title="Set status"
      >
        <div className="relative flex-none">
          <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5">
            <StatusDot status={status} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-white/80 truncate">{displayName}</div>
          <div className="text-xs text-white/40 truncate">{userEmail}</div>
        </div>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 py-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Set status</p>
          </div>
          {STATUS_OPTIONS.map(opt => {
            const isCurrent = (status ?? null) === opt.value
            return (
              <button
                key={String(opt.value)}
                onClick={() => setMyStatus(opt.value)}
                disabled={saving}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                  isCurrent ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-none ${opt.dot}`} />
                <div>
                  <div className="font-medium">{opt.label}</div>
                  {opt.description && <div className="text-xs text-gray-500">{opt.description}</div>}
                </div>
                {isCurrent && <span className="ml-auto text-[#2E7EB8] text-xs">✓</span>}
              </button>
            )
          })}

          <div className="border-t border-gray-800 mt-1 pt-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </Link>
            <Link
              href="/help"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Help</span>
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.285z" />
                </svg>
                <span>Admin</span>
              </Link>
            )}
          </div>

          <div className="border-t border-gray-800 mt-1 pt-1">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
