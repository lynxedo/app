'use client'

import { useEffect } from 'react'

// Warn before the page unloads — browser refresh (⌘R), tab close, the
// "Refresh to update" button, or any window.location navigation — while a draft
// is unsaved. Components with in-progress input call useUnsavedGuard(isDirty);
// the native "Leave site? Changes you made may not be saved" prompt fires
// whenever ANY mounted caller reports dirty. A module-level counter lets several
// editors (new-lead form, message composer, …) compose without stomping on each
// other. The listener stays attached once added — it is a no-op while count is 0.
let dirtyCount = 0
let attached = false

function beforeUnload(e: BeforeUnloadEvent) {
  if (dirtyCount <= 0) return
  e.preventDefault()
  e.returnValue = '' // required for the prompt to show in most browsers
}

/** True while ANY mounted editor reports an unsaved draft. Read by anything that
 *  wants to refresh the page out from under the user — see HubWarmResume, which
 *  refuses to when this is true. */
export function hasUnsavedWork(): boolean {
  return dirtyCount > 0
}

export function useUnsavedGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return
    dirtyCount += 1
    if (!attached) {
      window.addEventListener('beforeunload', beforeUnload)
      attached = true
    }
    return () => {
      dirtyCount = Math.max(0, dirtyCount - 1)
    }
  }, [isDirty])
}
