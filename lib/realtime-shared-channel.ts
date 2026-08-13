'use client'

import { createClient } from '@/lib/supabase/client'

/**
 * Shared subscription to a company-wide Supabase broadcast topic.
 *
 * The company topics (`txt:{companyId}`, `inbox:{companyId}`) have several
 * subscribers at once — the rail dot, the chime, the list sidebar, the open
 * conversation, the pop-out. Supabase dedupes by topic
 * (`RealtimeClient.channel()` returns the EXISTING channel if one matches), so
 * every one of them holds the same object, and `removeChannel()` unsubscribes +
 * tears it down for all of them. The first component to unmount therefore killed
 * realtime for everyone still listening: switching away from a Txt tab unmounts
 * the Txt sidebar, whose cleanup silently took the still-open conversation's
 * live updates with it (the Inbox thread view has no fallback poll at all, so it
 * stayed stale until a page refresh).
 *
 * So the channel is owned here and callers only register handlers. Releasing
 * removes YOUR handlers; it never touches the channel.
 *
 * Why the channel is deliberately never torn down: `removeChannel()` is async,
 * and until the server acks the leave, `channel(topic)` still hands out the
 * dying object — whose `subscribe()` is a no-op, because it only acts on a
 * CLOSED channel. Any subscriber landing in that window would silently get a
 * dead channel, and the one after it would throw ("tried to join multiple
 * times", since teardown doesn't reset phoenix's `joinedOnce`). That is the same
 * silent-dead-channel failure this helper exists to prevent, so there's no
 * teardown to race. The cost is at most two idle broadcast topics multiplexed
 * over the socket the Hub already holds open — and `HubShell` keeps `txt:` for
 * the whole session anyway, so in practice nothing is actually kept alive that
 * wasn't already.
 */
type Handler = (payload: unknown) => void

type Entry = {
  channel: ReturnType<ReturnType<typeof createClient>['channel']>
  /** event name -> live subscriber callbacks, read at dispatch time */
  listeners: Map<string, Set<Handler>>
}

const entries = new Map<string, Entry>()

export function subscribeSharedBroadcast(
  topic: string,
  handlers: Record<string, Handler>
): () => void {
  let entry = entries.get(topic)
  if (!entry) {
    entry = { channel: createClient().channel(topic), listeners: new Map() }
    entries.set(topic, entry)
  }
  const e = entry

  const added: [string, Handler][] = []
  for (const [event, fn] of Object.entries(handlers)) {
    let set = e.listeners.get(event)
    if (!set) {
      set = new Set()
      e.listeners.set(event, set)
      // Bind once per event and fan out from the live Set, so a subscriber that
      // arrives after the channel has joined still receives events. (Binding a
      // `broadcast` handler after `subscribe()` is allowed — unlike
      // `postgres_changes`, which throws.)
      e.channel.on('broadcast', { event }, ({ payload }: { payload: unknown }) => {
        for (const cb of Array.from(e.listeners.get(event) ?? [])) {
          try {
            cb(payload)
          } catch {
            /* one bad listener must not stop the others */
          }
        }
      })
    }
    // NOTE: a Set, so two subscribers passing the SAME function reference for one
    // event would share a slot and the first release would unregister both. Every
    // call site passes a fresh inline closure; keep it that way.
    set.add(fn)
    added.push([event, fn])
  }

  // No-op once the channel is joined/joining, so every caller can call it.
  e.channel.subscribe()

  let released = false
  return () => {
    if (released) return
    released = true
    for (const [event, fn] of added) e.listeners.get(event)?.delete(fn)
  }
}
