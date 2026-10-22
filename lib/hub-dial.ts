'use client'

// Click-to-call from anywhere in the Hub. On desktop the Hub window registers a
// handler that opens the pop-up phone with the number filled in (you stay on the
// screen you were on); a page running inside a Workspace Tab hands the request up
// to that window; anywhere else (phone, tabs off, no shell phone) it falls back to
// today's behaviour — the Dialer page with the number pre-filled.

import { isEmbeddedTabFrame } from './hub-embed'

export type DialRequest = { number: string; conversationId?: string | null; contactId?: string | null }

type DialHandler = (req: DialRequest) => void

declare global {
  interface Window { __lxDial?: DialHandler }
}

export function registerDialHandler(fn: DialHandler | null) {
  if (typeof window === 'undefined') return
  if (fn) window.__lxDial = fn
  else delete window.__lxDial
}

export function dialerHref(req: DialRequest): string {
  const qs = new URLSearchParams({ number: req.number })
  if (req.conversationId) qs.set('conversation_id', req.conversationId)
  if (req.contactId) qs.set('contact_id', req.contactId)
  return `/hub/dialer?${qs.toString()}`
}

export function requestDial(req: DialRequest, push: (href: string) => void) {
  if (typeof window !== 'undefined') {
    if (window.__lxDial) { window.__lxDial(req); return }
    if (isEmbeddedTabFrame()) {
      window.parent.postMessage({ lx: 'dial', ...req }, window.location.origin)
      return
    }
  }
  push(dialerHref(req))
}
