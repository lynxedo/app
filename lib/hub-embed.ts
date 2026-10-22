// Workspace Tabs — the shared vocabulary between the Hub window and the pages it
// runs inside tabs (client-safe: no server imports).
//
// Any Hub screen that has no kept-alive "twin" component opens as a PAGE TAB: the
// real route, loaded in a same-origin <iframe> whose `name` starts with
// EMBED_NAME_PREFIX. Inside that frame the Hub shell renders "embedded" — no
// rail, no tab strip, no phone, no radio, no notifiers — just the section's own
// sidebar and the page. Rendering the real route (instead of writing a second
// copy of every screen) is deliberate: twins drift from their routes and tsc
// can't see it (see lesson_workspace_tab_twins_are_a_second_entry_point).
//
// The frame and the window talk over postMessage, same origin only.

export const EMBED_NAME_PREFIX = 'lxtab:'

/** Query param added to a page tab's first load, stripped again before the href is reported. */
export const EMBED_QUERY_PARAM = 'lx_embed'

/** True when this window is a Hub page running inside a Workspace Tab. */
export function isEmbeddedTabFrame(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.parent !== window && typeof window.name === 'string' && window.name.startsWith(EMBED_NAME_PREFIX)
  } catch {
    return false
  }
}

/** Frame → window messages. */
export type EmbedToShellMessage =
  /** The page inside the tab moved (same app) — update the tab's href / label. */
  | { lx: 'nav'; href: string }
  | { lx: 'title'; title: string }
  /** Something inside the tab wants a different app — the window opens it as its own tab. */
  | { lx: 'open'; href: string }
  /** A screen inside the tab called the Workspace Tabs api (e.g. the Txt sidebar opening a thread). */
  | { lx: 'openTab'; input: { catalogId: string; label: string; href: string; instanceKey?: string; newCopy?: boolean } }
  /** Click-to-call from inside a tab — the window's phone handles it. */
  | { lx: 'dial'; number: string; conversationId?: string | null; contactId?: string | null }
  /** A shortcut pressed while focus was inside the frame (⌘K, Ctrl+1..9, …). */
  | { lx: 'key'; key: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }
  | { lx: 'compose' }

/** Window → frame messages. */
export type ShellToEmbedMessage =
  | { lx: 'visible'; visible: boolean }
  | { lx: 'intent'; kind: string }

export function isLxMessage(data: unknown): data is { lx: string } {
  return !!data && typeof data === 'object' && typeof (data as { lx?: unknown }).lx === 'string'
}

/** Strip the embed marker so the href a frame reports is the plain route. */
export function cleanEmbedHref(pathname: string, search: string): string {
  const sp = new URLSearchParams(search)
  sp.delete(EMBED_QUERY_PARAM)
  const qs = sp.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** The src for a page tab's frame. */
export function embedSrcFor(href: string): string {
  const [path, qs = ''] = href.split('?')
  const sp = new URLSearchParams(qs)
  sp.set(EMBED_QUERY_PARAM, '1')
  return `${path}?${sp.toString()}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(s: string | undefined | null): boolean {
  return !!s && UUID_RE.test(s)
}

/**
 * Which "app" a Hub path belongs to — the unit a tab stays inside. Navigating
 * within the same app (Admin → Admin → People, Reports → a report) stays in the
 * tab; a different app opens its own tab. Conversation routes (rooms, DMs) are
 * all one 'chat' app.
 */
export function appKeyFromPath(pathname: string): string {
  const seg = pathname.split('?')[0].split('/').filter(Boolean) // ['hub', 'admin', ...]
  if (seg[0] !== 'hub') return seg[0] ?? ''
  const first = seg[1] ?? ''
  if (!first || first === 'pm' || isUuid(first)) return 'chat'
  return first
}

/**
 * Screens that must only ever run in the main window, never in a frame: the
 * Dialer registers its own Twilio Device when the shell's isn't reachable (a
 * second phone — lesson_every_tab_is_another_phone), and Radio needs the
 * window-level engine.
 */
export function isWindowOnlyPath(pathname: string): boolean {
  const p = pathname.split('?')[0]
  return p === '/hub/dialer' || p.startsWith('/hub/dialer/') || p === '/hub/radio' || p.startsWith('/hub/radio/')
}
