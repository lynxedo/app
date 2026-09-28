'use client'

// One switch, two very different bridges.
//
// ⚠ Android has no Capacitor bridge on our remote pages, so its lock is a plain
// JavascriptInterface with SYNCHRONOUS methods. iOS does have the bridge, and a
// Capacitor plugin call is a PROMISE. Same feature, same setting, opposite
// shapes — so everything here is async and the Android side is wrapped.

type IosPlugin = {
  isAvailable(): Promise<{ available: boolean }>
  isEnabled(): Promise<{ enabled: boolean }>
  setEnabled(opts: { on: boolean }): Promise<void>
}
type AndroidBridge = {
  isAvailable(): boolean
  isEnabled(): boolean
  setEnabled(on: boolean): void
}

function ios(): IosPlugin | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: { Plugins?: { AppLock?: IosPlugin } } })
    .Capacitor?.Plugins?.AppLock
}

function android(): AndroidBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { LynxedoLock?: AndroidBridge }).LynxedoLock
}

/** True only where the phone can actually ask — a device with no biometric AND
 *  no passcode has nothing to unlock with, and offering the switch there would
 *  be a setting that silently does nothing. */
export async function appLockAvailable(): Promise<boolean> {
  try {
    const plugin = ios()
    if (plugin) return (await plugin.isAvailable()).available
    return android()?.isAvailable() ?? false
  } catch {
    return false
  }
}

export async function appLockEnabled(): Promise<boolean> {
  try {
    const plugin = ios()
    if (plugin) return (await plugin.isEnabled()).enabled
    return android()?.isEnabled() ?? false
  } catch {
    return false
  }
}

export async function setAppLock(on: boolean): Promise<void> {
  try {
    const plugin = ios()
    if (plugin) { await plugin.setEnabled({ on }); return }
    android()?.setEnabled(on)
  } catch {
    // No bridge on this build — there is nothing to lock.
  }
}
