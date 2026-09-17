'use client'

// The invite ring. Ben, Sep 16 2026: "a little persistent. Almost like a ring tone.
// But shorter."
//
// Two hard rules, both from Hub/HUB_RADIO_PRD.md:
//
//  1. It is BOUNDED. Nothing should ring for longer than the thing it is announcing
//     stays valid, so the ring can never outlive RADIO_INVITE_TTL_MS — and in
//     practice it stops long before, because a phone that rings for two minutes in a
//     truck is a phone somebody turns off.
//  2. It rides the Hub's own sound system, so the tone is the one chosen for
//     "Radio invites" in Settings and the master Sounds switch silences it.
//
// Out of the Hub this is irrelevant — that is the platform's push sound, and iOS web
// push cannot loop one. A true ring-until-answered needs the native release.

import { isChimeEnabled, playChime } from '@/lib/hub-chime'
import { RADIO_INVITE_TTL_MS } from './types'

const GAP_MS = 1_800
const MAX_RINGS = 5   // ~9 seconds. Persistent enough to catch, short enough to forgive.

let timer: ReturnType<typeof setInterval> | null = null
let stopped = false

/** Ring for the invite. Safe to call twice — the second call is ignored while a ring
 *  is already running, so a re-render or a duplicate broadcast can't stack two. */
export function startRadioInviteRing(): void {
  if (timer || !isChimeEnabled()) return

  stopped = false
  let rung = 0
  const ring = () => {
    rung += 1
    playChime('radio-invite')
    // The bound is the ring count, but tie it to the invite window as well: if the
    // constants are ever retuned so the ring would outlast the invite, the window wins.
    if (rung >= MAX_RINGS || rung * GAP_MS >= RADIO_INVITE_TTL_MS) stopRadioInviteRing()
  }

  ring()                                   // first one immediately, not after a gap
  // ⚠ Check the flag, not `timer`: the first ring can already have stopped us, and
  // `timer` is still null at that point, so testing it would start an interval we
  // have just decided not to run.
  if (!stopped) timer = setInterval(ring, GAP_MS)
}

/** Stop immediately — on accept, on decline, when the invite expires, and on unmount.
 *  Idempotent. */
export function stopRadioInviteRing(): void {
  stopped = true
  if (timer) { clearInterval(timer); timer = null }
}
