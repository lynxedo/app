'use client'

// The one way a clock punch is sent.
//
// ⚠⚠ There were two. `hooks/use-clock-punch.ts` served the Home card and the
// clock modal; `app/hub/timesheet/TimesheetPage.tsx` had its own copy. Both had
// the same silent-failure bug, and when the queue was added to one of them the
// Timesheet page — the screen people actually use to clock in — kept the old
// behaviour and lost punches exactly as before. Caught only by driving the real
// screen on a real phone. One path now, so a fix cannot land on half of them.

import { enqueue } from '@/lib/offline-queue'
import { haptic } from '@/lib/native-device'

export type PunchPayload = {
  employee_id: string
  action: 'in' | 'out'
  note: string | null
  lat: number | null
  lng: number | null
  /** When the button was tapped. Stamped here, not on the server — see below. */
  punched_at: string
}

export type PunchResult =
  | { status: 'sent'; warning?: string }
  /** No signal. Held on the device and it will go when there is some. */
  | { status: 'held' }
  /** No signal AND nowhere to hold it. The person has to be told. */
  | { status: 'lost' }
  /** The server read it and said no. `message` is for the person. */
  | { status: 'refused'; message: string }

/** How long to wait before deciding there is no signal.
 *
 *  ⚠ A dead zone does NOT reject — it HANGS. Measured on a real phone with the
 *  radio cut: without this the request never settles, the button sits on "…"
 *  forever and nothing is ever queued. */
const GIVE_UP_MS = 8000

/** A punch is the one thing in the Hub done with gloves on, in a truck, often
 *  without looking. Three outcomes that matter, so three different buzzes —
 *  the point is to know it landed without reading the screen.
 *
 *  ⚠ Haptics existed but nothing outside a message long-press and Radio ever
 *  called them, so the app felt dead to the touch everywhere people actually
 *  press things. Android has navigator.vibrate (VIBRATE is in the manifest);
 *  iOS has no Vibration API at all and goes through the native plugin. */
function feel(result: PunchResult) {
  if (result.status === 'sent') haptic('success')
  else if (result.status === 'held') haptic('warning')
  else haptic('error')
  return result
}

export async function sendPunch(payload: PunchPayload): Promise<PunchResult> {
  try {
    const res = await fetch('/api/timesheet/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GIVE_UP_MS),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      return feel({ status: 'refused', message: body?.error ?? 'That punch did not save. Try again.' })
    }
    const body = await res.json().catch(() => null) as { warning?: string } | null
    return feel({ status: 'sent', warning: body?.warning })
  } catch {
    // Unreachable, or we gave up waiting. Either way the person tapped the
    // button and the time that matters is already in the payload.
    const held = await enqueue({
      url: '/api/timesheet/punch',
      body: payload,
      kind: 'punch',
      label: payload.action === 'in' ? 'Clock in' : 'Clock out',
      createdAt: new Date(payload.punched_at).getTime(),
    })
    return feel(held ? { status: 'held' } : { status: 'lost' })
  }
}
