'use client'

import { createContext, useContext, type ReactNode } from 'react'

// Client-side mirror of the server-resolved beta flag map (lib/beta-flags.ts).
// HubShell provides it from the betaFlags it already receives from the Hub layout,
// so any client component rendered under the shell can gate a Beta-ring feature
// with useBetaFlag('<key>'). This is the reusable version of the explicit
// conversation_popout wiring — for flags that only need a boolean (show/hide an
// entry point) rather than their own provider + behavior.

const BetaFlagsContext = createContext<Record<string, boolean>>({})

export function BetaFlagsProvider({
  flags,
  children,
}: {
  flags: Record<string, boolean>
  children: ReactNode
}) {
  return <BetaFlagsContext.Provider value={flags}>{children}</BetaFlagsContext.Provider>
}

// True only when this beta feature is available AND on for the current user
// (opted in, or default-on and not opted out) — the server already resolved that.
export function useBetaFlag(key: string): boolean {
  return useContext(BetaFlagsContext)[key] === true
}
