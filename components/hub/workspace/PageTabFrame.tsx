'use client'

/**
 * A PAGE tab's content: the real Hub route in a same-origin frame running the
 * embedded shell (no rail, no phone, no radio — see lib/hub-embed.ts). The frame
 * reports where it moved, its title, and anything it wants opened elsewhere; the
 * window tells it whether it's on screen (for useTabVisible inside it).
 *
 * The src is fixed at mount — moving around inside the tab updates the tab's
 * href, never the src, or every click would reload the frame.
 */

import { useEffect, useRef, useState } from 'react'
import { EMBED_NAME_PREFIX, embedSrcFor, isLxMessage, type EmbedToShellMessage, type ShellToEmbedMessage } from '@/lib/hub-embed'

export type PageTabFrameHandlers = {
  onNav: (tabId: string, href: string) => void
  onTitle: (tabId: string, title: string) => void
  onOpen: (href: string) => void
  onOpenTab: (input: Extract<EmbedToShellMessage, { lx: 'openTab' }>['input']) => void
  onDial: (req: { number: string; conversationId?: string | null; contactId?: string | null }) => void
  onKey: (k: Extract<EmbedToShellMessage, { lx: 'key' }>) => void
  onCompose: () => void
}

export default function PageTabFrame({
  tabId,
  href,
  visible,
  label,
  handlers,
}: {
  tabId: string
  href: string
  visible: boolean
  label: string
  handlers: PageTabFrameHandlers
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => embedSrcFor(href))
  const [loaded, setLoaded] = useState(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const post = (msg: ShellToEmbedMessage) => {
    try { frameRef.current?.contentWindow?.postMessage(msg, window.location.origin) } catch { /* frame gone */ }
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return
      if (!isLxMessage(e.data)) return
      const m = e.data as EmbedToShellMessage
      const h = handlersRef.current
      switch (m.lx) {
        case 'nav': h.onNav(tabId, m.href); break
        case 'title': h.onTitle(tabId, m.title); break
        case 'open': h.onOpen(m.href); break
        case 'openTab': h.onOpenTab(m.input); break
        case 'dial': h.onDial({ number: m.number, conversationId: m.conversationId, contactId: m.contactId }); break
        case 'key': h.onKey(m); break
        case 'compose': h.onCompose(); break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [tabId])

  // Tell the page whether it's the one on screen (it defaults to visible).
  useEffect(() => { if (loaded) post({ lx: 'visible', visible }) }, [visible, loaded])

  // A "New …" request made while this tab was already open (see lib/hub-intent).
  useEffect(() => {
    const onIntent = (e: Event) => {
      if (!visibleRef.current) return
      const kind = (e as CustomEvent<string>).detail
      if (typeof kind === 'string') post({ lx: 'intent', kind })
    }
    window.addEventListener('lx-intent', onIntent)
    return () => window.removeEventListener('lx-intent', onIntent)
  }, [])

  return (
    <div className="relative flex-1 min-h-0 min-w-0 flex">
      <iframe
        ref={frameRef}
        name={`${EMBED_NAME_PREFIX}${tabId}`}
        src={src}
        title={label}
        onLoad={() => { setLoaded(true); post({ lx: 'visible', visible: visibleRef.current }) }}
        className="flex-1 min-h-0 w-full h-full border-0 bg-gray-950"
        allow="clipboard-read; clipboard-write; microphone; camera; geolocation; fullscreen"
      />
      {!loaded && (
        <div className="absolute inset-0 p-6 text-sm text-white/40 pointer-events-none">Loading {label}…</div>
      )}
    </div>
  )
}
