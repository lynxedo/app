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
  { id: 'call-log',     icon: '📞', label: 'Call Log' },
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
        {activeTab === 'call-log'   && <CallLogTab />}
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

      <Section title="Sidebar Navigation">
        <p>The sidebar on the left is how you get around Hub. Top to bottom you&apos;ll see:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Home</strong> — announcements, shout outs, your starred rooms</li>
          <li><strong className="text-white">Clients</strong> — SMS conversations with customers (Captivated)</li>
          <li><strong className="text-white">Rooms</strong> — group conversations you belong to</li>
          <li><strong className="text-white">Direct Messages</strong> — your one-on-ones</li>
          <li><strong className="text-white">Boards</strong> — your saved-message boards</li>
          <li><strong className="text-white">Tools</strong> — Daily Log, Tracker, Lawn Sizer, Call Log, Routing, Books, Time Records</li>
          <li><strong className="text-white">Pages</strong> — Company News, Files</li>
          <li><strong className="text-white">Links</strong> — one-click shortcuts to external tools (Jobber, Gusto, QuickBooks, Captivated, etc.)</li>
        </ul>
        <Note>📱 On mobile, the sidebar is hidden by default — tap the menu icon (top-left) to open it. Swiping right from the left edge also opens it.</Note>
      </Section>

      <Section title="Rooms">
        <p>Rooms are group conversations — usually organized by team, topic, or job site (e.g. <em>#crew-chat</em>, <em>#field-ops</em>).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Join a room</strong> — sidebar &gt; <em>+ Browse rooms</em>, then click Join on any room you want to be in.</li>
          <li><strong className="text-white">Leave a room</strong> — open the room, click the room name at the top, then Leave.</li>
          <li><strong className="text-white">Star a room</strong> — click the star icon next to a room in the sidebar to pin it to the top.</li>
        </ul>
        <AdminOnly>
          <p>Admins can create new rooms from the sidebar (<em>+ New room</em>), edit room names and descriptions, and remove members. Rooms can be made <strong className="text-white">private</strong> (members-only, doesn&apos;t appear in Browse).</p>
        </AdminOnly>
      </Section>

      <Section title="Direct Messages (DMs)">
        <p>DMs are private conversations between two people, or a small group.</p>
        <Step n={1}>Click <strong className="text-white">+ New DM</strong> in the sidebar.</Step>
        <Step n={2}>Pick one person for a one-on-one, or multiple people for a group DM.</Step>
        <Step n={3}>Type your message and send. The DM appears in their sidebar instantly.</Step>
        <Note>DMs cannot be deleted, but you can hide them from your sidebar by clicking the ✕ next to the conversation.</Note>
      </Section>

      <Section title="Sending Messages">
        <p>The composer is the box at the bottom of every conversation.</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Send</strong> — on desktop, press Enter. On phone or tablet, tap the blue send button (only shows up once you&apos;ve started typing).</li>
          <li><strong className="text-white">New line</strong> — Shift+Enter on desktop. On mobile, plain Enter inserts a new line — sending takes a deliberate tap of the send button so you can&apos;t fire off a half-typed message by accident.</li>
          <li><strong className="text-white">@mention someone</strong> — type <code className="bg-gray-800 px-1 rounded text-orange-300">@</code> and start typing a name. They&apos;ll get a push notification even if Notifications are set to Mentions only.</li>
          <li><strong className="text-white">Attach a file or photo</strong> — paperclip icon, or paste/drop directly into the composer.</li>
          <li><strong className="text-white">Emoji</strong> — smiley icon, or just type 🙂.</li>
        </ul>
      </Section>

      <Section title="Message Actions (long-press / right-click)">
        <p>Long-press a message on mobile, or hover and right-click on desktop, to see the actions menu:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">React</strong> — tap an emoji to react. Anyone in the conversation can see and click the reaction.</li>
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
        <p>Two tickers appear at the top of Hub Home:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">📢 Announcements (blue)</strong> — company-wide updates the admin team wants everyone to see (policy changes, schedule notes, etc.).</li>
          <li><strong className="text-white">🎉 Shout Outs (gold)</strong> — recognition for great work, customer compliments, milestones.</li>
        </ul>
        <p>Click either ticker to open the full <strong className="text-white">Company News</strong> page where everything is sorted by Active / Archived / Expired.</p>
        <AdminOnly>
          <p>Admins post announcements from <strong className="text-white">/admin/hub → Announcements</strong>. Anyone with the <em>Can post Shout Outs</em> flag enabled can post shout outs from the same page. Posting a new active announcement automatically archives the previous one — only one is live at a time.</p>
        </AdminOnly>
      </Section>

      <Section title="@Guardian Bot">
        <p>Guardian is an AI helper that lives in Hub. @mention <strong className="text-orange-300">@Guardian</strong> in any room or DM and ask it questions about Lynxedo or the business — it has context on your data and replies in-thread.</p>
        <p className="text-gray-400 text-xs">Examples: <em>&ldquo;@Guardian how many visits do we have tomorrow?&rdquo;</em> · <em>&ldquo;@Guardian who&apos;s clocked in right now?&rdquo;</em></p>
      </Section>

      <Section title="Slack Bridge">
        <p>Messages posted in Hub also relay into the matching Slack channel (and vice versa) so anyone still on Slack stays in the loop during the transition. Look for the small Slack icon next to bridged messages.</p>
        <Note>The bridge is one-way for some channels and two-way for others — ask Ben if a specific room is bridged.</Note>
      </Section>

      <Section title="Clients (SMS)">
        <p>The <strong className="text-white">Clients</strong> tab in the sidebar shows SMS conversations with customers, powered by Captivated. Replying here sends a real text from the company number.</p>
        <p>Each conversation shows the client&apos;s name (matched to Jobber when possible), the conversation history, and unread badges.</p>
      </Section>

      <Section title="Daily Log">
        <p>Daily Log is a running log of operational notes for the day — who&apos;s on what crew, what went wrong, what got finished. Anyone can post.</p>
        <p>Posts are organized by date. Scrolling back through old days is how you reconstruct what happened the week of a callback.</p>
      </Section>

      <Section title="Tracker (Lead Pipeline)">
        <p>Tracker is the lead pipeline — every inbound lead from any source ends up here as a card you move through stages (New → Quoted → Won / Lost).</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li><strong className="text-white">Pipeline</strong> — kanban view, drag cards between stages.</li>
          <li><strong className="text-white">Dashboard</strong> — counts and conversion rates by source, by month.</li>
          <li><strong className="text-white">Import</strong> — bulk-add leads from a spreadsheet.</li>
        </ul>
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
        <Step n={3}>Head to the <Link href="/routing" className="text-orange-400 hover:text-orange-300">Route Optimizer</Link> and build your first route.</Step>
      </Section>

      <Section title="Building a Route">
        <Step n={1}><strong className="text-white">Select a tech</strong> — choose the team member whose visits you&apos;re routing. The list pulls from your Jobber users.</Step>
        <Step n={2}><strong className="text-white">Pick a date</strong> — defaults to today.</Step>
        <Step n={3}><strong className="text-white">Set a start time</strong> — when the tech leaves the depot. Used to calculate ETAs.</Step>
        <Step n={4}><strong className="text-white">Load Stops</strong> — fetches all visits and assessments scheduled for that tech on that date.</Step>
        <Step n={5}><strong className="text-white">Optimize</strong> — reorders the stops to minimize total drive time. The depot is always locked first and last.</Step>
        <p className="mt-2">After optimizing, each stop shows:</p>
        <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
          <li>ETA and on-site duration</li>
          <li>Drive time from the previous stop</li>
          <li>Client name, address, and job details</li>
          <li>📋 badge = assessment/request stop</li>
          <li>🗺 badge = real road times used (vs straight-line estimate)</li>
          <li>Yellow banner = duration fell back to default (no matching line items)</li>
        </ul>
      </Section>

      <Section title="Reordering Stops Manually">
        <p>After loading or optimizing, drag stops up or down to adjust the order manually. Click <strong className="text-white">Recalculate</strong> to update all ETAs and drive times for the new sequence. The depot stays locked first and last.</p>
      </Section>

      <Section title="Sending Times to Jobber">
        <p>Click <strong className="text-white">Send to Jobber</strong>. The calculated ETA is written as the scheduled appointment time for each visit (and each assessment). Each stop shows a ✓ or an error after sending.</p>
        <Note>⚠️ Sending overwrites any existing appointment times on those visits.</Note>
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
          <p>Routing settings are now <strong className="text-white">company-wide</strong> (Session 34) — one admin configures them once and everyone uses the same depot, duration rules, and defaults. Open them at <Link href="/admin/routing" className="text-orange-400 hover:text-orange-300">Admin → Routing</Link>.</p>

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
