'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Shared UI primitives
// ──────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
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
  { id: 'routing',      icon: '⚡', label: 'Route Optimizer' },
  { id: 'lawn-sizer',   icon: '🌿', label: 'Lawn Sizer' },
  { id: 'zone-sizer',   icon: '💧', label: 'Zone Sizer' },
  { id: 'dialer',       icon: '☎️', label: 'Dialer' },
  { id: 'contacts',     icon: '👤', label: 'Contacts' },
  { id: 'call-log',     icon: '📞', label: 'Call Log' },
  { id: 'marketing',    icon: '📣', label: 'Marketing' },
  { id: 'books',        icon: '📊', label: 'Books' },
  { id: 'timesheet',    icon: '🕐', label: 'Timesheet' },
  { id: 'settings',     icon: '⚙️', label: 'Settings' },
] as const

type TabId = typeof TABS[number]['id']

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

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/hub" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Hub
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Help</h1>
      </header>

      {/* Tab bar */}
      <div className="sticky top-[env(safe-area-inset-top)] md:top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="px-2 sm:px-4">
          <div className="flex gap-1 overflow-x-auto no-scrollbar py-2 lg:justify-center">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={el => { tabRefs.current[tab.id] = el }}
                  onClick={() => setActiveTab(tab.id)}
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
        {activeTab === 'hub'        && <HubTab />}
        {activeTab === 'routing'    && <RoutingTab />}
        {activeTab === 'lawn-sizer' && <LawnSizerTab />}
        {activeTab === 'zone-sizer' && <ZoneSizerTab />}
        {activeTab === 'dialer'     && <DialerTab />}
        {activeTab === 'contacts'   && <ContactsTab />}
        {activeTab === 'call-log'   && <CallLogTab />}
        {activeTab === 'marketing'  && <MarketingTab />}
        {activeTab === 'books'      && <BooksTab />}
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
      </main>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// HUB
// ──────────────────────────────────────────────────────────────────────────

function HubTab() {
  return (
    <>
      <Section title="What Hub Is">
        <p>Hub is where the Heroes team communicates day-to-day — like Slack or Teams, but built into Lynxedo and connected to the rest of your tools. Everything in Hub stays inside the company.</p>
        <p>Hub has three main areas: <strong className="text-white">Rooms</strong> (group conversations), <strong className="text-white">DMs</strong> (one-on-one messages), and <strong className="text-white">Boards</strong> (saved messages you want to keep around).</p>
      </Section>

      <Section title="Home Screen">
        <p>The Home screen is what you see when you open Hub for the first time each day. It shows the date, your greeting, the active company announcements and shout outs, and your most-used rooms — so you can get oriented before diving into a conversation.</p>
        <p><strong className="text-white">My Time Clock card</strong> — if you have timesheet access and an employee record, a clock-in card appears near the top of Home. Tap <strong className="text-white">Clock In</strong> to start your shift (Lynxedo grabs your GPS at the same time, same as the Timesheet page). Once you&apos;re clocked in the card shows the time you started and how long you&apos;ve been on the clock; tap <strong className="text-white">Clock Out</strong> when you finish. The card mirrors what the Timesheet page does, just one tap from the landing screen so you don&apos;t have to navigate every morning.</p>
        <p><strong className="text-white">Resume where you left off</strong> — when you close and reopen Hub within 14 hours, you&apos;ll land on the last room or DM you were viewing instead of always going back to the General room. Tap a push notification and you still jump straight to that message.</p>
        <p><strong className="text-white">Auto-return to Home after long gaps</strong> — if it&apos;s been more than 14 hours since you last opened Hub, the next time you open it you&apos;ll land on Home instead. The idea: after an overnight gap you probably want to see the announcements and clock in first, not jump straight into whatever room you closed yesterday.</p>
        <Note>Don&apos;t want to land on Home? You can change your default landing page under <strong className="text-white">Settings → Account → Default landing page</strong> (Hub or Dashboard).</Note>
      </Section>

      <Section title="Navigation — rail + sidebars">
        <p>Hub is organized around a thin <strong className="text-white">icon rail</strong> on the left edge of the screen (or as a bottom tab bar on phones). Each icon opens its own sidebar with that section&apos;s contents.</p>
        <p className="font-medium text-white mt-3">Desktop rail — fixed icons</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">🔍 Search</strong> — opens the quick-jump palette (same as <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘K</kbd> / <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">Ctrl+K</kbd>).</li>
          <li><strong className="text-white">🕐 Clock</strong> — opens the Time Clock modal. A small green dot appears on the icon when you&apos;re punched in.</li>
          <li><strong className="text-white">💬 Hub</strong> — team conversations. Sidebar lists My Time Clock · Daily Log · Unread · Favorites · Rooms · DMs · Boards.</li>
          <li><strong className="text-white">📱 Txt</strong> — client SMS conversations (Captivated).</li>
          <li className="text-gray-300"><em>Then 4 user-configurable slots</em> (see &quot;My Hub&quot; below).</li>
          <li><strong className="text-white">⚙️ Settings</strong> — your profile, notifications, integrations, and My Hub.</li>
          <li><strong className="text-white">🛡️ Admin</strong> — only visible if you have admin access.</li>
          <li><strong className="text-white">👤 You</strong> (at the bottom) — your avatar with status dot. Opens the profile sidebar where you set Available / Busy / DND, change text size, and sign out.</li>
        </ul>
        <p className="font-medium text-white mt-3">Activity bell</p>
        <p>A small bell icon floats in the top-right of the main content area, anywhere inside Hub. The red badge shows how many @mentions or thread replies are waiting for you. Tap it to slide in a panel with the list — last 30 days. The bell hides when the keyboard is open on mobile so it doesn&apos;t cover the composer.</p>
        <p className="font-medium text-white mt-3">Keyboard shortcuts</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘1</kbd> Time Clock · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘2</kbd> Hub · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘3</kbd> Txt · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘4</kbd> Activity · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘5</kbd> Tools · <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">⌘K</kbd> Search (use Ctrl on Windows).</li>
        </ul>
        <p className="font-medium text-white mt-3">Mobile bottom bar</p>
        <p>Five tabs always within thumb reach: <strong className="text-white">Clock · Hub · Txt · [your pick] · More</strong>. The fourth slot is configurable in Settings → My Hub. Tap <strong className="text-white">More</strong> for everything else (Tools, Links, Settings, Admin if you have it, and your profile). A floating <strong className="text-white">+</strong> button in the bottom-right opens the quick compose / search palette.</p>
        <Note>📱 The top bar is gone on phones — just tap the bottom tab for the section you want. When the keyboard pops up, the bottom bar and the floating <strong className="text-white">+</strong> button slide out of the way so you see the most messages possible.</Note>
        <p className="font-medium text-white mt-3">My Hub — pick your own rail icons</p>
        <p>In <strong className="text-white">Settings → My Hub</strong>, pick what fills the 4 user-configurable rail slots (desktop) and the 1 mobile slot. Options include Tools, Links, Activity, Daily Log, Tracker, Routing, Fleet, Books, Lawn Sizer, Call Log, Time Records (admins), Files, Company News, or a custom URL of your choosing. The defaults give everyone Activity, Tools, and Links with one slot empty — but if you live in Tracker, put it directly on the rail and skip a click.</p>
        <p className="font-medium text-white mt-3">Hub sidebar contents</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">My Time Clock</strong> — backup access to the clock-in modal (same as the rail icon).</li>
          <li><strong className="text-white">Daily Log</strong> — jump to today&apos;s entry.</li>
          <li><strong className="text-white">Unread</strong> — rooms or DMs with new messages, surfaced at the top. Disappears when you&apos;re caught up.</li>
          <li><strong className="text-white">Favorites</strong> — your pinned rooms, DMs, and tools.</li>
          <li><strong className="text-white">Rooms</strong> — group conversations you belong to.</li>
          <li><strong className="text-white">Direct Messages</strong> — one-on-ones. The colored dot is the other person&apos;s status: <span className="inline-block w-2 h-2 rounded-full bg-green-400 align-middle"></span> Available, <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 align-middle"></span> Busy, <span className="inline-block w-2 h-2 rounded-full bg-red-500 align-middle"></span> DND, <span className="inline-block w-2 h-2 rounded-full bg-gray-500 align-middle"></span> Offline.</li>
          <li><strong className="text-white">Boards</strong> — your saved-message boards.</li>
        </ul>
        <p className="font-medium text-white mt-3">Landing page</p>
        <p>When you first sign in for the day — or after a long stretch (14+ hours) away from Hub — you land on the Home screen. It shows your Time Clock card up top, then announcements and shout outs, then a focused list of <strong className="text-white">your unread DMs / rooms</strong> followed by <strong className="text-white">recent @mentions</strong>. It&apos;s the &quot;what do I care about right now&quot; screen. There&apos;s no permanent way back to it from the rail — once you move on, the Activity bell and the Hub sidebar handle everything.</p>
        <Note>🖥️ Click any rail icon to navigate — the sidebar always opens. Click the icon of the section you&apos;re already in to toggle the sidebar closed/open. A small chevron also appears at the left edge while collapsed to bring it back.</Note>
        <Note>📱 On phone, when you tap the message box and the keyboard pops up, the room header hides to give the keyboard more room. A small <strong className="text-white">&lt;</strong> back button appears in the top-left so you can still get back to the sidebar with one tap. The header reappears after you send.</Note>
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
          <li><strong className="text-white">📎 Attach</strong> — pick a file or photo. You can also paste images from your clipboard or drag-and-drop a file straight onto the composer.</li>
          <li><strong className="text-white">Aa Format</strong> — wraps your selected text (or inserts markers for you to type between) in bold, italic, strike, code, or quote. See the Formatting section below for the full list of markers and keyboard shortcuts.</li>
          <li><strong className="text-white">😀 Emoji</strong> — opens a full emoji picker with search, categories, recents, and skin tones.</li>
          <li><strong className="text-white">@ Mention</strong> — inserts <code className="bg-gray-800 px-1 rounded text-orange-300">@</code> and opens the name picker. Mentioned people get a push notification even if their notifications are set to Mentions only. You can also just type <code className="bg-gray-800 px-1 rounded text-orange-300">@</code> directly.</li>
          <li><strong className="text-white">⏰ Schedule</strong> — pick a future date/time. The button turns blue, the Send button turns yellow, and a banner shows when it&apos;ll go out. Click the ✕ on the banner to switch back to send-now. The popover also has a <strong className="text-white">View scheduled messages</strong> link that opens a list of everything you have queued across all rooms and DMs — edit the body, reschedule the time, send right now, or delete.</li>
          <li><strong className="text-white">▶ Send</strong> — sends the message. Hidden until you&apos;ve started typing or attached something.</li>
        </ul>
        <p className="font-medium text-white mt-3">Typing emoji by name</p>
        <p>Type <code className="bg-gray-800 px-1 rounded text-orange-300">:</code> followed by a name and a list of matches pops up. <code className="bg-gray-800 px-1 rounded">:smile</code> → 😄, <code className="bg-gray-800 px-1 rounded">:fire</code> → 🔥, <code className="bg-gray-800 px-1 rounded">:thumbsup</code> → 👍. Arrow keys to navigate the list, Enter or Tab to insert.</p>
      </Section>

      <Section title="Viewing photos, videos, and PDFs">
        <p>Attachments open inside Hub — no new browser tab.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Photos</strong> — tap the thumbnail to open the full image in a dark lightbox. On desktop, use the ← / → buttons (or arrow keys) to flip between photos in the same message; Esc closes. On phone, swipe left/right to flip and pinch to zoom.</li>
          <li><strong className="text-white">Videos</strong> — play right in the chat bubble with native controls (play, scrub, fullscreen, volume).</li>
          <li><strong className="text-white">PDFs</strong> — tap the 📄 card to open the document in the lightbox. The ⬇ button in the top-right downloads the file.</li>
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

      <Section title="Message Actions (long-press / right-click)">
        <p>Long-press a message on mobile, or hover and right-click on desktop, to see the actions menu:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">React</strong> — tap one of the three quick reactions (✅ 👍 👀), or hit the <strong className="text-white">+</strong> button next to them to open the full emoji picker (search, categories, recents). On desktop, hover a message → 😊 button shows the same three quick picks. Anyone in the conversation can see and click the reaction.</li>
          <li><strong className="text-white">Copy text</strong> — copies the message text to your clipboard.</li>
          <li><strong className="text-white">Forward</strong> — send the message into another room or DM.</li>
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
        <p><strong className="text-white">Resize the thread pane</strong> — on desktop, hover over the left edge of the thread panel to reveal a drag handle. Drag left to widen it (up to about half the screen), drag right to narrow it. Your preferred width is saved automatically.</p>
      </Section>

      <Section title="Boards (Saved Messages)">
        <p>Boards are personal — like bookmarking messages you want to come back to. Each board is a collection of saved messages.</p>
        <Step n={1}>Long-press a message → <strong className="text-white">Add to Board</strong>.</Step>
        <Step n={2}>Pick an existing board or create a new one (e.g. <em>Follow-ups</em>, <em>Quotes to send</em>, <em>Photos to post</em>).</Step>
        <Step n={3}>Open the board from the sidebar to see everything you&apos;ve saved.</Step>
        <Note>Boards are private to you by default. Admins can create shared boards visible to multiple members.</Note>
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

      <Section title="External Links">
        <p>The <strong className="text-white">LINKS</strong> section near the bottom of the sidebar is a curated list of shortcuts to outside tools the team uses every day — Jobber, Gusto, QuickBooks, Captivated, and so on. Click any link to open it in a new browser tab.</p>
        <Note>Click the chevron next to <strong className="text-white">LINKS</strong> to collapse the section if you don&apos;t want it taking up space.</Note>
        <AdminOnly>
          <p>Admins manage the list under <strong className="text-white">/admin/hub → External Links</strong>. Each link has a name, URL, emoji icon, and sort order. Use multiples of 10 for sort order (10, 20, 30…) so you can insert new links between later. Everyone in Hub sees the same set of links.</p>
        </AdminOnly>
      </Section>

      <Section title="Announcements & Shout Outs">
        <p>Two tickers appear at the top of Hub (in rooms and DMs):</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">📢 Announcements (blue)</strong> — company-wide updates the admin team wants everyone to see (policy changes, schedule notes, etc.).</li>
          <li><strong className="text-white">🎉 Shout Outs (gold)</strong> — recognition for great work, customer compliments, milestones.</li>
        </ul>
        <p>Hit <strong className="text-white">✕</strong> to dismiss a ticker from your view — it stays hidden on that device until a new announcement of the same type is posted. Click the ticker text to open the full <strong className="text-white">Company News</strong> page where everything is sorted by Active / Archived / Expired.</p>
        <AdminOnly>
          <p>Admins manage announcements from <strong className="text-white">/admin/hub → Announcements</strong>. Anyone with the <em>Can post Shout Outs</em> flag enabled can post shout outs from the same page. Posting a new active announcement automatically archives the previous one — only one of each type is live at a time.</p>
          <p><strong className="text-white">Edit</strong> — click Edit on the active announcement card to change the text (expiration is preserved). The ✎ pencil on the ticker itself also opens the same edit modal.</p>
          <p><strong className="text-white">Archive</strong> — click Archive on the active card to pull it immediately, before it expires.</p>
          <p><strong className="text-white">Delete</strong> — the <em>Past Announcements</em> list at the bottom of the Announcements tab shows all archived and expired posts. Click Delete on any row to permanently remove it.</p>
        </AdminOnly>
      </Section>

      <Section title="@Guardian Bot">
        <p>Guardian is an AI helper that lives in Hub. @mention <strong className="text-orange-300">@Guardian</strong> in any room or DM and ask it questions about Lynxedo or the business — it has context on your data and replies in-thread.</p>
        <p className="text-gray-400 text-xs">Examples: <em>&ldquo;@Guardian how many visits do we have tomorrow?&rdquo;</em> · <em>&ldquo;@Guardian who&apos;s clocked in right now?&rdquo;</em></p>
        <p><strong className="text-white">What Guardian can do depends on your tier:</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">Basic</strong> (default) — read-only Jobber/Captivated lookups (clients, jobs, visits, quotes, invoices) and questions about the company knowledge base. Most office staff and field techs are here.</li>
          <li><strong className="text-emerald-300">Manager</strong> — everything Basic does, plus scheduling visits, editing visit times, marking visits complete, and creating notes on clients/jobs.</li>
          <li><strong className="text-amber-300">Full</strong> — everything Manager does, plus live web search for current information. There&apos;s a daily company-wide cap (default 30 searches/day) so costs stay predictable.</li>
        </ul>
        <p><strong className="text-white">Tier resolution:</strong> if you&apos;re a super-admin you always get Full. Otherwise, if the room you&apos;re asking in has &ldquo;Full access&rdquo; turned on, you get Full there regardless of your personal tier. Otherwise you get your personal tier.</p>
        <AdminOnly>
          <p>Set tiers per-person under <strong className="text-white">/admin/guardian → People</strong>. Turn on per-room Full access under <strong className="text-white">/admin/guardian → Rooms</strong> — useful for an &ldquo;office&rdquo; or &ldquo;leadership&rdquo; room where anyone asking should get full capabilities. Every Guardian reply is recorded in <strong className="text-white">/admin/guardian → Audit</strong> (last 100 entries, click to expand the full question + answer + tools used + tokens). Only super-admins can change tiers; managers with Hub admin access can view them.</p>
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
          <p>Admins pick where completion notifications go under <strong className="text-white">/admin/daily-log</strong> — any combination of DMs (each selected user gets a one-on-one DM from @Guardian) and rooms (the summary is posted in each selected room, where @Guardian auto-joins if it&apos;s not already a member). Leave both empty to disable the notification entirely.</p>
        </AdminOnly>
      </Section>

      <Section title="Daily Log v2 (preview)">
        <p>A new tech-facing view of the day&apos;s work, available at <Link href="/hub/daily-log-v2" className="text-sky-400 hover:underline">/hub/daily-log-v2</Link>. The original Daily Log keeps working unchanged — both run in parallel while v2 is iterating.</p>
        <p>What&apos;s different: instead of one text-based card with office instructions and tech updates, v2 shows the day&apos;s <strong className="text-white">stops as an ordered list</strong> with customer names, addresses, scheduled times, and line items. A map at the top of each entry shows the route with numbered pins.</p>
        <p><strong className="text-white">How stops get there:</strong> open the <Link href="/hub/routing" className="text-orange-400 hover:text-orange-300">Route Optimizer</Link>, build a route, then click the new <strong className="text-sky-300">Send to Daily Log</strong> button (blue, next to Send Order Only and Send with Times). The stops queue up under the target tech&apos;s entry for that day. If an entry doesn&apos;t exist yet it&apos;s created; if one already exists with office instructions, those stay — only stops get added or replaced.</p>
        <p>You can run <em>Send to Daily Log</em> independently of the Jobber sends. Sending it doesn&apos;t change anything in Jobber. Re-running it after re-optimizing replaces the stops list with the new order.</p>
        <p className="text-xs text-gray-500"><strong className="text-gray-400">Coming in later phases:</strong> tap a stop to see full details, mark complete (pushes back to Jobber), &ldquo;On my way&rdquo; text to the customer, navigate button (opens Google Maps), automatic weather capture at completion, pesticide records.</p>
      </Section>

      <Section title="Fleet Tracker">
        <p>Fleet shows all company vehicles on a live map (powered by OneStepGPS). Each vehicle appears as a colored pin with a heading arrow and a popup that gives speed, fuel %, and last ping time. Tap a vehicle in the sidebar list to fly the map to it.</p>
        <p>Pin colors:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-green-300">Green</strong> — driving</li>
          <li><strong className="text-yellow-300">Yellow</strong> — stopped or parked</li>
          <li><strong className="text-orange-300">Orange</strong> — being towed</li>
          <li><strong className="text-gray-300">Gray</strong> — off / offline</li>
        </ul>
        <p>A small red dot in the corner of a pin means at least one alert is active for that vehicle. The data refreshes every 30 seconds.</p>
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
        <p>Tracker is the lead pipeline — every inbound lead from any source ends up here as a card you move through stages (New → Quoted → Won / Lost).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Pipeline</strong> — kanban view, drag cards between stages.</li>
          <li><strong className="text-white">Dashboard</strong> — counts and conversion rates by source, by month.</li>
          <li><strong className="text-white">Import</strong> — bulk-add leads from a spreadsheet.</li>
        </ul>
        <p className="mt-3"><strong className="text-white">Resize or reorder columns.</strong> Drag a column header to reorder it. Drag the right edge of any header to resize. Your layout is saved per-user and follows you across devices.</p>
        <AdminOnly>
          <p>Admins configure lead sources, stages, and field defaults under <strong className="text-white">Tracker → Settings</strong>.</p>
        </AdminOnly>
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
        <Step n={1}>Connect your Jobber account under <Link href="/settings" className="text-orange-400 hover:text-orange-300">Settings → Integrations</Link>. Click <strong className="text-white">Connect Jobber →</strong> and authorize.</Step>
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
          <p className="text-white font-medium mb-2">Send Order Only (green button)</p>
          <p>Keeps visits as &ldquo;anytime&rdquo; in Jobber but sets the stop order so the Jobber mobile app and printed route sheet follow the optimized sequence. Techs stay flexible on timing — no appointment times are written.</p>
          <p className="mt-2 text-xs text-gray-500">Behind the scenes this uses Jobber&apos;s internal &ldquo;anytime route order&rdquo; controls. Changes apply live in Jobber — no page refresh needed.</p>
        </div>

        <div className="border border-gray-700 rounded-xl p-4 mt-3">
          <p className="text-white font-medium mb-2">Send with Times (orange button)</p>
          <p>Writes the calculated ETA as the scheduled appointment time for each visit (and each assessment). This converts anytime visits to scheduled visits in Jobber.</p>
          <p className="mt-2 text-xs text-gray-500">Use this when you want appointments shown to customers in Jobber notifications, or when techs need fixed time slots.</p>
        </div>

        <div className="border border-gray-700 rounded-xl p-4 mt-3">
          <p className="text-white font-medium mb-2">Send to Daily Log (blue button)</p>
          <p>Populates the new <Link href="/hub/daily-log-v2" className="text-sky-400 hover:underline">Daily Log v2</Link> with the optimized stops, attached to the target tech&apos;s entry for that day. <strong className="text-white">Doesn&apos;t touch Jobber.</strong> If an entry doesn&apos;t exist yet it&apos;s created; existing office instructions and tech updates are preserved — only the stops list is added or replaced.</p>
          <p className="mt-2 text-xs text-gray-500">Use this any time you want techs to see the route in the tech-facing Daily Log view, with or without sending to Jobber.</p>
        </div>

        <p className="mt-3"><strong className="text-white">Reassign to</strong> (above the buttons) picks which tech the visits should end up under. Applies to all three send modes — Jobber assignment AND the Daily Log entry. <strong className="text-amber-300">Required when multiple techs were loaded</strong> — Jobber&apos;s anytime stop order is per-tech, and Daily Log entries are per-tech, so consolidating to one tech is mandatory.</p>

        <Note>⚠️ Send with Times overwrites any existing appointment times on those visits. Send Order Only just sets the stop sequence. Send to Daily Log replaces the prior stops list (if any) but never touches Jobber.</Note>
      </Section>

      <Section title="Printing the Route Sheet">
        <p>Click <strong className="text-white">Print Route Sheet</strong> to open a printable version in a new tab:</p>
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
            <p>Check that Jobber is connected (Settings → Integrations shows ● Connected). If it is, try disconnecting and reconnecting — the OAuth token may have expired.</p>
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

      <AdminOnly>
        <p>Admins configure the per-zone square footage under <strong className="text-white">/admin/zone-sizer</strong>. Defaults are 1,000 sq ft per zone for both turf and beds. Raise the bed rate if you use drip or microspray that covers more area per zone.</p>
        <p>Each user must have the <em>Zone Sizer</em> permission enabled in Admin → People to use the tool.</p>
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
        <Note>Dialer is currently <strong className="text-white">on staging only</strong>. It&apos;s wired and ready for real Twilio voice setup. Once Heroes&apos; Twilio number is live, the dialpad starts placing real calls. Until then it shows a &quot;Not configured&quot; pill and call attempts fail cleanly.</Note>
      </Section>

      <Section title="Placing a Call">
        <Step n={1}>Open <strong className="text-white">Dialer</strong> from the sidebar under Tools → Communications, or from your favorites if you&apos;ve pinned it.</Step>
        <Step n={2}>Tap digits on the keypad or type a phone number directly into the field.</Step>
        <Step n={3}>Tap the green <strong className="text-white">Call</strong> button. The browser asks for microphone access the first time — say yes.</Step>
        <Step n={4}>While the call is connecting, the screen switches to the active-call view with caller info, a mute button, a keypad for tone entry (e.g. menu choices), and a red hang-up button.</Step>
      </Section>

      <Section title="Receiving a Call">
        <p>When an inbound call comes in, a full-screen ringing overlay shows the caller&apos;s number (and contact name if you&apos;ve texted them before from Txt). Tap green to accept, red to reject.</p>
        <Note>In v1 inbound calls only ring on Ben&apos;s account. IVR (auto-attendant) and ring groups land in a follow-up session. Until those ship, all incoming calls route to Ben — anyone else with Dialer access can still place outbound calls.</Note>
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
        <p>Tapping the caller name pre-fills the dialpad with their number so you can call back in one tap.</p>
        <p>Voicemail recipients (the people who get a push notification when a new voicemail lands) are configured in <strong className="text-white">Admin → Dialer</strong>. Push notifications respect each recipient&apos;s Do Not Disturb settings.</p>
      </Section>

      <Section title="Ring anywhere in Hub">
        <p>By default, incoming calls pop a ringing overlay no matter what page of Hub you&apos;re on — a room, a DM, Tracker, Settings, anywhere. Accept or reject from the overlay; if you accept and then navigate away from the Dialer page, a thin green banner at the top of Hub keeps the call timer visible with a one-tap return to Dialer. The banner has a <strong className="text-white">×</strong> to dismiss it if it&apos;s in the way (it&apos;ll come back on the next call).</p>
        <p>The rail Dialer icon also shows a red badge with your unheard voicemail count — so a missed-call voicemail is visible from any Hub page, not just from inside the Dialer sidebar.</p>
        <p>To turn off cross-page ringing — for example, if you don&apos;t want your browser holding an open phone connection while you&apos;re heads-down on something else — open <strong className="text-white">Settings → Account → Communications</strong> and uncheck <em>Ring me on every Hub page</em>. With the toggle off, calls only ring you while you&apos;re on the Dialer page itself.</p>
      </Section>

      <Section title="Auto-attendant (IVR)">
        <p>Set up a phone menu callers hear before reaching anyone — &quot;Thank you for calling Heroes Lawn Care. Press 1 for scheduling, press 2 for billing.&quot; Configure it in <strong className="text-white">Admin → Dialer</strong> under the <em>Auto-attendant</em> section.</p>
        <p>The menu is a tree of <strong className="text-white">menus</strong> (nodes). Each menu has a <strong className="text-white">prompt</strong> the caller hears and a set of <strong className="text-white">keypress actions</strong> (what happens when they press 0–9, *, or #).</p>
        <p><strong className="text-white">Prompts</strong> can be either typed text (Twilio reads it aloud in a synthetic voice — fast to draft and edit) or an uploaded MP3/WAV file (a human recording — sounds professional but you have to re-record to change wording). Most people start with typed prompts to dial in the menu structure, then upload audio recordings for the prompts callers hear most often.</p>
        <p><strong className="text-white">Keypress actions</strong> you can use today:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Go to another menu</strong> — branch into a submenu (nested menus are fully supported)</li>
          <li><strong className="text-white">Send to voicemail</strong> — caller leaves a message in the company voicemail box</li>
          <li><strong className="text-white">Ring a person</strong> — rings that user&apos;s Dialer until they answer; falls through to their voicemail if they don&apos;t</li>
          <li><strong className="text-white">Ring an extension</strong> — same as &quot;ring a person&quot; but referenced by 3-digit extension (handy when you want the menu to read &quot;Press 1 for Ben, extension 101&quot;)</li>
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
        <p>Every Hub user can be assigned a 3-digit extension (100–999) in <strong className="text-white">Admin → Dialer → Extensions</strong>. Once assigned, anyone on the Dialer can punch the 3 digits into the dialpad, tap Call, and it rings that person directly — no phone number needed.</p>
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
        <p>Members with Do Not Disturb on are skipped automatically. If a sequential group runs out of available members (or a simultaneous group is empty after DND filtering), the call falls through to the company general voicemail.</p>
      </Section>

      <Section title="Do Not Disturb (DND)">
        <p>Each user can turn DND on in <strong className="text-white">Settings → Account → Communications</strong>. With DND on, IVR transfers and ring groups skip you — calls go to other group members or to voicemail.</p>
        <p>You can also schedule auto-DND windows per day of week — e.g. 6 PM to 8 AM every weekday. Wrap-overnight ranges work (set &quot;from&quot; later than &quot;to&quot;). Times are interpreted in your local time zone.</p>
        <p>Dialer DND is separate from your Hub status dot — flipping your status to &quot;DND&quot; doesn&apos;t auto-mute the phone, and vice versa. Toggle each on its own.</p>
      </Section>

      <Section title="Voicemail (per-user boxes + greetings)">
        <p>Inbound calls that ring a specific person (via direct routing, extension dial, IVR transfer, or ring group fall-through) land in <strong className="text-white">that person&apos;s</strong> voicemail box instead of the company general inbox. Push notifications go only to them; the unheard count on the rail badge reflects what they can see.</p>
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
        <p>The Contacts page is your company-wide address book. Anyone you call from the Dialer, anyone who texts in through Txt, plus customers we&apos;ve pulled from Jobber — they all live in one searchable list at <strong className="text-white">Tools → Communications → Contacts</strong>.</p>
        <p>Search by name or phone number from the top bar. Tap any contact to see their details, call them (Dialer), or edit their info.</p>
      </Section>

      <Section title="Tags">
        <p>Tags are how you carve up the contact list so it&apos;s useful day-to-day. Customer, Vendor, Subcontractor, HOA, VIP — whatever categories matter for your business. Each contact can have any number of tags.</p>
        <Step n={1}>Tap any tag chip below the search bar to filter — pick multiple to narrow further (contact must have ALL selected tags).</Step>
        <Step n={2}>Tap <strong className="text-white">Untagged</strong> to see only contacts with no tags yet (good for cleanup).</Step>
        <Step n={3}>Tap <strong className="text-white">Clear</strong> to reset filters.</Step>
        <p>Tag chips appear inline on each contact row so you can see categorization at a glance.</p>
      </Section>

      <Section title="Adding & editing contacts">
        <p>The <strong className="text-white">+ Add</strong> button at the top creates a new contact (name + phone required). You can tag the contact on the same form.</p>
        <p>Tap any existing contact to open its detail sheet. <strong className="text-white">Edit</strong> lets you change name, phone, email, notes, and tags. The <strong className="text-white">Do not text</strong> toggle blocks outbound SMS to this contact from Txt and broadcasts — useful when someone replies STOP or asks to be left alone (Twilio also auto-flips this when they text STOP).</p>
        <Note>Inbound calls and texts auto-create contacts on first contact, so the list grows organically. The initial population came from Jobber (85 customers as of launch) plus anyone who&apos;s already texted in.</Note>
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
        <p>Call Log shows every recorded call processed by the Unitel system, with AI summaries, transcripts, and coaching feedback. New calls appear automatically within a few minutes of the call ending.</p>
      </Section>

      <Section title="Browsing Calls">
        <p><strong className="text-white">Filters</strong> — narrow the list by date range, phone number, or customer/rep name. All filters stack.</p>
        <p><strong className="text-white">Must-Listen flag</strong> — calls the AI flagged as especially noteworthy (unusual situation, missed opportunity, coaching moment) are marked in the list.</p>
        <p><strong className="text-white">Call type</strong> — each call is categorized: New Lead, Existing Customer, Vendor, Wrong Number, Voicemail, or Other.</p>
      </Section>

      <Section title="Call Detail & Audio">
        <p>Click any call in the list to open the detail panel:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Audio player</strong> — play the recording directly in the browser. Click the progress bar to seek.</li>
          <li><strong className="text-white">AI summary</strong> — a short paragraph describing what happened on the call.</li>
          <li><strong className="text-white">Action items</strong> — specific follow-ups the AI identified.</li>
          <li><strong className="text-white">Coaching feedback</strong> — wins and areas for improvement.</li>
          <li><strong className="text-white">Transcript</strong> — full speaker-labeled transcript, collapsible.</li>
        </ul>
        <Note>Historical calls (before May 2026) have transcripts and basic info but no AI coaching grades — those only run on new calls going forward.</Note>
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
      <Section title="Social Posting">
        <p>Schedule Facebook and Instagram posts directly from Hub Files photos — without leaving Lynxedo.</p>
        <p className="mt-2">Navigate to <strong className="text-white">Marketing → Social</strong> from the Tools sidebar to access the queue.</p>
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
        <Step n={1}>Tap <strong className="text-white">Clock In</strong> when you start your shift. Lynxedo records the time and your GPS location.</Step>
        <Step n={2}>Add a note if you want (start-of-shift conditions, crew, anything noteworthy).</Step>
        <Step n={3}>Tap <strong className="text-white">Clock Out</strong> when you&apos;re done. You&apos;ll see your total hours for the shift and the week.</Step>
        <Note>📍 Timesheet asks for location permission the first time you clock in. If you deny it, clocking still works but the location field stays blank.</Note>
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
          <p>Admins manage all timesheet data at <strong className="text-white">/admin/timesheet</strong> (also reachable from the Hub sidebar under Tools → Time Records).</p>
          <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
            <li>Review every employee&apos;s shifts for the pay period</li>
            <li>Edit clock in/out times when someone forgets to clock out</li>
            <li>Add manual shifts for missed days</li>
            <li>Link Lynxedo users to their Gusto employee record</li>
            <li>Import the period into Gusto when payroll runs (via the Gusto MCP integration)</li>
          </ul>
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
        <p>The <Link href="/settings" className="text-orange-400 hover:text-orange-300">Settings</Link> page has three tabs:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Profile</strong> — your name, photo, phone number, sign out</li>
          <li><strong className="text-white">Integrations</strong> — your Jobber Connection</li>
          <li><strong className="text-white">Account</strong> — default landing page, notifications, scheduled Do Not Disturb, change password</li>
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

      <Section title="Integrations — Jobber Connection">
        <p>Click <strong className="text-white">Connect Jobber →</strong> to authorize Lynxedo to read your visits and write appointment times. Once connected, status shows <span className="text-green-400 font-medium">● Connected</span>.</p>
        <p>You can disconnect at any time — this revokes Lynxedo&apos;s access to your Jobber account until you reconnect.</p>
        <Note>⚠️ If visits aren&apos;t loading in the Route Optimizer, try disconnecting and reconnecting. The OAuth token occasionally needs a refresh.</Note>
      </Section>

      <Section title="Account — Default Landing Page">
        <p>Where you land after signing in:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Hub</strong> — opens Hub Home (announcements and your rooms)</li>
          <li><strong className="text-white">Dashboard</strong> — opens the tool tile launcher</li>
        </ul>
      </Section>

      <Section title="Account — Notifications">
        <p>Controls all Hub notifications (web push and native app).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Everything</strong> — notify me for all messages in rooms I belong to</li>
          <li><strong className="text-white">Mentions + DMs only</strong> — only when I&apos;m @mentioned or someone DMs me</li>
          <li><strong className="text-white">Nothing</strong> — mute everything (including mentions and DMs)</li>
        </ul>
      </Section>

      <Section title="Account — Notifications: This device">
        <p>At the bottom of the Notifications section there&apos;s a <strong className="text-white">&ldquo;This device&rdquo;</strong> block showing whether the current device is registered to receive push notifications, with two buttons:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2 mt-2">
          <li><strong className="text-white">Send test notification</strong> — fires a real push to every device you&apos;re subscribed on. Use this to verify a device actually surfaces notifications. Make sure Hub isn&apos;t the focused window, otherwise the OS may suppress the banner (Slack works the same way).</li>
          <li><strong className="text-white">Reset notifications on this device</strong> — if pushes stop arriving on a device that used to get them, tap this. It clears the stale subscription, asks for permission again, and registers fresh. Per platform: web/PWA does the full reset; Android re-registers the FCM token; iOS Capacitor re-runs the push registration; the Mac/Windows desktop app uses a different mechanism and doesn&apos;t need a reset (just quit and reopen the app if its notifications stop).</li>
        </ul>
        <Note>If the status badge says &ldquo;Blocked in browser settings,&rdquo; the browser itself has blocked notifications for lynxedo.com. Open the browser&apos;s site settings for lynxedo.com and re-enable notifications, then come back here and tap Reset.</Note>
      </Section>

      <Section title="Account — Scheduled Do Not Disturb">
        <p>Automatically silence non-mention notifications during a recurring window every day (e.g. 9 PM to 6 AM). Mentions still come through.</p>
        <Step n={1}>Toggle <strong className="text-white">Scheduled Do Not Disturb</strong> on.</Step>
        <Step n={2}>Set <strong className="text-white">Quiet hours start</strong> and <strong className="text-white">Quiet hours end</strong>.</Step>
        <Step n={3}>If end is earlier than start (e.g. 10 PM → 6 AM), it wraps midnight automatically.</Step>
        <Note>DND is per-user — every teammate sets their own.</Note>
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
          <p>To make someone a manager: in <strong className="text-white">Admin → People</strong>, change their role dropdown to <em>Manager</em>. An amber <strong className="text-white">Admin Access</strong> panel appears with toggles for each admin area — People, Hub, Routing, Time Records, Fleet, Daily Log. Flip on whichever areas they should be able to manage. Only true admins (role = Admin) see this panel, and only true admins can change role or grant access.</p>
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
    </>
  )
}
