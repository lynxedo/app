'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Shared UI primitives
// ──────────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id={slugify(title)} className="scroll-mt-32 bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-white font-semibold text-lg mb-4">{title}</h2>
      <div className="space-y-3 text-sm text-gray-300 leading-relaxed">{children}</div>
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold flex items-center justify-center mt-0.5">{n}</span>
      <p>{children}</p>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-400 text-xs">
      {children}
    </div>
  )
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 border-l-4 border-purple-500/60 bg-purple-500/5 rounded-r-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs uppercase tracking-wider font-bold text-purple-300">Admin only</span>
      </div>
      <div className="space-y-2 text-sm text-gray-300 leading-relaxed">{children}</div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab definitions
// ──────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'hub',          icon: '💬', label: 'Hub' },
  { id: 'feedback',     icon: '🚩', label: 'Report an Issue' },
  { id: 'routing',      icon: '⚡', label: 'Route Optimizer' },
  { id: 'lawn-sizer',   icon: '🌿', label: 'Lawn Sizer' },
  { id: 'zone-sizer',   icon: '💧', label: 'Zone Sizer' },
  { id: 'dialer',       icon: '☎️', label: 'Dialer' },
  { id: 'txt',          icon: '🗨️', label: 'Txt' },
  { id: 'contacts',     icon: '👤', label: 'Contacts' },
  { id: 'call-log',     icon: '📞', label: 'Call Log' },
  { id: 'marketing',    icon: '📣', label: 'Marketing' },
  { id: 'forms',        icon: '📝', label: 'Forms' },
  { id: 'products',     icon: '📦', label: 'Products' },
  { id: 'service-builder', icon: '🧮', label: 'Service Builder' },
  { id: 'service-mapping', icon: '🔗', label: 'Service Mapping' },
  { id: 'pricer',       icon: '🧾', label: 'Pricer' },
  { id: 'scoreboards',  icon: '🏆', label: 'Scoreboards' },
  { id: 'books',        icon: '📊', label: 'Books' },
  { id: 'timesheet',    icon: '🕐', label: 'Timesheet' },
  { id: 'settings',     icon: '⚙️', label: 'Settings' },
] as const

type TabId = typeof TABS[number]['id']

// ──────────────────────────────────────────────────────────────────────────
// Content → search index
//
// Each tab's body is authored once as JSX (the *Tab() functions below). The
// SAME JSX both renders the tab and feeds the search box: we walk the rendered
// element tree to pull every <Section>'s title + plain text. Because there's a
// single source, search can never drift out of sync with what's on the page —
// adding or editing a Section automatically updates what's searchable.
// ──────────────────────────────────────────────────────────────────────────

// Map of tab id → the function that produces that tab's JSX. Used ONLY for
// building the search index; the visible tab is still rendered as <XxxTab />.
const TAB_BODY: Record<TabId, () => ReactNode> = {
  'hub': HubTab,
  'feedback': FeedbackTab,
  'routing': RoutingTab,
  'lawn-sizer': LawnSizerTab,
  'zone-sizer': ZoneSizerTab,
  'dialer': DialerTab,
  'txt': TxtTab,
  'contacts': ContactsTab,
  'call-log': CallLogTab,
  'marketing': MarketingTab,
  'forms': FormsTab,
  'products': ProductsTab,
  'service-builder': ServiceBuilderTab,
  'service-mapping': ServiceMappingTab,
  'pricer': PricerTab,
  'scoreboards': ScoreboardsTab,
  'books': BooksTab,
  'timesheet': TimesheetTab,
  'settings': SettingsTab,
}

type IndexEntry = {
  tabId: TabId
  tabLabel: string
  tabIcon: string
  title: string
  slug: string
  text: string
  haystack: string
}

// Recursively pull all plain-text out of a React node tree.
function extractText(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return ''
}

// Walk a tab body and collect each <Section>'s title + flattened text.
function collectSections(node: ReactNode, out: { title: string; text: string }[]): void {
  if (Array.isArray(node)) { node.forEach(n => collectSections(n, out)); return }
  if (!isValidElement(node)) return
  if (node.type === Section) {
    const props = node.props as { title?: string; children?: ReactNode }
    if (props.title) {
      out.push({ title: props.title, text: extractText(props.children).replace(/\s+/g, ' ').trim() })
    }
    return // a Section never contains another Section, so stop here
  }
  const props = node.props as { children?: ReactNode }
  collectSections(props.children, out)
}

function buildIndex(): IndexEntry[] {
  const entries: IndexEntry[] = []
  for (const tab of TABS) {
    const sections: { title: string; text: string }[] = []
    collectSections(TAB_BODY[tab.id](), sections)
    for (const s of sections) {
      entries.push({
        tabId: tab.id,
        tabLabel: tab.label,
        tabIcon: tab.icon,
        title: s.title,
        slug: slugify(s.title),
        text: s.text,
        haystack: (s.title + ' ' + s.text).toLowerCase(),
      })
    }
  }
  return entries
}

function searchIndex(index: IndexEntry[], words: string[]): IndexEntry[] {
  if (words.length === 0) return []
  return index
    .filter(e => words.every(w => e.haystack.includes(w)))
    .sort((a, b) => {
      // Section-title matches rank above body-only matches.
      const at = words.every(w => a.title.toLowerCase().includes(w)) ? 0 : 1
      const bt = words.every(w => b.title.toLowerCase().includes(w)) ? 0 : 1
      return at - bt
    })
    .slice(0, 40)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A ~180-char snippet centered on the first matched word, with matches highlighted.
function Snippet({ text, words }: { text: string; words: string[] }) {
  const lower = text.toLowerCase()
  let pos = -1
  for (const w of words) {
    const i = lower.indexOf(w)
    if (i >= 0 && (pos < 0 || i < pos)) pos = i
  }
  const start = pos < 0 ? 0 : Math.max(0, pos - 50)
  let snippet = text.slice(start, start + 180)
  if (start > 0) snippet = '…' + snippet
  if (start + 180 < text.length) snippet = snippet + '…'
  const parts = snippet.split(new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'ig'))
  return (
    <p className="text-gray-400 text-xs mt-1 leading-relaxed">
      {parts.map((part, i) =>
        part && words.some(w => part.toLowerCase() === w)
          ? <mark key={i} className="bg-orange-500/30 text-orange-200 rounded px-0.5">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </p>
  )
}

function SearchResults({ results, words, onPick }: {
  results: IndexEntry[]
  words: string[]
  onPick: (tabId: TabId, slug: string) => void
}) {
  if (results.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-3xl mb-3">🔍</p>
        <p className="text-sm">
          No help topics matched. Try fewer or different words, or{' '}
          <a href="mailto:support@lynxedo.com?subject=Lynxedo%20Support%20Request" className="text-orange-400 hover:underline">contact support</a>.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-gray-500 text-xs uppercase tracking-wider">
        {results.length} result{results.length === 1 ? '' : 's'}
      </p>
      {results.map(r => (
        <button
          key={r.tabId + ':' + r.slug}
          onClick={() => onPick(r.tabId, r.slug)}
          className="block w-full text-left bg-gray-900 border border-gray-800 hover:border-orange-500/40 hover:bg-gray-900/60 rounded-xl p-4 transition-colors"
        >
          <span className="text-xs text-gray-500">{r.tabIcon} {r.tabLabel}</span>
          <p className="text-white font-medium text-sm mt-0.5">{r.title}</p>
          <Snippet text={r.text} words={words} />
        </button>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────

export default function HelpContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initial = (searchParams.get('tab') as TabId | null) || 'hub'
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some(t => t.id === initial) ? initial : 'hub'
  )
  const [query, setQuery] = useState('')
  const pendingScrollRef = useRef<string | null>(null)
  const [scrollNonce, setScrollNonce] = useState(0)

  const index = useMemo(() => buildIndex(), [])
  const queryWords = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  )
  const results = useMemo(() => searchIndex(index, queryWords), [index, queryWords])
  const searching = queryWords.length > 0

  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeTab === 'hub') url.searchParams.delete('tab')
    else url.searchParams.set('tab', activeTab)
    router.replace(url.pathname + url.search, { scroll: false })
  }, [activeTab, router])

  // Scroll the active tab into view when it changes (handles mobile horizontal scroll)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  useEffect(() => {
    const el = tabRefs.current[activeTab]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeTab])

  // After a search result is clicked, jump to (and briefly flash) its section
  // once the target tab has mounted. Keyed on a nonce so it re-fires even when
  // the picked section lives in the already-active tab.
  useEffect(() => {
    if (scrollNonce === 0) return
    const slug = pendingScrollRef.current
    if (!slug) return
    const el = document.getElementById(slug)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('help-flash')
      window.setTimeout(() => el.classList.remove('help-flash'), 1600)
    }
  }, [scrollNonce])

  function goToSection(tabId: TabId, slug: string) {
    pendingScrollRef.current = slug
    setQuery('')
    setActiveTab(tabId)
    setScrollNonce(n => n + 1)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <style>{`@keyframes helpflash{0%{background-color:rgba(249,115,22,.22)}100%{background-color:transparent}}.help-flash{animation:helpflash 1.6s ease-out}`}</style>
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/hub" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Hub
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Help</h1>
      </header>

      {/* Search + tab bar */}
      <div className="sticky top-[env(safe-area-inset-top)] md:top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="px-3 sm:px-4 pt-3">
          <div className="max-w-2xl mx-auto relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search help…"
              aria-label="Search help"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-9 py-2.5 text-base md:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white w-6 h-6 flex items-center justify-center"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="px-2 sm:px-4">
          <div className="flex gap-1 overflow-x-auto no-scrollbar py-2 lg:justify-center">
            {TABS.map(tab => {
              const isActive = !searching && activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={el => { tabRefs.current[tab.id] = el }}
                  onClick={() => { setQuery(''); setActiveTab(tab.id) }}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    isActive
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                      : 'text-gray-400 hover:text-white hover:bg-gray-900 border border-transparent'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-5">
        {searching ? (
          <SearchResults results={results} words={queryWords} onPick={goToSection} />
        ) : (
          <>
            {activeTab === 'hub'        && <HubTab />}
            {activeTab === 'routing'    && <RoutingTab />}
            {activeTab === 'lawn-sizer' && <LawnSizerTab />}
            {activeTab === 'zone-sizer' && <ZoneSizerTab />}
            {activeTab === 'dialer'     && <DialerTab />}
            {activeTab === 'txt'        && <TxtTab />}
            {activeTab === 'contacts'   && <ContactsTab />}
            {activeTab === 'call-log'   && <CallLogTab />}
            {activeTab === 'marketing'  && <MarketingTab />}
            {activeTab === 'forms'      && <FormsTab />}
            {activeTab === 'products'    && <ProductsTab />}
            {activeTab === 'service-builder' && <ServiceBuilderTab />}
            {activeTab === 'service-mapping' && <ServiceMappingTab />}
            {activeTab === 'pricer'      && <PricerTab />}
            {activeTab === 'scoreboards' && <ScoreboardsTab />}
            {activeTab === 'books'       && <BooksTab />}
            {activeTab === 'timesheet'  && <TimesheetTab />}
            {activeTab === 'settings'   && <SettingsTab />}

            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-gray-500 text-sm">Can&apos;t find what you&apos;re looking for?</p>
              <a
                href="mailto:support@lynxedo.com?subject=Lynxedo%20Support%20Request"
                className="inline-block bg-orange-600 hover:bg-orange-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
              >
                Contact Support
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// HUB
// ──────────────────────────────────────────────────────────────────────────

function FeedbackTab() {
  return (
    <>
      <Section title="What is Report an Issue?">
        <p><strong className="text-white">Report an Issue</strong> is the fastest way to send a bug or a feature idea straight to the people who build Lynxedo. Everyone on the team has it — find it in the app menu (the 🚩 <strong className="text-white">Report an Issue</strong> icon).</p>
        <p className="mt-2">Every report lands on the internal <strong className="text-white">Development board</strong> and pings Ben directly, so nothing gets lost in a group chat.</p>
      </Section>

      <Section title="Sending a report">
        <Step n={1}>Open <strong className="text-white">Report an Issue</strong> from the app menu (tap <em>Apps</em> on mobile if you don&apos;t see it).</Step>
        <Step n={2}>Choose <strong className="text-white">🐛 Bug Report</strong> (something is broken) or <strong className="text-white">✨ Feature Request</strong> (an idea or improvement).</Step>
        <Step n={3}>Write a short <strong className="text-white">Summary</strong> — one line describing the issue. This becomes the task title, so keep it clear (e.g. &quot;Dialer drops the call when I use hold&quot;).</Step>
        <Step n={4}>Pick an <strong className="text-white">Urgency</strong>: Low, Medium, High, or Urgent.</Step>
        <Step n={5}>Add <strong className="text-white">Details</strong> — the more the better. For a bug: what happened, what you expected, where in the app, and how to reproduce it.</Step>
        <Step n={6}>Optionally <strong className="text-white">add a screenshot or photo</strong> (see below).</Step>
        <Step n={7}>Tap <strong className="text-white">Send</strong>. You&apos;ll see a confirmation once it&apos;s in.</Step>
      </Section>

      <Section title="Adding a screenshot or photo">
        <p>Tap <strong className="text-white">Add a screenshot or photo</strong>. On a phone you can take a new photo or pick one from your library; on a computer it opens a file picker. You&apos;ll see a preview — tap the <strong className="text-white">×</strong> to remove it and choose a different one.</p>
        <Note>A picture of the problem (or a screenshot of an error) almost always makes a bug quicker to fix. The image is attached to the task and viewable from its <strong className="text-white">Files</strong> tab.</Note>
      </Section>

      <Section title="What happens after you send">
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li>A <strong className="text-white">task</strong> is created on the Development board with your summary as the title.</li>
          <li>All of your details are saved as a <strong className="text-white">note</strong> on that task, along with your name and the urgency.</li>
          <li>Ben gets a <strong className="text-white">Guardian DM</strong> in the Hub (and a push notification) so he sees it right away.</li>
          <li>If it needs a follow-up question, he&apos;ll reach out to you.</li>
        </ul>
        <Note>Tip: send <strong className="text-white">one issue per report</strong> so each can be tracked and fixed on its own.</Note>
      </Section>
    </>
  )
}

function HubTab() {
  return (
    <>
      <Section title="What Hub Is">
        <p>Hub is where the Heroes team communicates day-to-day — like Slack or Teams, but built into Lynxedo and connected to the rest of your tools. Everything in Hub stays inside the company.</p>
        <p>Hub has three main areas: <strong className="text-white">Rooms</strong> (group conversations), <strong className="text-white">DMs</strong> (one-on-one messages), and <strong className="text-white">Boards</strong> (shared task lists). Everything assigned to you across boards is gathered under <strong className="text-white">My Tasks</strong>.</p>
      </Section>

      <Section title="Home Screen">
        <p>The Home screen is what you see when you open Hub for the first time each day. It shows the date, your greeting, the active company announcements and shout outs, and your most-used rooms — so you can get oriented before diving into a conversation.</p>
        <p><strong className="text-white">My Time Clock card</strong> — if you have timesheet access and an employee record, a clock-in card appears near the top of Home. Tap <strong className="text-white">Clock In</strong> to start your shift (Lynxedo just records the time — no location prompt). Once you&apos;re clocked in the card shows the time you started and how long you&apos;ve been on the clock; tap <strong className="text-white">Clock Out</strong> when you finish. The card mirrors what the Timesheet page does, just one tap from the landing screen so you don&apos;t have to navigate every morning.</p>
        <p><strong className="text-white">Resume where you left off</strong> — when you close and reopen Hub within 14 hours, you&apos;ll land on the last room or DM you were viewing instead of always going back to the General room. Tap a push notification and you still jump straight to that message.</p>
        <p><strong className="text-white">Auto-return to Home after long gaps</strong> — if it&apos;s been more than 14 hours since you last opened Hub, the next time you open it you&apos;ll land on Home instead. The idea: after an overnight gap you probably want to see the announcements and clock in first, not jump straight into whatever room you closed yesterday.</p>
      </Section>

      <Section title="Navigation — rail + sidebars">
        <p>Hub is organized around a thin <strong className="text-white">icon rail</strong> on the left edge of the screen (or as a bottom tab bar on phones). Each icon opens its own sidebar with that section&apos;s contents.</p>
        <p className="font-medium text-white mt-3">Desktop rail — fixed icons</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">🔍 Search</strong> — opens the search palette (same as <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘K</kbd> / <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">Ctrl+K</kbd>). Jump to a room or person by name, or <strong className="text-white">type any keyword to search messages</strong> across every room and DM you&apos;re in — results show who said it, where, and when, with your keyword highlighted. Tap a result and it opens that conversation <strong className="text-white">scrolled right to that message</strong>, which flashes briefly so you can spot it (it even loads older history if the message is far back). If the match was a thread reply, the thread opens to it. The Apps drawer also has a <strong className="text-white">search bar at the top</strong> that filters the icons as you type.</li>
          <li><strong className="text-white">🕐 Clock</strong> — opens the Time Clock modal. A small green dot appears on the icon when you&apos;re punched in.</li>
          <li><strong className="text-white">💬 Hub</strong> — team conversations. Sidebar lists My Time Clock · Daily Log · Unread · Favorites · Rooms · DMs · My Tasks · Boards.</li>
          <li><strong className="text-white">📱 Txt</strong> — client SMS conversations (Captivated).</li>
          <li className="text-gray-300"><em>Then 4 user-configurable slots</em> (see &quot;My Hub&quot; below).</li>
          <li><strong className="text-white">⚙️ Settings</strong> — your profile, notifications, browser extension, and My Hub.</li>
          <li><strong className="text-white">🛡️ Admin</strong> — only visible if you have admin access.</li>
          <li><strong className="text-white">👤 You</strong> (at the bottom) — your avatar with status dot. Opens the profile sidebar where you set Available / Busy / DND, change text size, and sign out.</li>
        </ul>
        <p className="font-medium text-white mt-3">Activity bell</p>
        <p>A small bell icon floats in the top-right of the main content area, anywhere inside Hub. The red badge shows how many @mentions or thread replies are waiting for you. Tap it to slide in a panel with the list — last 30 days. The bell hides when the keyboard is open on mobile so it doesn&apos;t cover the composer.</p>
        <p className="font-medium text-white mt-3">Keyboard shortcuts</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘1</kbd> Time Clock · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘2</kbd> Hub · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘3</kbd> Txt · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘4</kbd> Activity · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘K</kbd> Search (use Ctrl on Windows).</li>
        </ul>
        <p className="font-medium text-white mt-3">Mobile bottom bar</p>
        <p>Five tabs always within thumb reach: <strong className="text-white">Clock · Hub · Txt · [your pick] · More</strong>. The fourth slot is configurable in Settings → My Hub. Tap <strong className="text-white">More</strong> to see your full app list plus Search, Activity, Settings, Admin if you have it, Help, and your profile. A floating <strong className="text-white">+</strong> button in the bottom-right opens the quick compose / search palette.</p>
        <Note>📱 The top bar is gone on phones — just tap the bottom tab for the section you want. When the keyboard pops up, the bottom bar and the floating <strong className="text-white">+</strong> button slide out of the way so you see the most messages possible.</Note>
        <p className="font-medium text-white mt-3">My Hub — pick your own rail icons</p>
        <p>In <strong className="text-white">Settings → My Hub</strong>, customize your own app list — add, remove, and reorder any page (Daily Log, Tracker, Routing, Fleet, Books, Lawn Sizer, Call Log, Time Records for admins, Files, Company News, and more), or add a custom URL of your own. Hub, Txt, Dialer, and Time Clock always lead the list; everything after that is yours. The desktop rail shows as many as fit; the mobile bar shows your first 5 — the rest live one tap away under More.</p>
        <p className="font-medium text-white mt-3">Hub sidebar contents</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">My Time Clock</strong> — backup access to the clock-in modal (same as the rail icon).</li>
          <li><strong className="text-white">Daily Log</strong> — jump to today&apos;s entry.</li>
          <li><strong className="text-white">Unread</strong> — rooms or DMs with new messages, surfaced at the top. Disappears when you&apos;re caught up.</li>
          <li><strong className="text-white">Favorites</strong> — your pinned rooms, DMs, and tools.</li>
          <li><strong className="text-white">Rooms</strong> — group conversations you belong to.</li>
          <li><strong className="text-white">Direct Messages</strong> — one-on-ones. The colored dot is the other person&apos;s status: <span className="inline-block w-2 h-2 rounded-full bg-green-400 align-middle"></span> Available, <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 align-middle"></span> Busy, <span className="inline-block w-2 h-2 rounded-full bg-red-500 align-middle"></span> DND, <span className="inline-block w-2 h-2 rounded-full bg-gray-500 align-middle"></span> Offline.</li>
          <li><strong className="text-white">My Tasks</strong> — every open task assigned to you, pulled from all your boards into one list.</li>
          <li><strong className="text-white">Boards</strong> — your shared task lists.</li>
        </ul>
        <p className="font-medium text-white mt-3">Landing page</p>
        <p>When you first sign in for the day — or after a long stretch (14+ hours) away from Hub — you land on the Home screen. It shows your Time Clock card up top, then announcements and shout outs, then a focused list of <strong className="text-white">your unread DMs / rooms</strong> followed by <strong className="text-white">recent @mentions</strong>. It&apos;s the &quot;what do I care about right now&quot; screen. There&apos;s no permanent way back to it from the rail — once you move on, the Activity bell and the Hub sidebar handle everything.</p>
        <Note>🖥️ Click any rail icon to navigate — the sidebar always opens. Click the icon of the section you&apos;re already in to toggle the sidebar closed/open. A small chevron also appears at the left edge while collapsed to bring it back.</Note>
        <Note>📱 On phone, a small <strong className="text-white">&lt;</strong> menu chevron sits in the top-left corner of <strong className="text-white">every</strong> screen — tap it to open the current page&apos;s sidebar. This is how you reach the sidebar for an app you opened from the <strong className="text-white">More</strong> drawer that isn&apos;t one of your bottom-bar tabs. When you tap the message box and the keyboard pops up, the room header hides to give the keyboard more room; the chevron stays put so you can still get back with one tap.</Note>
      </Section>

      <Section title="Rooms">
        <p>Rooms are group conversations — usually organized by team, topic, or job site (e.g. <em>#crew-chat</em>, <em>#field-ops</em>).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Join a room</strong> — sidebar &gt; <em>+ Browse rooms</em>, then click Join on any room you want to be in.</li>
          <li><strong className="text-white">Leave a room</strong> — open the room, click the room name at the top, then Leave.</li>
          <li><strong className="text-white">Star a room</strong> — click the star icon next to a room in the sidebar to pin it to the top.</li>
          <li><strong className="text-white">See who&apos;s in the room</strong> — tap the people icon in the top-right of the room header to open a list of everyone in it.</li>
        </ul>
        <AdminOnly>
          <p>Admins can create new rooms from the sidebar (<em>+ New room</em>), edit room names and descriptions, and add or remove members from <strong className="text-white">/admin/hub → Rooms</strong>. Rooms can be made <strong className="text-white">private</strong> (members-only, doesn&apos;t appear in Browse, and only members can see who else is in it).</p>
        </AdminOnly>
      </Section>

      <Section title="Direct Messages (DMs)">
        <p>DMs are private conversations between two people, or a small group.</p>
        <Step n={1}>Click <strong className="text-white">+ New DM</strong> in the sidebar.</Step>
        <Step n={2}>Pick one person for a one-on-one, or multiple people for a group DM.</Step>
        <Step n={3}>Type your message and send. The DM appears in their sidebar instantly.</Step>
        <p className="mt-3"><strong className="text-white">DM with yourself.</strong> You also have a private DM with just you, labeled with your own name. Use it as a scratchpad — jot notes, paste links, or forward messages you want to keep handy. Nobody else can see it.</p>
      </Section>

      <Section title="Managing your DMs">
        <p>Your DM list keeps itself tidy automatically — and you can also tuck specific conversations out of the way yourself.</p>
        <p className="font-medium text-white mt-3">Auto-archive after 60 days</p>
        <p>If you and another person haven&apos;t exchanged a message in 60 days, that DM quietly moves into your archived list. Nothing is deleted — every message and photo is still there. The conversation just stops cluttering your active list.</p>
        <p className="font-medium text-white mt-3">Archive a DM yourself</p>
        <p>Right-click (or long-press on mobile) any DM in the sidebar and pick <strong className="text-white">Archive conversation</strong>. It disappears from your active list immediately.</p>
        <Note>Archiving is per-person. If you archive your DM with Alice, only your sidebar changes — Alice still sees the DM in her active list.</Note>
        <p className="font-medium text-white mt-3">See archived DMs</p>
        <p>At the bottom of the Direct Messages section in the sidebar, you&apos;ll see <strong className="text-white">Show N archived</strong>. Click it to reveal a dimmed list of every archived DM. Each row has a small unarchive icon to bring it back to your active list.</p>
        <p className="font-medium text-white mt-3">Auto-unarchive when there&apos;s new activity</p>
        <p>If someone sends a message to an archived DM, or if you start a new DM with that person, it automatically jumps back to your active list. You never have to think about whether archiving was the right call — new activity always wins.</p>
      </Section>

      <Section title="Pop out a conversation">
        <Note><strong className="text-white">Beta feature.</strong> The pop-out button only appears once you turn it on in <strong className="text-white">Settings → Beta Features</strong> (you&apos;ll need the Beta Features grant from an admin first).</Note>
        <p>Every room/channel and DM has a <strong className="text-white">⧉ pop-out</strong> button in its header. Tap it to float that conversation in its own always-on-top window — the same way the <Link href="/hub/dialer" className="text-sky-400 hover:underline">Dialer</Link> pops out. Keep it in the corner of your screen while you work in another part of Hub, or in another app entirely, and reply without switching back and forth. Close it and the conversation returns to the normal in-page view.</p>
        <p>The pop-out is a <strong className="text-white">trimmed</strong> view — the running messages plus a box to type a reply. Threads/replies, reactions, file uploads, and message actions stay on the full in-page conversation.</p>
        <Note>The floating window works in <strong className="text-white">Chrome, Edge, Arc, and Brave</strong> (it uses their Picture-in-Picture support). On Safari and the mobile/native app the button doesn&apos;t appear — everything else works the same. Only one conversation floats at a time; popping out another moves the window to it. The window closes if you fully reload the page or leave Hub.</Note>
      </Section>

      <Section title="Your status (Available / Busy / DND / Offline)">
        <p>The colored dot next to each name tells everyone whether you&apos;re actually around. You can set <strong className="text-white">Busy</strong> or <strong className="text-white">Do Not Disturb</strong> manually; the rest is figured out automatically based on whether you&apos;re clocked in (techs) or active in Hub (office).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400 align-middle mr-1"></span> <strong className="text-white">Available</strong> — you&apos;re around. See below for how this is determined.</li>
          <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400 align-middle mr-1"></span> <strong className="text-white">Busy</strong> — around but minimizing interruptions. Manual only.</li>
          <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 align-middle mr-1"></span> <strong className="text-white">Do Not Disturb</strong> — silences push notifications on your phone. <em>@-mentions still come through</em>. Manual only.</li>
          <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-500 align-middle mr-1"></span> <strong className="text-white">Offline</strong> — you&apos;re not currently available. Automatic; clears as soon as you become active again.</li>
        </ul>
        <p className="font-medium text-white mt-3">How auto-presence works</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Field techs (hourly):</strong> your dot is green when you&apos;re clocked in and gray when you&apos;re clocked out. The dot flips the moment you punch in or out, no matter which device you use.</li>
          <li><strong className="text-white">Office (salary):</strong> your dot is green while you&apos;re active in Hub. After 2 hours with no Hub activity it drops to gray; it flips back to green the next time you open Hub.</li>
        </ul>
        <p className="mt-3">Setting Busy or DND yourself always wins — they show no matter what the automatic state would have been. Clear them when you&apos;re done and the dot goes back to the automatic color.</p>
        <p className="mt-3">Where you&apos;ll see the dot: replaces the 💬 next to each solo DM in your sidebar, and shows up next to the name at the top of the conversation when you&apos;re inside a DM. Both update live — when a teammate changes status or clocks in/out, every dot flips without a refresh.</p>
      </Section>

      <Section title="Sending Messages">
        <p>The composer is the box at the bottom of every conversation. Tools live in a thin toolbar <em>below</em> the input — not crammed inside it — so what you&apos;ve typed always reads cleanly.</p>
        <p className="font-medium text-white mt-3">Sending and writing</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Send</strong> — on desktop, press Enter. On phone or tablet, tap the blue send button (only shows up once you&apos;ve started typing).</li>
          <li><strong className="text-white">New line</strong> — Shift+Enter on desktop. On mobile, plain Enter inserts a new line — sending takes a deliberate tap of the send button so you can&apos;t fire off a half-typed message by accident.</li>
          <li><strong className="text-white">Expand the box</strong> — small chevron just above the input (flush right). Tap it to grow the composer to about half the screen for drafting longer messages; tap again to shrink. Sending also auto-shrinks it. Every room or DM you open starts at the default small size.</li>
          <li><strong className="text-white">Drafts</strong> — if you start typing and switch to another room or DM before sending, your text is automatically saved. Come back to that conversation and it&apos;ll be waiting exactly where you left off. Drafts clear the moment you send.</li>
        </ul>
        <p className="font-medium text-white mt-3">Toolbar buttons (left to right, below the input)</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">📎 Attach</strong> — pick a file, photo, or video. You can also paste images from your clipboard or drag-and-drop a file straight onto the composer. While a file is uploading (videos can take a few seconds) an <strong className="text-white">Uploading attachment…</strong> banner shows above the box and Send stays disabled until it finishes, so a large video can&apos;t be half-sent.</li>
          <li><strong className="text-white">Aa Format</strong> — wraps your selected text (or inserts markers for you to type between) in bold, italic, strike, code, or quote. See the Formatting section below for the full list of markers and keyboard shortcuts.</li>
          <li><strong className="text-white">😀 Emoji</strong> — opens a full emoji picker with search, categories, recents, and skin tones.</li>
          <li><strong className="text-white">@ Mention</strong> — inserts <code className="bg-gray-800 px-1 rounded text-orange-300">@</code> and opens the name picker. Mentioned people get a push notification even if their notifications are set to Mentions only. You can also just type <code className="bg-gray-800 px-1 rounded text-orange-300">@</code> directly. When two teammates share a first name, picking one inserts their <em>full</em> name so only that person is pinged — and names with accents or apostrophes (José, O&apos;Brien) match correctly.</li>
          <li><strong className="text-white">⏰ Schedule</strong> — pick a future date/time. The button turns blue, the Send button turns yellow, and a banner shows when it&apos;ll go out. Click the ✕ on the banner to switch back to send-now. The popover also has a <strong className="text-white">View scheduled messages</strong> link that opens a list of everything you have queued across all rooms and DMs — edit the body, reschedule the time, send right now, or delete.</li>
          <li><strong className="text-white">▶ Send</strong> — sends the message. Hidden until you&apos;ve started typing or attached something.</li>
        </ul>
        <p className="font-medium text-white mt-3">Typing emoji by name</p>
        <p>Type <code className="bg-gray-800 px-1 rounded text-orange-300">:</code> followed by a name and a list of matches pops up. <code className="bg-gray-800 px-1 rounded">:smile</code> → 😄, <code className="bg-gray-800 px-1 rounded">:fire</code> → 🔥, <code className="bg-gray-800 px-1 rounded">:thumbsup</code> → 👍. Arrow keys to navigate the list, Enter or Tab to insert.</p>
      </Section>

      <Section title="Viewing photos, videos, audio, and PDFs">
        <p>Attachments open inside Hub — no new browser tab.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Photos</strong> — tap the thumbnail to open the full image in a dark lightbox. On desktop, use the ← / → buttons (or arrow keys) to flip between photos in the same message; Esc closes. On phone, swipe left/right to flip, <strong className="text-white">pinch to zoom and drag to pan</strong>, and double-tap to zoom in/out. (Pinch works inside the iOS and Android apps too, not just the browser.)</li>
          <li><strong className="text-white">Videos</strong> — play right in the chat bubble with native controls (play, scrub, fullscreen, volume).</li>
          <li><strong className="text-white">Audio</strong> — voice memos and audio files (MP3, M4A, WAV, and more) play right in the chat bubble with a built-in player.</li>
          <li><strong className="text-white">PDFs</strong> — tap the 📄 card to open the document in the lightbox. <strong className="text-white">Pinch to zoom</strong> (iOS + Android apps included) or use the − / + buttons at the bottom; the ⬇ button in the top-right downloads the file.</li>
          <li><strong className="text-white">Other files</strong> — documents, spreadsheets, HTML files, and the like show as a card; tap to download and open.</li>
        </ul>
      </Section>

      <Section title="Scrolling back through history">
        <p>A room or DM opens at the newest messages. Just <strong className="text-white">scroll up</strong> and older messages load automatically as you go — no &quot;load more&quot; button. Your place stays put while the older messages slot in above, so you can keep scrolling back through the whole conversation.</p>
      </Section>

      <Section title="Loading, errors &amp; not-found">
        <p>A few things you&apos;ll see around the edges of Hub:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Loading</strong> — while a page is fetching, you see a centered spinner instead of a blank screen, so it&apos;s clear something is on its way.</li>
          <li><strong className="text-white">Something went wrong</strong> — if a page hits an error, you get a friendly screen with a short explanation and a <strong className="text-white">Try again</strong> button (which reloads just that section) rather than a broken page. Most of the time a retry clears it.</li>
          <li><strong className="text-white">Not found</strong> — open a link to a room, DM, or page that doesn&apos;t exist (or that you don&apos;t have access to) and you get a clear &quot;not found&quot; screen with a link back to Hub, instead of a dead end.</li>
        </ul>
      </Section>

      <Section title="Formatting Text">
        <p>Hub uses Slack-style markdown. The <strong className="text-white">Aa</strong> toolbar button opens a small popover with one-tap formatters — or type the markers directly. Either way, your message displays formatted when it sends.</p>
        <p className="font-medium text-white mt-3">Markers</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><code className="bg-gray-800 px-1 rounded text-orange-300">*bold*</code> → <strong className="text-white">bold</strong></li>
          <li><code className="bg-gray-800 px-1 rounded text-orange-300">_italic_</code> → <em>italic</em></li>
          <li><code className="bg-gray-800 px-1 rounded text-orange-300">~strike~</code> → <span className="line-through">strike</span></li>
          <li><code className="bg-gray-800 px-1 rounded text-orange-300">`code`</code> → <code className="bg-gray-700 text-gray-100 rounded px-1 font-mono text-sm">code</code> (inline)</li>
          <li><code className="bg-gray-800 px-1 rounded text-orange-300">&gt; quote</code> at the start of a line → renders as a quoted line with a left border</li>
          <li><strong className="text-white">Bullet list</strong> — the bullet button in the <strong className="text-white">Aa</strong> popover adds a <code className="bg-gray-800 px-1 rounded text-orange-300">•</code> to the line. Press <strong className="text-white">Enter</strong> to continue the list with a new bullet automatically; press Enter on an empty bullet to end the list (like Docs/Word).</li>
        </ul>
        <p className="font-medium text-white mt-3">Keyboard shortcuts (desktop)</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">⌘B</strong> / <strong className="text-white">Ctrl+B</strong> — bold</li>
          <li><strong className="text-white">⌘I</strong> / <strong className="text-white">Ctrl+I</strong> — italic</li>
          <li><strong className="text-white">⌘⇧X</strong> / <strong className="text-white">Ctrl+Shift+X</strong> — strikethrough</li>
        </ul>
        <p className="text-gray-400 mt-3">If you have text selected when you tap a formatter (or hit a shortcut), it wraps the selection. With no selection, the markers are inserted and your cursor lands between them so you can type.</p>
        <p className="text-gray-400 mt-1">Markdown also works in thread replies and in forwarded message previews.</p>
      </Section>

      <Section title="Read Receipts">
        <p>In DMs, a small grey label appears under your most recent message to show when the other person (or people) have seen it. Inspired by iMessage.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">1-on-1 DM</strong> — shows <em>Read</em> when the other person has opened the conversation since you sent.</li>
          <li><strong className="text-white">Group DM</strong> — shows <em>Read by Joe</em>, then <em>Read by Joe &amp; Sarah</em>, then <em>Read by Joe, Sarah &amp; 2 more</em>, and finally <em>Read by everyone</em> once the whole group has caught up.</li>
          <li>The label only sits under the most recent message <em>you</em> sent — if they read it, it stays put; if you send another, the label moves to the new one once that one is read too.</li>
          <li>Updates live — the moment someone opens the DM, you see the label appear without refreshing. Works reliably on all devices including native iOS and Android apps.</li>
          <li>Rooms (channels) intentionally <strong>do not</strong> show read receipts. Slack-style — channels would be overwhelming and weird to track per-person.</li>
          <li>Bots (like @Guardian) are never counted as readers.</li>
        </ul>
      </Section>

      <Section title="Typing Indicator">
        <p>When someone in a room or DM is typing, you&apos;ll see a small <em>&ldquo;Name is typing…&rdquo;</em> line with animated dots at the bottom of the conversation, just above the box where you type. If two people are typing it shows both names; more than that shows <em>&ldquo;Several people are typing…&rdquo;</em></p>
        <p className="text-gray-400 text-xs">It appears within a second of them typing and clears a few seconds after they stop. You never see your own typing.</p>
      </Section>

      <Section title="Message Actions (long-press / right-click)">
        <p>Long-press a message on mobile, or hover and right-click on desktop, to see the actions menu:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">React</strong> — tap one of the three quick reactions (✅ 👍 👀), or hit the <strong className="text-white">+</strong> button next to them to open the full emoji picker (search, categories, recents). On desktop, hover a message → the <strong className="text-white">+</strong> button shows the same three quick picks. Anyone in the conversation can see and click the reaction.</li>
          <li><strong className="text-white">Copy text</strong> — copies the message text to your clipboard.</li>
          <li><strong className="text-white">Copy link</strong> — copies a direct link to that exact message. Paste it anywhere (a chat, a note); whoever opens it lands in the room or DM scrolled right to the message, which flashes so it&apos;s easy to spot. Often quicker than forwarding when you just want to point someone at something. Links to messages only open for people who are already members of that room or DM.</li>
          <li><strong className="text-white">Forward</strong> — send the message into another room or DM. Any photos or files on the original message come along with it.</li>
          <li><strong className="text-white">Save to Files</strong> — for photos. Saves the image into Hub Files where it&apos;s tagged and searchable.</li>
          <li><strong className="text-white">Add to Board</strong> — saves the message to one of your boards.</li>
          <li><strong className="text-white">Reply in thread</strong> — opens a side thread so the side conversation doesn&apos;t clutter the main room.</li>
          <li><strong className="text-white">Edit</strong> — only on messages you sent. Edited messages show an <em>(edited)</em> tag.</li>
          <li><strong className="text-white">Delete</strong> — only on your own messages (or any message if you&apos;re admin).</li>
        </ul>
      </Section>

      <Section title="Threads">
        <p>Threads keep side conversations from cluttering the main room. Opening <em>Reply in thread</em> on any message slides out a panel where replies live.</p>
        <p>Anyone in the room can read and reply to a thread. When someone replies in a thread you started or participated in, you get a notification.</p>
        <p>Thread replies support the same toolbar as the main composer — <strong className="text-white">📎 attach</strong> photos and files, <strong className="text-white">Aa</strong> format (bold/italic/strike/quote), <strong className="text-white">😀</strong> insert emoji, and <strong className="text-white">⏰</strong> schedule the reply for later. Attachment-only replies (no text) work too.</p>
        <p><strong className="text-white">Reply actions</strong> — replies have the same actions as any message in the room. On desktop, hover a reply to reveal the action bar (react, forward, <strong className="text-white">copy link</strong>, save a photo to Files, add to a board, and edit or delete your own); on phone, long-press a reply for the same menu. A reply&apos;s copy-link opens the thread and flashes that reply for whoever follows it. Edit and delete follow the usual rule — your own messages, and admins can delete any.</p>
        <p><strong className="text-white">Reactions in threads</strong> — both the original message and every reply support the same emoji reactions as the main feed: the three quick picks (✅ 👍 👀) plus the full emoji picker (search, categories, recents). React on a thread message and everyone in the thread sees it update live, exactly like reacting in the room.</p>
        <p><strong className="text-white">Resize or expand the thread pane</strong> — on desktop, hover over the left edge of the thread panel to reveal a drag handle. Drag left to widen it (up to about half the screen), drag right to narrow it. Or click the <strong className="text-white">⤢ expand</strong> icon in the thread header to fill the whole pane in one click — click it again to snap back. Your preferred width is saved automatically.</p>
        <Note>📱 On phone, opening a thread takes the full screen for the most reading room — tap the <strong className="text-white">←</strong> back arrow at the top-left to return to the room. The original message scrolls up with the replies as you read.</Note>
      </Section>

      <Section title="Boards &amp; Tasks">
        <p>Boards are shared task lists. Each board holds tasks you can check off, assign, schedule, and discuss. Your boards — and the <strong className="text-white">My Tasks</strong> view — live in the Hub sidebar.</p>
        <Step n={1}>Click <strong className="text-white">+</strong> next to <strong className="text-white">Boards</strong> in the sidebar to make one. Choose who can see it: <strong className="text-white">Public</strong> (everyone on the team), <strong className="text-white">Private</strong> (just you and the people you add), or <strong className="text-white">Personal</strong> (only you).</Step>
        <Step n={2}>Type a task and press Enter. Click its row to set the options below.</Step>
        <Step n={3}>Check the circle to mark a task done. The <strong className="text-white">Open / All</strong> toggle shows or hides completed tasks.</Step>
        <p className="mt-3"><strong className="text-white">On each task you can set:</strong></p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Priority</strong> — None / Low / Medium / High.</li>
          <li><strong className="text-white">Due date &amp; time</strong> — pick a date and, optionally, a time of day (e.g. 8:00 AM). Overdue tasks turn red.</li>
          <li><strong className="text-white">Assignees</strong> — assign one <em>or several</em> people; tap names to add or remove them.</li>
          <li><strong className="text-white">Repeat</strong> — Daily, Weekly, Every 2 weeks, or Monthly. Completing a repeating task drops a &ldquo;✅ Completed…&rdquo; note on it and rolls it forward to the next date automatically (a weekly task due Jul 1 reappears due Jul 8).</li>
          <li><strong className="text-white">Notes &amp; Files</strong> — open a task to comment (tag a teammate with <strong className="text-white">@name</strong>) or attach a photo/document. The 💬 and 📎 chips on the card show the counts.</li>
        </ul>
        <p className="mt-3"><strong className="text-white">My Tasks</strong> — the <strong className="text-white">My Tasks</strong> link in the sidebar gathers <em>every open task assigned to you</em> — plus everything on a board that&apos;s yours alone (a Personal board, or a Private board only you belong to, where every task is implicitly yours) — into one list, grouped Overdue / Today / Upcoming. Check tasks off right there. Use the <strong className="text-white">Boards</strong> button to choose which boards feed your list — that&apos;s personal to you and doesn&apos;t affect anyone else&apos;s.</p>
        <p className="mt-3"><strong className="text-white">Overdue reminders</strong> — when a task with a due date passes its deadline, Guardian sends each assignee a one-time direct message so nothing slips.</p>
        <p className="mt-3"><strong className="text-white">Turn a message into a task</strong> — hover (or long-press on phone) any room, thread, or customer text message and choose <strong className="text-white">Add to Board</strong> to drop it onto a board.</p>
        <Note>You only ever see tasks on boards you have access to — a teammate&apos;s Personal or Private board never shows up in your My Tasks.</Note>
      </Section>

      <Section title="Hub Files">
        <p>Every photo or file shared in a room or DM also lives in Hub Files. Open the Files page from the sidebar to browse, filter, and download.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Filter by tag</strong> — tap any tag at the top of the Files page to narrow the view (e.g. <em>before-after</em>, <em>social-media</em>, <em>damage</em>).</li>
          <li><strong className="text-white">Tag an upload</strong> — when you upload directly to Files, you can pick one or more tags. You can also tag a file after the fact by clicking Edit on it.</li>
          <li><strong className="text-white">Save from a message</strong> — long-press any photo in a room → <em>Save to Files</em> → pick tags.</li>
        </ul>
        <AdminOnly>
          <p>Admins manage the tag list under <strong className="text-white">/admin/hub → Files Tags</strong>. Add, rename, or remove tags. Tags applied to existing files stay attached even if you rename the tag.</p>
        </AdminOnly>
      </Section>

      <Section title="Announcements & Shout Outs">
        <p>Two tickers appear at the top of Hub (in rooms and DMs):</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">📢 Announcements (blue)</strong> — company-wide updates the admin team wants everyone to see (policy changes, schedule notes, etc.).</li>
          <li><strong className="text-white">🎉 Shout Outs (gold)</strong> — recognition for great work, customer compliments, milestones.</li>
        </ul>
        <p>Hit <strong className="text-white">✕</strong> to dismiss a ticker from your view — it stays hidden on that device until a new announcement of the same type is posted. Click the ticker text to open the full <strong className="text-white">Company News</strong> page where everything is sorted by Active / Archived / Expired.</p>
        <Note>📢 <strong className="text-white">Read-first gate:</strong> any active <strong className="text-white">announcement</strong> you haven&apos;t acknowledged pops up on the Home screen — either the moment you <strong className="text-white">clock in</strong>, or (for salaried folks who don&apos;t clock in) the first time you try to <strong className="text-white">leave the Home screen</strong> — and you tap <strong className="text-white">✓ Got it</strong> to continue (it then sends you where you were headed). You only see each one once — it won&apos;t nag you again on later days unless a new announcement is posted. Shout outs never gate; this is announcements only.</Note>
        <AdminOnly>
          <p>Admins manage announcements from <strong className="text-white">/admin/hub → Announcements</strong>. Anyone with the <em>Can post Shout Outs</em> flag enabled can post shout outs from the same page. Posting a new active announcement automatically archives the previous one — only one of each type is live at a time.</p>
          <p><strong className="text-white">Edit</strong> — click Edit on the active announcement card to change the text (expiration is preserved). The ✎ pencil on the ticker itself also opens the same edit modal.</p>
          <p><strong className="text-white">Archive</strong> — click Archive on the active card to pull it immediately, before it expires.</p>
          <p><strong className="text-white">Delete</strong> — the <em>Past Announcements</em> list at the bottom of the Announcements tab shows all archived and expired posts. Click Delete on any row to permanently remove it.</p>
        </AdminOnly>
      </Section>

      <Section title="Automations">
        <p>Automations send a message automatically when something happens — on a schedule, when a vehicle moves, when work is logged, on a clock punch, or when a customer texts. Each rule is a simple <strong className="text-white">When → Notify → Message</strong>.</p>
        <AdminOnly>
          <p>Build them under <strong className="text-white">/admin/hub → Automation → Scheduled &amp; Event Automations</strong>. Pick a trigger, who to notify, and how to deliver it.</p>
          <p><strong className="text-white">Triggers (the &quot;when&quot;):</strong></p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li><strong className="text-white">At a scheduled time</strong> — e.g. weekdays at 5:30 PM. Optionally only for people <em>still clocked in</em> at that time.</li>
            <li><strong className="text-white">A vehicle arrives / leaves</strong> — when a truck enters or exits a <em>Place</em> (an address + radius you define), optionally only within a time window.</li>
            <li><strong className="text-white">A Daily Log stop is completed</strong> — fires when a tech marks a stop done.</li>
            <li><strong className="text-white">Someone clocks in / out</strong>.</li>
            <li><strong className="text-white">A text comes in</strong> — optionally only when the message contains a word (e.g. <em>cancel</em>).</li>
          </ul>
          <p><strong className="text-white">Notify (the &quot;who&quot;):</strong> each matching person, a specific person, a room, the vehicle&apos;s assigned driver, the person involved in the event, the rule creator, or a phone number.</p>
          <p><strong className="text-white">Deliver as:</strong> an <strong className="text-orange-300">@Guardian</strong> message (in-app + push), a <strong className="text-white">text message</strong> (sent from the company number, skips anyone marked do-not-text), or both. Texting a person uses the phone on their Lynxedo profile.</p>
          <p><strong className="text-white">Message placeholders</strong> fill in details: <code className="bg-gray-800 px-1 rounded">{'{tech_name}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{vehicle}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{geofence}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{customer}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{address}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{from}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{message}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{event}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{time}'}</code>, <code className="bg-gray-800 px-1 rounded">{'{date}'}</code>.</p>
          <p>Two extra panels on the same tab: <strong className="text-white">Places</strong> (manage geofence addresses + radius) and <strong className="text-white">Vehicle drivers</strong> (assign a driver to each truck — used by &quot;notify the assigned driver&quot;). Toggle any rule On/Off or Delete it from the list.</p>
          <p>The older <strong className="text-white">Keyword Rules</strong> (post when a word appears in a room) still live at the top of the same tab.</p>
        </AdminOnly>
      </Section>

      <Section title="@Guardian Bot">
        <p>Guardian is an AI helper that lives in Hub. @mention <strong className="text-orange-300">@Guardian</strong> in any room, or in your one-on-one Guardian chat, and ask it questions about Lynxedo or the business — it has context on your data and replies in-thread.</p>
        <p className="text-gray-400 text-xs">Guardian only takes part in chats it&apos;s actually a member of — a room where it&apos;s enabled, or your own one-on-one Guardian chat. It won&apos;t reply inside a regular direct message between two people, so @mentioning it there does nothing.</p>
        <p className="text-gray-400 text-xs">Examples: <em>&ldquo;@Guardian how many visits do we have tomorrow?&rdquo;</em> · <em>&ldquo;@Guardian who&apos;s clocked in right now?&rdquo;</em></p>
        <p><strong className="text-white">What Guardian can do depends on your tier:</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">Basic</strong> (default) — read-only Jobber/Captivated lookups (clients, jobs, visits, quotes, invoices) and questions about the company knowledge base. Most office staff and field techs are here.</li>
          <li><strong className="text-emerald-300">Manager</strong> — everything Basic does, plus scheduling visits, editing visit times, marking visits complete, and creating notes on clients/jobs.</li>
          <li><strong className="text-amber-300">Full</strong> — everything Manager does, plus live web search for current information. There&apos;s a daily company-wide cap (default 30 searches/day) so costs stay predictable.</li>
        </ul>
        <p><strong className="text-white">Tier resolution:</strong> if you&apos;re a super-admin you always get Full. Otherwise, if the room you&apos;re asking in has &ldquo;Full access&rdquo; turned on, you get Full there regardless of your personal tier. Otherwise you get your personal tier.</p>
        <AdminOnly>
          <p>Set tiers per-person under <strong className="text-white">Admin → AI → Hub Bot → People</strong>. Turn on per-room Full access under <strong className="text-white">Admin → AI → Hub Bot → Rooms</strong> — useful for an &ldquo;office&rdquo; or &ldquo;leadership&rdquo; room where anyone asking should get full capabilities. Every reply is recorded in <strong className="text-white">Admin → AI → Hub Bot → Audit</strong> (last 100 entries, click to expand the full question + answer + tools used + tokens). Only super-admins can change tiers; managers with Hub admin access can view them.</p>
          <p><strong className="text-white">Name &amp; avatar.</strong> Under <strong className="text-white">Admin → AI → Hub Bot → Settings</strong>, the <em>Bot identity</em> section lets an admin rename the bot and upload its avatar (JPG, PNG, WebP, or GIF, under 5 MB). The name shows as the sender in chat, DMs, and notifications; a bot with no uploaded avatar uses a neutral default icon.</p>
          <p>The shared knowledge lives in <strong className="text-white">Admin → AI → Knowledge</strong>. Each doc has a <em>Used by</em> setting — <strong className="text-white">Hub Bot</strong>, <strong className="text-white">Auto Responder</strong>, and/or <strong className="text-white">AI Receptionist</strong> — that controls which assistants automatically draw on it (leave all unchecked to keep a doc on-demand only). Company identity and the customer-service playbook are core docs, always available.</p>
        </AdminOnly>
      </Section>

      <Section title="Chat Synx (Slack bridge)">
        <p>Chat Synx mirrors messages between Hub rooms and Slack channels, both directions, in real time. Anyone on Slack stays in the loop without needing a Hub account, and vice versa.</p>
        <p><strong className="text-white">How it appears in Slack:</strong> a message you send in Hub shows up in the linked Slack channel wearing your name and profile picture — as far as anyone reading Slack is concerned, it looks like you typed it there. (Under the hood it&apos;s the <code className="text-green-400">@Chat Synx</code> bot posting on your behalf, but you&apos;d have to look closely to tell.)</p>
        <p><strong className="text-white">How it appears in Hub:</strong> a message someone sends in the linked Slack channel shows up in the Hub room attributed to their Hub account — same name, same avatar, same as any other Hub message.</p>
        <p><strong className="text-white">Threads</strong> cross over both directions. Reply in a Hub thread → it lands in the same Slack thread. Reply in a Slack thread → it lands in the same Hub thread.</p>
        <p><strong className="text-white">Attachments</strong> cross over both directions, up to 25 MB per file. Drop an image or file in Slack → it appears in the Hub room. Attach a file to a Hub message → it appears in the linked Slack channel. <em>Note:</em> Slack file uploads always show as the <code className="text-green-400">@Chat Synx</code> bot (not as you) — that&apos;s a Slack API limitation. The text portion of the message still wears your name and avatar, so the file ends up posted right under it.</p>
        <p><strong className="text-white">Edits and deletes</strong> cross over both directions. Edit a Hub message → the Slack mirror updates. Edit in Slack → Hub updates. Delete in Hub → Slack message is removed; delete in Slack → the Hub message is removed.</p>
        <p><strong className="text-white">Emoji reactions</strong> cross over both directions. React in Hub → the reaction appears in Slack (attributed to <code className="text-green-400">@Chat Synx</code> — Slack&apos;s reactions API doesn&apos;t support per-user identities). React in Slack → it appears in Hub attributed to your Hub account. Custom Slack emoji (workspace-specific ones) don&apos;t cross over.</p>
        <p><strong className="text-white">@mentions</strong> cross over both directions. Type <code className="text-green-400">@Joe</code> in Hub → Slack shows a real ping for Joe (and his phone buzzes). Type <code className="text-green-400">@Joe</code> in Slack → Hub shows a real mention and Joe gets a push notification. <code className="text-green-400">@room</code> in Hub maps to <code className="text-green-400">@channel</code> in Slack and vice versa. First-name matching depends on display names being unique within the company — if two people share a first name, add a last initial (e.g. <em>Ben S</em>) so the mention resolves to one person.</p>
        <p><strong className="text-white">Setup is in two parts, both in <code className="text-green-400">/admin/hub → Chat Synx</code>:</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">People</strong> — one row per teammate. Maps a Slack user ID to a Hub user. Without this mapping, that person&apos;s Slack messages won&apos;t reach Hub (and outbound messages will use their Hub name and avatar instead of their Slack name/avatar).</li>
          <li><strong className="text-white">Channels</strong> — one row per Hub room ↔ Slack channel pair. Each side can only be in one bridge at a time. <strong>You must invite <code className="text-green-400">@Chat Synx</code> to the Slack channel</strong> for events to reach us; type <code className="text-green-400">/invite @Chat Synx</code> in the channel.</li>
        </ul>
        <Note>
          <strong className="text-white">Not yet supported:</strong> DM bridges (Hub ↔ Slack person-to-person). Rooms only for now.
        </Note>
      </Section>

      <Section title="Clients (SMS)">
        <p>The <strong className="text-white">Clients</strong> tab in the sidebar shows SMS conversations with customers, powered by Captivated. Replying here sends a real text from the company number.</p>
        <p>Each conversation shows the client&apos;s name (matched to Jobber when possible), the conversation history, and unread badges.</p>
      </Section>

      <Section title="Daily Log">
        <p>Daily Log is a running log of operational notes for the day — who&apos;s on what crew, what went wrong, what got finished. Anyone can post.</p>
        <p>Posts are organized by date. Scrolling back through old days is how you reconstruct what happened the week of a callback.</p>
        <p><strong className="text-white">Update notifications — works like a DM or Room.</strong> When someone posts an update, the people who care about that entry get notified just like a chat message: a push notification on their phone/desktop, an orange unread dot on the Daily Log icon in the rail, and (on a desktop browser, if the sound toggle is on) the new-message chime. Tapping the push takes you straight to the Daily Log. Who gets notified: <strong className="text-white">the assigned tech (and any secondary techs) always</strong>, anyone an admin adds to the always-notify list, and anyone who tapped <strong className="text-white">Follow</strong> on the entry. The dot clears when you open Daily Log. Each person&apos;s mute / Do Not Disturb settings are respected, the same as for messages.</p>
        <p><strong className="text-white">Follow</strong> — tap Follow on any entry to add yourself to its update notifications even if you&apos;re not the tech and aren&apos;t on the always-notify list. Tap again to stop.</p>
        <p><strong className="text-white">Attaching files to updates:</strong> hit the 📎 paperclip button to the left of the text box to attach photos or files to any update. Multiple files per update are supported. Images and PDFs open in a built-in viewer right inside Hub — tap to open, zoom in and out, and Download — so they work on every device, including the iOS and Android apps; other file types show as a download card. Either the tech or the office can attach files, and attachment-only updates (no text required) are fine for when a photo says it all.</p>
        <p><strong className="text-white">Route sheet:</strong> the PDF (or generated route sheet) attached to the top of an entry opens in that same built-in viewer on any device — tap it to read, zoom, or download. If a PDF ever can&apos;t preview, the viewer shows a Download button so you can always open it.</p>
        <p><strong className="text-white">Two techs on one route:</strong> when creating an entry you can pick a primary tech plus one or more secondary techs (the second person riding the route). The entry shows up on every tech&apos;s <em>My Day</em> view, and either tech can post updates or mark it complete.</p>
        <p><strong className="text-white">Two checkboxes — one for the tech, one for the office:</strong></p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-emerald-300">Route Completed</strong> — the tech (primary or secondary) checks this when the route is done. The card turns green and a notification goes out from @Guardian to the users and rooms configured in <em>Admin → Daily Log</em>.</li>
          <li><strong className="text-sky-300">Closed</strong> — the office checks this once they&apos;ve reviewed the day&apos;s updates and handled anything that needed handling. The card dims so you can tell at a glance which entries are still waiting on office review. Only admins and anyone with the Daily Log admin grant can check this — and no DM fires (silent close).</li>
        </ul>
        <p>The two boxes are independent — you can close an entry before it&apos;s marked complete, or mark complete without closing. Unchecking either box reverses it.</p>
        <p>The Route Completed DM contains that day&apos;s office notes, route sheet name, and every update that was posted — so you can read the whole day at a glance instead of opening the log. If anything changes after the route is marked complete (a new update gets posted, notes get edited), the DM resends with the updated info.</p>
        <AdminOnly>
          <p>Under <strong className="text-white">/admin/daily-log</strong> there are two separate notification controls:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li><strong className="text-white">Notify on every update</strong> — these users always get a push (plus the unread dot + chime) for <em>every</em> new update, no Follow needed. The assigned tech is always notified automatically and doesn&apos;t need to be added here; use this list for office staff who should stay on top of all activity.</li>
            <li><strong className="text-white">On completion</strong> — when a route is marked complete, @Guardian sends the end-of-day summary to any combination of DM&apos;d users and rooms. Leave both empty to disable the completion notification.</li>
          </ul>
        </AdminOnly>
      </Section>

      <Section title="Daily Log v2 (preview)">
        <p>A new tech-facing view of the day&apos;s work, available at <Link href="/hub/daily-log-v2" className="text-sky-400 hover:underline">/hub/daily-log-v2</Link>. The original Daily Log keeps working unchanged — both run in parallel while v2 is iterating.</p>
        <p>What&apos;s different: instead of one text-based card with office instructions and tech updates, v2 shows the day&apos;s <strong className="text-white">stops as an ordered list</strong> with customer names, addresses, scheduled times, and line items. A map at the top of each entry shows the route with numbered pins.</p>
        <p><strong className="text-white">How stops get there:</strong> open the <Link href="/hub/routing" className="text-orange-400 hover:text-orange-300">Route Optimizer</Link>, build a route, then click the new <strong className="text-sky-300">Send to Daily Log</strong> button (blue, next to Send Day + Team and Send with Times). The stops queue up under the target tech&apos;s entry for that day. If an entry doesn&apos;t exist yet it&apos;s created; if one already exists with office instructions, those stay — only stops get added or replaced.</p>
        <p>You can run <em>Send to Daily Log</em> independently of the Jobber sends. Sending it doesn&apos;t change anything in Jobber. Re-running it after re-optimizing replaces the stops list with the new order.</p>

        <p className="mt-4"><strong className="text-white">🧪 Route Loadout header:</strong> when a route is sent from the Advanced Route Optimizer, a collapsible loadout panel appears near the top of the tech&apos;s day (under Office Instructions). It shows the route&apos;s <strong className="text-white">predicted on-site + drive time</strong>, <strong className="text-white">total square footage</strong>, <strong className="text-white">tank fill bars</strong> (with a red ⚠ refill flag if a route overflows a tank), and the <strong className="text-white">amount of each product to mix</strong> — grouped by line item, with which tank each goes in — so the crew can load the truck before they roll. It&apos;s a snapshot taken at send time; product amounts appear once line items are mapped to products in <Link href="/hub/admin/service-mapping" className="text-orange-400 hover:text-orange-300">Admin → Service Mapping</Link>.</p>

        <p className="mt-4"><strong className="text-white">📎 Route Sheet (downloadable PDF):</strong> sending a route from the optimizer attaches a real <strong className="text-white">PDF</strong> route sheet to the entry. It appears in a <strong className="text-white">Route Sheet</strong> section at the bottom of the day&apos;s card — tap it to open the full sheet (map, stop list, and per-stop line items) in the in-app viewer, then use the viewer&apos;s <strong className="text-white">Download</strong> button to save or print a copy. You can also <strong className="text-white">+ Upload PDF</strong> (or <strong className="text-white">Replace</strong>) to attach your own route-sheet PDF.</p>

        <p className="mt-4"><strong className="text-white">Tap a stop</strong> to expand it. The detail panel shows:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Customer phone</strong> — tap to call (opens your dialer / phone app)</li>
          <li><strong className="text-white">Line items</strong> — full list with quantities and prices, plus the total</li>
          <li><strong className="text-white">Visit instructions</strong> — the same instructions stored on the Jobber visit (gate codes, dog warnings, etc.)</li>
          <li><strong className="text-white">My notes</strong> — a per-stop notes field for what the tech actually did or saw. Saves automatically when you tap away.</li>
        </ul>

        <p className="mt-4"><strong className="text-white">Timing each stop:</strong> the expanded panel has two buttons.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-amber-300">▶ Arrived at property</strong> — tap when you pull up. Stamps an arrival timestamp and starts a live ticking timer in the panel. The stop&apos;s number badge turns amber.</li>
          <li><strong className="text-emerald-300">✓ Mark Complete</strong> — tap when you&apos;re done. Stamps a completion timestamp, stops the timer, and flips the number badge to green ✓. <strong className="text-white">Also marks the Jobber visit complete via the API.</strong></li>
        </ul>
        <p>Once complete, the panel shows the duration and both timestamps: <em className="text-gray-300">&ldquo;24 min · 2:15 PM – 2:39 PM&rdquo;</em>. The entry header&apos;s &ldquo;done&rdquo; count ticks up. The arrival timestamp is also the application-time used by pesticide records (below).</p>
        <p>You can skip the timer — tap <strong className="text-white">Mark Complete (skip timer)</strong> directly to mark done without capturing arrival time. Useful when you forgot to tap Arrived earlier.</p>
        <p>Tap <strong className="text-white">Reopen</strong> on a complete stop to undo — the Jobber visit also flips back. Reopen keeps the original arrival time so the timer picks up where it left off; tap <em>Reset arrival time</em> to clear it entirely.</p>
        <p>If the Jobber push fails (offline, expired token), the local complete still works — you&apos;ll see an amber warning in the detail panel telling you what went wrong. The stop stays marked complete; the office can manually mark the Jobber visit later if needed.</p>

        <p className="mt-4"><strong className="text-white">Approach buttons</strong> — at the top of the expanded panel, next to the customer phone.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-sky-300">🗺️ Navigate</strong> — opens Google Maps in turn-by-turn mode with the customer&apos;s address pre-filled. On phones it opens the Google Maps app; on desktop it opens in a new browser tab.</li>
          <li><strong className="text-amber-300">💬 On My Way</strong> — sends the customer a text message with your name and an estimated arrival time. Tap the button → pick how many minutes away you are (5/10/15/20/30/45 or type a custom number) → tap <em>Send</em>. The compact stop row gains a small <em>💬 Sent 2:13</em> badge so it&apos;s visible without expanding. You can re-send if needed (e.g. customer asks &ldquo;where are you?&rdquo; later).</li>
        </ul>
        <p>The SMS goes out through Heroes&apos; existing Captivated number (832-220-8100). Customers who are marked do-not-text or have no phone on file get a disabled button.</p>
        <AdminOnly>
          <p>Admins customize the text template under <strong className="text-white">/admin/daily-log</strong>. Available placeholders: <code className="text-amber-300">{'{first_name}'}</code> (customer first name), <code className="text-amber-300">{'{tech_name}'}</code> (tech first name from their Hub display name), <code className="text-amber-300">{'{eta}'}</code> (minutes selected at send time). Leave the template field blank to fall back to the system default.</p>
        </AdminOnly>

        <p className="mt-4"><strong className="text-white">Weather snapshot</strong> — when you tap <em>Mark Complete</em>, the app calls the National Weather Service ({/* eslint-disable-next-line @next/next/no-html-link-for-pages */}<a href="https://api.weather.gov" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">api.weather.gov</a>) for the current observed conditions at the stop&apos;s coordinates and stamps temperature, conditions, wind, and humidity onto the record. The data shows up in the expanded detail panel as <em className="text-gray-300">&ldquo;Weather at completion · 78°F · Partly Cloudy · Wind 8 mph · Humidity 64%&rdquo;</em>. NWS is free, no key, US-only — when it&apos;s slow or down the stop still marks complete fine, weather is just null. The snapshot is also attached to the pesticide application record (below) for TDA compliance.</p>

        <p className="mt-4"><strong className="text-white">Products Used log</strong> — for any stop with a line item that maps to a product (a pesticide like <em>&ldquo;Fire Ant Treatment&rdquo;</em> <strong>or</strong> a fertilizer like <em>&ldquo;Soil Revive&rdquo;</em>), Mark Complete also writes a <Link href="/hub/pesticide-records" className="text-sky-400 hover:underline">Products Used record</Link> capturing application time, location, customer, applicator, the products used, and weather. EPA registration # and active ingredient are recorded when the product has them (fertilizers simply have none). The EPA-registered subset is what you file for TDA compliance. Reopen and re-complete keeps the existing record (records are never deleted to clean up). What gets logged is the <strong className="text-white">Service Mapping</strong> line-item → product map admins maintain — see the <Link href="/hub/pesticide-records" className="text-sky-400 hover:underline">Products Used</Link> tab for the full list + CSV exports.</p>

        <p className="mt-4"><strong className="text-white">Two paths, one record.</strong> A record is created whether a visit is completed in <strong className="text-white">Daily Log v2</strong> <em>or</em> directly in Jobber — when a Jobber visit is marked complete, a webhook creates the same kind of record automatically. Both paths read the same Service Mapping and write to the same place, deduped per Jobber visit, so you never get two records for one visit. Daily Log v2 is the richer source (it captures the technician and the weather at the moment of arrival); the Jobber path fills in any visit completed outside the app (weather there is best-effort from the property address, and the applicator name may be blank).</p>

        <AdminOnly>
          <p className="mt-4"><strong className="text-white">What gets logged</strong> is driven by <strong className="text-white">Service Mapping</strong> (<strong>Admin → Service Mapping</strong>). Map a Jobber line item (case-insensitive contains or exact) to one or more <strong className="text-white">products</strong> — <strong className="text-white">map every product you want logged, including fertilizers</strong>, not just EPA pesticides. The details on the record — name, EPA registration # (if any), active ingredient, application rate, batch # — are pulled live from each mapped product in the Products catalog (no re-typing). When a visit completes, every line item is checked against every active mapping; matches roll into the record&apos;s products-used list (one entry per matched product). Set a product&apos;s mapping inactive to stop it logging new records — existing records stay intact. <em>(The old per-line-item pesticide mapping screen under Daily Log Admin is retired — mappings now live in Service Mapping, the single source the route-capacity tool also reads.)</em></p>
        </AdminOnly>
      </Section>

      <Section title="Products Used">
        <p>Available at <Link href="/hub/pesticide-records" className="text-sky-400 hover:underline">/hub/pesticide-records</Link>. An automatic log of <strong className="text-white">every product applied</strong> on a completed visit — fertilizers included, not just EPA pesticides — captured whether the visit was completed in Daily Log v2 or directly in Jobber. Filter by date range or search by customer / address / technician. Each row shows the customer, application time, applicator, the products used, and the weather snapshot at completion. EPA-registered products show a green 🧪 chip with the EPA #; non-EPA products (e.g. fertilizers) show a 🌿 chip. Tap a row for the full detail view.</p>
        <p><strong className="text-white">Show: All products / EPA-registered only</strong> — toggle the on-screen list between every product used and just the EPA-registered ones.</p>
        <p><strong className="text-white">Two CSV exports</strong> (top-right): <strong className="text-white">All products</strong> downloads everything used in the range; <strong className="text-white">TDA pesticide export</strong> filters to EPA-registered products only — the state pesticide-compliance format. Both expand to one row per product (so a visit with 2 matching products yields 2 rows). EPA #, active ingredients, and rate are filled in where the product has them.</p>
        <p>Records are created automatically — you don&apos;t add them by hand. They appear when a visit with matching line items is marked complete, either in Daily Log v2 or in Jobber. If the mapping configuration changes after a record is created, the existing record stays as it was at the time of application (the products-used list is a snapshot, not a live join).</p>
        <p>Records are preserved across stop reopen. If a tech reopens then re-completes a stop, the record is updated in place with the fresh timestamp + weather, not duplicated.</p>
      </Section>

      <Section title="Reports">
        <p>Available at <Link href="/hub/reports" className="text-sky-400 hover:underline">/hub/reports</Link> (admin only) — the index page lists every report. Today there are two: the Visit Report and the Customer Report.</p>
        <p className="text-white font-semibold mt-3">Visit Report</p>
        <p>Completed visits broken down by technician for any date range you pick.</p>
        <p><strong className="text-white">Date ranges</strong> — quick-select buttons at the top: This Week, Last Week, This Month, Last Month, YTD, or a Custom date range. The report re-runs instantly when you switch ranges.</p>
        <p><strong className="text-white">Summary cards</strong> — four at-a-glance numbers across all techs: total visits, total value, recurring visits, and one-off visits.</p>
        <p><strong className="text-white">Tech table</strong> — one row per technician, sorted by visit count. Each row shows visits, dollar value, and the recurring/one-off split. Tap any row to expand a department breakdown (IR, WF, PW, etc.) for that tech.</p>
        <p><strong className="text-white">Dollar value note</strong> — visits with per-visit line items (most IR jobs, one-off jobs) show full dollar attribution. Recurring flat-rate visits bill at the job/invoice level and show $0 visit value — the visit count is still accurate, only the dollar attribution differs.</p>
        <p className="text-white font-semibold mt-3">Customer Report</p>
        <p>Every customer and property pulled from Jobber, one row per property. A normal customer is a single row; an HOA or management account with several properties shows as several rows.</p>
        <p><strong className="text-white">Columns</strong> — tap the <em>Columns</em> button to choose exactly which columns to show. The catalog is grouped into Customer fields (name, email, phone, balance, status, lead source, sales person, cancellation reason…), Property fields (address, lawn size, irrigation zones, sprinkler, gate code, neighborhood, lat/long…), and Custom Fields — every custom field from Jobber is a checkbox you can turn on or off. Your selection is remembered on that device.</p>
        <p><strong className="text-white">Search &amp; filter</strong> — the search box matches name, address, email, or phone. The status buttons filter to Active, Lead, Cancelled, or Archived customers.</p>
        <p><strong className="text-white">Sort</strong> — click any column header to sort by it; click again to reverse.</p>
        <p><strong className="text-white">Export CSV</strong> — downloads exactly the columns you have showing, for the rows currently filtered in.</p>
      </Section>

      <Section title="Fleet Tracker">
        <p>Fleet shows all company vehicles on a live map (powered by OneStepGPS). Each vehicle appears as a colored pin with a heading arrow and a popup that gives speed, fuel %, and last ping time. Tap a vehicle in the sidebar list to fly the map to it.</p>
        <p>Pin colors:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-green-300">Green</strong> — driving</li>
          <li><strong className="text-amber-300">Amber</strong> — idle (engine running, parked at a stop)</li>
          <li><strong className="text-orange-300">Orange</strong> — being towed</li>
          <li><strong className="text-gray-300">Gray</strong> — off / offline</li>
        </ul>
        <p>A small red dot in the corner of a pin means at least one alert is active for that vehicle. The data refreshes every 30 seconds.</p>
        <p className="mt-4"><strong className="text-white">Day History</strong> — see the path a vehicle actually took on any day. In the <em>Day History</em> card in the sidebar, pick a vehicle and a date, then tap <strong className="text-white">Show path</strong>: a dotted blue line traces the day&apos;s route through every GPS ping (small arrows show the direction of travel), and <strong className="text-orange-300">larger orange dots</strong> mark anywhere the truck sat for <strong className="text-white">10+ minutes</strong>. Tap any dot for its exact time — stop dots also show how long the truck was there (arrival – departure). The map zooms to fit the whole day. Tap <em>✕ Back to live</em> to clear the path and return to live tracking.</p>
        <p>Four alert types can fire:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">🚨 Speeding</strong> — vehicle is driving over the configured speed limit</li>
          <li><strong className="text-white">🌙 After-hours</strong> — vehicle is driving outside configured work hours</li>
          <li><strong className="text-white">⛽ Low fuel</strong> — fuel is below the configured threshold</li>
          <li><strong className="text-white">📡 Offline</strong> — vehicle hasn&apos;t reported in past the configured timeout (suppressed outside work hours so parked-overnight trucks don&apos;t spam)</li>
        </ul>
        <Note>Alerts are evaluated server-side every 5 minutes. Each alert is delivered by @Guardian to whoever is configured in <em>Admin → Fleet → Notify</em> — any combination of DMs and room posts. You don&apos;t need to be looking at the map for alerts to fire.</Note>
        <AdminOnly>
          <p>Admins configure which alerts fire, the thresholds, and where alerts go (DM specific users, post in specific rooms, or both) under <strong className="text-white">/admin/fleet</strong>. Each user must have the <em>Fleet Tracker</em> permission enabled in Admin → People to see the map.</p>
        </AdminOnly>
      </Section>

      <Section title="Tracker (Lead Pipeline)">
        <p>Tracker is the lead pipeline — every inbound lead from any source ends up here as a row, grouped under the stage it&apos;s in. There&apos;s no separate &ldquo;Stage&rdquo; column anymore; a lead&apos;s stage <em>is</em> the group it sits under. Move a lead by dragging it (or via the bulk action bar / the edit drawer) into a different stage group.</p>
        <Note><strong className="text-white">Angi leads land here automatically.</strong> New leads from your Angi (Angi Leads/Ads) account are delivered straight into the Tracker under <em>Leads — Current</em>, tagged <strong className="text-white">Lead Source: Angi</strong>, with the customer&apos;s questionnaire answers, comments, and the Angi lead fee saved as the first note. They&apos;re also added to Contacts. No copy-paste from the Angi app — they appear on their own within seconds of Angi sending them.</Note>
        <Note><strong className="text-white">Add a text or call as a lead (Beta).</strong> Inside a <Link href="/hub/txt" className="text-sky-400 hover:underline">Txt</Link> conversation, or on any call in the <Link href="/hub/call-log" className="text-sky-400 hover:underline">Call Log</Link>, tap <strong className="text-white">+ Add to Lead Tracker</strong> to turn that person into a new lead. The name and number come over automatically, and the first note is pre-filled with a short summary of the conversation (for a call, from its AI summary) — edit it and save. Lead Source is left blank so you can set it yourself. Once added, the button reads <strong className="text-white">✓ In tracker</strong>; adding the same text or call again won&apos;t create a duplicate. This is a <strong className="text-white">Beta feature</strong> — switch it on under <strong className="text-white">Settings → Beta Features</strong> to see the button.</Note>
        <p className="mt-3"><strong className="text-white">Collapse a stage</strong> with the arrow on the <em>left</em> of each stage header, next to the select-all checkbox.</p>
        <p className="mt-3"><strong className="text-white">Resize or reorder columns.</strong> Drag a column header to reorder it. Drag the right edge of any header to resize. Column order is saved <em>per-user</em> and follows you across devices.</p>

        <p className="mt-4 font-medium text-white">Contact attempts</p>
        <p>Click the ▶ arrow at the start of any lead row to expand <strong className="text-white">5 contact-attempt rows</strong>. Each has an attempted date, a free-text note (drag the divider on the Notes header to make that column wider — it stays put), and Call / Text / Email checkboxes. The boxes you&apos;re <em>expected</em> to use for that attempt show an amber highlight (Attempt 1 → all three, 2 → Text, 3 → Email, 4 → Call, 5 → all three) — they start unchecked, so check each one off as you actually do it.</p>

        <AdminOnly>
          <p className="mt-4 font-medium text-white">Admin — Tracker → Settings</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li><strong className="text-white">Stages</strong> — add, rename (double-click the label), recolor (click the swatch), reorder (▲▼), or delete a stage. Deleting one asks which stage to move its leads into. These save instantly.</li>
            <li><strong className="text-white">Custom Columns</strong> — add your own columns and pick the type: text, number, date, dropdown, checkbox, or phone. Dropdowns get an inline options editor. New/deleted columns apply to everyone (each person still controls their own column order).</li>
            <li><strong className="text-white">Dropdown options &amp; colors</strong> — manage Status / Service / Lead Source / Salesperson / Base Program / Auxiliary lists, status colors, and auto-move rules.</li>
          </ul>
        </AdminOnly>

        <Note>If an inline edit can&apos;t save — say you briefly lost connection — the cell rolls back to its previous value and a red <strong className="text-white">&ldquo;Couldn&apos;t save that change&rdquo;</strong> toast pops up, so a failed edit is never silently swallowed. Just make the change again once you&apos;re back online.</Note>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// ROUTE OPTIMIZER
// ──────────────────────────────────────────────────────────────────────────

function RoutingTab() {
  return (
    <>
      <Section title="What It Does">
        <p>Route Optimizer pulls your scheduled visits and assessments from Jobber, reorders them for the shortest total drive time, calculates an ETA for each stop, and lets you push those times back to Jobber and print a route sheet.</p>
      </Section>

      <Section title="First-Time Setup">
        <Step n={1}>Connect your Jobber account under <Link href="/hub/admin/integrations" className="text-orange-400 hover:text-orange-300">Admin → Integrations</Link>. Open the Jobber card, click <strong className="text-white">Connect</strong>, and authorize.</Step>
        <Step n={2}>An admin needs to configure the depot, duration rules, and routing defaults at <strong className="text-white">Admin → Routing</strong> (see Admin section below). This only happens once for the whole company.</Step>
        <Step n={3}>Head to the <Link href="/hub/routing" className="text-orange-400 hover:text-orange-300">Route Optimizer</Link> and build your first route.</Step>
      </Section>

      <Section title="Building a Route">
        <Step n={1}><strong className="text-white">Pick team member(s)</strong> — click the Team Member(s) dropdown and check one or more techs. The list comes from the allowlist your admin set at <Link href="/admin/routing" className="text-orange-400 hover:text-orange-300">Admin → Routing → Team Members</Link>. Selecting multiple combines their visits into one route — useful for consolidating two routes onto one tech when someone&apos;s out.</Step>
        <Step n={2}><strong className="text-white">Pick a date</strong> — defaults to today.</Step>
        <Step n={3}><strong className="text-white">Set a start time</strong> — when the tech leaves the depot. Used to calculate ETAs.</Step>
        <Step n={4}><strong className="text-white">Load Stops</strong> — fetches all visits and assessments scheduled for the selected tech(s) on that date. When multiple techs are loaded, each stop shows a small purple chip with the originating tech&apos;s first name.</Step>
        <Step n={5}><strong className="text-white">Optimize</strong> — reorders the stops to minimize total drive time. The depot is always locked first and last.</Step>
        <p className="mt-2">After optimizing, each stop shows:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li>ETA and on-site duration</li>
          <li>Drive time from the previous stop</li>
          <li>Client name, address, and job details</li>
          <li>📋 badge = assessment/request stop</li>
          <li>Purple tech-name chip = originating tech (multi-tech routes only)</li>
          <li>🗺 badge = real road times used (vs straight-line estimate)</li>
          <li>Yellow banner = duration fell back to default (no matching line items)</li>
        </ul>
      </Section>

      <Section title="Pinning a First or Last Stop">
        <p>Before optimizing, click the small <strong className="text-white">1st</strong> or <strong className="text-white">Last</strong> button on a stop to lock it in place. The optimizer then finds the best order of the middle stops <em>flowing out of</em> your pinned first stop and <em>into</em> your pinned last stop — not just optimized around the depot. Useful when you want to start near a specific customer (early appointment) or end near home/depot/lunch.</p>
        <p className="mt-2 text-xs text-gray-500">Pin both for a fully constrained route, or just one if only one anchor matters.</p>
      </Section>

      <Section title="Reordering Stops Manually">
        <p>After loading or optimizing, drag stops up or down to adjust the order manually. Click <strong className="text-white">Recalculate</strong> to update all ETAs and drive times for the new sequence. The depot stays locked first and last.</p>
      </Section>

      <Section title="The Preview Map">
        <p>The Route Preview map is fully interactive — pinch/scroll to zoom, drag to pan, and click the full-screen button (top-right) for a bigger view. Pins are numbered in route order; the depot shows as a green <strong className="text-white">D</strong>.</p>
        <p className="mt-2">After optimizing, the blue line follows <strong className="text-white">actual driving roads</strong> via Mapbox Directions — not straight lines. When you drag a stop to reorder, the line updates automatically after a brief pause. If the road path can&apos;t be fetched, a yellow note appears in the corner and the map falls back to straight lines.</p>
      </Section>

      <Section title="Sending the Route">
        <p>After optimizing you have <strong className="text-white">three independent send buttons</strong>. Two push to Jobber (pick one), the third populates Daily Log v2. You can use any combination — they don&apos;t conflict.</p>

        <div className="border border-gray-700 rounded-xl p-4 mt-3">
          <p className="text-white font-medium mb-2">Send Day + Team (gray button) — was &ldquo;Send Order Only&rdquo;</p>
          <p>Pushes each visit&apos;s <strong className="text-white">day and assigned tech</strong> back to Jobber and leaves the stops as &ldquo;anytime&rdquo; (no appointment times). The crew follows the optimized <strong className="text-white">order</strong> in the Daily Log / printed route sheet — not in Jobber.</p>
          <p className="mt-2 text-xs text-gray-500">Why not the order? Jobber&apos;s API can&apos;t reorder anytime visits, and Jobber now blocks the old behind-the-scenes workaround. So Lynxedo writes only what changes during planning (the day + who&apos;s assigned) and keeps the sequence in the route sheet. In <strong>Basic</strong> mode this button is <strong className="text-white">Send Team to Jobber</strong> and just reassigns the route to the tech you pick in &ldquo;Reassign to&rdquo;.</p>
        </div>

        <div className="border border-gray-700 rounded-xl p-4 mt-3">
          <p className="text-white font-medium mb-2">Send with Times (orange button)</p>
          <p>Writes the calculated ETA as the scheduled appointment time for each visit (and each assessment). This converts anytime visits to scheduled visits in Jobber — so the Jobber day view shows them <strong className="text-white">in the optimized order</strong>.</p>
          <p className="mt-2 text-xs text-gray-500">This is the way to get the optimized order into Jobber itself. The times are sequence markers, not promises — if you don&apos;t want customers to see a specific time, edit the Jobber visit-reminder template to show only the date.</p>
        </div>

        <div className="border border-gray-700 rounded-xl p-4 mt-3">
          <p className="text-white font-medium mb-2">Send to Daily Log (blue button)</p>
          <p>Populates the new <Link href="/hub/daily-log-v2" className="text-sky-400 hover:underline">Daily Log v2</Link> with the optimized stops, attached to the target tech&apos;s entry for that day. <strong className="text-white">Doesn&apos;t touch Jobber.</strong> If an entry doesn&apos;t exist yet it&apos;s created; existing office instructions and tech updates are preserved — only the stops list is added or replaced.</p>
          <p className="mt-2 text-xs text-gray-500">Use this any time you want techs to see the route in the tech-facing Daily Log view, with or without sending to Jobber.</p>
        </div>

        <p className="mt-3"><strong className="text-white">Reassign to</strong> (above the buttons) picks which tech the visits should end up under. Applies to all three send modes — Jobber assignment AND the Daily Log entry. <strong className="text-amber-300">Required when multiple techs were loaded</strong> — Daily Log entries are per-tech, so consolidating to one tech is mandatory.</p>

        <Note>⚠️ Send with Times overwrites any existing appointment times on those visits. Send Day + Team only updates the day and assigned tech (stops stay anytime, order lives in the route sheet). Send to Daily Log replaces the prior stops list (if any) but never touches Jobber.</Note>
      </Section>

      <Section title="Advanced mode (lasso + holding area)">
        <p>Flip the <strong className="text-white">Advanced</strong> toggle for a bigger interactive map and multi-day planning. Pull visits across a <strong className="text-white">date range</strong> and for <strong className="text-white">several techs at once</strong>, then <strong className="text-white">lasso</strong> stops on the map (or check rows) to build a selection. Switch the lasso between <strong className="text-white">Select</strong> and <strong className="text-white">Deselect</strong>, and use Clear to start over.</p>
        <p><strong className="text-white">Optimize</strong> the selection to see the route, drive time, and ETAs. You can optimize as few as <strong className="text-white">one stop</strong> — handy when you just want to see drive time and the path from the depot for a single stop before parking it.</p>
        <p><strong className="text-white">Lock first / last</strong> and <strong className="text-white">drag to reorder</strong>: on the optimized list, the <strong className="text-white">📌 1st</strong> / <strong className="text-white">📌 Last</strong> buttons pin a stop and re-optimize the rest around it, and you can drag stops with the <span className="text-gray-400">⠿</span> handle to set the order by hand — then hit <strong className="text-white">↻ Recalculate times</strong> to refresh the ETAs (same as Basic mode).</p>
        <p><strong className="text-white">Couldn&apos;t-map panel:</strong> if a visit&apos;s address can&apos;t be located, it shows in a red <strong className="text-white">&ldquo;couldn&apos;t be mapped&rdquo;</strong> panel (and is flagged with a ⚠ in the day list) instead of silently disappearing. Fix the address on the visit in Jobber and reload visits — it&apos;ll then map and route normally.</p>
        <p><strong className="text-white">Holding area:</strong> park an optimized selection for a specific day + tech with <strong className="text-white">Send to Holding</strong>. Those stops leave the map/list so you can keep building other days. From the holding area you can view the route sheet or send each batch to Jobber / Daily Log. <strong className="text-white">A batch automatically clears from holding once you send it to Jobber</strong> (Send Day + Team / Send with Times) — no need to delete it afterward. Daily Log sends keep the batch so you can still send it to Jobber too; use <strong className="text-white">Delete</strong> to remove a batch manually (its stops return to the map).</p>
      </Section>

      <Section title="Tank loadout (Advanced)">
        <p>Once you optimize a selection, a <strong className="text-white">🧪 Tank loadout</strong> panel appears under the stop list. It reads each stop&apos;s lawn size (from the &ldquo;K&rdquo; in the job title, e.g. <em>RC1 25K</em> = 25,000 sq ft) and the products mapped to those line items, and shows you, before the day runs:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">How much of each product to mix, grouped by line item</strong> — the products are listed <strong className="text-white">under each line item</strong> (e.g. Root Rot Recovery, Lawn Health Complete), totalled across every stop that has that line item. If the same product is applied for two line items, it appears once under each — so you can load and split it correctly.</li>
          <li><strong className="text-white">Tank fill bars</strong> — how full each tank gets (route sq ft ÷ what a full tank can spray). A bar turns <span className="text-red-400">red</span> with a <strong className="text-white">⚠ needs a refill</strong> note when the route is bigger than the tank can cover in one fill.</li>
          <li><strong className="text-white">Which tank each line item goes in</strong> — pick the tank once <em>per line item</em> from the dropdown in its header, and every product under it loads into that tank (each product row shows the tank it lands in). Because a different line item has its own dropdown, the <em>same</em> product can go in Tank 1 for one line item and Tank 2 for another (e.g. &ldquo;today Root Rot goes in Tank 1, Lawn Health Complete in Tank 2&rdquo;). Your choices are remembered for that route and day; they don&apos;t change anyone else&apos;s run.</li>
        </ul>
        <p>If the panel says <strong className="text-white">&ldquo;No product mappings yet&rdquo;</strong>, an admin needs to map your Jobber line items to products in <Link href="/hub/admin/service-mapping" className="text-orange-400 hover:text-orange-300">Admin → Service Mapping</Link> first. Stops whose job title has no size, or line items with no product mapping, are called out so nothing is silently missed.</p>
      </Section>

      <Section title="Printing the Route Sheet">
        <p>Click <strong className="text-white">Print Route Sheet</strong> to open a printable version (a new tab in a browser; opens in place inside the iPhone/Android app):</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Page 1 (landscape)</strong> — a map with numbered stops and road geometry</li>
          <li><strong className="text-white">Following pages (portrait)</strong> — one card per stop with client name, address, phone, job details, and special instructions</li>
        </ul>
        <p>Use the browser&apos;s Print dialog (Cmd+P / Ctrl+P). Set margins to None or Minimum for best results.</p>
      </Section>

      <Section title="Admin — Routing Settings">
        <AdminOnly>
          <p>Routing settings are <strong className="text-white">company-wide</strong> — one admin configures them once and everyone uses the same depot, team-member list, duration rules, and defaults. Open them at <Link href="/admin/routing" className="text-orange-400 hover:text-orange-300">Admin → Routing</Link>.</p>

          <div className="border border-gray-700 rounded-xl p-4 mt-3">
            <p className="text-white font-medium mb-2">Team Members</p>
            <p>Choose which Jobber users show up in the Quick Route tech dropdown. Click <strong className="text-white">↻ Refresh from Jobber</strong> to pull the current user list, then check the names you want visible. Use <em>Select all</em> / <em>Clear all</em> as shortcuts.</p>
            <p className="mt-2 text-xs text-gray-500">Leave everyone unchecked to show all active Jobber users (default). Re-refresh whenever you hire new techs or want to hide someone who&apos;s left.</p>
          </div>

          <div className="border border-gray-700 rounded-xl p-4 mt-3">
            <p className="text-white font-medium mb-2">Depot</p>
            <p>The starting and ending point for every route — your shop, warehouse, or home base. Enter the full street address and click Save. Lynxedo geocodes it and shows a green ✓ when it&apos;s valid.</p>
          </div>

          <div className="border border-gray-700 rounded-xl p-4 mt-3">
            <p className="text-white font-medium mb-2">Tanks</p>
            <p>Set up the spray tanks the crew mixes into — up to <strong className="text-white">4</strong>. For each tank give it a label, its <strong className="text-white">gallon capacity</strong>, and the <strong className="text-white">mix rate</strong> (gallons applied per 1,000 sq ft — Heroes runs 2). The panel shows live how much area a full tank covers (e.g. 180 gal ÷ 2 = ~90,000 sq ft). The Advanced Route Optimizer&apos;s Tank loadout uses these numbers to show how full each tank gets per route. Changes save as you type; untick <strong className="text-white">Active</strong> to retire a tank without deleting it.</p>
          </div>

          <div className="border border-gray-700 rounded-xl p-4">
            <p className="text-white font-medium mb-2">Routing Defaults</p>
            <p><strong className="text-white">Default service time per stop</strong> — fallback when the Formula method can&apos;t calculate. Also used when method is set to Default Time.</p>
            <p><strong className="text-white">Avg drive speed (mph)</strong> — rough drive estimate when Mapbox road data isn&apos;t available. Real road times from Mapbox are used whenever possible.</p>
          </div>

          <div className="border border-gray-700 rounded-xl p-4">
            <p className="text-white font-medium mb-2">On-Site Duration — Default Time</p>
            <p>Every stop gets the same fixed minutes. Good for crews that run similar services all day.</p>
          </div>

          <div className="border border-gray-700 rounded-xl p-4">
            <p className="text-white font-medium mb-2">On-Site Duration — Formula (Line Items)</p>
            <p>Calculates a different duration for each stop based on what services are on that visit. More accurate when one crew does both quick and long jobs.</p>
            <p className="mt-2 text-white font-medium text-xs uppercase tracking-wide">Setup:</p>
            <div className="space-y-2 mt-2">
              <Step n={1}>Click <strong className="text-white">↻ Refresh from Jobber</strong> to pull your full list of line items.</Step>
              <Step n={2}>For each line item that affects duration, enter the minutes it adds.</Step>
              <Step n={3}>All matching line items on a visit are summed together.</Step>
              <Step n={4}>Optionally check <strong className="text-white">Add lawn size (K = minutes)</strong> — &ldquo;6K&rdquo; in the job title adds 6 minutes.</Step>
              <Step n={5}>Set <strong className="text-white">Padding</strong> (extra minutes per stop) and <strong className="text-white">Minimum</strong> (floor).</Step>
              <Step n={6}>Set <strong className="text-white">Assessments</strong> — fixed duration for 📋 stops.</Step>
            </div>
            <Note>If a stop can&apos;t be calculated (no matching line items), it falls back to <em>Default service time</em>. A yellow banner shows on that stop.</Note>
          </div>

          <div className="border border-gray-700 rounded-xl p-4">
            <p className="text-white font-medium mb-2">Routing Profile Name</p>
            <p>Shown on the printed route sheet header. Set this to your company name or a crew name.</p>
          </div>
        </AdminOnly>
      </Section>

      <Section title="Tips & Troubleshooting">
        <div className="space-y-4">
          <div>
            <p className="text-white font-medium mb-1">Stops aren&apos;t loading</p>
            <p>Check that Jobber is connected (Admin → Integrations shows Connected). If it is, try disconnecting and reconnecting — the OAuth token may have expired.</p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">Drive times look like estimates, not real road times</p>
            <p>The 🗺 badge means real Mapbox road times were used. If it&apos;s missing, the route has more than 25 stops — Mapbox&apos;s Matrix API caps at 25 locations (depot + 24 stops). Above that, straight-line distances are used as a fallback.</p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">Duration formula isn&apos;t calculating a stop</p>
            <p>A yellow warning banner appears on stops that fell back to the default time. Usually the stop&apos;s line items don&apos;t match any entries in the Formula rules. Have an admin open <strong className="text-white">Admin → Routing</strong> and check line item names for exact matches (spelling and capitalization matter).</p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">Assessment shows wrong address or is missing</p>
            <p>Assessments use a different address field than regular visits. If an address is missing, it may not be set on the request in Jobber.</p>
          </div>
        </div>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// LAWN SIZER
// ──────────────────────────────────────────────────────────────────────────

function LawnSizerTab() {
  return (
    <>
      <Section title="What It Does">
        <p>Lawn Sizer estimates the mowable square footage of a property using satellite imagery and county parcel data. Use it to size new leads before quoting.</p>
      </Section>

      <Section title="How to Use It">
        <Step n={1}><strong className="text-white">Enter the property address</strong> and click <strong className="text-white">Calculate</strong>. Lynxedo geocodes the address and pulls parcel data from the county.</Step>
        <Step n={2}><strong className="text-white">Quick result</strong> appears first — a single AI analysis of the satellite image. If confidence is HIGH ✅, you&apos;re done.</Step>
        <Step n={3}>If confidence is MEDIUM ⚠️ or FLAG 🚩, the tool automatically runs <strong className="text-white">Advanced mode</strong> — three separate AI analyses averaged together for a more reliable estimate.</Step>
        <Note>Lawn Sizer covers Montgomery County (MCAD) and Harris County (HCAD) properties. Addresses outside those counties may still work but parcel data may be limited.</Note>
      </Section>

      <Section title="Reading the Results">
        <p>The result card breaks the lot down into:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Lot sqft</strong> — total parcel size from county records</li>
          <li><strong className="text-white">Building sqft</strong> — structure footprint (excluded from lawn)</li>
          <li><strong className="text-white">Driveway / hardscape sqft</strong> — estimated paved area (excluded)</li>
          <li><strong className="text-white">Tree canopy sqft</strong> — areas with significant tree cover (excluded)</li>
          <li><strong className="text-white">Visible lawn sqft</strong> — the mowable estimate used for quoting</li>
        </ul>
        <p className="mt-2">Confidence tiers:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">HIGH ✅</strong> — all three AI runs closely agreed. Use the number.</li>
          <li><strong className="text-white">MEDIUM ⚠️</strong> — moderate variance. Use with a sanity check.</li>
          <li><strong className="text-white">FLAG 🚩</strong> — high variance or unusual property. Treat as a rough estimate only.</li>
        </ul>
        <Note>Pool presence is detected. If a pool is found, it&apos;s noted in the result — pools affect hardscape area and shift the lawn estimate.</Note>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// ZONE SIZER
// ──────────────────────────────────────────────────────────────────────────

function ZoneSizerTab() {
  return (
    <>
      <Section title="What It Does">
        <p>Zone Sizer estimates how many irrigation zones a residential property needs. It uses the same satellite imagery and Claude Vision analysis as Lawn Sizer, plus auto-detection of landscape beds, and converts those areas into zone counts using your company&apos;s configured square-feet-per-zone rates.</p>
        <Note>Zone Sizer always runs in <strong className="text-white">Advanced mode</strong> (3 AI analyses averaged). Each estimate takes 15–30 seconds — accuracy matters more than speed for irrigation quoting.</Note>
      </Section>

      <Section title="How to Use It">
        <Step n={1}><strong className="text-white">Enter the property address</strong> and tap <strong className="text-white">Estimate zones</strong>.</Step>
        <Step n={2}>Wait 15–30 seconds while Lynxedo pulls the satellite imagery, identifies turf and landscape beds, and computes zone counts.</Step>
        <Step n={3}>Review the result panel: turf square footage and lawn zones, beds square footage and bed zones, plus a confidence badge.</Step>
        <Step n={4}>If the auto-detected bed area looks wrong, tap the bed number and edit it. The bed zone count recalculates as you type. Tap <strong className="text-white">reset</strong> to go back to the auto value.</Step>
      </Section>

      <Section title="Reading the Results">
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Turf sq ft</strong> — the area a mowing crew would service, after subtracting hardscape and heavy canopy</li>
          <li><strong className="text-white">Lawn zones</strong> — turf sq ft divided by the configured turf-per-zone rate (default 1,000), rounded up</li>
          <li><strong className="text-white">Beds sq ft</strong> — landscape bed area (mulched/planted) detected from above</li>
          <li><strong className="text-white">Bed zones</strong> — bed sq ft divided by the configured bed-per-zone rate (default 1,000), rounded up</li>
          <li><strong className="text-white">Total zones</strong> — lawn zones + bed zones, highlighted in the blue summary band</li>
          <li><strong className="text-white">Confidence</strong> — HIGH ✅, MEDIUM ⚠️, or FLAG 🚩, same scale as Lawn Sizer</li>
        </ul>
        <Note>Obstacles like driveways and sidewalks are already excluded by Claude Vision when it identifies turf and beds — the numbers you see are net.</Note>
      </Section>

      <Section title="Admin — per-zone rates &amp; access">
        <AdminOnly>
          <p>Admins configure the per-zone square footage under <strong className="text-white">/admin/zone-sizer</strong>. Defaults are 1,000 sq ft per zone for both turf and beds. Raise the bed rate if you use drip or microspray that covers more area per zone.</p>
          <p>Each user must have the <em>Zone Sizer</em> permission enabled in Admin → People to use the tool.</p>
        </AdminOnly>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// TXT2
// ──────────────────────────────────────────────────────────────────────────

function TxtTab() {
  return (
    <>
      <Section title="What It Does">
        <p><strong className="text-white">Txt</strong> is the customer texting inbox, powered by Heroes&apos; own phone number through Twilio. Send and receive SMS/MMS with customers, hand conversations off between teammates, send templates, schedule messages, and run text broadcasts — all inside Hub.</p>
      </Section>

      <Section title="The conversation list">
        <p>The Txt sidebar lists conversations under these tabs:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Mine</strong> — conversations assigned to you (or where you&apos;re a member).</li>
          <li><strong className="text-white">All</strong> — every active conversation on Heroes&apos; line. The whole team can <em>read</em> any thread here, but you can only <em>send</em> in conversations you own or have joined (see <strong className="text-white">Sending a text</strong>). The orange <strong className="text-white">unread</strong> dot only lights on threads that are <em>yours</em> (owned or joined), so a teammate&apos;s unread threads don&apos;t bury your own in the All view.</li>
          <li><strong className="text-white">Archived</strong> — closed-out conversations. They pop back to the top automatically if the customer texts again, and you can reopen one yourself anytime — open it and tap <strong className="text-white">Reopen to reply</strong>.</li>
        </ul>
        <p>For <strong className="text-white">managers</strong>, <strong className="text-white">unassigned</strong> conversations (a customer texted in, called, or left a voicemail and no one&apos;s claimed them yet) pin to the top as a highlighted orange <strong className="text-white">Queue</strong>, with inline <strong className="text-white">Claim · Assign · Archive</strong> buttons. Claim takes it for yourself; Assign hands it to a teammate. Guardian auto-text threads now live <em>in</em> this Queue too (with a small purple <strong className="text-white">Guardian</strong> badge) instead of a separate tab — so there&apos;s one place to triage everything.</p>
      </Section>

      <Section title="Sending a text">
        <Step n={1}>Open <strong className="text-white">Txt</strong> from the sidebar, then pick a conversation — or tap <strong className="text-white">New</strong> and search your contacts to start one.</Step>
        <Step n={2}>Type your message in the composer at the bottom and tap the <strong className="text-white">➤</strong> send button.</Step>
        <Step n={3}>The customer&apos;s replies land back in the same thread in real time, with a push notification to whoever owns the conversation.</Step>
        <Note>If a text can&apos;t be delivered, the bubble shows a plain-English reason instead of a cryptic code — e.g. <strong className="text-white">🚫 Landline — can&apos;t receive texts</strong> or <strong className="text-white">🚫 Number invalid or unreachable</strong> (the number won&apos;t take texts) vs. <strong className="text-white">⚠ Phone unreachable — may work later</strong> (a temporary hiccup worth retrying). Photos and videos a customer sends now open <em>inside the app</em> when you tap them, instead of a separate browser tab.</Note>
        <p>The composer toolbar has: <strong className="text-white">📎 attach</strong> (send a photo, PDF, or short video as an MMS, up to 5 MB total), <strong className="text-white">📋 templates</strong>, <strong className="text-white">🚗 on-my-way</strong>, <strong className="text-white">⏰ schedule</strong>, <strong className="text-white">😀 emoji</strong>, <strong className="text-white">⤢ expand</strong> (a bigger typing box), and <strong className="text-white">➤ send</strong>.</p>
        <Note><strong className="text-white">PDFs and video over text.</strong> Text messages are capped at <strong className="text-white">5 MB total</strong>, so a video has to be short to fit. Photos and PDFs are reliable; video delivery depends on the customer&apos;s carrier and phone and isn&apos;t guaranteed — if a carrier rejects it, the bubble shows a delivery error so you know to follow up another way.</Note>
        <Note><strong className="text-white">Paste a picture.</strong> You can copy an image (a screenshot, or a photo) and paste it straight into the text box with ⌘V / Ctrl+V — it attaches as an MMS just like the 📎 button, no need to save and upload the file first.</Note>
        <p className="mt-3"><strong className="text-white">Send a text to a board.</strong> Hover over any message bubble (yours or the customer&apos;s) and tap the <strong className="text-white">☑</strong> that appears beside it to turn that text into a task card on one of your Hub <Link href="/hub" className="text-sky-400 hover:underline">Boards</Link>. Pick the board and it&apos;s added as <em>&ldquo;Text from {'{customer}'}: …&rdquo;</em> so the team has the context — handy for turning a customer request into a to-do.</p>
        <Note>Reading is open to the whole team; <strong className="text-white">sending</strong> is just for the people on a conversation, and you join one of two explicit ways (typing a reply never silently claims a thread anymore). If it&apos;s an <strong className="text-white">unclaimed</strong> Queue thread, you&apos;ll see <strong className="text-white">Claim it</strong> — tap it to become the owner and the composer appears. If it&apos;s already <strong className="text-white">owned by someone else</strong>, you&apos;ll see <strong className="text-white">Join to reply</strong> — tap it to add yourself as a member and the composer appears.</Note>
      </Section>

      <Section title="Add to Contacts">
        <p>When you&apos;re texting a number that isn&apos;t in your <Link href="/hub/contacts" className="text-sky-400 hover:underline">Contacts</Link> directory yet — someone who just texted in, for example — a green <strong className="text-white">+ Add to Contacts</strong> button shows in the conversation header. Tap it to save them (name pre-filled where we have it); the whole conversation history stays attached to that contact. Once saved, the button disappears and the name opens the usual <strong className="text-white">Edit contact</strong> panel.</p>
      </Section>

      <Section title="Add to Lead Tracker (Beta)">
        <p>Talking to a prospect who should be tracked as a lead? The conversation header has a <strong className="text-white">+ Add to Lead Tracker</strong> button. Tap it and a quick form opens with the name, phone, and email already filled in, plus a first note summarizing what the conversation has been about (written for you from the messages) — tweak anything and save. It lands in the <Link href="/hub/tracker" className="text-sky-400 hover:underline">Lead Tracker</Link> under the stage you pick, and the person is added to Contacts. Lead Source is left blank on purpose — set it in the tracker if you know it. Once added the button reads <strong className="text-white">✓ In tracker</strong>; tapping it again just opens the lead rather than making a duplicate.</p>
        <Note>This is a <strong className="text-white">Beta feature</strong>. If you don&apos;t see the button, turn it on under <strong className="text-white">Settings → Beta Features</strong>.</Note>
      </Section>

      <Section title="Templates">
        <p>Save messages you send over and over — appointment confirmations, &quot;running late&quot;, payment reminders. Tap <strong className="text-white">📋</strong> in the composer, or just type <strong className="text-white">/</strong> at the start of the box to pop the picker.</p>
        <p>Templates support <code>{'{first_name}'}</code>, which fills in the customer&apos;s first name automatically. There are <strong className="text-white">company templates</strong> (shared with the team, managed in Admin → Txt) and your own <strong className="text-white">personal templates</strong> (managed in Settings → Account → Communications).</p>
        <Note><strong className="text-white">Attach an image to a template.</strong> When you create or edit a template you can <strong className="text-white">📎 Attach image</strong> — that picture is saved with the template and sends automatically (as an MMS) whenever you pick it, so you don&apos;t have to attach it by hand each time. Templates with an attachment show a 📎 next to their name. A template can be image-only (no text) if you just want to fire off a flyer or photo.</Note>
        <Note><strong className="text-white">Assign a template to specific people.</strong> In <strong className="text-white">Admin → Txt → Templates</strong>, each template has a <strong className="text-white">Who can use this</strong> setting: <em>Everyone</em> (the default) or <em>Specific people</em>. Keep one shared library, but pick who sees each one — so a tech only sees the templates relevant to their role instead of scrolling past everyone else&apos;s. The list shows &quot;Everyone&quot; or how many people are assigned.</Note>
      </Section>

      <Section title="On My Way">
        <p>Tap <strong className="text-white">🚗</strong>, pick an ETA (5 / 10 / 15 / 20 / 30 / 45 min, or a custom number), and Txt drops a polished &quot;I&apos;m on my way&quot; message into the composer for you to review and send. The wording is set in <strong className="text-white">Admin → Txt → On My Way</strong> and uses <code>{'{first_name}'}</code>, <code>{'{my_name}'}</code>, <code>{'{company}'}</code>, and <code>{'{eta}'}</code>.</p>
      </Section>

      <Section title="Scheduled send">
        <p>Tap <strong className="text-white">⏰</strong> to queue a message for a future date and time instead of sending now — useful for next-morning reminders. A badge shows how many you have queued, and you can cancel any of them before they go out.</p>
      </Section>

      <Section title="Assigning &amp; collaborating">
        <p>Each conversation has an <strong className="text-white">owner</strong> (the chip reads &quot;Owner: You&quot; or the teammate&apos;s name) plus optional <strong className="text-white">members</strong> who can also see and reply. An <strong className="text-white">unclaimed</strong> thread has no owner — anyone with Txt can <strong className="text-white">Claim</strong> it to become the owner. A thread <em>owned by someone else</em> you can <strong className="text-white">Join</strong> yourself (one tap) so you never have to wait to be added. To pull <em>someone else</em> in, the owner or a Texting Manager uses <strong className="text-white">+ member</strong> (they get a push so they know they&apos;ve been added). A member can <strong className="text-white">Leave</strong> a thread anytime. <strong className="text-white">Archiving</strong> a thread is owner-level — only the conversation&apos;s owner or a Texting Manager can archive it. <strong className="text-white">Reopening</strong> an archived thread, though, is open to anyone with Txt: tap <strong className="text-white">Reopen to reply</strong> (or the ↺ in the header) and the conversation comes back to your inbox and becomes yours, so you can text the customer right away.</p>
        <p>The <strong className="text-white">📝 Notes</strong> panel holds internal notes that the customer never sees — context for whoever picks the conversation up next. On mobile it opens full-screen; note markers also appear inline in the thread at the point in time they were added.</p>
      </Section>

      <Section title="Click-to-call">
        <p>Direct conversations have a <strong className="text-white">📞</strong> button in the header that jumps to the Dialer with the customer&apos;s number filled in. Texting and calling stay linked so Call Log can show which thread a call came from.</p>
      </Section>

      <Section title="Pop out a conversation">
        <p>Tap the <strong className="text-white">⧉ pop-out</strong> button in a conversation&apos;s header to float that text thread in its own always-on-top window — the same way the <Link href="/hub/dialer" className="text-sky-400 hover:underline">Dialer</Link> pops out. You can then move around Hub, or switch to another app entirely, and keep reading and replying without losing the thread. Close it and the conversation goes right back to the normal in-page view.</p>
        <p>The pop-out is a <strong className="text-white">trimmed</strong> view — the running conversation plus a box to type your reply. Templates, on-my-way, scheduling, notes, attaching media, and assignment stay on the full Txt page (incoming photos still show in the pop-out).</p>
        <Note>The floating window works in <strong className="text-white">Chrome, Edge, Arc, and Brave</strong> (it uses their Picture-in-Picture support). On Safari and the mobile/native app the button simply doesn&apos;t appear — everything else works the same. Only one thread floats at a time; popping out a second conversation moves the window to that one. The window closes if you fully reload the page or leave Hub.</Note>
      </Section>

      <Section title="Unified inbox (calls + voicemails)">
        <p>Every customer thread is one chronological story of <em>every</em> way you&apos;ve talked: texts as bubbles, plus inline markers for <strong className="text-white">📞 calls</strong> and <strong className="text-white">🎙 voicemails</strong> — visible to <strong className="text-white">anyone with Txt</strong> (you already see the texts; now the calls and voicemails sit right alongside them). Tap a call or voicemail marker to expand it — play the recording right in the app, read the AI summary and sentiment, and open the full transcript. A missed call that left a voicemail shows as <em>one</em> combined marker, not two.</p>
        <p>Turning on <strong className="text-white">Unified Inbox</strong> for someone (Admin → People) adds the extras below on top of those in-thread markers: the channel icons + sorting + filter chips in the conversation list, and the AI <strong className="text-white">🧭 Catch me up</strong> recap.</p>
        <p>The conversation list reflects all of it: each row shows a <strong className="text-white">💬 / 📞 / 🎙</strong> icon for its most recent activity, sorts by the latest event across <em>any</em> channel, and the filter chips <strong className="text-white">All · Unread · Missed · Voicemails</strong> narrow the list. So a customer who just called (but hasn&apos;t texted in weeks) floats to the top.</p>
        <p>A <strong className="text-white">missed call or voicemail from someone with no open conversation</strong> creates a Queue item automatically — exactly like an inbound text — so nothing slips through the cracks. Claim it and reply by text right from the thread.</p>
        <p><strong className="text-white">🧭 Catch me up</strong> (header) gives a 2–3 sentence AI recap of the whole relationship — last contact, open threads, what the last voicemail was about — built from the summaries already on file. <strong className="text-white">✨ Polish draft</strong> (composer) cleans up the grammar and tone of <em>your own</em> typed or dictated message without changing what you meant; an <strong className="text-white">↩ Undo</strong> restores your original.</p>
      </Section>

      <Section title="Groups &amp; broadcasts">
        <p><strong className="text-emerald-300">Broadcasts are back — in Beta.</strong> A <strong className="text-white">Texting Manager</strong> turns on <strong className="text-white">Txt Broadcasts</strong> under <strong className="text-white">Settings → Beta Features</strong>; once it&apos;s on, the <strong className="text-white">📣 Broadcast</strong> button and the <strong className="text-white">Broadcasts</strong> link appear. A broadcast sends one message to many customers as separate private one-to-one texts — nobody sees anyone else — automatically skips <em>do-not-text</em> contacts, and appends your opt-out notice on the first text to each person. With more than one company number, a <strong className="text-white">Send from</strong> dropdown in the composer picks which line the whole broadcast goes out on.</p>
        <p className="mt-3"><strong className="text-emerald-300">Group texts are back too — in Beta.</strong> Turn on <strong className="text-white">Txt Group Messages</strong> under <strong className="text-white">Settings → Beta Features</strong> and a <strong className="text-white">+ Group</strong> button appears in the Txt sidebar. This is a <em>real</em> group text, like on your phone: <strong className="text-white">everyone in the group sees everyone&apos;s messages and phone numbers</strong>, and any member&apos;s reply goes to the whole group. Each member&apos;s separate one-on-one thread with us stays private and unaffected — the group is its own conversation, and it archives and reopens like any other (a member texting the group brings it back, history intact). Limits: 2–9 contacts per group (plus us), <strong className="text-white">US/Canada cell phones only</strong> (landlines can&apos;t join a group text), groups always send from our main local number, and photos in groups aren&apos;t supported yet.</p>
      </Section>

      <Section title="Opt-outs (STOP / HELP)">
        <p>If a customer replies <strong className="text-white">STOP</strong>, they&apos;re automatically marked <em>do not text</em> and the conversation archives — outbound texts to them are then blocked everywhere (regular sends and broadcasts). <strong className="text-white">START</strong> re-enables them. The carrier sends the customer the official STOP/HELP confirmation, so you don&apos;t need to reply to those yourself.</p>
        <p>An opt-out banner shows at the top of any conversation with a customer who&apos;s opted out, including archived ones, so it&apos;s always clear.</p>
        <p><strong className="text-white">First-text opt-out notice.</strong> The very first text a customer ever receives from us automatically gets a short opt-out line added to the end (<em>&ldquo;Reply STOP to opt out.&rdquo;</em>) — so every new contact is told how to stop. Follow-up texts to that same person don&apos;t repeat it. Admins can edit the wording or turn it off in <strong className="text-white">Admin → Txt → Signature</strong>.</p>
      </Section>

      <Section title="Signatures">
        <p>A signature is auto-appended when you&apos;re the first to text a client, or when you jump into a conversation a different teammate was handling — so customers always know who they&apos;re talking to. It won&apos;t repeat back-to-back from the same sender, and it supports the same dynamic fields as templates (e.g. <code>{'{first_name}'}</code>, <code>{'{my_name}'}</code>).</p>
        <p><strong className="text-white">Company default.</strong> Admins set a company-wide signature in <strong className="text-white">Admin → Txt → Signature</strong> (e.g. <code>{'{first_name}'}, - Heroes Lawn Care</code>). It&apos;s used for anyone who hasn&apos;t set their own.</p>
        <p><strong className="text-white">Personal signature.</strong> If the admin allows it, you can set your own in <strong className="text-white">Settings → Account → Communications</strong>, which overrides the company default. When the admin turns off personal signatures, everyone uses the company default and that field is hidden.</p>
      </Section>

      <Section title="Suggest Reply (Guardian)">
        <p>In a conversation, Guardian can draft a reply suggestion based on the thread so far. Review and edit it before sending — it&apos;s a starting point, never sent automatically.</p>
      </Section>

      <AdminOnly>
        <p>Txt is gated per person. Turn on <strong className="text-white">Txt</strong> for a user in <strong className="text-white">Admin → People</strong> (under Communication) to give them the Txt icon and access to <code>/hub/txt</code>. It&apos;s off by default — grant it to each person who should handle customer texts.</p>
        <p><strong className="text-white">Two access levels.</strong> Everyone with Txt shares the inbox — they can <strong className="text-white">read</strong> any conversation in <strong className="text-white">All</strong>, start new ones, and take notes. <strong className="text-white">Sending a reply is limited to the conversation&apos;s owner and its members</strong>: an unclaimed thread shows <strong className="text-white">Claim it</strong> (you become owner); a thread owned by someone else shows <strong className="text-white">Join to reply</strong> (you add yourself as a member). Either way the composer — plus AI suggestions, scheduling, etc. — appears only after that explicit action. <strong className="text-white">Archiving</strong> a thread is owner-or-manager only, but <strong className="text-white">anyone with Txt can reopen an archived thread</strong> (<strong className="text-white">Reopen to reply</strong>) to re-engage the customer — it claims the thread for you so the composer appears. <strong className="text-white">Texting Managers</strong> additionally see the unassigned <strong className="text-white">Queue</strong> (which now also holds Guardian auto-text threads), can add or remove <em>other</em> people on a thread, can reassign/archive any thread, and can send <strong className="text-white">Broadcasts</strong>.</p>
        <p><strong className="text-white">Admin → Txt</strong> has tabs for the phone number(s) (mark one as default), the On-My-Way wording, the company templates, Responder notifications, and the <strong className="text-white">Managers</strong> tab — where you pick who&apos;s a Texting Manager. Admins and Txt-admins are always managers; checking anyone else there grants them the manager tier (it writes each person&apos;s <code>can_assign_txt_threads</code> flag).</p>
        <p><strong className="text-white">Multiple numbers &amp; per-user access.</strong> If your company has more than one number (e.g. a toll-free line plus a local line), the <strong className="text-white">Phone Numbers</strong> tab is where you manage them all. The <strong className="text-white">Per-user numbers</strong> table sets two things per person: their <strong className="text-white">Default number</strong> (what they send from) and their <strong className="text-white">Access</strong> — which numbers they see. <strong className="text-white">Leaving every Access box unchecked = they see all numbers</strong> (the default for everyone); check specific ones to keep a person&apos;s view simple — for example, limit a field tech to just the local line. This access set governs <em>both</em> Txt and the Dialer, and it filters which numbers their &ldquo;Call from&rdquo; picker offers. Admins always see every number.</p>
        <p><strong className="text-white">Which line is this thread on?</strong> When your company uses more than one number, each conversation in the Txt list shows a small badge (e.g. <em>Main</em> / <em>Toll Free</em>) so you can tell at a glance which of your numbers the customer is on. Inside a thread, the <strong className="text-white">From:</strong> chip shows the same — and lets the owner switch which number replies go out from.</p>
        <p><strong className="text-white">Unified Inbox</strong> is a separate per-person toggle in <strong className="text-white">Admin → People</strong> (&quot;Unified Inbox&quot;, off by default; admins always have it). In-thread <strong className="text-white">📞 call</strong> and <strong className="text-white">🎙 voicemail</strong> markers now show for <em>everyone</em> with Txt regardless of this toggle; the toggle adds the list-level channel sorting/filters and the AI <strong className="text-white">Catch me up</strong> recap — see the <strong className="text-white">Unified inbox (calls + voicemails)</strong> section above.</p>
        <p>Customer-facing texting requires Heroes&apos; verified Twilio number to be live and configured (inbound + status webhooks, the broadcast and scheduled-send crons, and the number added in Admin → Txt). Voice (Dialer) and texting (Txt) share the same Twilio number.</p>
      </AdminOnly>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// DIALER
// ──────────────────────────────────────────────────────────────────────────

function DialerTab() {
  return (
    <>
      <Section title="What It Does">
        <p>Dialer is the in-browser softphone — place and receive phone calls from any Hub device without a separate calling app. Calls go through Heroes&apos; Twilio number, so anyone you reach sees a single consistent business number.</p>
        <Note>Dialer is <strong className="text-white">live</strong> — it places and receives real calls through Heroes&apos; Twilio business number on every Hub device.</Note>
      </Section>

      <Section title="Placing a Call">
        <Step n={1}>Open <strong className="text-white">Dialer</strong> from your app drawer, or from your favorites if you&apos;ve pinned it.</Step>
        <Step n={2}>Tap digits on the keypad or type a phone number directly into the field.</Step>
        <Step n={3}>Tap the green <strong className="text-white">Call</strong> button. The browser asks for microphone access the first time — say yes.</Step>
        <Step n={4}>While the call is connecting, the screen switches to the active-call view with caller info, a mute button, a keypad for tone entry (e.g. menu choices), and a red hang-up button.</Step>
        <Note>If your company has more than one number and you&apos;re allowed to use more than one, a <strong className="text-white">Call from</strong> picker appears above the keypad so you can choose which number the customer sees. With a single number it&apos;s hidden — calls just use it. Which numbers you can pick is set per-user in <strong className="text-white">Admin → Txt → Phone Numbers</strong>.</Note>
        <Note><strong className="text-white">Holds are private.</strong> Putting a caller on hold plays them hold music <em>and</em> pauses the recording for as long as they&apos;re on hold — so anything said while a caller is on hold (to a coworker, or on another phone) is never recorded. Recording resumes automatically the moment you take them off hold.</Note>
        <Note><strong className="text-white">Choose your headset (mic &amp; speaker).</strong> Tap <strong className="text-white">Audio settings</strong> under the keypad — or the <strong className="text-white">Audio</strong> button during a call — to pick exactly which microphone and speaker the Dialer uses, and <strong className="text-white">Test</strong> the speaker. Your choice is remembered on that computer and can be changed mid-call. If callers say you sound hollow, echoey, or like you&apos;re on speakerphone, it&apos;s usually because the browser defaulted to the laptop&apos;s built-in mic and speakers — pick your headset here to fix it. There&apos;s also a <strong className="text-white">Headset mode</strong> switch — <strong className="text-white">on by default on computers</strong>, since most agents wear a headset — that gives fuller, more natural (and usually louder) audio. If you use your computer&apos;s built-in speakers instead of a headset, turn it off to prevent echo. (Speaker selection needs Chrome or Edge; on other browsers, set your headset as the default speaker in your computer&apos;s sound settings. On the mobile app, use the built-in earpiece/speaker button instead.)</Note>
      </Section>

      <Section title="Receiving a Call">
        <p>When an inbound call comes in, a full-screen ringing overlay shows the caller&apos;s number (and contact name if you&apos;ve texted them before from Txt). Tap green to accept, red to reject.</p>
        <Note>Where an inbound call rings is set by your phone routing — the auto-attendant (IVR) menu, ring groups, 3-digit extensions, and after-hours rules are all live and configured in <strong className="text-white">Admin → Dialer</strong> (see the sections below).</Note>
      </Section>

      <Section title="Recent Calls">
        <p>The Dialer sidebar shows four tabs: <strong className="text-white">Recent</strong> (your own calls — inbound and outbound), <strong className="text-white">Missed</strong> (inbound calls that didn&apos;t connect), <strong className="text-white">All</strong> (managers only — every call on Heroes&apos; line), and <strong className="text-white">Voicemail</strong>. Tap any call row to pre-fill the dialpad with that number for a callback.</p>
      </Section>

      <Section title="Click-to-call from Txt">
        <p>Every direct Txt conversation header has a green <strong className="text-white">📞</strong> button next to Notes and Archive. Tap it to jump to the Dialer with the contact&apos;s number already filled in — tap the green Call button there to actually dial. The resulting call gets linked back to the Txt thread so Call Log can show the conversation it came from. Group Txt threads don&apos;t show the button (no single contact to call).</p>
      </Section>

      <Section title="Voicemail">
        <p>If an inbound call rings out without being answered, the caller is sent to the company voicemail. The <strong className="text-white">Voicemail</strong> tab in the Dialer sidebar lists every message. The tab label shows a red badge with the unheard count.</p>
        <p>Each voicemail row shows the caller (name if the number matches a Txt contact, otherwise the formatted phone number), the time it came in, and the recording length. Tap <strong className="text-white">Play</strong> to hear it inline — playing it once marks it as heard. <strong className="text-white">Mark heard</strong> / <strong className="text-white">Mark unheard</strong> lets you toggle without playing. <strong className="text-white">Delete</strong> removes it from the inbox (soft-deleted; admins can recover it from the database for 90 days if needed).</p>
        <p><strong className="text-white">Follow-up markers</strong> — next to Mark heard are two quick status buttons: <strong className="text-white">✓</strong> marks a voicemail as <em>taken care of</em> (turns green) and <strong className="text-white">🚩</strong> flags it as <em>needs follow-up</em> (turns amber). Tap the lit one again to clear it. It&apos;s a shared status — anyone on the Voicemail tab sees the same marker — so the team can tell at a glance which messages are handled and which still need attention.</p>
        <p>Tapping the caller name pre-fills the dialpad with their number so you can call back in one tap.</p>
        <p>Voicemail recipients (the people who get a push notification when a new voicemail lands) are configured in <strong className="text-white">Admin → Dialer</strong>. Push notifications respect each recipient&apos;s Do Not Disturb settings.</p>
        <p><strong className="text-white">AI transcript + summary</strong> — within about 15–30 seconds after a voicemail arrives, Deepgram transcribes the audio and Claude writes a one-sentence summary of what the caller said. The summary appears as a grey snippet below the caller name in the voicemail list so you can triage messages at a glance without playing them. The full transcript is visible in <strong className="text-white">Call Log 2</strong> when you click the matching call row.</p>
        <p><strong className="text-white">Emergency fallback voicemail</strong> — if the phone system ever errors on a live call, a backup hosted at Twilio answers, apologizes for the technical issue, and records a message so the caller never hears a dead-end error. How your team is alerted when that happens (a Guardian Hub message by default, or a text) is configured in <strong className="text-white">Admin → Dialer → Fallback voicemail alerts</strong>. These alerts are rare by design — each one means a real call hit an error and is worth flagging to an admin.</p>
      </Section>

      <Section title="Ring anywhere in Hub">
        <p>By default, incoming calls pop a ringing overlay no matter what page of Hub you&apos;re on — a room, a DM, Tracker, Settings, anywhere. Accept or reject from the overlay; if you accept and then navigate away from the Dialer page, a thin green banner at the top of Hub keeps the call timer visible with a one-tap return to Dialer. The banner has a <strong className="text-white">×</strong> to dismiss it if it&apos;s in the way (it&apos;ll come back on the next call).</p>
        <p>The rail Dialer icon also shows a red badge with your unheard voicemail count — so a missed-call voicemail is visible from any Hub page, not just from inside the Dialer sidebar.</p>
        <p><strong className="text-white">Call waiting is silent.</strong> If a second call comes in while you&apos;re already on a call (on the computer / desktop app), it does <em>not</em> ring out loud — it shows a quiet amber <strong className="text-white">&quot;Another call waiting&quot;</strong> banner at the top with the caller&apos;s name, so it never interrupts the conversation you&apos;re having. Finish your call and call them back, or tap <strong className="text-white">Dismiss</strong> to send them on to voicemail.</p>
        <p>To turn off cross-page ringing — for example, if you don&apos;t want your browser holding an open phone connection while you&apos;re heads-down on something else — open <strong className="text-white">Settings → Account → Communications</strong> and uncheck <em>Ring me on every Hub page</em>. With the toggle off, calls only ring you while you&apos;re on the Dialer page itself.</p>
      </Section>

      <Section title="Call dispositions (after-call prompt)">
        <p>When a connected call ends, a small <strong className="text-white">&quot;how did it go?&quot;</strong> prompt pops up with quick outcome buttons — <em>Scheduled, Voicemail, Callback, Wrong number, Other</em> by default. Tap one to log the outcome on the call (it shows in the Call Log); ignore it and it disappears on its own after 30 seconds.</p>
        <p>Admins can edit the button list — or <strong className="text-white">turn the prompt off entirely</strong> — in <strong className="text-white">Admin → Dialer → Call dispositions</strong>. Flip the switch off and the after-call prompt never appears for anyone in the company; flip it back on to resume. It&apos;s on by default.</p>
      </Section>

      <Section title="Who's calling — caller ID">
        <p>The ringing overlay (and the in-call card, mini-dialer, and missed-call notification) shows who&apos;s calling. It always prefers a name <strong className="text-white">we have on file</strong> — a saved contact, or a matched Jobber customer or contact person — and tags it <strong className="text-white">Customer</strong> or <strong className="text-white">Lead</strong> when it&apos;s a Jobber match.</p>
        <p>When the number isn&apos;t anyone we know, the Dialer falls back to the phone carrier&apos;s <strong className="text-white">caller ID</strong> and shows that name with a small <strong className="text-white">Caller ID</strong> tag. That name is the carrier&apos;s best guess — it can be a spouse, a previous line-holder, or blank for a cell or a blocked/spam call — so treat it as a hint, not gospel. It&apos;s never saved as the contact&apos;s real name. If the carrier has no name (common for blocked callers), you&apos;ll just see the number.</p>
      </Section>

      <Section title="Auto-attendant (IVR)">
        <p>Set up a phone menu callers hear before reaching anyone — &quot;Thank you for calling Heroes Lawn Care. Press 1 for scheduling, press 2 for billing.&quot; Configure it in <strong className="text-white">Admin → Dialer</strong> under the <em>Auto-attendant</em> section.</p>
        <p>The menu is a tree of <strong className="text-white">menus</strong> (nodes). Each menu has a <strong className="text-white">prompt</strong> the caller hears and a set of <strong className="text-white">keypress actions</strong> (what happens when they press 0–9, *, or #).</p>
        <p><strong className="text-white">Prompts</strong> can be either typed text (Twilio reads it aloud in a synthetic voice — fast to draft and edit) or an uploaded MP3/WAV file (a human recording — sounds professional but you have to re-record to change wording). Most people start with typed prompts to dial in the menu structure, then upload audio recordings for the prompts callers hear most often.</p>
        <p><strong className="text-white">Keypress actions</strong> you can use today:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Go to another menu</strong> — branch into a submenu (nested menus are fully supported)</li>
          <li><strong className="text-white">Send to voicemail</strong> — caller leaves a message in the company voicemail box</li>
          <li><strong className="text-white">Ring a person</strong> — rings that user&apos;s Dialer until they answer; if they don&apos;t, the caller goes to the <strong className="text-white">company voicemail</strong>. (A menu choice like this is a business call, so it uses the company greeting — not the person&apos;s personal one.)</li>
          <li><strong className="text-white">Ring an extension</strong> — rings whoever owns that 3-digit extension. Because this is a direct <em>extension</em> dial, an unanswered call goes to <strong className="text-white">that person&apos;s personal voicemail</strong> (handy when you want the menu to read &quot;Press 1 for Ben, extension 101&quot;)</li>
          <li><strong className="text-white">Prompt for an extension (dial by extension)</strong> — asks the caller to enter an extension, then rings whoever owns it. Lets people who know a specific extension reach that person directly without listing names on the menu (e.g. &quot;If you know your party&apos;s extension, press 1&quot;). An unrecognized or empty entry re-prompts once, then drops to the general voicemail. Only reaches users who have an extension assigned.</li>
          <li><strong className="text-white">Ring a group</strong> — rings a named group of people (simultaneous or sequential)</li>
          <li><strong className="text-white">Forward to a phone number</strong> — bridges to an external number (e.g. forwarding to a cell)</li>
          <li><strong className="text-white">Say a message, then hang up</strong> — speaks a closing message and ends the call (useful for &quot;we&apos;re closed&quot; trees)</li>
          <li><strong className="text-white">Hang up</strong> — ends the call cleanly</li>
        </ul>
        <p>Each menu also has two <strong className="text-white">fallbacks</strong> — &quot;if no input&quot; (caller didn&apos;t press anything within ~6 seconds) and &quot;if invalid input&quot; (they pressed a digit you haven&apos;t mapped). Both default to <em>repeat the menu twice, then voicemail</em>, which is what you want most of the time.</p>
        <p>The <strong className="text-white">root menu</strong> is the first one callers hear. The one labeled &quot;root&quot; in the menu list is the entry point — use &quot;Set as root&quot; on any menu to make it the new starting point.</p>
        <p><strong className="text-white">To test:</strong> save your changes, then call your Heroes business number. Changes take effect immediately on the next inbound call — no deploy or restart needed.</p>
        <p>Turn the auto-attendant off and inbound calls go straight to the &quot;ring this person → voicemail&quot; flow. Turn it back on and the menu picks up again. You can leave a draft menu built but disabled at any time.</p>
      </Section>

      <Section title="Extensions (3-digit dialing)">
        <p>Every Hub user can be assigned a 3-digit extension (100–999) in <strong className="text-white">Admin → Dialer → Extensions</strong>. Once assigned, anyone on the Dialer can punch the 3 digits into the dialpad, tap Call, and it rings that person directly — no phone number needed. If they don&apos;t answer, the caller is dropped into <strong className="text-white">that person&apos;s personal voicemail</strong>.</p>
        <p>Extensions also show up in the IVR action picker, so you can build a menu like &quot;Press 1 for sales (ext 101), press 2 for billing (ext 102)&quot; without re-picking the person each time.</p>
        <p>Extensions are unique within a company. Use the <em>Suggest</em> button to grab the next free number (101, 102, ...).</p>
      </Section>

      <Section title="Ring groups">
        <p>Named groups of people that an IVR menu can ring as one action. Configured in <strong className="text-white">Admin → Dialer → Ring groups</strong>.</p>
        <p>Two ring modes:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Simultaneous</strong> — everyone&apos;s phone rings at once. Whoever picks up first connects; the others stop ringing. Good for &quot;ring the whole sales team&quot;.</li>
          <li><strong className="text-white">Sequential</strong> — rings one member at a time in the order shown, falling through to the next on no-answer. Good for &quot;try Ben first, then Zac, then Kathryn&quot;.</li>
        </ul>
        <p><strong className="text-white">Ring time</strong> is set per group in its settings: for <em>simultaneous</em>, how many seconds everyone rings before voicemail; for <em>sequential</em>, how many seconds <em>each</em> person rings before moving to the next (5–120 seconds, default 20). So a sequential group of two people at 20 seconds each rings for up to ~40 seconds before voicemail.</p>
        <p>Members with Do Not Disturb on are skipped automatically. When a group goes unanswered (a sequential group runs out of members, or a simultaneous group rings out / is empty after DND filtering), the call falls through to the <strong className="text-white">company</strong> voicemail.</p>
      </Section>

      <Section title="Do Not Disturb (DND)">
        <p>Each user can turn <strong className="text-white">Calls DND</strong> on in <strong className="text-white">Settings → Notifications</strong>. With it on, IVR transfers and ring groups skip you — calls go to other group members or to voicemail.</p>
        <p>You can also schedule auto-DND windows per day of week — e.g. 6 PM to 8 AM every weekday. Wrap-overnight ranges work (set &quot;from&quot; later than &quot;to&quot;). Times are interpreted in your local time zone.</p>
        <p>Setting your Hub status to &quot;DND&quot; (in the <strong className="text-white">You menu</strong>) turns on <strong className="text-red-400">Master DND</strong>, which silences <em>everything</em> — including calls. The separate <strong className="text-white">Calls DND</strong> toggle is narrower: it quiets only the phone while your messages still notify. Use Calls DND when you want the phone silent but Hub messages coming through.</p>
      </Section>

      <Section title="Voicemail (company box + personal boxes)">
        <p><strong className="text-white">Business calls use the company voicemail.</strong> Anything that comes in on the main line and isn&apos;t answered — the inbound &quot;ring this person&quot; route (auto-attendant off), or an IVR menu&apos;s &quot;ring a person&quot; / &quot;ring a group&quot; that no one picks up — lands in the <strong className="text-white">company voicemail box</strong> and plays the <strong className="text-white">company greeting</strong>.</p>
        <p><strong className="text-white">Personal voicemail boxes are only for direct extension dials.</strong> When someone dials a person&apos;s <strong className="text-white">extension</strong> — internally from the dialpad, or a caller who enters it at the auto-attendant&apos;s &quot;dial by extension&quot; prompt — and they don&apos;t answer, it lands in <em>that person&apos;s</em> box with their personal greeting. Push notifications for a personal voicemail go only to them; the unheard count on the rail badge reflects what they can see.</p>
        <p>The Voicemail tab has a <strong className="text-white">Mine / All</strong> sub-toggle for managers. <em>Mine</em> shows the general inbox plus voicemails directed at you; <em>All</em> shows every voicemail in the company (manager-only).</p>
        <p>Upload your personal greeting in <strong className="text-white">Settings → Account → Communications</strong>. MP3 or WAV, 2 MB max. Without one, callers hear a spoken default that names you (&quot;You&apos;ve reached Ben…&quot;). Remove the greeting at any time to revert to the spoken default.</p>
        <p>The company-wide general greeting (heard when calls aren&apos;t routed to a specific person) is configured separately in <strong className="text-white">Admin → Dialer → Voicemail greeting</strong>.</p>
      </Section>

      <Section title="Business hours &amp; holidays (which menu plays when)">
        <p>The auto-attendant supports three separate menu trees that run automatically depending on the time of day:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Default</strong> — runs during business hours and any time no other tree applies. Required if the auto-attendant is on.</li>
          <li><strong className="text-white">After-hours</strong> — runs when business hours are configured and the call lands outside them. Skip building this tree and after-hours calls fall back to the Default tree.</li>
          <li><strong className="text-white">Holiday</strong> — runs on dates listed in the Holidays section. Overrides After-hours when both would apply (e.g. a holiday that falls on a weekend).</li>
        </ul>
        <p>Switch between trees using the <strong className="text-white">Default / After-hours / Holiday</strong> tab strip inside the Auto-attendant editor. A small dot next to each tab name shows whether you&apos;ve built that tree yet (green = configured, grey = empty).</p>
        <p><strong className="text-white">Business hours</strong> are configured in <strong className="text-white">Admin → Dialer → Business hours</strong> as per-day-of-week windows — for example, Mon–Fri 8 AM to 6 PM, Sat 9 AM to 12 PM, Sun closed. Multiple windows per day work too (handy for a midday closure). Times are in America/Chicago by default. Calls outside any window for the current day count as &quot;after hours&quot;.</p>
        <p><strong className="text-white">Holidays</strong> are configured in <strong className="text-white">Admin → Dialer → Holidays</strong>. Two kinds:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">One-off date</strong> — a specific calendar date (e.g. 2026-11-26 for this year&apos;s Thanksgiving). Re-add it next year.</li>
          <li><strong className="text-white">Recurring</strong> — every year on the same month + day (e.g. December 25 — Christmas). Useful for fixed-date holidays.</li>
        </ul>
        <p>You can leave a holiday tree empty and just use Holidays as a way to fall back to After-hours behavior on those days — the Holiday tree only activates when it has at least one menu built.</p>
        <p>The Admin → Dialer page shows a small green &quot;<em>Right now: using …</em>&quot; banner so you can see which tree would run if a call landed right now.</p>
      </Section>

      <Section title="What&apos;s Coming">
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Mobile native dialer</strong> — built into the existing iOS/Android Hub app. Calls ring with native iOS CallKit / Android ConnectionService, work from lock screen + Bluetooth + CarPlay.</li>
          <li><strong className="text-white">Voicemail transcription + AI summary</strong> — Deepgram transcripts + bullet-point summaries.</li>
          <li><strong className="text-white">Call recording + AI summary</strong> — opt-in recording with Deepgram transcription + Claude bullet-point summary, all in Call Log.</li>
        </ul>
      </Section>

      <AdminOnly>
        <p>Each user must have the <em>Dialer</em> permission enabled in Admin → People to access <code>/hub/dialer</code> and receive a Twilio Voice access token. Setting <em>Admin → Dialer</em> as a manager grant lets that user see <strong className="text-white">All</strong> calls (not just their own), inject test calls, and configure inbound routing / voicemail at <code>/hub/admin/dialer</code>.</p>
        <p>Inbound routing, ring timeout (5–120 seconds, default 20), the company voicemail greeting (MP3 or WAV, 2 MB max), and the voicemail recipient list are all configured in <strong className="text-white">Admin → Dialer</strong>. If no inbound routing person is set, every call goes straight to voicemail.</p>
        <p>Required env vars when going live: <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_API_KEY_SID</code>, <code>TWILIO_API_KEY_SECRET</code>, <code>TWILIO_TWIML_APP_SID</code>, <code>TWILIO_PHONE_NUMBER</code>. Voice does NOT need A2P 10DLC approval — that&apos;s SMS-only. Dialer can launch before Txt v2.</p>
      </AdminOnly>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// CONTACTS
// ──────────────────────────────────────────────────────────────────────────

function ContactsTab() {
  return (
    <>
      <Section title="Contacts">
        <p>The Contacts page is your company-wide address book — the one central directory every tool reads from. It fills automatically from two places: your <strong className="text-white">Jobber customers</strong> and anyone added to the <Link href="/hub/tracker/leads" className="text-sky-400 hover:underline">Lead Tracker</Link>. You can also add someone by hand any time. Everyone lives in one searchable list at <strong className="text-white">Contacts</strong> in your app drawer, with one record per person.</p>
        <p>Search by name, phone, or email from the top bar. Tap any contact to see their details, call them (Dialer), text them, or edit their info. Each contact now also holds a <strong className="text-white">company name</strong>, a <strong className="text-white">mailing address</strong>, and an <strong className="text-white">email subscription status</strong>, and shows where it came from (Jobber, the Lead Tracker, manually added, or imported).</p>
        <Note><strong className="text-white">Just calling or texting a number doesn&apos;t add it to Contacts.</strong> Random inbound texts and calls still show up in your Txt inbox and the Dialer exactly as before — but a number only becomes a saved contact when it&apos;s a Jobber customer, a lead, or you add it by hand. If someone you&apos;ve texted or called later becomes a customer or a lead, they turn into a full contact automatically — with their past conversation kept.</Note>
        <Note><strong className="text-white">Leads land here automatically.</strong> When a new lead is added to the <Link href="/hub/tracker/leads" className="text-sky-400 hover:underline">Lead Tracker</Link>, it&apos;s also added to Contacts (tagged source <em>Leads</em>) so you have one record for that person across the whole platform. Because a lead form isn&apos;t texting consent, lead-sourced contacts are set <strong className="text-white">do-not-text</strong> until someone opts them in.</Note>
      </Section>

      <Section title="Filtering the directory">
        <p>Below the search box are three quick filters so you can slice the directory the way each tool sees it:</p>
        <Step n={1}><strong className="text-white">Channel</strong> — show only contacts that have a phone (the Txt/Dialer view) or have an email (the Email Marketing view).</Step>
        <Step n={2}><strong className="text-white">Source</strong> — where the contact came from: Jobber, the Lead Tracker, Manual, or Imported.</Step>
        <Step n={3}><strong className="text-white">Email status</strong> — Subscribed, Unsubscribed, Bounced, or Complained. <strong className="text-white">Reset</strong> clears these three at once.</Step>
      </Section>

      <Section title="Right inside the Dialer & Txt sidebars">
        <p>You don&apos;t have to leave what you&apos;re doing to find someone. Both the <strong className="text-white">Dialer</strong> and <strong className="text-white">Txt</strong> sidebars now have a <strong className="text-white">Contacts</strong> tab right next to Recent / Missed / Voicemail (Dialer) and Mine / All / Archived (Txt). Tap it to search the same address book in place.</p>
        <p>Each contact row gives you a <strong className="text-white">📞 Call</strong> and a <strong className="text-white">💬 Text</strong> button — you&apos;ll see whichever ones you have access to. <strong className="text-white">+ Add</strong> creates a new contact without leaving the sidebar, and <strong className="text-white">Full Contacts ›</strong> opens the complete Contacts page when you want the full view (tags, filters, editing).</p>
      </Section>

      <Section title="Tags">
        <p>Tags are how you carve up the contact list so it&apos;s useful day-to-day. Customer, Vendor, Subcontractor, HOA, VIP — whatever categories matter for your business. Each contact can have any number of tags.</p>
        <Step n={1}>Tap any tag chip below the search bar to filter — pick multiple to narrow further (contact must have ALL selected tags).</Step>
        <Step n={2}>Tap <strong className="text-white">Untagged</strong> to see only contacts with no tags yet (good for cleanup).</Step>
        <Step n={3}>Tap <strong className="text-white">Clear</strong> to reset filters.</Step>
        <p>Tag chips appear inline on each contact row so you can see categorization at a glance.</p>
      </Section>

      <Section title="Adding & editing contacts">
        <p>The <strong className="text-white">+ Add</strong> button at the top creates a new contact (name + phone required; company, email, mailing address, and tags optional). Tick <strong className="text-white">This contact is a business</strong> for vendors or commercial accounts.</p>
        <p>Tap any existing contact to open its detail sheet. <strong className="text-white">Edit</strong> lets you change name, company, phone, email, email status, mailing address, notes, and tags. The <strong className="text-white">Do not text</strong> toggle blocks outbound SMS to this contact from Txt and broadcasts — useful when someone replies STOP or asks to be left alone (Twilio also auto-flips this when they text STOP).</p>
        <p><strong className="text-white">Delete</strong> now <strong className="text-white">removes the contact from the directory but keeps it recoverable</strong> — their text and call history stays intact, and it can be brought back. (Nothing is permanently erased.)</p>
        <Note>Editing a contact by hand marks it as yours — the nightly Jobber sync won&apos;t overwrite fields you&apos;ve corrected. Inbound calls and texts still auto-create contacts on first contact, so the list keeps growing on its own.</Note>
      </Section>

      <Section title="Calling from Contacts">
        <p>The detail sheet has a green <strong className="text-white">📞 Call</strong> button that jumps to the Dialer with the number pre-filled. Tap the green Call button there to actually dial. The call gets logged with the contact&apos;s name attached so it shows up nicely in Recent and Call Log later.</p>
      </Section>

      <Section title="Managing tags (admin)">
        <p>Tag definitions live at <strong className="text-white">Admin → Contacts</strong>. Only admins (or anyone with the <strong className="text-white">Contacts</strong> admin grant) can create, rename, recolor, or delete tags.</p>
        <p>Each tag has a label and a color. The color shows up everywhere the tag does — filter chips, contact rows, the edit sheet. Pick from the suggested swatches or use the custom color picker.</p>
        <p>Deleting a tag that&apos;s in use shows a confirmation with the count of affected contacts. It removes the tag from those contacts but doesn&apos;t delete the contacts themselves.</p>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// CALL LOG
// ──────────────────────────────────────────────────────────────────────────

function CallLogTab() {
  return (
    <>
      <Section title="What It Does">
        <p>Call Log brings all of your calls together in one list — live calls placed and received through the Dialer alongside the older recorded calls from the previous phone system. Every row is tagged with its source (a small <strong className="text-white">Dialer</strong> or <strong className="text-white">Unitel</strong> pill) so you always know where a call came from. New Dialer calls appear on their own within a minute or two of the call ending.</p>
        <p className="mt-3"><strong className="text-white">Turn a call into a lead (Beta).</strong> Open any call and tap <strong className="text-white">+ Add to Lead Tracker</strong> in the top-right of its detail. The caller&apos;s name and number carry over, and the call&apos;s AI summary and action items are pre-filled as the first note. Pick a stage and save — it lands in the <Link href="/hub/tracker" className="text-sky-400 hover:underline">Lead Tracker</Link> and the caller is added to Contacts. Once added the button shows <strong className="text-white">✓ In tracker</strong>, and adding the same call twice won&apos;t create a duplicate. This is a <strong className="text-white">Beta feature</strong> — enable it under <strong className="text-white">Settings → Beta Features</strong>.</p>
      </Section>

      <Section title="Browsing Calls">
        <p><strong className="text-white">Filters</strong> — narrow the list by date range, phone number, or a keyword found in the transcript, and (when more than one rep has calls) filter by rep. All filters stack; tap <strong className="text-white">Search</strong> to apply the date/phone/keyword filters or <strong className="text-white">Clear</strong> to reset.</p>
        <p>The list is sorted newest first, with both sources interleaved by date.</p>
      </Section>

      <Section title="Call Detail & Audio">
        <p>Click any call in the list to open its detail panel (on mobile the detail slides in — use <strong className="text-white">Back</strong> to return to the list):</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Audio player</strong> — play the recording directly in the browser. Click the progress bar to seek. Missed calls show the voicemail recording and its transcript instead.</li>
          <li><strong className="text-white">AI summary</strong> — a short paragraph describing what happened on the call, plus any follow-up action items the AI picked out.</li>
          <li><strong className="text-white">Transcript</strong> — the full speaker-labeled transcript, collapsible.</li>
        </ul>
        <Note>Older calls (from before AI transcription was turned on) still show basic info and audio, but may not have a summary or transcript.</Note>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// MARKETING
// ──────────────────────────────────────────────────────────────────────────

function MarketingTab() {
  return (
    <>
      <Section title="The Marketing section">
        <p>All marketing channels live under one roof. Open <strong className="text-white">Marketing</strong> (the megaphone icon in your app drawer) to reach the overview, then pick a channel from the cards or the Marketing sidebar: <strong className="text-white">Email</strong>, <strong className="text-white">Drip</strong>, and <strong className="text-white">Social</strong>. The Marketing sidebar stays with you as you move between channels, with admin shortcuts at the bottom for anyone with admin access.</p>
      </Section>
      <Section title="Social Posting">
        <p>Schedule Facebook and Instagram posts directly from Hub Files photos — without leaving Lynxedo.</p>
        <p className="mt-2">Navigate to <strong className="text-white">Marketing → Social</strong> from your app drawer to access the queue.</p>
      </Section>
      <Section title="Creating a Post">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Click <strong className="text-white">New Post</strong> in the top-right.</li>
          <li>Select which accounts to post to — check Facebook (FB) and/or Instagram (IG) for each connected account.</li>
          <li>Optionally pick a photo from Hub Files. Photos tagged <em>Social Media</em> appear first with &ldquo;Social queue only&rdquo; checked.</li>
          <li>Write your caption, or click <strong className="text-white">✦ Generate Caption</strong> to have AI draft one based on the photo, service type, and content pillar.</li>
          <li>Set the schedule date and time, then click <strong className="text-white">Schedule</strong> (or <strong className="text-white">Save Draft</strong> to hold it).</li>
        </ol>
      </Section>
      <Section title="AI Caption Generator">
        <p>The Generate Caption button calls Claude with your selected photo and settings to draft a platform-appropriate caption with hashtags. Choose:</p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li><strong className="text-white">Service type</strong> — Fertilization, Irrigation, Doody Duty, Aeration, Team, etc.</li>
          <li><strong className="text-white">Content pillar</strong> — Show the Work, Educate, Engage, or Soft Sell</li>
        </ul>
        <p className="mt-2">Review and edit before scheduling — it&apos;s a starting draft, not a final post.</p>
      </Section>
      <Section title="Queue View">
        <p>The main Social page shows all posts with status chips: <strong className="text-white">Draft</strong>, <strong className="text-white">Scheduled</strong>, <strong className="text-white">Published</strong>, or <strong className="text-white">Failed</strong>.</p>
        <p className="mt-2">Use the filter tabs to narrow by status. Draft and Scheduled posts can be edited or deleted.</p>
      </Section>
      <Section title="Automatic Publishing">
        <p>A background task runs every minute and publishes any post whose scheduled time has arrived. No manual action needed — just schedule and it posts itself.</p>
        <p className="mt-2">If a post fails (e.g. an expired token), the status shows <strong className="text-white">Failed</strong> with the error. Reconnect your accounts in Admin → Marketing, then edit the post to reschedule.</p>
      </Section>
      <Section title="Admin: Connecting Accounts">
        <p>Admins with Marketing Admin access can connect accounts at <strong className="text-white">Admin → Marketing</strong> (or via the Admin link in the Marketing sidebar section).</p>
        <p className="mt-2"><strong className="text-white">Facebook + Instagram:</strong> Click <strong className="text-white">Connect Facebook Accounts</strong> — you&apos;ll be redirected to Facebook to approve the connection. Lynxedo detects any linked Instagram Business accounts automatically. Facebook page tokens last ~60 days and auto-renew weekly via cron.</p>
      </Section>
      <Section title="Access">
        <p>Marketing access is controlled per-user in <strong className="text-white">Admin → People → Tools</strong>. Admin access (to connect accounts and manage settings) is a separate <em>Marketing Admin</em> grant.</p>
      </Section>

      <Section title="Email Marketing (new)">
        <p>Open <strong className="text-white">Marketing → Email</strong> to reach the new in-Hub email module. The page has five tabs: <strong className="text-white">Overview</strong>, <strong className="text-white">Templates</strong>, <strong className="text-white">Segments</strong>, <strong className="text-white">Campaigns</strong>, and <strong className="text-white">Automations</strong>.</p>
        <p className="mt-2"><strong className="text-white">Templates (block composer).</strong> Reusable email designs you build by stacking <strong className="text-white">blocks</strong> — no code. Give the template a name + subject, then <em>+ Add block</em>: <strong className="text-white">Header</strong> (upload your logo + pick a background color), <strong className="text-white">Text</strong>, <strong className="text-white">Image</strong> (upload a picture, optionally link it), <strong className="text-white">Button</strong> (label, link, colors), <strong className="text-white">Divider</strong>, and <strong className="text-white">Spacer</strong>. Each block has its own color / background / alignment / size controls, and <em>⚙ Page</em> sets the overall background and width. Reorder with ↑ ↓, duplicate with ⧉, delete with ✕. To reuse a whole template as a starting point, hit <strong className="text-white">Duplicate</strong> on it in the list — you get a <em>“Copy of …”</em> opened ready to tweak.</p>
        <p className="mt-2"><strong className="text-white">Text blocks are a normal rich-text editor</strong> — just type. Use the <strong className="text-white">B</strong> / <em>I</em> / <u>U</u> buttons (or ⌘B / ⌘I / ⌘U) to format as you go, add bulleted or numbered lists, insert a link (🔗), or pick an emoji (😊). Drop in <strong className="text-white">merge fields</strong> — <code className="text-gray-300">{'{{first_name}}'}</code>, <code className="text-gray-300">{'{{last_name}}'}</code>, <code className="text-gray-300">{'{{email}}'}</code> — with the Insert buttons; they fill in per-recipient at send time.</p>
        <p className="mt-2"><strong className="text-white">Images &amp; logos</strong> are uploaded right in the composer (JPEG/PNG/GIF/WebP, up to 5 MB) and hosted for you, so they load reliably in inboxes. Switch to the <em>Preview</em> tab to see the finished email with sample values, or <em>Send test to myself</em> to get it in your own inbox (subject prefixed <em>[TEST]</em>, merge fields filled with your name).</p>
        <p className="mt-2"><strong className="text-white">Segments.</strong> A saved audience — who an email goes to. Each segment is a filter over the Contacts directory: choose tags it <strong className="text-white">must have</strong> and/or tags it <strong className="text-white">must not have</strong>. A segment with no tag rules means <strong className="text-white">everyone subscribed</strong>. As you build, the editor shows a live <strong className="text-white">≈ N recipients</strong> count. Every segment automatically excludes anyone unsubscribed, bounced, or on the suppression list. Tag chips light up as Jobber/Mailchimp tags land in the shared tag system. You can also filter by the Jobber <strong className="text-white">services</strong> a customer&apos;s account has bought — pick a whole department (Weed &amp; Fert, Irrigation, Pet Waste, …) or a specific line item, for both &ldquo;must have&rdquo; and &ldquo;must not have.&rdquo; Service rules read each customer&apos;s <em>job</em> line items and only apply to contacts linked to a Jobber account. (Example: &ldquo;has Weed &amp; Fert (all) but not the PHC add-on.&rdquo;) By default a service rule counts <strong className="text-white">only customers who currently have that service</strong> (it&apos;s on an active, non-archived job) — so someone who cancelled PW but still has another service won&apos;t match a &ldquo;buys PW&rdquo; rule. Uncheck <em>Only customers who currently have the service</em> to instead match anyone who&apos;s <em>ever</em> had it. You can also filter by <strong className="text-white">customer status</strong> — <em>All customers</em>, <em>Active only</em> (excludes cancelled/archived Jobber customers), or <em>Archived only</em> (for win-back campaigns); imported contacts with no Jobber account count as active. To see exactly who a segment resolves to, click <strong className="text-white">View</strong> on any saved segment (or <strong className="text-white">View contacts</strong> while editing) — it lists every matching person by name and email, searchable.</p>
        <p className="mt-2"><strong className="text-white">Campaigns (one-off blasts).</strong> A campaign is an email you build and send. In the Campaigns tab, hit <em>+ New campaign</em>: optionally <strong className="text-white">start from a template</strong> (it loads that design into the editor as a starting point — your template stays untouched), then <strong className="text-white">customize the email right here</strong> in the same block editor you use for templates (text, images, buttons, colors, merge fields). Set the subject, then pick who it goes to. The audience is <strong className="text-white">composable — combine any of these and duplicates are removed automatically</strong>, so nobody gets the same email twice: tick <strong className="text-white">Everyone</strong> (all subscribed), and/or check <strong className="text-white">one or more segments</strong>, and/or <strong className="text-white">add specific contacts</strong> (search by name or email), and/or paste <strong className="text-white">other email addresses</strong> into the box (one per line or comma-separated) to reach people who aren&apos;t contacts at all — those typed-in addresses are sent to as a one-off and are <em>not</em> saved to your contacts. You&apos;ll see a live <strong className="text-white">≈ N recipients</strong> count (already de-duplicated across everything you picked), and you can <em>Send test to myself</em> before launching. Hit <strong className="text-white">Review recipients</strong> to see the actual contact list — everyone&apos;s checked by default; uncheck anyone you want to drop from <em>this</em> send, without changing the saved segments. <strong className="text-white">Not ready to send? Hit <em>Save draft</em></strong> — it keeps the email and the audience you picked but sends nothing. Drafts show in the list with an <em>Edit</em> button; reopen, change anything, and send (or save again) whenever you&apos;re ready. A draft&apos;s audience is re-checked the moment you actually send, so it always goes to the current list. So the typical flow is: keep a few clean base templates, then for each send start from one, tweak it for this campaign, choose the audience, and go. Choose <strong className="text-white">Send now</strong> or <strong className="text-white">Schedule</strong> a date/time. Sends go out steadily in the background (throttled, never all at once), and the campaign row shows a live progress bar with <em>sent / failed / skipped</em> counts. Every email automatically carries a one-click unsubscribe and your mailing address (CAN-SPAM), and anyone unsubscribed or suppressed is skipped — even if they opt out <em>after</em> the campaign is queued. Hit <strong className="text-white">Stop</strong> to halt a campaign that&apos;s still sending (remaining recipients are skipped), or <strong className="text-white">Remove</strong> to clear a finished one from the list.</p>
        <p className="mt-2"><strong className="text-white">Campaign reports (delivery + opens + clicks).</strong> Hit <strong className="text-white">Report</strong> on any campaign to see how it did: <em>delivered</em>, <em>opened</em> (with rate), <em>clicked</em> (with rate), <em>bounced</em>, <em>complaints</em>, and <em>unsubscribed</em>, plus a recent-recipients list. These fill in automatically as the email provider reports back what happened. A <strong className="text-white">hard bounce or spam complaint adds that address to the suppression list automatically</strong> — protecting your sending reputation so future emails keep landing in inboxes. <em>(Tip: open rates run a little high because some mail apps pre-load images; click rate is the more reliable engagement number.)</em></p>
        <p className="mt-2"><strong className="text-white">Automations (drip + tag-triggered, on autopilot).</strong> An automation is a journey a contact walks automatically. In the Automations tab, hit <em>+ New automation</em>, give it a name, and pick a <strong className="text-white">trigger</strong> — <em>a new customer is added</em>, <em>a contact gets a tag</em>, or <em>manual</em>. Then build the <strong className="text-white">steps</strong>: stack <em>Send email</em> (pick a template) and <em>Wait</em> (N days) in order. A classic welcome drip is <em>Send</em> → <em>Wait 3 days</em> → <em>Send</em> → <em>Wait 7 days</em> → <em>Send</em>. Save it as a <strong className="text-white">draft</strong>, then <strong className="text-white">Activate</strong> when ready — only active automations enroll and send. The <em>new customer</em> trigger only enrolls people added <em>after</em> you activate (it won&apos;t blast your whole existing list); a <em>tag</em> trigger enrolls anyone who has that tag. A contact enters a given automation once. <strong className="text-white">Pause</strong> freezes everyone in place; reactivating resumes them. Hit <strong className="text-white">Monitor</strong> to see who&apos;s enrolled, what step they&apos;re on, and the active/completed counts. Every send respects unsubscribes + the suppression list, exactly like campaigns.</p>
        <p className="mt-2"><strong className="text-white">Sending identities &amp; choosing a domain.</strong> You can send from <strong className="text-white">more than one domain</strong> — for example your own brand domain for important mail and a secondary domain for everyday sends (sending steady, lower-stakes volume from a secondary domain builds its reputation over time). Set these up in <strong className="text-white">Admin → Email Marketing</strong> under <em>Sending identities</em>: each identity is a From address + Reply-To on a domain that&apos;s verified in Resend (SPF/DKIM DNS records). Add one, paste its Resend <em>domain id</em>, then click <strong className="text-white">Refresh</strong> until it reads <em>Verified</em> — a send from an unverified domain won&apos;t deliver. Mark one as the <strong className="text-white">Default</strong> (it&apos;s the one pre-selected on new campaigns and automations). The company <strong className="text-white">mailing address</strong> (the CAN-SPAM footer) is set once and applies to every identity.</p>
        <p className="mt-2"><strong className="text-white">Send from (per campaign / automation).</strong> When you build a campaign — or an automation — a <strong className="text-white">Send from</strong> picker lets you choose which verified domain that send goes out on. It defaults to your default identity, so you only change it when you want to (e.g. switch an important announcement to your brand domain). Automations use one identity for every email in the sequence. <em>Send test to myself</em> uses whichever identity you&apos;ve picked, so you can preview each domain before sending for real.</p>
        <p className="mt-2"><strong className="text-white">Contacts &amp; import.</strong> Email now runs off the one central <strong className="text-white">Contacts directory</strong> — the same address book the rest of the Hub uses. The email audience is simply every contact that has an email and is still subscribed (minus the suppression list). <strong className="text-white">Jobber customers are already in the directory</strong> (with their tags), so there&apos;s nothing to sync by hand for them. For your Mailchimp-only contacts and opt-outs, export your Mailchimp audience (Audience → All contacts → Export) and upload each file (subscribed / unsubscribed / cleaned) with <em>Import Mailchimp CSV</em>. The importer dedupes on email against the directory (so a customer who&apos;s also in Mailchimp is merged into their existing record, not duplicated), files the Mailchimp <em>TAGS</em> into the shared tag system, and routes unsubscribed + cleaned addresses straight to the suppression list. Every import shows a created / merged / suppressed / skipped summary.</p>
        <p className="mt-2"><strong className="text-white">Unsubscribes are permanent.</strong> Every marketing email carries a one-click unsubscribe; anyone who opts out (or hard-bounces, or marks spam) is added to the suppression list and skipped on every future send — campaigns and automated sequences alike.</p>
        <AdminOnly>Access is per-user via <strong className="text-white">Admin → People → Tools → Email Marketing</strong>; managing sending identities (domains), contacts, and imports is the separate <em>Email Marketing</em> admin grant.</AdminOnly>
      </Section>

      <Section title="Drip (speed-to-lead follow-up)">
        <p>Open <strong className="text-white">Marketing → Drip</strong> to reach new leads the moment they arrive and follow up automatically. The idea: whoever answers a lead first usually wins it — so instead of waiting for someone to notice a new lead, Drip reaches out within a couple minutes (by <strong className="text-white">text</strong> or <strong className="text-white">email</strong>), then a few more times over the next days if they don&apos;t respond. The instant the lead replies, the sequence <strong className="text-white">stops automatically</strong> so a real person can take over.</p>
        <p className="mt-2"><strong className="text-white">Build a campaign.</strong> Hit <em>+ New campaign</em>, give it a name, and pick a <strong className="text-white">trigger</strong> — <em>Any new lead</em> (every new lead, from any source), <em>A specific lead source</em> (e.g. only <em>Angi Lead</em> — type the source exactly as it appears on the lead), <em>When a lead moves to a stage</em> (e.g. kick off a follow-up when you drag a lead to <em>Quoted</em>), or <em>Manual</em>. Then add your <strong className="text-white">steps</strong> — each step is a <strong className="text-white">text</strong> or an <strong className="text-white">email</strong>: the first one <em>sends immediately</em>; for each follow-up, set how long to <em>wait</em> (hours or days) before it goes out. Use <code className="text-gray-300">{'{{first_name}}'}</code> to personalize (email steps also take a subject line). A classic sequence is: <em>send now</em> → <em>wait 1 hour</em> → <em>wait 1 day</em> → <em>wait 3 days</em>.</p>
        <p className="mt-2"><strong className="text-white">Draft → Activate.</strong> New campaigns save as a <strong className="text-white">draft</strong> and do nothing until you <strong className="text-white">Activate</strong> them. Activating only enrolls leads that arrive <em>after</em> that moment — it won&apos;t contact your existing leads. <strong className="text-white">Pause</strong> freezes everyone in place; <strong className="text-white">Monitor</strong> shows who&apos;s enrolled, which step they&apos;re on, and how many have replied or finished.</p>
        <p className="mt-2"><strong className="text-white">Replies come into the Queue.</strong> While a lead is being nurtured the drip thread stays tucked away (archived) — you watch progress on the Lead Tracker Board, and the Txt inbox stays quiet. The moment the lead texts (or calls) back, their sequence <strong className="text-white">stops</strong> and the conversation pops into the shared <strong className="text-white">Txt Queue</strong> for a human to take over. Texting <em>STOP</em> opts them out entirely. Every first text includes the business name and a &ldquo;Reply STOP to opt out&rdquo; line, and nothing sends outside <strong className="text-white">quiet hours</strong>.</p>
        <p className="mt-2"><strong className="text-white">Work your leads on the Tracker.</strong> Open the <strong className="text-white">Lead Tracker</strong> to see every lead three ways: a <strong className="text-white">Board</strong> of drag-and-drop cards (color-coded by where each lead is in its drip, with a one-tap text button), a <strong className="text-white">Table</strong> (the classic list), and <strong className="text-white">Needs me</strong> (just the leads waiting on a person — e.g. anyone who replied). When a lead replies, its card moves itself to <em>Responded</em> so nothing slips through.</p>
        <p className="mt-2"><strong className="text-white">Settings.</strong> The <em>Settings</em> button sets the defaults for all campaigns: <strong className="text-white">who texts are sent as</strong> (by default your assistant <strong className="text-white">Amber</strong> — automated texts come from &ldquo;Amber&rdquo; and are signed with her name, so a teammate&apos;s personal name never rides on one; you can point it at a real teammate instead), <strong className="text-white">quiet hours</strong> (default 8am–8pm, messages due outside the window wait until it opens), a <strong className="text-white">max messages per lead per day</strong> cap, and your <strong className="text-white">business name</strong>.</p>
        <AdminOnly>Access is per-user via <strong className="text-white">Admin → People → Tools → Drip Marketing</strong>.</AdminOnly>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// BOOKS
// ──────────────────────────────────────────────────────────────────────────

function BooksTab() {
  return (
    <>
      <Section title="What It Is">
        <p>Books is the company financial dashboard, pulled live from QuickBooks Online. It shows YTD revenue, cost trends, monthly P&amp;L, and overhead — all in one place.</p>
        <Note>🔒 Books is restricted. You need permission to access it, and even then it&apos;s gated by a PIN. Ask Ben if you should have access.</Note>
      </Section>

      <Section title="What&apos;s on the Dashboard">
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">YTD strip</strong> — year-to-date revenue, expenses, and net income at a glance</li>
          <li><strong className="text-white">Monthly P&amp;L chart</strong> — revenue vs. expenses by month for the current year</li>
          <li><strong className="text-white">Month comparison cards</strong> — current month vs. prior months, with deltas</li>
          <li><strong className="text-white">Cost trend</strong> — biggest expense categories trending over time</li>
          <li><strong className="text-white">Overhead</strong> — fixed monthly overhead broken out</li>
        </ul>
      </Section>

      <Section title="Refreshing the Numbers">
        <p>Books caches data from QuickBooks to keep it fast. Click <strong className="text-white">Refresh</strong> (top right) to pull the latest. The header shows the time of the most recent refresh in CT.</p>
        <p>If the refresh fails, the page shows a red error message — usually QuickBooks needs to be reconnected. Tell Ben.</p>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// TIMESHEET
// ──────────────────────────────────────────────────────────────────────────

function TimesheetTab() {
  return (
    <>
      <Section title="Clocking In and Out">
        <p>Open Timesheet from the Hub sidebar (or use the clock icon at the top of Hub).</p>
        <Step n={1}>Tap <strong className="text-white">Clock In</strong> when you start your shift. Lynxedo records the time — no location prompt.</Step>
        <Step n={2}>Add a note if you want (start-of-shift conditions, crew, anything noteworthy).</Step>
        <Step n={3}>Tap <strong className="text-white">Clock Out</strong> when you&apos;re done. You&apos;ll see your total hours for the shift and the week.</Step>
        <Note>🌙 <strong className="text-white">Forgot to clock out?</strong> If a shift is left running for more than 14 hours, Lynxedo automatically clocks you out overnight so a forgotten punch doesn&apos;t balloon into a giant shift. It caps the shift at 14 hours, notes <em>&ldquo;Auto clock-out after 14h — please verify&rdquo;</em> on the record, and sends you a heads-up so you can fix the real end time if it&apos;s wrong.</Note>
      </Section>

      <Section title="Your Week View">
        <p>Under the clock buttons, your shifts for the current week are listed with the date, in/out times, and total hours. The header shows:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Hours this week</strong> — total clocked time so far</li>
          <li><strong className="text-white">Overtime</strong> — anything past 40 hours, highlighted</li>
        </ul>
        <p>Use the date arrows to look at past weeks.</p>
      </Section>

      <Section title="Linking Your Gusto Account">
        <p>If your timesheet page says <strong className="text-white">Account Not Linked</strong>, your Lynxedo account hasn&apos;t been connected to a Gusto employee record yet. Ask Ben — admins link accounts under Admin → Time Records.</p>
      </Section>

      <Section title="Admin — Time Records">
        <AdminOnly>
          <p>Admins manage all timesheet data at <strong className="text-white">/admin/timesheet</strong> (also reachable from <strong className="text-white">Time Records</strong> in your app drawer).</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li>Review every employee&apos;s shifts for the pay period</li>
            <li><strong className="text-white">Edit one day at a time</strong> — on the Summary tab, expand an employee and click <strong className="text-white">✎ Edit</strong> on a day. The Clock In / Clock Out / reason editor opens right there on that day&apos;s row — no popup listing the whole week&apos;s punches.</li>
            <li>Add manual shifts for missed days</li>
            <li><strong className="text-white">Departed employees still appear</strong> — if you deactivate someone, they still show up in (and export to the Gusto CSV for) any pay period where they had clocked hours, so a final week is never dropped from payroll.</li>
          </ul>
          <p className="mt-3"><strong className="text-white">Roster tab:</strong> every field on an employee — name, email, phone, title, department, pay type, $/hr — is edited directly here with the <strong className="text-white">✎ Edit</strong> button. You never need Gusto to change someone&apos;s rate. People get ON the roster via the <strong className="text-white">Employee Roster</strong> toggle on their person in Admin → People (Gusto never adds anyone). Use the <strong className="text-white">Active / Deactivated / All</strong> filter to see archived employees.</p>
          <p className="mt-3"><strong className="text-white">Match with Gusto:</strong> after connecting Gusto once (<strong className="text-white">Connect Gusto</strong> button, admins only), the <strong className="text-white">Match with Gusto</strong> button compares the roster to Gusto and shows a review screen — each difference (title, department, pay type, rate) is a checkbox you approve or skip. Nothing changes without your approval, and Gusto never adds or removes anyone from the roster. People in Gusto who aren&apos;t on the roster (or vice-versa) are listed as FYIs.</p>
          <p className="mt-3"><strong className="text-white">Built-in guards against bad times:</strong> a day won&apos;t save if the clock-out isn&apos;t after the clock-in (catches an AM/PM mix-up, like 3:40 <em>am</em> instead of 3:40 <em>pm</em>), or if a single shift would run over 24 hours. A yellow heads-up also appears for any time before 5 AM or a shift longer than 16 hours so you can double-check before saving.</p>
          <Note>Overtime is calculated <strong className="text-white">weekly</strong> — anything over 40 hours in the Mon–Sun week — not per day. A 10-hour day on its own is all regular time; OT only kicks in once the week passes 40.</Note>
        </AdminOnly>
      </Section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────────────────────────────

function SettingsTab() {
  return (
    <>
      <Section title="Settings Overview">
        <p>The <Link href="/settings" className="text-orange-400 hover:text-orange-300">Settings</Link> page has a sidebar with these sections:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Profile</strong> — your name, photo, phone number, sign out</li>
          <li><strong className="text-white">My Hub</strong> — your theme, plus customize your icon rail and mobile bottom bar (show only what you use, in your order)</li>
          <li><strong className="text-white">Notifications</strong> — your notification level, the three Do&nbsp;Not&nbsp;Disturb tiers (Master / Hub / Calls), and your push devices</li>
          <li><strong className="text-white">Browser Extension</strong> — connect the Lynxedo browser extension</li>
          <li><strong className="text-white">Account</strong> — communications (signature, ring &amp; voicemail settings), change password, delete account</li>
        </ul>
      </Section>

      <Section title="Signing In">
        <p>There are two ways to sign in at <Link href="/login" className="text-orange-400 hover:text-orange-300">lynxedo.com/login</Link>:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Sign in with Google</strong> — fastest if you have a Heroes Lawn Google account. One click and you&apos;re in.</li>
          <li><strong className="text-white">Email code</strong> — enter your email, hit <strong className="text-white">Send code</strong>, and we&apos;ll email you a 6-digit code. Type it on the same screen and you&apos;re in.</li>
        </ul>
        <p>Both methods land you on the same account — you can switch back and forth whenever you want. Codes expire in 1 hour, and if you mistype one just hit <strong className="text-white">Send code</strong> again for a fresh one.</p>
        <Note>The email code replaces the old &ldquo;click this link&rdquo; sign-in email — much friendlier on phones, because the code goes into the same browser or app you started in.</Note>
      </Section>

      <Section title="Profile">
        <p><strong className="text-white">Email</strong> — read-only, the address you sign in with.</p>
        <p><strong className="text-white">Full name</strong> — your legal name. Used on payroll and admin views.</p>
        <p><strong className="text-white">Display name</strong> — how you appear in Hub. This is what your teammates see on every message.</p>
        <p><strong className="text-white">Phone</strong> — optional, helps admins reach you.</p>
        <p><strong className="text-white">Profile photo</strong> — click the avatar to upload. You can crop after uploading.</p>
        <p>Use the <strong className="text-white">Sign out</strong> link here when you&apos;re done on a shared device.</p>
      </Section>

      <Section title="My Hub — your rail &amp; bottom bar">
        <p>Make the icon rail (and the phone bottom bar) your own — show only the tools you use, in the order you want. Tap <strong className="text-white">Customize my Hub</strong> to add or remove apps and reorder them. The fourth slot on the phone bottom bar is whichever app you pick here.</p>
        <Note>You can open the same editor any time from the <strong className="text-white">Apps&nbsp;▦</strong> button on the rail → <strong className="text-white">Customize</strong>.</Note>
      </Section>

      <Section title="Connecting Jobber &amp; other integrations">
        <p>Connecting your outside tools — Jobber, QuickBooks, Gusto, OneStepGPS (fleet GPS), Angi, Facebook &amp; Instagram, and more — now lives in one place: <Link href="/hub/admin/integrations" className="text-orange-400 hover:text-orange-300">Admin → Integrations</Link> (available to admins and anyone with the Integrations admin grant). Open a card, click <strong className="text-white">Connect</strong>, and follow the steps.</p>
        <Note>⚠️ If visits aren&apos;t loading in the Route Optimizer, open Admin → Integrations and check that Jobber shows <span className="text-emerald-400 font-medium">Connected</span>. If not, reconnect — the OAuth token occasionally needs a refresh.</Note>
      </Section>

      <Section title="Inbound automation keys">
        <p>At the bottom of <Link href="/hub/admin/integrations" className="text-orange-400 hover:text-orange-300">Admin → Integrations</Link> is an <strong className="text-white">Inbound automation keys</strong> section. These work the opposite way from the connection cards above them: instead of Lynxedo reaching out to another tool, an inbound key lets an outside service — Zapier, a script, an auto-poster — securely push messages <strong className="text-white">into</strong> your Hub.</p>
        <p className="mt-2">Click <strong className="text-white">Create a key</strong>, give it a name (e.g. &ldquo;Zapier&rdquo;), and copy the key <strong className="text-white">right away</strong> — it&apos;s shown only once. The outside service then sends messages with that key in its <code className="text-green-400">Authorization</code> header. Revoke any key immediately if it&apos;s lost or no longer needed.</p>
        <Note>Available to admins and anyone with the <strong className="text-white">Integrations</strong> admin grant — the same access as the rest of the Integrations page.</Note>
      </Section>

      <Section title="Browser Extension">
        <p>The Lynxedo browser extension scans the web page you&apos;re on for contacts and lets you add them to your directory, add them to the Lead Tracker, text them, or dial them — without leaving the page. It also shows an <strong className="text-white">In Hub</strong> badge on anyone already in your directory, so you don&apos;t create duplicates. To connect it, just click <strong className="text-white">Sign in with Lynxedo</strong> in the extension — if you&apos;re already logged into Lynxedo in that browser it connects instantly; otherwise you log in once and you&apos;re set. No copying or pasting.</p>
        <p><strong className="text-white">Advanced:</strong> you can also connect by generating a token under <strong className="text-white">Settings → Browser Extension</strong> and pasting it into the extension&apos;s Advanced settings. Tokens are shown <strong className="text-white">only once</strong> and act as you, so treat them like a password. However you connected, each device shows up in this list — click <strong className="text-white">Revoke</strong> to cut off a lost or retired one immediately.</p>
        <Note>Contacts added from the extension are textable by default, the same as leads and Jobber contacts — your company is responsible for having consent before texting.</Note>
      </Section>

      <Section title="Account — Delete Account">
        <p>At the bottom of <strong className="text-white">Settings → Account</strong> there&apos;s a <strong className="text-red-400">Delete account</strong> option. It permanently deletes your Lynxedo account — your login and personal profile are removed, you&apos;re signed out, and you can&apos;t sign back in.</p>
        <p>You&apos;ll be asked to confirm before anything happens. <strong className="text-white">This cannot be undone.</strong></p>
        <Note>⚠️ Lynxedo is a team tool — deleting your account is the same as an admin removing you in Admin → People. If you just want to step away from a shared device, use <strong className="text-white">Sign out</strong> instead (Settings → Profile).</Note>
      </Section>

      <Section title="Notifications — Default notification level">
        <p>Controls all Hub notifications (web push and native app).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Everything</strong> — notify me for all messages in rooms I belong to</li>
          <li><strong className="text-white">Mentions + DMs only</strong> — only when I&apos;m @mentioned or someone DMs me</li>
          <li><strong className="text-white">Nothing</strong> — mute everything (including mentions and DMs)</li>
        </ul>
      </Section>

      <Section title="Notifications — This device (push)">
        <p>At the bottom of the Notifications section there&apos;s a <strong className="text-white">&ldquo;This device&rdquo;</strong> block showing whether the current device is registered to receive push notifications, with two buttons:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Send test notification</strong> — fires a real push to every device you&apos;re subscribed on, and (in a browser, if the sound toggle below is on) immediately plays the new-message chime so you can check the sound too. Use this to verify a device actually surfaces notifications. Make sure Hub isn&apos;t the focused window, otherwise the OS may suppress the banner (Slack works the same way). Note: the push banner and the in-app chime are separate — the chime also plays on its own whenever a real message arrives while a Hub tab is open.</li>
          <li><strong className="text-white">Reset notifications on this device</strong> — if pushes stop arriving on a device that used to get them, tap this. It clears the stale subscription, asks for permission again, and registers fresh. Per platform: web/PWA does the full reset; Android re-registers the FCM token; iOS Capacitor re-runs the push registration; the Mac/Windows desktop app uses a different mechanism and doesn&apos;t need a reset (just quit and reopen the app if its notifications stop).</li>
        </ul>
        <p className="mt-3">In a web browser or PWA you&apos;ll also see a <strong className="text-white">&ldquo;Play a sound for new messages&rdquo;</strong> toggle. When it&apos;s on, Hub plays a short chime on this device <em>whenever a new message arrives and a Hub tab is open in that browser</em> — whether you&apos;re looking at Hub or working in another tab or app. It respects your mute / mentions-only / Do Not Disturb settings and is remembered per device (turn it on at your desk, leave it off on a shared machine). It only works while a Hub tab is open in that browser; once the browser is fully closed, the regular push notification takes over. Flipping it on plays a quick preview so you know what it sounds like.</p>
        <Note>If the status badge says &ldquo;Blocked in browser settings,&rdquo; the browser itself has blocked notifications for lynxedo.com. Open the browser&apos;s site settings for lynxedo.com and re-enable notifications, then come back here and tap Reset.</Note>
      </Section>

      <Section title="Notifications — Do Not Disturb (three tiers)">
        <p>The <strong className="text-white">Notifications</strong> tab has three independent Do&nbsp;Not&nbsp;Disturb switches, so you can silence exactly as much as you want:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-red-400">Master DND</strong> — silences <em>everything</em>: calls, messages, and every push (including @-mentions). Overrides the other two.</li>
          <li><strong className="text-amber-300">Hub Notifications DND</strong> — silences chat/message pushes only. Calls still ring.</li>
          <li><strong className="text-amber-300">Calls DND</strong> — silences the dialer only (incoming calls, IVR transfers, ring groups). Messages still notify. <em>(Shown only if you have Dialer access.)</em></li>
        </ul>
        <p className="mt-3">Each tier can be flipped on right now, or put on a <strong className="text-white">per-day schedule</strong> — set a start and end time for each day of the week (e.g. 6 PM–8 AM, Mon–Fri). Overnight ranges that cross midnight work (set the start later than the end). Times use your device&apos;s local time zone.</p>
        <Note>DND is per-user — every teammate sets their own. Quick toggles for all three also live in your <strong className="text-white">You menu</strong> (tap your avatar at the bottom of the rail → <strong className="text-white">Do Not Disturb</strong>), so you don&apos;t have to open Settings each time. Setting your status to <strong className="text-white">Do Not Disturb</strong> there automatically turns on <strong className="text-red-400">Master DND</strong> (and clearing it turns Master DND back off).</Note>
      </Section>

      <Section title="Account — Change Password">
        <p>Use at least 8 characters. You&apos;ll stay signed in on this device after the change. If you forget your password, sign out and use the &ldquo;forgot password&rdquo; flow on the login page.</p>
      </Section>

      <Section title="Admin Access (Roles)">
        <p>Lynxedo has three roles:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">User</strong> — everyday access. Uses Hub and whichever tools are enabled on their account.</li>
          <li><strong className="text-white">Manager</strong> — gets access to specific admin areas. A manager only sees the admin tabs they&apos;ve been granted (e.g. just <em>Time Records</em>, or <em>Daily Log + Fleet</em>).</li>
          <li><strong className="text-white">Admin</strong> — full access to every admin area. Admins are the only ones who can change roles or grant manager access.</li>
        </ul>
        <AdminOnly>
          <p>To make someone a manager: in <strong className="text-white">Admin → People</strong>, pick the person from the dropdown, then change their role to <em>Manager</em>. An amber <strong className="text-white">Admin Access</strong> panel appears with toggles for each admin area. Flip on whichever areas they should be able to manage. Only true admins (role = Admin) see this panel, and only true admins can change role or grant access.</p>
        </AdminOnly>
      </Section>

      <Section title="Admin — People (managing a person)">
        <AdminOnly>
          <p><strong className="text-white">Admin → People</strong> works one person at a time: pick them from the dropdown (searchable), then manage everything on their panel — role, names, tool access toggles (grouped by area), admin grants, and the <strong className="text-white">Employee Roster</strong> toggle that puts them on (or takes them off) the timesheet roster. The <strong className="text-white">Active / Deactivated / All</strong> filter at the top controls who appears in the dropdown.</p>
          <p className="mt-3"><strong className="text-white">When someone leaves, there are two layers:</strong></p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li><strong className="text-white">🔒 Lock</strong> — immediate security cutoff. They can&apos;t sign in, push notifications stop, and the Dialer skips them in ring groups. They stay visible in People and on the roster (so you can still run their final pay period). Unlock reverses it.</li>
            <li><strong className="text-white">Deactivate</strong> — after the final paycheck. Sign-in stays blocked, they come off the Employee Roster, their Txt conversations transfer to the main admin, and they move under the <em>Deactivated</em> filter. Nothing is deleted — messages, calls, and punch history all stay. <strong className="text-white">Reactivate</strong> restores sign-in for a rehire (their old toggles are kept but review them, and re-enable the roster toggle yourself).</li>
          </ul>
          <p className="mt-3"><strong className="text-white">Remove</strong> only appears for accounts that never signed in (typos, tests) — anyone with real history must be deactivated instead, so nothing is lost. Locking or deactivating is available to admins and managers with People access; only full admins can act on another admin.</p>
        </AdminOnly>
      </Section>

      <Section title="Text Size (S / M / L)">
        <p>Open your account menu in the bottom-left of the Hub sidebar — there are three buttons labeled <strong className="text-white">S</strong>, <strong className="text-white">M</strong>, <strong className="text-white">L</strong> for text size.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">S</strong> — fits more on screen</li>
          <li><strong className="text-white">M</strong> — default</li>
          <li><strong className="text-white">L</strong> — easier to read, especially on phones</li>
        </ul>
        <p>The setting scales <em>everything</em> — message bubbles, the sidebar, Settings, Help, every tool — and it travels with your account, so it&apos;s the same on every device you sign in on.</p>
      </Section>

      <Section title="Choosing Your Theme">
        <p>Open your account menu (bottom-left of the Hub sidebar) and scroll to the <strong className="text-white">Theme</strong> section — or go to <strong className="text-white">Settings → My Hub</strong> for the full labeled list. Tap any option to instantly repaint the whole app. Your choice is saved to your account and syncs across every device.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Dark</strong> — Midnight (default), Carbon</li>
          <li><strong className="text-white">Light</strong> — Daylight, Blossom</li>
          <li><strong className="text-white">Hybrid</strong> (dark sidebar, light workspace) — Eclipse, Pine</li>
          <li><strong className="text-white">Glossy</strong> (frosted panels over a color gradient) — Aurora, Nebula, Tide, Obsidian, Ember Glass, Heroes Glass</li>
        </ul>
        <p>Everyone on your team can have their own theme — it&apos;s a personal preference and doesn&apos;t affect what other users see.</p>
      </Section>

      <Section title="Beta Features">
        <p>Beta features are new tools we&apos;re trying out with a few people before rolling them out to everyone. If an admin has given you the <strong className="text-white">Beta Features</strong> grant, a <strong className="text-white">Beta Features</strong> tab appears here in Settings.</p>
        <p className="mt-2">Each beta shows a short description (sometimes with a screenshot) and an on/off switch. Turn one on to start using it right away; turn it off any time to go back to normal. Betas are new, so they may change or have rough edges.</p>
        <p className="mt-2">Under each beta is a <strong className="text-white">Feedback</strong> box — tell us what&apos;s working, what&apos;s confusing, or what&apos;s broken, then hit <strong className="text-white">Send feedback</strong>. It goes straight to the team.</p>
        <Note>Don&apos;t see a Beta Features tab? Either no betas are open right now, or you don&apos;t have the grant yet — ask an admin. Admins manage the list of betas in <strong className="text-white">Admin → Beta</strong> and grant access per person in <strong className="text-white">Admin → People</strong>.</Note>
      </Section>
    </>
  )
}

function FormsTab() {
  return (
    <>
      <Section title="What are Forms?">
        <p>Forms is a customizable checklist and inspection tool. Your admin team builds forms in the <strong className="text-white">Form Builder</strong>, and field technicians fill them out from <strong className="text-white">Forms</strong> in their app drawer.</p>
        <p className="mt-2">Uses include after-service reports, irrigation inspection checklists, equipment sign-offs, and any other structured data you want to capture per job.</p>
      </Section>

      <Section title="Filling Out a Form">
        <ol className="list-decimal list-inside text-gray-400 space-y-2 ml-2">
          <li>Go to <strong className="text-white">Forms</strong> in your app drawer.</li>
          <li>Tap the form you want to fill out (e.g. <em>Irrigation Inspection Report</em>).</li>
          <li>Fill in each field — checkboxes, dates, short answers, dropdowns, etc.</li>
          <li>For the <strong className="text-white">signature field</strong>, draw directly on the canvas with your finger or stylus. Tap <em>Clear</em> to redo.</li>
          <li>Optionally enter the customer&apos;s name and phone number at the bottom. With both filled in, Lynxedo automatically texts them the after-service message when you submit (and falls back to a copy-paste message if it can&apos;t send).</li>
          <li>To link the submission to a Jobber client (so a note appears on their record), tap <strong className="text-white">Link to Jobber Client</strong>, search by name, and select the customer.</li>
          <li>Tap <strong className="text-white">Submit Form</strong>. The form saves to the database. If Jobber was linked, a formatted note is added to the client automatically.</li>
        </ol>
      </Section>

      <Section title="Texting the customer">
        <p>When you submit a form with the customer&apos;s name <em>and</em> phone number filled in, Lynxedo <strong className="text-white">automatically texts them</strong> the after-service message from the company number — you&apos;ll see a green <strong className="text-emerald-300">✓ Text sent to customer</strong> on the success screen. No copy-paste needed.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li>If the customer has <strong className="text-white">opted out of texts</strong> (replied STOP), nothing is sent and you&apos;ll see a note saying so.</li>
          <li>If the text <strong className="text-white">can&apos;t send automatically</strong> (no valid phone number, or texting isn&apos;t set up yet), the message still appears on the success screen with a <strong className="text-white">Copy message</strong> button so you can send it by hand.</li>
        </ul>
        <p className="mt-2">The admin can customize what this message says in the Form Builder (see below).</p>
      </Section>

      <Section title="Jobber Sync">
        <p>When you link a Jobber client before submitting, the form results are automatically posted as a <strong className="text-white">note on the Jobber client record</strong>. The note includes all answered fields, organized by section, plus who submitted it and when.</p>
        <p className="mt-2">If Jobber sync fails (e.g. you&apos;re not connected to Jobber), the form still saves locally. You&apos;ll see a warning on the success screen.</p>
      </Section>

      <AdminOnly>
        <Section title="Building a Form (Admin)">
          <p>Go to <strong className="text-white">Admin → Form Builder</strong> in the sidebar (or Admin → Form Builder from the admin nav).</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
            <li>Click <strong className="text-white">+ Irrigation Inspection</strong> to create the pre-built irrigation form, or <strong className="text-white">+ Blank Form</strong> to start from scratch.</li>
            <li>Click <strong className="text-white">Build</strong> on any form to open the builder.</li>
          </ul>
          <p className="mt-3">In the builder:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li><strong className="text-white">Section Title</strong> — a bold header that organizes fields into groups. Not a fillable field.</li>
            <li><strong className="text-white">Checkbox</strong> — yes/no item (e.g. &quot;System tested and functioning&quot;).</li>
            <li><strong className="text-white">Date</strong> — a date picker.</li>
            <li><strong className="text-white">Dropdown</strong> — a pick-one list. Add options by typing and pressing Enter or clicking +&nbsp;Add.</li>
            <li><strong className="text-white">Short Answer</strong> — a single-line text input.</li>
            <li><strong className="text-white">Long Answer</strong> — a multi-line textarea for notes.</li>
            <li><strong className="text-white">Signature</strong> — a touchscreen-friendly canvas for capturing a signature.</li>
          </ul>
          <p className="mt-3">Use <strong className="text-white">▲ / ▼</strong> to reorder fields. Mark a field <strong className="text-white">Req</strong> to make it required before submission.</p>
          <p className="mt-3">The <strong className="text-white">SMS Notification Template</strong> is the text message shown after submission. Use placeholders: <code className="text-sky-400">{'{customer_name}'}</code> <code className="text-sky-400">{'{tech_name}'}</code> <code className="text-sky-400">{'{date}'}</code> <code className="text-sky-400">{'{company_name}'}</code>.</p>
          <p className="mt-3">Toggle <strong className="text-white">Active / Inactive</strong> to control whether the form is visible to techs. Click <strong className="text-white">Save</strong> (or <em>Save Form</em> at the bottom) when done.</p>
        </Section>

        <Section title="Permissions">
          <p>Two toggles in <strong className="text-white">Admin → People → Tools</strong>:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-1">
            <li><strong className="text-white">Forms</strong> — allows the user to view and fill out forms. On by default for all new users.</li>
            <li><strong className="text-white">Form Builder</strong> (Admin Access section) — allows the user to create and edit forms in the Form Builder admin panel.</li>
          </ul>
        </Section>
      </AdminOnly>
    </>
  )
}

function ProductsTab() {
  return (
    <>
      <Section title="What is Products?">
        <p>Products is the master catalog of everything you apply — fertilizers, herbicides, fungicides, insecticides, and more — each with its price, package size, application rate, and on-hand inventory. It&apos;s the &ldquo;spreadsheet&rdquo; the cost numbers, inventory counts, route-capacity tool, and pesticide records all read from.</p>
        <p className="mt-2">It lives at <strong className="text-white">Admin → Products</strong> and is managed by admins (or anyone with the Products admin grant).</p>
      </Section>

      <Section title="Groups &amp; products">
        <p>The catalog is organized in two levels:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Group</strong> — the product type (Fertilizer, Insecticide, Fungicide…). Each group header collapses and expands.</li>
          <li><strong className="text-white">Product</strong> — one row per product <em>at a specific rate</em>. Because the same chemical is often used at different rates, each rate is its own row (e.g. <em>Acelepryn 0.1 rate</em> and <em>Acelepryn 0.2 rate</em> are separate products). Each row holds its price, package size, unit, application rate, EPA #, active ingredient, label link, batch info, and inventory.</li>
        </ul>
        <p className="mt-2">This matches your Products spreadsheet exactly — one line per priced, rated product — so what you see here is what feeds the pricing, route-capacity, and pesticide tools.</p>
      </Section>

      <Section title="Application rate &amp; rate basis">
        <p>Every product has an <strong className="text-white">application rate</strong> and a <strong className="text-white">rate basis</strong> — a dropdown set to either <em>per 1,000 sq ft</em> (most products) or <em>per gallon</em> (the DRF spray-mix products). Nothing is hardcoded: flip the basis on any product yourself in its expanded editor.</p>
      </Section>

      <Section title="Cost per 1,000 sq ft">
        <p>You never type the cost — it&apos;s calculated. From <strong className="text-white">package size ÷ rate</strong> the system works out how many 1,000-sq-ft a package covers, then <strong className="text-white">package price ÷ that</strong> gives the cost per 1,000 sq ft (shown with a <em>/1k</em> or <em>/gal</em> tag matching the basis). Update the price from your invoices and the cost updates automatically.</p>
      </Section>

      <Section title="Inventory by location">
        <p>Each storage location (Vehicle 1, Shop, North Shop…) is its own column. Type how many packages are at each location; the <strong className="text-white">Total</strong> and <strong className="text-emerald-300">$ Value</strong> columns add up automatically (total packages × package price).</p>
      </Section>

      <Section title="Automatic stock decrement &amp; low-stock alerts">
        <p>You don&apos;t have to subtract product by hand. When a route&apos;s <strong className="text-white">last stop is marked complete in Daily Log v2</strong>, the system reads that route&apos;s loadout (the products + amounts computed by Route Capacity), converts each amount to <strong className="text-white">packages</strong> (amount ÷ package size), and subtracts it from stock — once per route, automatically.</p>
        <p className="mt-2">Set a <strong className="text-white">Reorder at (packages)</strong> level on any product (in its expanded editor). When a decrement drops that product&apos;s total on-hand below the level, the row turns <span className="text-amber-400">amber with a ⚠ low badge</span> and <strong className="text-white">@Guardian sends a low-stock alert</strong> to the people and rooms you&apos;ve chosen. The alert fires once on crossing — it won&apos;t nag you every route once it&apos;s already low.</p>
        <p className="mt-2 text-gray-500 text-sm">Two things make this work: products need a <em>package size</em> (so amounts can convert to packages), and the route needs line-item → product mappings in <strong className="text-white">Admin → Service Mapping</strong>. Manual edits to the inventory cells still work anytime for corrections.</p>
      </Section>

      <AdminOnly>
        <Section title="Adding &amp; editing products (Admin)">
          <p>In <strong className="text-white">Admin → Products</strong> (Catalog tab):</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
            <li><strong className="text-white">+ Add product</strong> — name, group, price, size, unit, rate, and basis; then expand it to fill in EPA #, active ingredient, label, and batch info.</li>
            <li>Click any product&apos;s arrow to <strong className="text-white">expand</strong> it — edit every field and see the derived cost.</li>
            <li><strong className="text-white">Package price</strong>, <strong className="text-white">application rate</strong>, and the per-location inventory cells edit right in the table — changes save as you click away.</li>
            <li>The <strong className="text-white">✕</strong> on a row removes that product. It&apos;s a <em>soft delete</em> — the row is hidden but kept in the database, so a deleted product can be restored if needed.</li>
            <li><strong className="text-white">Monthly batch update:</strong> expand a product and update its <strong className="text-white">Batch #</strong> and <strong className="text-white">Batch date</strong> — these flow onto the pesticide records.</li>
          </ul>
        </Section>

        <Section title="Groups, locations &amp; alert settings (Settings)">
          <p>The <strong className="text-white">Settings</strong> sub-tab manages your <strong className="text-white">Product Groups</strong> and <strong className="text-white">Inventory Locations</strong> — add, rename, or delete each. Deleting a group keeps its products (they become Uncategorized); deleting a location removes its inventory counts.</p>
          <p className="mt-2">It also has <strong className="text-white">Stock decrement &amp; low-stock alerts</strong>: pick which location route spraying deducts from (defaults to your first active location), turn low-stock alerts on/off, and choose which people get a Guardian DM and which rooms get a post when a product runs low.</p>
        </Section>

        <Section title="Permissions">
          <p>Controlled by the <strong className="text-white">Products</strong> grant in <strong className="text-white">Admin → People → Admin Access</strong> (for managers) — or any full admin. Off by default.</p>
        </Section>
      </AdminOnly>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// SERVICE BUILDER
// ──────────────────────────────────────────────────────────────────────────

function ServiceBuilderTab() {
  return (
    <>
      <Section title="What is the Service Builder?">
        <p>The Service Builder is your Round Creator spreadsheet, rebuilt as a live engine. You build a program out of <strong className="text-white">rounds</strong> (visits) and the products in each, set your visits, labor, and pricing, and instantly see <strong className="text-white">cost per round, annual cost, a price chart across lawn sizes, COGS, and gross-profit margin</strong>. When the numbers look right, you <strong className="text-white">publish</strong> the program&apos;s price chart — and the Pricer quotes from it. Edit once; everything recalculates.</p>
        <p className="mt-2">It lives at <strong className="text-white">Admin → Service Builder</strong> and reads products straight from the <strong className="text-white">Products</strong> catalog — so a price change there flows through here with no re-typing.</p>
      </Section>

      <Section title="Programs &amp; versions">
        <p>Use the dropdown at the top to pick a program. Each program can have several <strong className="text-white">versions</strong> — e.g. a <em>2026</em> version you&apos;re quoting from today and a <em>2027</em> version you&apos;re planning ahead. Every version has a status:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-amber-300">Draft</strong> — a work-in-progress. Never used by the Pricer, so you can tinker freely.</li>
          <li><strong className="text-emerald-300">Published</strong> — live. The Pricer quotes from this. Set an <strong className="text-white">Effective from</strong> date to schedule a future version (e.g. publish 2027 pricing now, dated Jan 1 — it activates on its own).</li>
          <li><strong className="text-gray-300">Archived</strong> — kept for history, out of the way.</li>
        </ul>
        <p className="mt-2"><strong className="text-white">+ New program</strong>, <strong className="text-white">Duplicate as version</strong>, <strong className="text-white">Rename</strong>, and <strong className="text-white">Delete</strong> (soft — kept in the database) are next to the dropdown.</p>
      </Section>

      <Section title="Rounds &amp; products">
        <p>A program is a set of rounds. Add products to each round from the dropdown — each one shows its cost per 1,000 sq ft. The round&apos;s cost/K is the sum, and the program&apos;s <strong className="text-white">annual product cost/K</strong> is the sum of all rounds.</p>
        <p className="mt-2"><strong className="text-white">↧ Seed from current composition</strong> fills the rounds from the program&apos;s saved round composition, so you don&apos;t start from a blank slate. (It matches on the program name.)</p>
      </Section>

      <Section title="Labor, COGS &amp; margin">
        <p>Annual labor = (Size × Minutes-per-K ÷ 60) × $/hr × Visits. Minutes-per-K is <strong className="text-white">tiered</strong> — a small-lawn rate at or below your size threshold and a more efficient large-lawn rate above it (e.g. 2 min/K ≤ 15K, 1.5 min/K above). <strong className="text-white">COGS</strong> = annual product + annual labor; <strong className="text-white">GP margin</strong> = (annual price − COGS) ÷ annual price. <strong className="text-white">Per-treatment is always annual ÷ visits</strong>, computed — so the old ÷8-vs-÷12 spreadsheet bug can&apos;t happen here.</p>
      </Section>

      <Section title="Price chart, averages &amp; the target helper">
        <p>The <strong className="text-white">price chart</strong> shows every metric across the lawn sizes you list. The <strong className="text-white">averages</strong> box shows whether margin holds as lawns scale across a size range. The <strong className="text-white">target-margin helper</strong> lets you enter a target GP% at a size and tells you the Price/K (or Base fee) to set to hit it.</p>
      </Section>

      <Section title="Per-gallon products">
        <p>Products priced <em>per gallon</em> (the DRF spray-mix chemicals) use your tank ratio — gallons of mix per 1,000 sq ft (default 2) — to work out their cost per 1,000 sq ft. The <strong className="text-white">Tank gal / K</strong> field on each program lets you adjust that ratio. Products that aren&apos;t expressible per 1,000 sq ft (e.g. per-tree trunk drenches) show <em>n/a</em> and aren&apos;t counted in the round cost.</p>
      </Section>

      <AdminOnly>
        <Section title="Publishing">
          <p>When a version&apos;s margins look right, click <strong className="text-emerald-300">Publish</strong>. That marks it live and snapshots its margins for the record. The Pricer (and any customer-facing quote) reads the published version. Editing a published version updates the live numbers — so for big changes, duplicate to a new draft version first, then publish when ready.</p>
        </Section>
        <Section title="Permissions">
          <p>Uses the same <strong className="text-white">Products</strong> grant as the Products catalog — full admins, or managers with the Products admin grant.</p>
        </Section>
      </AdminOnly>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// SERVICE MAPPING
// ──────────────────────────────────────────────────────────────────────────

function ServiceMappingTab() {
  return (
    <>
      <Section title="What is Service Mapping?">
        <p>Service Mapping connects the work you sell to the products you actually apply. It lives at <strong className="text-white">Admin → Service Mapping</strong>: pick a <strong className="text-white">program</strong> from the dropdown, and you see its Jobber line item(s) with their <strong className="text-white">rounds</strong> — each round is the set of products applied for a date window. This is the layer the <strong className="text-white">Technician Mix Sheet</strong>, the Route Capacity tool, and the Pesticide / Products-Used log all read from — so every job knows its products and rates for its date. There is no &ldquo;make current&rdquo; button: the <strong className="text-white">dates decide</strong> which round is in effect on any given day.</p>
      </Section>

      <Section title="Programs & rounds">
        <p>Every line item belongs to a <strong className="text-white">program</strong> (set in the Program box on the line item — type a new name there to start a new program; line items with no program sit under <strong className="text-white">Unassigned line items</strong> in the dropdown). To add a line item, start typing its Jobber name (the field suggests your real names with how often each is used), optionally pick a first product, then <strong className="text-white">+ Add</strong>.</p>
        <p className="mt-2"><strong className="text-white">Rounds are dated.</strong> Click <strong className="text-white">+ Add round</strong>, give it a label (e.g. “Round 3”) and a From/To window, and add its products. The system automatically uses the round whose dates cover each service date, so you can <strong className="text-white">build a whole year ahead</strong>. Rounds sort in date order (and “Round 10” correctly comes after “Round 9”). If two active rounds overlap, you&apos;ll see an amber warning — the most recently started one wins; adjust the dates so each day maps to one round. A round with <em>no</em> dates is the <strong className="text-white">always-on fallback</strong>, used only when no dated round covers a date.</p>
        <p className="mt-2"><strong className="text-white">Drafts vs Active.</strong> New, imported, duplicated and copied-to-new rounds start as <strong className="text-white">drafts</strong> — completely invisible to the Mix Sheet, Route Loadout and Pesticide records. When the round&apos;s real dates are set, click <strong className="text-white">Activate</strong> to make it live (and <strong className="text-white">Deactivate</strong> to take it back offline). Imported rounds carry obviously-fake <em>placeholder dates in year 2000</em> just to keep them apart — the Activate button refuses to run until you&apos;ve replaced them with real dates.</p>
        <p className="mt-2"><strong className="text-white">Copy to… / Duplicate →.</strong> <strong className="text-white">Copy to…</strong> copies a round&apos;s products into another round of the same line item (or into a brand-new round) — products the target already has are skipped. <strong className="text-white">Duplicate →</strong> clones the whole round into a new draft starting the day after it ends. Both are the fast way to build next round (or next year) without re-entering products.</p>
        <p className="mt-2">Each product row lets you set:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Rate + Unit</strong> — overrides the product&apos;s default rate for this line item (leave blank to use the product default).</li>
          <li><strong className="text-white">OR group</strong> — give two products the same OR-group name to mark them as alternatives (use one <em>or</em> the other), e.g. a liquid and its granular swap. They share one spot on the Mix Sheet.</li>
          <li><strong className="text-white">Tank</strong> — the default tank (1–4); routes can override it.</li>
          <li><strong className="text-white">Match</strong> — <em>contains</em> (the line item includes this text) or <em>exact</em>.</li>
          <li><strong className="text-white">Notes</strong> and an <strong className="text-white">Active</strong> toggle (the round-level Activate/Deactivate flips all of a round&apos;s products at once).</li>
        </ul>
        <p className="mt-2">Changes save as you go. <strong className="text-white">Remove</strong> takes a product off a round; <strong className="text-white">Delete round</strong> removes the whole round (soft delete — kept in the database).</p>
      </Section>

      <Section title="Where did Current Rounds go?">
        <p>The old <strong className="text-white">Current Rounds</strong> tab is retired — every program&apos;s rounds were imported here (July 2026) and now live with their dates in one place. Imported rounds arrived as <strong className="text-white">drafts with placeholder dates in year 2000</strong>; work through each program — set the real window on each round, then Activate. Nothing reaches the Mix Sheet, Loadout or Pesticide records until you do.</p>
      </Section>

      <Section title="Technician Mix Sheet">
        <p>The <strong className="text-white">Mix Sheet</strong> is its own tool in the Hub (and there&apos;s a <strong className="text-white">Mix Sheet →</strong> button at the top of this screen). It turns your dated rounds into a tech-facing tank chart — how much of each product to add for any water amount or lawn size — and <strong className="text-white">fills itself in</strong> from the round in effect on the date you pick. Everyone on the team can open it; only admins edit it. Use the <strong className="text-white">On sheet</strong> checkbox on each product (above) to keep a product off the sheet while still recording + loading it.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Mix for [date]</strong> — pick any date and the sheet shows that day&apos;s mix.</li>
          <li><strong className="text-white">Program chips</strong> — show or hide programs (LHB / LHP / LHC / RRR) to keep it to one page.</li>
          <li><strong className="text-white">Reorder columns</strong> — admins use the <strong className="text-white">‹ ›</strong> arrows on each product column to set the order; it&apos;s saved for everyone.</li>
          <li><strong className="text-white">Landscape PDF</strong> — prints black-and-white on a single page.</li>
          <li><strong className="text-white">Override a rate</strong> — admins can type a different rate in a column header just for that month; the column recalculates. It does <em>not</em> change the mapping.</li>
          <li><strong className="text-white">Notes</strong>, <strong className="text-white">Granular options</strong>, and the <strong className="text-white">Inspect / Treat</strong> checklist (PHC / BWP by BP / RC routes) are editable and saved per month.</li>
        </ul>
        <p className="mt-2">The same product at the same rate across several programs shows as <strong className="text-white">one column</strong>, tagged with each program. Give two products the same <strong className="text-white">OR group</strong> on their rounds and they show as either/or on the sheet.</p>
      </Section>

      <AdminOnly>
        <Section title="Permissions">
          <p>Uses the same <strong className="text-white">Products</strong> grant as the Products catalog and the Service Builder — full admins, or managers with the Products admin grant.</p>
        </Section>
      </AdminOnly>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// PRICER
// ──────────────────────────────────────────────────────────────────────────

function PricerTab() {
  return (
    <>
      <Section title="What is the Pricer?">
        <p>The Pricer is a fast quoting tool for the office and sales team. Enter a customer&apos;s <strong className="text-white">lawn size</strong> and it instantly prices every program — per visit and annual — plus the add-ons. It lives at <strong className="text-white">Pricer</strong> in your app menu.</p>
        <p className="mt-2">All the numbers come <strong className="text-white">live from the Service Builder</strong> — whatever an admin has published is what you quote. When pricing changes, it&apos;s published once in the Builder and the Pricer updates automatically. There&apos;s nothing to edit here.</p>
      </Section>

      <Section title="Quoting a customer">
        <p>Type the lawn size in <strong className="text-white">thousands of square feet</strong> at the top (e.g. <em>10</em> = 10,000 sq ft; minimum 3K). Every program card recalculates as you type:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Annual programs</strong> show the <em>per-visit</em> price and the <em>annual</em> total.</li>
          <li><strong className="text-white">One-time &amp; seasonal services</strong> show a single one-time price.</li>
        </ul>
        <p className="mt-2">Coming from the <strong className="text-white">Lawn Sizer</strong>? It can hand the measured size straight in, so the quote is ready the moment the page opens.</p>
      </Section>

      <Section title="Add-ons">
        <p>Three add-ons price off their own inputs rather than lawn size:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Moisture Manager</strong> — priced from lawn size; always shown.</li>
          <li><strong className="text-white">Bed Weed Control</strong> — enter the <em>bed area</em> (in thousands) to see pricing.</li>
          <li><strong className="text-white">Plant Health Care</strong> — pick a <em>difficulty tier</em> (based on landscape complexity, not size).</li>
        </ul>
        <p className="mt-2">Each add-on shows its annual total plus the per-visit cost on an 8-visit and a 12-visit plan, so you can fold it into whichever program the customer chooses.</p>
      </Section>

      <AdminOnly>
        <Section title="Where the numbers come from">
          <p>The Pricer reads the <strong className="text-white">published</strong> price chart for each program — specifically the live version whose effective date is on or before today. Drafts never appear, and a future-dated version waits until its date. To change what the team quotes, edit and publish in the <strong className="text-white">Service Builder</strong>.</p>
        </Section>
        <Section title="Permissions">
          <p>Grant <strong className="text-white">Pricer</strong> per person in <strong className="text-white">Admin → People</strong>. Admins always have access. It&apos;s a read-only quoting view — no one can change pricing from here.</p>
        </Section>
      </AdminOnly>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// SCOREBOARDS
// ──────────────────────────────────────────────────────────────────────────

function ScoreboardsTab() {
  return (
    <>
      <Section title="What Scoreboards Are">
        <p>Scoreboards are live KPI dashboards that pull numbers from Jobber, your recurring services, timesheets, and the Lead Tracker. Each board focuses on one area of the business:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Main</strong> — company-wide metrics: revenue, jobs, avg ticket, active customers, and more.</li>
          <li><strong className="text-white">WF Weed &amp; Fert</strong> — job count/value, program mix (PHC/BWP%), and per-tech revenue + $/hr.</li>
          <li><strong className="text-white">IR Irrigation</strong> — Gold book size, avg repair ticket, visit revenue by tech, Rachio + Gold sold/week.</li>
          <li><strong className="text-white">PW Pet Waste</strong> — active customers + annual value, visit revenue by tech (weekly + monthly), and a full cross-department view for Bonnie.</li>
          <li><strong className="text-white">Office</strong> — office-staff performance metrics.</li>
          <li><strong className="text-white">Retention &amp; Churn</strong> — this year&apos;s recurring book: gross retention, controllable churn (the part we could have influenced), cancellations by reason and by month, and the annual value lost.</li>
          <li><strong className="text-white">Lead Sources</strong> — where customers come from and which sources keep them: new customers by source, a per-source scorecard (retention, tenure, value, estimated LTV), close rate by source, and the paid-vs-free mix.</li>
        </ul>
        <p className="mt-2">Scoreboards are at <strong className="text-white">/hub/scoreboards</strong> — tap a board in the left sidebar to open it.</p>
      </Section>

      <Section title="Retention &amp; Lead Sources — How to Read Them">
        <p>Both boards look at <strong className="text-white">this year&apos;s recurring book</strong>: every active recurring service plus the ones cancelled this year. Last year&apos;s cancellations don&apos;t count against the current year.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Retention</strong> = of every recurring service on the books during a year, the share kept. The headline is <strong className="text-white">this year (YTD)</strong>, with the <strong className="text-white">prior full year</strong> shown beside it as a reminder. The current-year number starts high and drifts down as more cancellations land — it&apos;s only part-way through the year (the Recurring Services board began in 2025, so there&apos;s no earlier year to compare a full 12 months against yet).</li>
          <li><strong className="text-white">Controllable churn</strong> is the number to manage against — cancels we could have influenced (price, results, service). Moves, deaths, and accounts <em>we</em> cancelled are reported separately, not blamed on operations.</li>
          <li>A cancellation shows as <strong className="text-white">Review</strong> when its reason is blank or unrecognized — fill in the reason on the Recurring Services board and it moves to the right bucket.</li>
          <li>The Lead Sources board reads the <strong className="text-white">&ldquo;HLC105 Lead Source&rdquo;</strong> field on the Jobber client. The <strong className="text-white">Source Coverage</strong> card shows how much of the book has a known source — set the field on every new client to make these numbers sharper.</li>
          <li><strong className="text-white">Retention by source</strong> favors newer sources (their customers haven&apos;t had time to leave yet) — read it together with the <em>Tenure</em> column on the scorecard.</li>
        </ul>
      </Section>

      <Section title="Access — Who Sees What">
        <p>There are two gates:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Scoreboards section access</strong> — the <em>Scoreboards</em> toggle in <strong className="text-white">Admin → People</strong>. A user without this flag sees no Scoreboards link at all.</li>
          <li><strong className="text-white">Per-board access</strong> — once the section is on, a user still sees <em>only the boards you explicitly grant them</em>. By default they can't open any board until an admin enables them one by one.</li>
        </ul>
        <p className="mt-2">Admins always see every board regardless of both gates.</p>
      </Section>

      <Section title="Going Back in Time — Weekly Snapshots">
        <p>Each board normally shows <strong className="text-white">live</strong> numbers. To see how a board looked at a past point, use the <strong className="text-white">View</strong> dropdown in the bar just under the board&apos;s title.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li>Every <strong className="text-white">Friday night</strong> the system saves a snapshot of each board — a frozen copy of exactly what it showed that week.</li>
          <li>Pick a week from the dropdown to roll the whole board back to that snapshot; the bar turns amber and reads <strong className="text-white">📸 Snapshot</strong> so you always know you&apos;re looking at history, not today.</li>
          <li>Click <strong className="text-white">← Back to live</strong> (or pick <em>Live (current)</em>) to return to today&apos;s numbers.</li>
        </ul>
        <Note>Snapshots only exist going forward from when this was switched on — there&apos;s no way to recreate weeks before that, because the live data doesn&apos;t keep its own history. The dropdown won&apos;t appear on a board until its first Friday snapshot has been captured.</Note>
      </Section>

      <Section title="Seeing the Numbers Behind a Chart">
        <p>Every chart has a small <strong className="text-white">⊞ Data</strong> button in its top-right corner. Tap it to open a spreadsheet-style table of the exact numbers that chart is drawn from — each period (week or month) down the side, every series across the top, with row and column totals.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Copy</strong> — copies the table to your clipboard so you can paste it straight into Excel or Google Sheets.</li>
          <li><strong className="text-white">Download CSV</strong> — saves the table as a .csv file.</li>
        </ul>
        <p className="mt-2">This works on the snapshot (history) view too, so you can pull the underlying numbers for any past week.</p>
      </Section>

      <Section title="Department Revenue · Year to Date">
        <p>The <strong className="text-white">WF</strong>, <strong className="text-white">IR</strong>, and <strong className="text-white">PW</strong> boards each show a <strong className="text-white">Revenue · Year to Date</strong> card — the department&apos;s <em>actual completed-visit revenue</em> from January 1 through today.</p>
        <Note>This is real revenue from work that&apos;s been done — different from <strong className="text-white">Total Annual Value</strong>, which is the run-rate of the active recurring book (what the current customers are worth over a full year). One is money earned so far; the other is the annualized value of who&apos;s on the books now.</Note>
      </Section>

      <AdminOnly>
        <Section title="Enabling Scoreboard Access (Admin)">
          <p>Two steps in sequence:</p>
          <Step n={1}>Go to <strong className="text-white">Admin → People</strong>, find the user, and turn on the <strong className="text-white">Scoreboards</strong> toggle. This gives them access to the Scoreboards section.</Step>
          <Step n={2}>Go to <strong className="text-white">Admin → Scoreboards → Who can see each board</strong>. Find the user&apos;s row and click the board buttons you want them to see — each button lights up sky-blue when the board is granted. Changes save instantly. A user with the section flag but <em>no</em> boards granted won&apos;t see the Scoreboards icon in their app drawer at all, and if they open the link directly they&apos;ll get a &ldquo;No scoreboards assigned yet&rdquo; message — so granting at least one board here is what actually turns Scoreboards on for them.</Step>
        </Section>

        <Section title="Technician Assignment (Admin)">
          <p>The <strong className="text-white">Technician assignments</strong> panel at <strong className="text-white">Admin → Scoreboards</strong> controls which employees show up in the per-tech charts on the WF, IR, and PW boards. Assign the right people to each board there — the charts update immediately.</p>
          <Note>Technician assignment is separate from view access: assigning someone to a board doesn&apos;t let them see the board, and granting view access doesn&apos;t put them in the charts.</Note>
        </Section>
      </AdminOnly>
    </>
  )
}
