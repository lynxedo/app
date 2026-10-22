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

// ── Jump to a message (search result → a conversation that's open as a tab) ──
// A tab's URL isn't the window's, so `?msg=` can't reach a conversation open as
// a tab. The search hands the target over the same way: parked + announced, and
// the conversation's RoomView picks it up (on mount, or live if already open).

export type MessageJump = { target: string; msg: string; thread: string | null }

const JUMP_KEY = 'lx-msg-jump'
const JUMP_EVENT = 'lx-msg-jump'

export function requestMessageJump(j: MessageJump) {
  try { sessionStorage.setItem(JUMP_KEY, JSON.stringify({ ...j, at: Date.now() })) } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: j.target })) } catch { /* ignore */ }
}

function takeJump(target: string): MessageJump | null {
  try {
    const raw = sessionStorage.getItem(JUMP_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as MessageJump & { at?: number }
    if (p.target !== target) return null
    sessionStorage.removeItem(JUMP_KEY)
    return typeof p.at === 'number' && Date.now() - p.at < MAX_AGE_MS ? { target: p.target, msg: p.msg, thread: p.thread ?? null } : null
  } catch {
    return null
  }
}

/** Run `fn` with a jump aimed at this room / conversation id. */
export function useMessageJump(target: string | null | undefined, fn: (j: MessageJump) => void) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!target) return
    const first = takeJump(target)
    if (first) fnRef.current(first)
    const onJump = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== target) return
      const j = takeJump(target)
      if (j) fnRef.current(j)
    }
    window.addEventListener(JUMP_EVENT, onJump)
    return () => window.removeEventListener(JUMP_EVENT, onJump)
  }, [target])
}
