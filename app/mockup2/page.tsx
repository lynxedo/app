import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Lynxedo · Design Mockup 2',
  robots: { index: false, follow: false },
}

/**
 * STANDALONE DESIGN MOCKUP #2 — "total overhaul" liquid-glass direction.
 * A restyled copy of the Hub #routing screen. Pure presentational server
 * component: fake data, no auth, no backend, not wired into the live Hub.
 * Safe to delete this whole folder when we're done evaluating.
 */

// ---- fake data (realistic Heroes content) -------------------------------

type Person = { name: string; from: string; to: string; status?: 'online' | 'busy' | 'off' }

const PEOPLE: Record<string, Person> = {
  ben: { name: 'Ben Simpson', from: '#fbbf24', to: '#f59e0b', status: 'online' },
  kathryn: { name: 'Kathryn Reyes', from: '#34d399', to: '#10b981', status: 'online' },
  wilson: { name: 'Wilson Leon', from: '#60a5fa', to: '#3b82f6', status: 'online' },
  mike: { name: 'Mike Alvarez', from: '#c084fc', to: '#8b5cf6', status: 'busy' },
  zac: { name: 'Zac Lowder', from: '#fb7185', to: '#f43f5e', status: 'off' },
  angel: { name: 'Angel Ortiz', from: '#2dd4bf', to: '#06b6d4', status: 'online' },
  guardian: { name: 'Guardian', from: '#818cf8', to: '#38bdf8', status: 'online' },
}

function Avatar({ p, size = 36, ring = true }: { p: Person; size?: number; ring?: boolean }) {
  const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  const dot = p.status === 'online' ? '#34d399' : p.status === 'busy' ? '#fbbf24' : '#64748b'
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-full font-semibold text-white"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.36,
          background: `linear-gradient(140deg, ${p.from}, ${p.to})`,
          boxShadow: ring ? `0 4px 14px -4px ${p.to}AA, inset 0 0 0 1px rgba(255,255,255,.25)` : 'none',
        }}
      >
        {initials}
      </div>
      {p.status && (
        <span
          className="absolute rounded-full"
          style={{ width: size * 0.3, height: size * 0.3, right: -1, bottom: -1, background: dot, boxShadow: '0 0 0 2.5px rgba(8,10,22,.85), 0 0 10px ' + dot }}
        />
      )}
    </div>
  )
}

// ---- glyphs --------------------------------------------------------------

const I = {
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>,
  hub: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>,
  txt: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 10h8M8 14h5" /><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z" /></svg>,
  phone: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>,
  clock: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  route: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" /></svg>,
  log: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h9a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8" /><path d="M9 4 5 8M9 4v3a1 1 0 0 1-1 1H5M9 12h6M9 16h6" /></svg>,
  reports: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V4" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></svg>,
  apps: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>,
}

// ---- floating rail island ------------------------------------------------

function RailBtn({ children, label, active, badge }: { children: React.ReactNode; label: string; active?: boolean; badge?: number }) {
  return (
    <button className="group relative flex h-12 w-12 items-center justify-center" title={label}>
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 ${active ? 'text-white' : 'text-white/55 group-hover:text-white'}`}
        style={
          active
            ? { background: 'linear-gradient(140deg,#6366f1,#38bdf8)', boxShadow: '0 8px 22px -6px rgba(56,189,248,.8), inset 0 0 0 1px rgba(255,255,255,.25)' }
            : { background: 'transparent' }
        }
      >
        <span className="transition-transform duration-200 group-hover:scale-110">{children}</span>
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: 'linear-gradient(180deg,#fb7185,#f43f5e)', boxShadow: '0 0 0 2px rgba(10,12,24,.9)' }}>{badge}</span>
        ) : null}
      </span>
      {!active && <span className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100" style={{ background: 'rgba(255,255,255,.06)' }} />}
    </button>
  )
}

// ---- glass primitives ----------------------------------------------------

const GLASS: React.CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.02))',
  backdropFilter: 'blur(24px) saturate(160%)',
  WebkitBackdropFilter: 'blur(24px) saturate(160%)',
  border: '1px solid rgba(255,255,255,.10)',
  boxShadow: '0 24px 60px -24px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.14)',
}

function ChannelRow({ name, active, unread, muted, lock }: { name: string; active?: boolean; unread?: number; muted?: boolean; lock?: boolean }) {
  return (
    <button
      className={`group flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-sm transition-all duration-150 ${active ? 'text-white' : muted ? 'text-white/35 hover:text-white/70' : 'text-white/65 hover:text-white'}`}
      style={active ? { background: 'linear-gradient(90deg, rgba(99,102,241,.28), rgba(56,189,248,.10))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.16)' } : undefined}
    >
      <span className={`text-base ${active ? 'text-cyan-200' : 'text-white/30'}`}>{lock ? '🔒' : '#'}</span>
      <span className={`flex-1 truncate text-left ${active || (unread && !muted) ? 'font-semibold' : ''}`}>{name}</span>
      {unread ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: 'linear-gradient(180deg,#818cf8,#38bdf8)', boxShadow: '0 4px 10px -3px rgba(56,189,248,.8)' }}>{unread}</span> : null}
    </button>
  )
}

function DmRow({ id, active, unread, preview }: { id: string; active?: boolean; unread?: boolean; preview: string }) {
  const p = PEOPLE[id]
  return (
    <button
      className={`group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-sm transition-all duration-150 ${active ? 'text-white' : 'text-white/65 hover:text-white'}`}
      style={active ? { background: 'linear-gradient(90deg, rgba(99,102,241,.28), rgba(56,189,248,.10))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.16)' } : undefined}
    >
      <Avatar p={p} size={32} />
      <span className="min-w-0 flex-1 text-left">
        <span className={`block truncate ${unread ? 'font-semibold text-white' : ''}`}>{p.name}</span>
        <span className="block truncate text-xs text-white/35">{preview}</span>
      </span>
      {unread && <span className="h-2 w-2 flex-none rounded-full" style={{ background: '#38bdf8', boxShadow: '0 0 10px #38bdf8' }} />}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">{children}</div>
}

// ---- message -------------------------------------------------------------

function Message({ id, time, children, reactions, replies, continuation }: { id: string; time?: string; children: React.ReactNode; reactions?: { e: string; n: number }[]; replies?: { ids: string[]; n: number; last: string }; continuation?: boolean }) {
  const p = PEOPLE[id]
  return (
    <div className="group relative flex items-start gap-3 rounded-2xl px-2.5 py-1.5 transition-colors hover:bg-white/[0.04]">
      <div className="w-9 flex-none pt-0.5">{!continuation && <Avatar p={p} size={36} />}</div>
      <div className="min-w-0 flex-1">
        {!continuation && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-[15px] font-semibold text-white">{p.name}</span>
            {id === 'guardian' && <span className="rounded-md px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-cyan-200 ring-1 ring-inset ring-cyan-300/40" style={{ background: 'rgba(56,189,248,.14)' }}>Bot</span>}
            <span className="text-xs text-white/25">{time}</span>
          </div>
        )}
        <div className="text-[15px] leading-relaxed text-white/80">{children}</div>
        {reactions && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reactions.map((r) => (
              <span key={r.e} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-white/85" style={{ background: 'rgba(255,255,255,.06)', backdropFilter: 'blur(8px)', boxShadow: 'inset 0 0 0 1px rgba(129,140,248,.35)' }}>
                <span className="text-sm">{r.e}</span>
                <span className="font-semibold text-indigo-200">{r.n}</span>
              </span>
            ))}
            <span className="flex h-7 w-8 items-center justify-center rounded-full text-white/30 ring-1 ring-inset ring-white/10 transition-colors hover:text-white/70 hover:ring-white/25">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </span>
          </div>
        )}
        {replies && (
          <button className="mt-2 flex items-center gap-2 rounded-full px-2.5 py-1 text-xs transition-all hover:bg-white/[0.06]" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
            <span className="flex -space-x-1.5">{replies.ids.map((rid) => <Avatar key={rid} p={PEOPLE[rid]} size={20} ring={false} />)}</span>
            <span className="font-semibold text-cyan-200">{replies.n} replies</span>
            <span className="text-white/30">Last reply {replies.last}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ---- page ----------------------------------------------------------------

export default function Mockup2Page() {
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden text-white" style={{ background: '#07080f' }}>
      {/* aurora background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-[34rem] w-[34rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(99,102,241,.55), transparent 65%)', filter: 'blur(40px)' }} />
        <div className="absolute -right-24 top-10 h-[30rem] w-[30rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(56,189,248,.45), transparent 65%)', filter: 'blur(50px)' }} />
        <div className="absolute bottom-[-12rem] left-1/3 h-[32rem] w-[32rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(217,70,239,.30), transparent 65%)', filter: 'blur(60px)' }} />
        <div className="absolute bottom-0 right-1/4 h-[26rem] w-[26rem] rounded-full" style={{ background: 'radial-gradient(circle, rgba(45,212,191,.28), transparent 65%)', filter: 'blur(55px)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 0%, transparent 40%, rgba(7,8,15,.85) 100%)' }} />
      </div>

      {/* floating mockup badge */}
      <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-white/80" style={GLASS}>
          <span>✨</span>
          <span><span className="font-semibold">Design mockup #2</span> · total-overhaul / liquid glass — not the live app</span>
        </div>
      </div>

      {/* content */}
      <div className="relative z-10 flex h-full gap-3 p-3 md:gap-4 md:p-4">
        {/* ---- floating rail island ---- */}
        <nav className="hidden flex-none flex-col items-center justify-between rounded-[28px] px-2 py-4 md:flex" style={GLASS}>
          <div className="flex flex-col items-center gap-1">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-black text-[#0a0c18]" style={{ background: 'linear-gradient(140deg,#fbbf24,#f59e0b)', boxShadow: '0 8px 20px -6px rgba(245,158,11,.7)' }}>H</div>
            <RailBtn label="Search">{I.search}</RailBtn>
            <div className="my-1 h-px w-7 bg-white/10" />
            <RailBtn label="Hub" active badge={3}>{I.hub}</RailBtn>
            <RailBtn label="Txt2" badge={2}>{I.txt}</RailBtn>
            <RailBtn label="Phone">{I.phone}</RailBtn>
            <RailBtn label="Clock">{I.clock}</RailBtn>
            <RailBtn label="Routing">{I.route}</RailBtn>
            <RailBtn label="Daily Log">{I.log}</RailBtn>
            <RailBtn label="Reports">{I.reports}</RailBtn>
            <RailBtn label="Apps">{I.apps}</RailBtn>
          </div>
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="h-px w-7 bg-white/10" />
            <Avatar p={PEOPLE.ben} size={38} />
          </div>
        </nav>

        {/* ---- sidebar glass panel ---- */}
        <aside className="hidden w-72 flex-none flex-col rounded-[28px] md:flex" style={GLASS}>
          <div className="flex items-center gap-3 px-4 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold text-white">Heroes Lawn Care</div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-300/90"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 8px #34d399' }} />The Woodlands</div>
            </div>
          </div>
          <div className="px-3">
            <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-white/40" style={{ background: 'rgba(255,255,255,.05)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
              {I.search}<span>Jump to…</span><span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/45">⌘K</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <SectionLabel>★ Favorites</SectionLabel>
            <ChannelRow name="routing" active unread={3} />
            <ChannelRow name="general" />
            <SectionLabel>Channels <span className="ml-auto text-white/25">▾</span></SectionLabel>
            <ChannelRow name="general" />
            <ChannelRow name="office" lock />
            <ChannelRow name="technicians" unread={7} />
            <ChannelRow name="daily-standup" muted />
            <ChannelRow name="wins" />
            <SectionLabel>Direct Messages <span className="ml-auto text-white/25">▾</span></SectionLabel>
            <DmRow id="wilson" unread preview="On it 👍" />
            <DmRow id="kathryn" preview="You: sounds good, thanks!" />
            <DmRow id="zac" preview="Routes look good for tomorrow" />
            <DmRow id="angel" preview="Heading to the shop now" />
            <DmRow id="guardian" preview="Daily digest is ready ☀️" />
          </div>
        </aside>

        {/* ---- main glass panel ---- */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px]" style={GLASS}>
          {/* header */}
          <header className="flex flex-none items-center gap-3 border-b border-white/[0.08] px-5 py-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold leading-tight" style={{ background: 'linear-gradient(90deg,#fff,#a5b4fc 60%,#7dd3fc)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}># routing</h1>
              <p className="text-xs text-white/40">Dispatch &amp; route planning · 8 members</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center -space-x-2 sm:flex">
                {['kathryn', 'wilson', 'mike', 'zac', 'angel'].map((id) => <Avatar key={id} p={PEOPLE[id]} size={30} ring />)}
              </div>
              <button className="flex h-10 w-10 items-center justify-center rounded-2xl text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
              </button>
            </div>
          </header>

          {/* feed */}
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-4 md:px-5">
            <div className="my-3 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.08]" />
              <span className="rounded-full px-3 py-1 text-xs font-medium text-white/45" style={{ background: 'rgba(255,255,255,.05)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>Today</span>
              <div className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <Message id="kathryn" time="7:58 AM">Route 4 is running ~30 min behind — the irrigation check over on Creekside took longer than planned. 🌧️</Message>
            <Message id="wilson" time="8:04 AM" reactions={[{ e: '👍', n: 3 }, { e: '🚜', n: 2 }]}>Finished the aerations on Route 2, lawns looked great. Heading to the next stop now.</Message>
            <Message id="ben" time="8:11 AM" replies={{ ids: ['wilson', 'zac'], n: 2, last: '8:19 AM' }}>
              <span className="rounded-md px-1 font-medium text-cyan-200" style={{ background: 'rgba(56,189,248,.16)' }}>@Wilson</span> can you add the <span className="font-medium text-white">Gloria Rodriguez</span> property to Route 2? She called about a sprinkler zone that&apos;s not turning on.
            </Message>
            <Message id="wilson" time="8:13 AM" continuation>On it 👍 I&apos;ll swing by after the Heath stop.</Message>
            <Message id="mike" time="8:22 AM">Truck 3 is low on fuel — stopping at the Buc-ee&apos;s on 1488, back on route in 10.</Message>
            <Message id="zac" time="8:30 AM" reactions={[{ e: '🔥', n: 4 }, { e: '🎉', n: 2 }]}>✓ Optimized tomorrow&apos;s routes — <span className="font-medium text-white">RC3</span> saves about 22 minutes of drive time. Sheet&apos;s in Daily Log.</Message>

            <Message id="guardian" time="8:31 AM">
              <div className="mt-1.5 max-w-md rounded-3xl p-4" style={{ background: 'linear-gradient(150deg, rgba(99,102,241,.22), rgba(56,189,248,.10))', backdropFilter: 'blur(12px)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18), 0 20px 50px -20px rgba(99,102,241,.7)' }}>
                <div className="mb-2.5 flex items-center gap-2 text-sm font-bold text-white">☀️ Morning Dispatch Summary</div>
                <div className="space-y-2 text-sm text-white/75">
                  <div className="flex items-center justify-between gap-4"><span>Visits scheduled today</span><span className="font-semibold text-white">47</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Techs clocked in</span><span className="font-semibold text-emerald-300">6 / 7</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Routes optimized</span><span className="font-semibold text-white">RC1–RC8</span></div>
                </div>
                <button className="mt-3.5 w-full rounded-2xl py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]" style={{ background: 'linear-gradient(90deg,#6366f1,#38bdf8)', boxShadow: '0 10px 26px -8px rgba(56,189,248,.8)' }}>Open today&apos;s board →</button>
              </div>
            </Message>
          </div>

          {/* floating composer */}
          <div className="flex-none px-3 pb-4 md:px-5">
            <div className="flex items-end gap-2 rounded-[22px] p-2" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.03))', backdropFilter: 'blur(20px)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14), 0 14px 40px -18px rgba(0,0,0,.8)' }}>
              <div className="flex items-center gap-0.5 pb-1.5">
                {[
                  <svg key="a" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 1 1 5.18 5.18l-8.49 8.49a1.83 1.83 0 1 1-2.59-2.59l7.78-7.78" /></svg>,
                  <span key="e" className="text-lg leading-none">😀</span>,
                  <span key="f" className="text-[13px] font-semibold leading-none">Aa</span>,
                ].map((g, i) => (
                  <button key={i} className="flex h-9 w-9 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white">{g}</button>
                ))}
              </div>
              <div className="flex-1 py-2.5 text-[15px] text-white/35">Message #routing…</div>
              <button className="mb-0.5 flex h-10 items-center gap-1.5 rounded-2xl px-5 text-sm font-bold text-white transition-transform hover:scale-[1.04]" style={{ background: 'linear-gradient(90deg,#6366f1,#38bdf8)', boxShadow: '0 10px 26px -8px rgba(56,189,248,.85)' }}>
                Send
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-white/25">Static preview · buttons aren&apos;t wired up</p>
          </div>
        </main>
      </div>
    </div>
  )
}
