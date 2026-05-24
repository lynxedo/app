// IndexedDB cache for Hub data (Session 47, stale-while-revalidate).
//
// Best-effort: every operation is wrapped so a cache failure never blocks UI.
// All read paths return null when the cache is unavailable; all write paths
// return without throwing. The cache is an optimization layer, not a source
// of truth — the server fetch always runs and reconciles.
//
// Kill switch: localStorage['hub_cache_disable'] = '1' disables reads and writes
// without a deploy. Bumping SCHEMA_VERSION wipes the database on next open.

import type { HubMessage, HubUser } from '@/components/hub/MessageFeed'

const DB_NAME = 'lynxedo-hub-cache'
const SCHEMA_VERSION = 1
const MAX_MESSAGES_PER_SCOPE = 50

type Scope = 'room' | 'conv'

type StoredMessageRow = HubMessage & {
  _scope: Scope
  _scope_id: string
  _ts: number
}

type ConversationListRow = {
  id: string
  participants: HubUser[]
  last_message?: string
  archived_at?: string | null
  archived?: boolean
}

type RoomListRow = {
  id: string
  name: string
  is_private: boolean
}

type ReadReceiptsRow = {
  conv_id: string
  receipts: Array<{ user_id: string; last_read_at: string }>
}

type UnreadStateRow = {
  user_id: string
  unread_room_ids: string[]
  unread_conv_ids: string[]
}

type HubUserRow = HubUser

type MetaRow = {
  key: string
  value: string | number
  updated_at: number
}

const STORE_MESSAGES = 'messages'
const STORE_ROOMS = 'rooms'
const STORE_CONVERSATIONS = 'conversations'
const STORE_MEMBERS = 'members'
const STORE_READ_RECEIPTS = 'read_receipts'
const STORE_UNREAD = 'unread'
const STORE_HUB_USERS = 'hub_users'
const STORE_META = 'meta'

function isCacheDisabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem('hub_cache_disable') === '1'
  } catch {
    return false
  }
}

function hasIDB(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (isCacheDisabled() || !hasIDB()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, SCHEMA_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        // Wipe any existing stores when schema bumps — cache is throw-away.
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name)
        }
        const msgs = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' })
        msgs.createIndex('scope_id', '_scope_id', { unique: false })
        msgs.createIndex('scope_ts', ['_scope_id', '_ts'], { unique: false })
        db.createObjectStore(STORE_ROOMS, { keyPath: 'id' })
        db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' })
        db.createObjectStore(STORE_MEMBERS, { keyPath: 'conv_id' })
        db.createObjectStore(STORE_READ_RECEIPTS, { keyPath: 'conv_id' })
        db.createObjectStore(STORE_UNREAD, { keyPath: 'user_id' })
        db.createObjectStore(STORE_HUB_USERS, { keyPath: 'id' })
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function tx(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode): IDBTransaction | null {
  try {
    return db.transaction(stores, mode)
  } catch {
    return null
  }
}

function promisify<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function scopeKey(scope: Scope, id: string): string {
  return `${scope}:${id}`
}

// -- Messages -----------------------------------------------------------------

export async function saveMessages(scope: Scope, id: string, messages: HubMessage[]): Promise<void> {
  if (!messages.length) return
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_MESSAGES, 'readwrite')
  if (!t) return
  try {
    const store = t.objectStore(STORE_MESSAGES)
    const scopeId = scopeKey(scope, id)
    const now = Date.now()
    for (const m of messages) {
      const row: StoredMessageRow = {
        ...m,
        _scope: scope,
        _scope_id: scopeId,
        _ts: new Date(m.created_at).getTime() || now,
      }
      store.put(row)
    }
    // Evict beyond MAX_MESSAGES_PER_SCOPE for this scope.
    const idx = store.index('scope_ts')
    const range = IDBKeyRange.bound([scopeId, -Infinity], [scopeId, Infinity])
    const all = await promisify(idx.getAllKeys(range))
    if (all && all.length > MAX_MESSAGES_PER_SCOPE) {
      // getAllKeys with the index returns the primary keys ordered by index.
      // Trim oldest (lowest _ts) — those are first in the result.
      const drop = all.slice(0, all.length - MAX_MESSAGES_PER_SCOPE)
      for (const key of drop) {
        store.delete(key as IDBValidKey)
      }
    }
  } catch {
    // swallow
  }
}

export async function getMessages(scope: Scope, id: string): Promise<HubMessage[] | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_MESSAGES, 'readonly')
  if (!t) return null
  try {
    const store = t.objectStore(STORE_MESSAGES)
    const idx = store.index('scope_ts')
    const scopeId = scopeKey(scope, id)
    const range = IDBKeyRange.bound([scopeId, -Infinity], [scopeId, Infinity])
    const rows = await promisify(idx.getAll(range))
    if (!rows || !rows.length) return null
    // Index ordering ascending by _ts. Strip cache-only fields.
    return (rows as StoredMessageRow[]).map(({ _scope, _scope_id, _ts, ...rest }) => rest)
  } catch {
    return null
  }
}

export async function patchMessage(msg: HubMessage): Promise<void> {
  const db = await openDB()
  if (!db) return
  // Figure out the scope/id from the message itself.
  const scope: Scope | null = msg.room_id ? 'room' : msg.conversation_id ? 'conv' : null
  const id = msg.room_id ?? msg.conversation_id ?? null
  if (!scope || !id) return
  await saveMessages(scope, id, [msg])
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_MESSAGES, 'readwrite')
  if (!t) return
  try {
    t.objectStore(STORE_MESSAGES).delete(id)
  } catch {
    // swallow
  }
}

// -- Conversations list (sidebar data) ---------------------------------------

export async function saveConversationsList(convs: ConversationListRow[]): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_CONVERSATIONS, 'readwrite')
  if (!t) return
  try {
    const store = t.objectStore(STORE_CONVERSATIONS)
    store.clear()
    for (const c of convs) store.put(c)
  } catch {
    // swallow
  }
}

export async function getConversationsList(): Promise<ConversationListRow[] | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_CONVERSATIONS, 'readonly')
  if (!t) return null
  try {
    const rows = await promisify(t.objectStore(STORE_CONVERSATIONS).getAll())
    return rows && rows.length ? (rows as ConversationListRow[]) : null
  } catch {
    return null
  }
}

// -- Rooms list ---------------------------------------------------------------

export async function saveRoomsList(rooms: RoomListRow[]): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_ROOMS, 'readwrite')
  if (!t) return
  try {
    const store = t.objectStore(STORE_ROOMS)
    store.clear()
    for (const r of rooms) store.put(r)
  } catch {
    // swallow
  }
}

export async function getRoomsList(): Promise<RoomListRow[] | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_ROOMS, 'readonly')
  if (!t) return null
  try {
    const rows = await promisify(t.objectStore(STORE_ROOMS).getAll())
    return rows && rows.length ? (rows as RoomListRow[]) : null
  } catch {
    return null
  }
}

// -- Members ------------------------------------------------------------------

export async function saveMembers(convId: string, members: HubUser[]): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_MEMBERS, 'readwrite')
  if (!t) return
  try {
    t.objectStore(STORE_MEMBERS).put({ conv_id: convId, members })
  } catch {
    // swallow
  }
}

export async function getMembers(convId: string): Promise<HubUser[] | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_MEMBERS, 'readonly')
  if (!t) return null
  try {
    const row = await promisify(t.objectStore(STORE_MEMBERS).get(convId))
    return row ? (row as { members: HubUser[] }).members : null
  } catch {
    return null
  }
}

// -- Read receipts ------------------------------------------------------------

export async function saveReadReceipts(convId: string, receipts: ReadReceiptsRow['receipts']): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_READ_RECEIPTS, 'readwrite')
  if (!t) return
  try {
    t.objectStore(STORE_READ_RECEIPTS).put({ conv_id: convId, receipts })
  } catch {
    // swallow
  }
}

export async function getReadReceipts(convId: string): Promise<ReadReceiptsRow['receipts'] | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_READ_RECEIPTS, 'readonly')
  if (!t) return null
  try {
    const row = await promisify(t.objectStore(STORE_READ_RECEIPTS).get(convId))
    return row ? (row as ReadReceiptsRow).receipts : null
  } catch {
    return null
  }
}

// -- Unread state -------------------------------------------------------------

export async function saveUnreadState(
  userId: string,
  unreadRoomIds: string[],
  unreadConvIds: string[],
): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_UNREAD, 'readwrite')
  if (!t) return
  try {
    t.objectStore(STORE_UNREAD).put({
      user_id: userId,
      unread_room_ids: unreadRoomIds,
      unread_conv_ids: unreadConvIds,
    } satisfies UnreadStateRow)
  } catch {
    // swallow
  }
}

export async function getUnreadState(userId: string): Promise<UnreadStateRow | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_UNREAD, 'readonly')
  if (!t) return null
  try {
    const row = await promisify(t.objectStore(STORE_UNREAD).get(userId))
    return row ? (row as UnreadStateRow) : null
  } catch {
    return null
  }
}

// -- Hub users (for mention rendering) ---------------------------------------

export async function saveHubUsers(users: HubUserRow[]): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_HUB_USERS, 'readwrite')
  if (!t) return
  try {
    const store = t.objectStore(STORE_HUB_USERS)
    store.clear()
    for (const u of users) store.put(u)
  } catch {
    // swallow
  }
}

export async function getHubUsers(): Promise<HubUserRow[] | null> {
  const db = await openDB()
  if (!db) return null
  const t = tx(db, STORE_HUB_USERS, 'readonly')
  if (!t) return null
  try {
    const rows = await promisify(t.objectStore(STORE_HUB_USERS).getAll())
    return rows && rows.length ? (rows as HubUserRow[]) : null
  } catch {
    return null
  }
}

// -- Eviction -----------------------------------------------------------------

export async function evictScope(scope: Scope, id: string): Promise<void> {
  const db = await openDB()
  if (!db) return
  const t = tx(db, STORE_MESSAGES, 'readwrite')
  if (!t) return
  try {
    const store = t.objectStore(STORE_MESSAGES)
    const idx = store.index('scope_id')
    const keys = await promisify(idx.getAllKeys(scopeKey(scope, id)))
    if (keys) {
      for (const key of keys) {
        store.delete(key as IDBValidKey)
      }
    }
  } catch {
    // swallow
  }
}

export async function evictMissingConvs(currentConvIds: string[]): Promise<void> {
  const db = await openDB()
  if (!db) return
  const cached = await getConversationsList()
  if (!cached) return
  const fresh = new Set(currentConvIds)
  for (const conv of cached) {
    if (!fresh.has(conv.id)) {
      await evictScope('conv', conv.id)
    }
  }
}

export async function evictMissingRooms(currentRoomIds: string[]): Promise<void> {
  const db = await openDB()
  if (!db) return
  const cached = await getRoomsList()
  if (!cached) return
  const fresh = new Set(currentRoomIds)
  for (const room of cached) {
    if (!fresh.has(room.id)) {
      await evictScope('room', room.id)
    }
  }
}

// -- Bulk operations ----------------------------------------------------------

export async function clearCache(): Promise<void> {
  const db = await openDB()
  if (!db) return
  const stores = [
    STORE_MESSAGES, STORE_ROOMS, STORE_CONVERSATIONS, STORE_MEMBERS,
    STORE_READ_RECEIPTS, STORE_UNREAD, STORE_HUB_USERS, STORE_META,
  ]
  const t = tx(db, stores, 'readwrite')
  if (!t) return
  try {
    for (const s of stores) t.objectStore(s).clear()
  } catch {
    // swallow
  }
}

// Ask the platform for durable storage. Safe to call repeatedly; idempotent.
// Returns the granted state (or false if unavailable). Never throws.
export async function persistStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    const already = await navigator.storage.persisted?.()
    if (already) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
