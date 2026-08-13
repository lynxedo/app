'use client'

// Per-row 📞 Call / 💬 Text buttons for the Lead Tracker table — the same two
// actions the contacts sidebar already offers, so a rep can work a lead without
// copying the number into another screen.
//
// Behaviour is lifted verbatim from SidebarContactsList: Call pre-fills the
// dialer keypad; Text find-or-creates the thread and jumps to it. Neither
// invents a new send path.
//
// The two permission booleans ride a context rather than props because the only
// consumer sits inside a column-definition render function, three components
// below the page — and they never change for the life of the page.

import { createContext, useCallback, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'

export type LeadContactPerms = { canCall: boolean; canText: boolean }

const LeadContactPermsContext = createContext<LeadContactPerms>({ canCall: false, canText: false })

export function LeadContactPermsProvider({
  value,
  children,
}: {
  value: LeadContactPerms
  children: React.ReactNode
}) {
  return <LeadContactPermsContext.Provider value={value}>{children}</LeadContactPermsContext.Provider>
}

export default function LeadContactActions({
  phone,
  name,
}: {
  phone: string | null
  name: string | null
}) {
  const { canCall, canText } = useContext(LeadContactPermsContext)
  const router = useRouter()
  const [texting, setTexting] = useState(false)

  const call = useCallback(() => {
    if (!phone) return
    router.push(`/hub/dialer?number=${encodeURIComponent(phone)}`)
  }, [phone, router])

  const text = useCallback(async () => {
    if (!phone || texting) return
    setTexting(true)
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.conversation_id) {
        router.push(`/hub/txt/${data.conversation_id}`)
        return // leave the button busy through the navigation
      }
    } catch {
      /* fall through to re-enable */
    }
    setTexting(false)
  }, [phone, name, router, texting])

  if (!canCall && !canText) return null

  return (
    // stopPropagation so tapping an action never also triggers the row's own
    // click handling (open notes / start an inline edit).
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {canCall && (
        <button
          type="button"
          onClick={call}
          disabled={!phone}
          // 28px box — under the 44px touch target the rest of the app uses, but
          // this is a dense desktop table where the row itself is only ~36px.
          className="w-7 h-7 flex items-center justify-center rounded text-xs bg-emerald-700/30 hover:bg-emerald-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
          title={phone ? 'Call (pre-fills the keypad)' : 'No phone number on this lead'}
          aria-label="Call this lead"
        >
          📞
        </button>
      )}
      {canText && (
        <button
          type="button"
          onClick={text}
          disabled={!phone || texting}
          className="w-7 h-7 flex items-center justify-center rounded text-xs bg-sky-700/30 hover:bg-sky-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
          title={phone ? 'Open a text conversation' : 'No phone number on this lead'}
          aria-label="Text this lead"
        >
          {texting ? '…' : '💬'}
        </button>
      )}
    </div>
  )
}
