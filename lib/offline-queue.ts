'use client'

// Writes that survive a dead zone.
//
// A crew works properties with no signal. Today a clock punch made there is
// simply lost: the fetch throws, nothing is caught, and the button appears not
// to have worked. This holds the write on the device and sends it when signal
// comes back.
//
// ⚠⚠ ORDER IS NOT OPTIONAL. Clock in, then clock out, must reach the server in
// that order or the shift computes backwards. So this is a strict FIFO and a
// failure STOPS the drain rather than skipping past it — one stuck item holds
// the queue rather than letting the one behind it overtake.
//
// ⚠ A network failure and a refusal are different things and must not be
// treated alike. `fetch` rejecting means we never reached the server: keep the
// item and try again. A 4xx is the server having read it and said no: that will
// never succeed on a retry, so the item is dropped and the reason surfaced. A
// 5xx sits in between — the server is up but unwell — so those are retried.
//
// ⚠ This is deliberately NOT a Service Worker with Background Sync. The Hub's
// service worker exists for push and does not control the page (verified:
// navigator.serviceWorker.controller is null in the app's webview), and
// Background Sync in an Android WebView is not something to stake payroll on.
// This drains while the app is open, which is the real recovery moment anyway:
// the person comes back into signal with Lynxedo still on screen.

const DB_NAME = 'lynxedo-offline-queue'
const STORE = 'writes'
const SCHEMA_VERSION = 1
const MAX_ATTEMPTS = 50

export type QueuedWrite = {
  id: string
  url: string
  body: unknown
  /** Shown to the person: "Clock in at 9:04 AM". Never a URL. */
  label: string
  /** Groups items for the UI and for callers that want their own count. */
  kind: 'punch' | 'other'
  createdAt: number
  attempts: number
}

export type DropReason = { item: QueuedWrite; message: string }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, SCHEMA_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function allItems(): Promise<QueuedWrite[]> {
  const rows = (await tx<QueuedWrite[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedWrite[]>)) ?? []
  return rows.sort((a, b) => a.createdAt - b.createdAt)   // strict FIFO
}

// ---- listeners -------------------------------------------------------------

type Listener = (count: number) => void
const listeners = new Set<Listener>()
const dropListeners = new Set<(reason: DropReason) => void>()

async function notify() {
  const count = (await allItems()).length
  listeners.forEach((l) => { try { l(count) } catch { /* a bad listener is not our problem */ } })
}

/** Subscribe to how many writes are still waiting. Fires immediately. */
export function onPendingChange(listener: Listener): () => void {
  listeners.add(listener)
  void allItems().then((rows) => listener(rows.length))
  return () => { listeners.delete(listener) }
}

/** Subscribe to writes the server refused outright — these need telling about. */
export function onDropped(listener: (reason: DropReason) => void): () => void {
  dropListeners.add(listener)
  return () => { dropListeners.delete(listener) }
}

// ---- the queue -------------------------------------------------------------

/** Hold a write for later. Returns false when there is no storage to hold it in,
 *  so the caller can say so rather than pretend it was saved. */
export async function enqueue(
  item: Omit<QueuedWrite, 'id' | 'createdAt' | 'attempts'> & { createdAt?: number },
): Promise<boolean> {
  const row: QueuedWrite = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: item.createdAt ?? Date.now(),
    attempts: 0,
  }
  const ok = await tx('readwrite', (s) => s.put(row) as IDBRequest<IDBValidKey>)
  await notify()
  return ok !== null
}

let draining = false

/**
 * Send what is waiting, oldest first, stopping at the first item that cannot go.
 * Safe to call at any time and from anywhere; overlapping calls collapse.
 */
export async function flush(): Promise<void> {
  if (draining) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  draining = true
  try {
    for (const item of await allItems()) {
      let res: Response
      try {
        res = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body),
        })
      } catch {
        // Never reached the server. Keep it, keep the order, try again later.
        item.attempts += 1
        if (item.attempts >= MAX_ATTEMPTS) {
          await drop(item, 'That could not be sent after many tries. Ask a manager to add it by hand.')
          continue
        }
        await tx('readwrite', (s) => s.put(item) as IDBRequest<IDBValidKey>)
        break
      }

      if (res.ok) {
        await tx('readwrite', (s) => s.delete(item.id) as IDBRequest<undefined>)
        await notify()
        continue
      }

      if (res.status >= 500) {
        // The server is up but unwell. Not this item's fault — wait.
        item.attempts += 1
        await tx('readwrite', (s) => s.put(item) as IDBRequest<IDBValidKey>)
        break
      }

      // 4xx: it was read and refused. Retrying changes nothing.
      const body = await res.json().catch(() => null) as { error?: string } | null
      await drop(item, body?.error ?? 'That was not accepted when it finally sent.')
    }
  } finally {
    draining = false
  }
}

async function drop(item: QueuedWrite, message: string) {
  await tx('readwrite', (s) => s.delete(item.id) as IDBRequest<undefined>)
  await notify()
  dropListeners.forEach((l) => { try { l({ item, message }) } catch { /* ignore */ } })
}

let started = false

/** Start draining on the events that mean "signal might be back". Idempotent. */
export function startDraining(): void {
  if (started || typeof window === 'undefined') return
  started = true
  void flush()
  window.addEventListener('online', () => { void flush() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })
  // ⚠ navigator.onLine lies: it reports the radio, not reachability. A truck in
  // a yard with one bar and no working data says it is online. So poll as well
  // rather than trusting the events alone.
  setInterval(() => { void flush() }, 30_000)
}
