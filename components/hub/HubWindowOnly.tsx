'use client'

// Renders its children only in the Hub WINDOW, never in a page running inside a
// Workspace Tab's frame (lib/hub-embed.ts). Sticky: decided on the first render,
// so a later server re-render of the layout inside the frame (router.refresh,
// whose request no longer says Sec-Fetch-Dest: iframe) can't switch the
// notifiers, chimes, push or idle redirect back on in there.

import { useState, type ReactNode } from 'react'
import { isEmbeddedTabFrame } from '@/lib/hub-embed'

export default function HubWindowOnly({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  const [inFrame] = useState(() => embedded || isEmbeddedTabFrame())
  return inFrame ? null : <>{children}</>
}
