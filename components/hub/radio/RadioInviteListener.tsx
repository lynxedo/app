'use client'

// Listens for "someone wants to open a radio channel with you" anywhere in the Hub.
//
// Two ways an invite reaches you and they are deliberately different:
//  - In the Hub → this banner, with a short ring (Phase 2, Ben Sep 16 2026: "a little
//    persistent. Almost like a ring tone. But shorter."). In here we own the sound
//    completely, so it is a few repeats of the tone chosen for "Radio invites" in
//    Settings, and the master Sounds switch silences it. Bounded — see ring.ts.
//  - Away from the Hub → one push notification (sent by the open-channel route,
//    subject to Hub DND like anything else). Tapping it opens the channel directly.
//    ⚠ That one is the platform's notification sound; iOS web push cannot loop one, so
//    a true ring-until-answered waits for the native release.
//
// It is mounted once in the Hub layout, so the banner appears whatever page you are
// on. An invite that arrives while you're already on the channel screen is ignored —
// that screen handles its own state.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import { RADIO_INVITE_TTL_MS, radioUserTopic } from '@/lib/radio/types'
import { startRadioInviteRing, stopRadioInviteRing } from '@/lib/radio/ring'
import { RadioIcon } from './RadioIcons'

type Invite = { sessionId: string; fromName: string }

export default function RadioInviteListener({ currentUserId }: { currentUserId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return subscribeSharedBroadcast(radioUserTopic(currentUserId), {
      invite: (payload) => {
        const p = (payload ?? {}) as { sessionId?: string; fromName?: string }
        if (!p.sessionId) return
        setInvite({ sessionId: p.sessionId, fromName: p.fromName || 'A teammate' })
      },
      // The opener gave up, or it was answered on another device.
      closed: () => setInvite(null),
      declined: () => setInvite(null),
    })
  }, [currentUserId])

  // An unanswered invite is a moment, not a standing request — it clears itself
  // rather than sitting on screen until someone deals with it.
  useEffect(() => {
    if (!invite) return
    const t = setTimeout(() => setInvite(null), RADIO_INVITE_TTL_MS)
    return () => clearTimeout(t)
  }, [invite])

  // The ring is tied to the banner being up, so every way an invite ends — accepted,
  // declined, withdrawn, expired, or this component unmounting — stops it in one place.
  useEffect(() => {
    if (invite) startRadioInviteRing()
    else stopRadioInviteRing()
    return () => stopRadioInviteRing()
  }, [invite])

  if (!invite) return null
  // Already looking at that channel (e.g. you arrived through the push) — that
  // screen owns the invite, so there is nothing for the banner to add.
  if (pathname?.startsWith(`/hub/radio/${invite.sessionId}`)) return null

  async function accept() {
    if (!invite || busy) return
    setBusy(true)
    // Navigate first: the channel screen does the accepting, so the tap that lands
    // there is also the user gesture iOS needs before it will play any audio.
    router.push(`/hub/radio/${invite.sessionId}`)
    setInvite(null)
    setBusy(false)
  }

  async function decline() {
    if (!invite || busy) return
    setBusy(true)
    const id = invite.sessionId
    setInvite(null)
    try { await fetch(`/api/hub/radio/session/${id}/decline`, { method: 'POST' }) } catch { /* it expires anyway */ }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-[120] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-3 shadow-2xl">
        <RadioIcon className="h-5 w-5 flex-none text-blue-400" />
        <p className="text-sm text-white">
          <span className="font-semibold">{invite.fromName}</span> wants to open a radio channel
        </p>
        <button type="button" onClick={accept} disabled={busy}
          className="flex-none rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          Accept
        </button>
        <button type="button" onClick={decline} disabled={busy}
          className="flex-none rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 disabled:opacity-50">
          Not now
        </button>
      </div>
    </div>
  )
}
