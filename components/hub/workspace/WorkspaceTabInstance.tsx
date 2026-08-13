'use client'

import { createContext, useContext, useMemo } from 'react'

/**
 * Am I the tab the user is actually looking at?
 *
 * Workspace Tabs keep EVERY open tab mounted and toggle `display` (that's the
 * whole point — scroll, drafts and filters survive a tab switch). The cost is
 * that a hidden tab still runs its effects, so anything that means "the user is
 * looking at this" — marking a conversation read, pinning a feed to the newest
 * message — fires for tabs nobody can see.
 *
 * `useTabVisible()` is that missing signal. It defaults to TRUE when there is no
 * provider above it, which is every render outside the tab stack: the normal
 * Next route, mobile, and anyone not opted into the beta. So consumers can gate
 * on it without changing behavior for the people who don't have tabs.
 */
type TabInstance = { tabId: string; isActive: boolean }

const WorkspaceTabInstanceContext = createContext<TabInstance | null>(null)

export function WorkspaceTabInstanceProvider({
  tabId,
  isActive,
  children,
}: {
  tabId: string
  isActive: boolean
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ tabId, isActive }), [tabId, isActive])
  return (
    <WorkspaceTabInstanceContext.Provider value={value}>
      {children}
    </WorkspaceTabInstanceContext.Provider>
  )
}

/** True when this subtree is on screen: not in a tab at all, or in the active tab. */
export function useTabVisible(): boolean {
  const instance = useContext(WorkspaceTabInstanceContext)
  return instance === null ? true : instance.isActive
}
