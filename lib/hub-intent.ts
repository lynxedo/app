'use client'

// "Start something" hand-off for the top bar's New menu. The New button opens an
// app as a tab, and that app may not be mounted yet (or may be running inside a
// page-tab frame), so a plain event would be lost. The request is parked in
// sessionStorage — shared by the window and its same-origin frames — and also
// announced live; whichever screen owns that kind consumes it once.

import { useEffect, useRef } from 'react'

export type HubIntentKind = 'new-text' | 'new-contact' | 'new-lead'

const KEY = 'lx-intent'
const EVENT = 'lx-intent'
const MAX_AGE_MS = 30_000

export function requestHubIntent(kind: HubIntentKind) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ kind, at: Date.now() })) } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: kind })) } catch { /* ignore */ }
}

/** Re-announce an intent inside this window (used by a page-tab frame when the window pings it). */
export function announceHubIntent(kind: string) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: kind })) } catch { /* ignore */ }
}

function takePending(kind: HubIntentKind): boolean {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return false
    const p = JSON.parse(raw) as { kind?: string; at?: number }
    if (p.kind !== kind) return false
    sessionStorage.removeItem(KEY)
    return typeof p.at === 'number' && Date.now() - p.at < MAX_AGE_MS
  } catch {
    return false
  }
}

/** Run `fn` when a `kind` intent is requested — on mount (if one is waiting) or live. */
export function useHubIntent(kind: HubIntentKind, fn: () => void) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (takePending(kind)) fnRef.current()
    const onIntent = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== kind) return
      if (takePending(kind)) fnRef.current()
    }
    window.addEventListener(EVENT, onIntent)
    return () => window.removeEventListener(EVENT, onIntent)
  }, [kind])
}
