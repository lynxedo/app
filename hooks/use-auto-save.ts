'use client'
// Shared debounced auto-save (audit AD-toolkit / SET-autosave). Consolidates the
// inline debounce that Phase 1 (AD1) added to the Routing + Guardian admin panels
// so save behavior is uniform: edits persist without a manual Save, and the
// last-saved snapshot guards against the post-save setState re-triggering a loop.
//
// Usage:
//   useAutoSave(settings, saveSettings)            // 800ms debounce
//   useAutoSave(form, save, { delay: 500 })
//   useAutoSave(form, save, { enabled: ready })    // gate until loaded
import { useEffect, useRef } from 'react'

export function useAutoSave<T>(
  value: T,
  save: () => void | Promise<void>,
  opts: { delay?: number; enabled?: boolean } = {},
): void {
  const delay = opts.delay ?? 800
  const enabled = opts.enabled ?? true
  const lastSaved = useRef<string>(JSON.stringify(value))
  const mounted = useRef(false)
  // Keep the latest save fn without making it a dep (avoids re-arming on every render).
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!enabled) return
    const serialized = JSON.stringify(value)
    // Skip the first run after mount (and after enable flips true) — that's the
    // initial/loaded value, not a user edit.
    if (!mounted.current) {
      mounted.current = true
      lastSaved.current = serialized
      return
    }
    if (serialized === lastSaved.current) return
    const t = setTimeout(() => {
      lastSaved.current = serialized
      void saveRef.current()
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, delay])
}

export default useAutoSave
