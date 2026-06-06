import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Lynxedo · Design Mockup',
  robots: { index: false, follow: false },
}

/**
 * STANDALONE DESIGN MOCKUP — not wired into the live Hub.
 * A restyled copy of the Hub #routing screen used to preview a more modern look.
 * Pure presentational server component: fake data, no auth, no backend.
 * Safe to delete this whole folder when we're done evaluating the direction.
 */

// ---- fake data (realistic Heroes content) -------------------------------

type Person = { name: string; from: string; to: string; status?: 'online' | 'busy' | 'off' }

const PEOPLE: Record<string, Person> = {
  ben: { name: 'Ben Simpson', from: '#f59e0b', to: '#d97706', status: 'online' },
  kathryn: { name: 'Kathryn Reyes', from: '#34d399', to: '#059669', status: 'online' },
  wilson: { name: 'Wilson Leon', from: '#38bdf8', to: '#2563eb', status: 'online' },
  mike: { name: 'Mike Alvarez', from: '#a78bfa', to: '#7c3aed', status: 'busy' },
  zac: { name: 'Zac Lowder', from: '#fb7185', to: '#e11d48', status: 'off' },
  angel: { name: 'Angel Ortiz', from: '#2dd4bf', to: '#0891b2', status: 'online' },
  guardian: { name: 'Guardian', from: '#2E7EB8', to: '#38bdf8', status: 'online' },
}

function Avatar({
  p,
  size = 36,
  ring = true,
}: {
  p: Person
  size?: number
  ring?: boolean
}) {
  const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  const dot =
    p.status === 'online'
      ? '#34d399'
      : p.status === 'busy'
      ? '#fbbf24'
      : '#64748b'
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-full font-semibold text-white"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.36,
          background: `linear-gradient(140deg, ${p.from}, ${p.to})`,
          boxShadow: ring
            ? `0 1px 2px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.12)`
            : 'none',
        }}
      >
        {initials}
      </div>
      {p.status && (
        <span
          className="absolute rounded-full"
          style={{
            width: size * 0.3,
            height: size * 0.3,
            right: -1,
            bottom: -1,
            background: dot,
            boxShadow: '0 0 0 2.5px #0c1322',
          }}
        />
      )}
    </div>
  )
}

// ---- rail ----------------------------------------------------------------

function RailIcon({
  label,
  active,
  badge,
  children,
}: {
  label: string
  active?: boolean
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      className={`group relative flex w-full flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-all ${
        active ? 'text-white' : 'text-white/45 hover:text-white'
      }`}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{ background: 'linear-gradient(180deg,#38bdf8,#2E7EB8)', boxShadow: '0 0 12px #2E7EB8' }}
        />
      )}
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
          active
            ? 'text-white'
            : 'text-white/55 group-hover:bg-white/[0.06] group-hover:text-white'
        }`}
        style={
          active
            ? {
                background: 'linear-gradient(145deg, rgba(56,189,248,.22), rgba(46,126,184,.28))',
                boxShadow: 'inset 0 0 0 1px rgba(56,189,248,.35), 0 4px 16px -6px rgba(46,126,184,.7)',
              }
            : undefined
        }
      >
        {children}
        {badge ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
            style={{ background: 'linear-gradient(180deg,#fb923c,#f97316)', boxShadow: '0 0 0 2px #0c1322' }}
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className="leading-none">{label}</span>
    </button>
  )
}

// tiny inline glyphs (stroke style, consistent weight)
const I = {
  search: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
  ),
  hub: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>
  ),
  txt: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 10h8M8 14h5" /><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z" /></svg>
  ),
  phone: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>
  ),
  clock: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  route: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" /></svg>
  ),
  log: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h9a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8" /><path d="M9 4 5 8M9 4v3a1 1 0 0 1-1 1H5M9 12h6M9 16h6" /></svg>
  ),
  reports: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V4" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></svg>
  ),
  apps: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>
  ),
  gear: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.2A1.6 1.6 0 0 0 7 19.5a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.2A1.6 1.6 0 0 0 2.5 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.5h.1A1.6 1.6 0 0 0 8.2 1V1a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" /></svg>
  ),
}

// ---- sidebar -------------------------------------------------------------

function ChannelRow({
  name,
  active,
  unread,
  muted,
  lock,
}: {
  name: string
  active?: boolean
  unread?: number
  muted?: boolean
  lock?: boolean
}) {
  return (
    <button
      className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-sm transition-all ${
        active
          ? 'text-white'
          : muted
          ? 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
          : 'text-white/70 hover:bg-white/[0.05] hover:text-white'
      }`}
      style={
        active
          ? {
              background: 'linear-gradient(90deg, rgba(46,126,184,.22), rgba(46,126,184,.05))',
              boxShadow: 'inset 0 0 0 1px rgba(56,189,248,.18)',
            }
          : undefined
      }
    >
      <span className={`text-base ${active ? 'text-sky-300' : 'text-white/35'}`}>
        {lock ? '🔒' : '#'}
      </span>
      <span className={`flex-1 truncate text-left ${active || (unread && !muted) ? 'font-semibold' : ''}`}>
        {name}
      </span>
      {unread ? (
        <span
          className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
          style={{ background: 'linear-gradient(180deg,#fb923c,#f97316)' }}
        >
          {unread}
        </span>
      ) : null}
    </button>
  )
}

function DmRow({ id, active, unread, preview }: { id: string; active?: boolean; unread?: boolean; preview: string }) {
  const p = PEOPLE[id]
  return (
    <button
      className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-all ${
        active ? 'text-white' : 'text-white/70 hover:bg-white/[0.05] hover:text-white'
      }`}
      style={
        active
          ? { background: 'linear-gradient(90deg, rgba(46,126,184,.22), rgba(46,126,184,.05))', boxShadow: 'inset 0 0 0 1px rgba(56,189,248,.18)' }
          : undefined
      }
    >
      <Avatar p={p} size={30} />
      <span className="min-w-0 flex-1 text-left">
        <span className={`block truncate ${unread ? 'font-semibold text-white' : ''}`}>{p.name}</span>
        <span className="block truncate text-xs text-white/40">{preview}</span>
      </span>
      {unread && <span className="h-2 w-2 flex-none rounded-full bg-orange-400" style={{ boxShadow: '0 0 8px #fb923c' }} />}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-white/35">
      {children}
    </div>
  )
}

// ---- message -------------------------------------------------------------

function Message({
  id,
  time,
  children,
  reactions,
  replies,
  continuation,
  highlight,
}: {
  id: string
  time?: string
  children: React.ReactNode
  reactions?: { e: string; n: number }[]
  replies?: { ids: string[]; n: number; last: string }
  continuation?: boolean
  highlight?: boolean
}) {
  const p = PEOPLE[id]
  return (
    <div
      className="group relative flex items-start gap-3 rounded-xl px-2 py-1 transition-colors hover:bg-white/[0.03]"
      style={highlight ? { background: 'linear-gradient(90deg, rgba(46,126,184,.10), transparent)' } : undefined}
    >
      <div className="w-9 flex-none pt-0.5">{!continuation && <Avatar p={p} size={36} />}</div>
      <div className="min-w-0 flex-1">
        {!continuation && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-[15px] font-semibold text-white">{p.name}</span>
            {id === 'guardian' && (
              <span className="rounded-md bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-300 ring-1 ring-inset ring-sky-400/30">
                Bot
              </span>
            )}
            <span className="text-xs text-white/30">{time}</span>
          </div>
        )}
        <div className="text-[15px] leading-relaxed text-white/80">{children}</div>

        {reactions && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {reactions.map((r) => (
              <span
                key={r.e}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-white/80 ring-1 ring-inset ring-sky-400/25"
                style={{ background: 'rgba(56,189,248,.10)' }}
              >
                <span className="text-sm">{r.e}</span>
                <span className="font-semibold text-sky-200">{r.n}</span>
              </span>
            ))}
            <span className="flex h-6 w-7 items-center justify-center rounded-full text-white/30 ring-1 ring-inset ring-white/10 transition-colors hover:text-white/70 hover:ring-white/20">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </span>
          </div>
        )}

        {replies && (
          <button className="mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-white/[0.05]">
            <span className="flex -space-x-1.5">
              {replies.ids.map((rid) => (
                <Avatar key={rid} p={PEOPLE[rid]} size={20} ring={false} />
              ))}
            </span>
            <span className="font-semibold text-sky-300">{replies.n} replies</span>
            <span className="text-white/30">Last reply {replies.last}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ---- page ----------------------------------------------------------------

export default function MockupPage() {
  return (
    <div
      className="flex h-[100dvh] w-full flex-col overflow-hidden text-white"
      style={{ background: 'radial-gradient(1200px 600px at 18% -10%, #102338 0%, transparent 55%), linear-gradient(160deg,#0a0f1c 0%,#0b1320 60%,#090d18 100%)' }}
    >
      {/* mockup banner */}
      <div className="flex flex-none items-center justify-center gap-2 border-b border-white/[0.06] bg-sky-500/[0.07] px-4 py-1.5 text-center text-xs text-sky-200/90 backdrop-blur">
        <span>✨</span>
        <span>
          <span className="font-semibold text-sky-100">Design mockup</span> — a preview of a more modern Hub. Not the live app. Compare side-by-side with{' '}
          <span className="font-mono text-sky-100">/hub</span>.
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---- icon rail ---- */}
        <nav
          className="hidden w-[68px] flex-none flex-col items-center border-r border-white/[0.06] py-3 md:flex"
          style={{ background: 'linear-gradient(180deg,#0b1626,#0a1120)' }}
        >
          <RailIcon label="Search">{I.search}</RailIcon>
          <div className="my-2 h-px w-8 bg-white/[0.06]" />
          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
            <RailIcon label="Hub" active badge={3}>{I.hub}</RailIcon>
            <RailIcon label="Txt2" badge={2}>{I.txt}</RailIcon>
            <RailIcon label="Phone">{I.phone}</RailIcon>
            <RailIcon label="Clock">{I.clock}</RailIcon>
            <RailIcon label="Routing">{I.route}</RailIcon>
            <RailIcon label="Daily Log">{I.log}</RailIcon>
            <RailIcon label="Reports">{I.reports}</RailIcon>
          </div>
          <div className="mt-1 flex w-full flex-col items-center gap-0.5 border-t border-white/[0.06] pt-2">
            <RailIcon label="Apps">{I.apps}</RailIcon>
            <RailIcon label="Settings">{I.gear}</RailIcon>
            <div className="pt-1.5">
              <Avatar p={PEOPLE.ben} size={34} />
            </div>
          </div>
        </nav>

        {/* ---- sidebar ---- */}
        <aside
          className="hidden w-72 flex-none flex-col border-r border-white/[0.06] md:flex"
          style={{ background: 'linear-gradient(180deg,rgba(17,26,42,.55),rgba(12,19,34,.55))' }}
        >
          {/* workspace header */}
          <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3 py-3">
            <div
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-sm font-black text-[#08111f]"
              style={{ background: 'linear-gradient(140deg,#fbbf24,#f59e0b)', boxShadow: '0 4px 14px -4px rgba(245,158,11,.6)' }}
            >
              H
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">Heroes Lawn Care</div>
              <div className="truncate text-xs text-emerald-300/80">● The Woodlands</div>
            </div>
            <button className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 ring-1 ring-inset ring-white/10 hover:text-white">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>

          {/* search */}
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-sm text-white/40 ring-1 ring-inset ring-white/[0.07]">
              {I.search}
              <span>Jump to…</span>
              <span className="ml-auto rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/40">⌘K</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <SectionLabel>★ Favorites</SectionLabel>
            <ChannelRow name="routing" active unread={3} />
            <ChannelRow name="general" />

            <SectionLabel>
              Channels
              <span className="ml-auto text-white/25">▾</span>
            </SectionLabel>
            <ChannelRow name="general" />
            <ChannelRow name="office" lock />
            <ChannelRow name="technicians" unread={7} />
            <ChannelRow name="daily-standup" muted />
            <ChannelRow name="wins" />

            <SectionLabel>
              Direct Messages
              <span className="ml-auto text-white/25">▾</span>
            </SectionLabel>
            <DmRow id="wilson" unread preview="On it 👍" />
            <DmRow id="kathryn" preview="You: sounds good, thanks!" />
            <DmRow id="zac" preview="Routes look good for tomorrow" />
            <DmRow id="angel" preview="Heading to the shop now" />
            <DmRow id="guardian" preview="Daily digest is ready ☀️" />
          </div>
        </aside>

        {/* ---- main column ---- */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* room header */}
          <header className="flex flex-none items-center gap-3 border-b border-white/[0.06] px-4 py-3 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-xl text-sky-300/70">#</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-[17px] font-semibold text-white">routing</h1>
                  <span className="hidden rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-white/45 ring-1 ring-inset ring-white/10 sm:inline">
                    Dispatch &amp; route planning
                  </span>
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center -space-x-2 sm:flex">
                {['kathryn', 'wilson', 'mike', 'zac', 'angel'].map((id) => (
                  <Avatar key={id} p={PEOPLE[id]} size={28} ring />
                ))}
                <span className="flex h-7 items-center rounded-full bg-white/[0.06] px-2 text-xs font-medium text-white/55 ring-1 ring-inset ring-white/10">
                  8
                </span>
              </div>
              <button className="flex h-9 w-9 items-center justify-center rounded-xl text-white/45 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.05] hover:text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
              </button>
            </div>
          </header>

          {/* feed */}
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-4 md:px-6">
            <div className="my-3 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.07]" />
              <span className="rounded-full bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/45 ring-1 ring-inset ring-white/[0.07]">
                Today
              </span>
              <div className="h-px flex-1 bg-white/[0.07]" />
            </div>

            <Message id="kathryn" time="7:58 AM">
              Route 4 is running ~30 min behind — the irrigation check over on Creekside took longer than planned. 🌧️
            </Message>

            <Message
              id="wilson"
              time="8:04 AM"
              reactions={[{ e: '👍', n: 3 }, { e: '🚜', n: 2 }]}
            >
              Finished the aerations on Route 2, lawns looked great. Heading to the next stop now.
            </Message>

            <Message
              id="ben"
              time="8:11 AM"
              replies={{ ids: ['wilson', 'zac'], n: 2, last: '8:19 AM' }}
            >
              <span className="rounded-md bg-sky-500/15 px-1 font-medium text-sky-200">@Wilson</span>{' '}
              can you add the <span className="font-medium text-white">Gloria Rodriguez</span> property to Route 2? She called about a sprinkler zone that&apos;s not turning on.
            </Message>

            <Message id="wilson" time="8:13 AM" continuation>
              On it 👍 I&apos;ll swing by after the Heath stop.
            </Message>

            <Message id="mike" time="8:22 AM" highlight>
              Truck 3 is low on fuel — stopping at the Buc-ee&apos;s on 1488, back on route in 10.
            </Message>

            <Message
              id="zac"
              time="8:30 AM"
              reactions={[{ e: '🔥', n: 4 }, { e: '🎉', n: 2 }]}
            >
              ✓ Optimized tomorrow&apos;s routes — <span className="font-medium text-white">RC3</span> saves about 22 minutes of drive time. Sheet&apos;s in Daily Log.
            </Message>

            <Message id="guardian" time="8:31 AM">
              <div
                className="mt-1 max-w-md rounded-2xl border border-white/[0.07] p-3.5"
                style={{ background: 'linear-gradient(150deg,rgba(46,126,184,.14),rgba(12,19,34,.4))', boxShadow: '0 10px 30px -16px rgba(46,126,184,.5)' }}
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-200">
                  ☀️ Morning Dispatch Summary
                </div>
                <div className="space-y-1.5 text-sm text-white/70">
                  <div className="flex items-center justify-between gap-4"><span>Visits scheduled today</span><span className="font-semibold text-white">47</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Techs clocked in</span><span className="font-semibold text-emerald-300">6 / 7</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Routes optimized</span><span className="font-semibold text-white">RC1–RC8</span></div>
                </div>
                <button className="mt-3 w-full rounded-xl py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.01]" style={{ background: 'linear-gradient(90deg,#2E7EB8,#38bdf8)' }}>
                  Open today&apos;s board →
                </button>
              </div>
            </Message>
          </div>

          {/* composer */}
          <div className="flex-none px-3 pb-4 md:px-6">
            <div
              className="rounded-2xl border border-white/[0.08] p-2"
              style={{ background: 'linear-gradient(180deg,rgba(20,30,49,.7),rgba(13,20,34,.7))', boxShadow: '0 -2px 24px -12px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.02)' }}
            >
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-0.5 pb-1.5">
                  {[
                    <svg key="a" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 1 1 5.18 5.18l-8.49 8.49a1.83 1.83 0 1 1-2.59-2.59l7.78-7.78" /></svg>,
                    <span key="e" className="text-lg leading-none">😀</span>,
                    <span key="f" className="text-[13px] font-semibold leading-none">Aa</span>,
                  ].map((g, i) => (
                    <button key={i} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white">
                      {g}
                    </button>
                  ))}
                </div>
                <div className="flex-1 py-2 text-[15px] text-white/35">Message #routing…</div>
                <button
                  className="mb-0.5 flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
                  style={{ background: 'linear-gradient(90deg,#2E7EB8,#38bdf8)', boxShadow: '0 6px 18px -6px rgba(56,189,248,.7)' }}
                >
                  Send
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                </button>
              </div>
            </div>
            <p className="mt-1.5 px-1 text-center text-[11px] text-white/25">
              Static preview · buttons aren&apos;t wired up
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
