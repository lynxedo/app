import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Lynxedo · Rail + App Drawer Mockup',
  robots: { index: false, follow: false },
}

/**
 * STANDALONE DESIGN MOCKUP #3 — redesigned icon rail + app drawer (Option A look).
 * Pure presentational server component: fake data, no auth, not wired into the
 * live Hub. Uses Heroes' real app catalog as the drawer tiles. Safe to delete.
 */

// ---- glyphs (stroke = currentColor) -------------------------------------

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const G: Record<string, React.ReactNode> = {
  search: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>,
  hub: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>,
  txt: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h6" /></svg>,
  txt2: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M8 10h.01M12 10h.01M16 10h.01" /><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z" /></svg>,
  phone: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>,
  clock: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  log: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M9 4h9a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8" /><path d="M9 4 5 8M9 4v3a1 1 0 0 1-1 1H5M9 12h6M9 16h6" /></svg>,
  route: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" /></svg>,
  reports: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M4 20V4" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></svg>,
  apps: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>,
  gear: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" /></svg>,
  truck: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M1 4h13v11H1zM14 8h4l3 3v4h-7" /><circle cx="6" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" /></svg>,
  funnel: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>,
  book: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></svg>,
  megaphone: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V7L6 11H4a1 1 0 0 0-1 1Z" transform="translate(1 0)" /><path d="M14 8a4 4 0 0 1 0 8M18 6a7 7 0 0 1 0 12" /></svg>,
  folder: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  user: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>,
  form: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>,
  flask: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M9 3h6M10 3v6l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3" /><path d="M7.5 14h9" /></svg>,
  calllog: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M13 4h8M13 9h8M13 14h5" /><path d="M3 5.5C3 4.7 3.7 4 4.5 4H6l1.2 3-1.5 1a8 8 0 0 0 3.3 3.3l1-1.5 3 1.2v1.5c0 .8-.7 1.5-1.5 1.5A8.8 8.8 0 0 1 3 5.5Z" /></svg>,
  wrench: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6l-7 7a2.1 2.1 0 0 1-3-3l7-7a3.5 3.5 0 0 0-1.6-1.6Z" /></svg>,
  news: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M4 5h13v14H5a1 1 0 0 1-1-1zM17 8h3v9a2 2 0 0 1-2 2" /><path d="M7 9h7M7 13h7M7 16h4" /></svg>,
  ruler: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M4 16 16 4l4 4L8 20z" /><path d="M9 9l1.5 1.5M12 6l1.5 1.5M6 12l1.5 1.5" /></svg>,
  moon: <svg width="20" height="20" viewBox="0 0 24 24" {...s}><path d="M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8Z" /></svg>,
  edit: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>,
}

// ---- rail ----------------------------------------------------------------

function RailIcon({ label, glyph, active, badge, dot }: { label: string; glyph: React.ReactNode; active?: boolean; badge?: number; dot?: boolean }) {
  return (
    <button className={`group relative flex w-full flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-all ${active ? 'text-white' : 'text-white/45 hover:text-white'}`}>
      {active && <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full" style={{ background: 'linear-gradient(180deg,#38bdf8,#2E7EB8)', boxShadow: '0 0 12px #2E7EB8' }} />}
      <span
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all ${active ? 'text-white' : 'text-white/55 group-hover:bg-white/[0.06] group-hover:text-white'}`}
        style={active ? { background: 'linear-gradient(145deg, rgba(56,189,248,.22), rgba(46,126,184,.28))', boxShadow: 'inset 0 0 0 1px rgba(56,189,248,.35), 0 4px 16px -6px rgba(46,126,184,.7)' } : undefined}
      >
        {glyph}
        {badge ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: 'linear-gradient(180deg,#fb923c,#f97316)', boxShadow: '0 0 0 2px #0b1322' }}>{badge}</span> : null}
        {dot ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-orange-400" style={{ boxShadow: '0 0 0 2px #0b1322' }} /> : null}
      </span>
      <span className="leading-none">{label}</span>
    </button>
  )
}

// ---- app tile ------------------------------------------------------------

type App = { label: string; glyph: keyof typeof G; color: string; badge?: number; onRail?: boolean }

const APPS: App[] = [
  { label: 'Hub', glyph: 'hub', color: '#38bdf8', badge: 3, onRail: true },
  { label: 'Txt', glyph: 'txt', color: '#2dd4bf' },
  { label: 'Txt2', glyph: 'txt2', color: '#60a5fa', badge: 2, onRail: true },
  { label: 'Phone', glyph: 'phone', color: '#34d399', onRail: true },
  { label: 'Time Clock', glyph: 'clock', color: '#fbbf24', onRail: true },
  { label: 'Daily Log', glyph: 'log', color: '#fb923c', onRail: true },
  { label: 'Routing', glyph: 'route', color: '#818cf8', onRail: true },
  { label: 'Reports', glyph: 'reports', color: '#a78bfa', onRail: true },
  { label: 'Fleet', glyph: 'truck', color: '#22d3ee' },
  { label: 'Tracker', glyph: 'funnel', color: '#f472b6' },
  { label: 'Books', glyph: 'book', color: '#10b981' },
  { label: 'Marketing', glyph: 'megaphone', color: '#fb7185' },
  { label: 'Files', glyph: 'folder', color: '#38bdf8' },
  { label: 'Contacts', glyph: 'user', color: '#7dd3fc' },
  { label: 'Forms', glyph: 'form', color: '#a3e635' },
  { label: 'Pesticide', glyph: 'flask', color: '#34d399' },
  { label: 'Call Log 2', glyph: 'calllog', color: '#c084fc' },
  { label: 'Tools', glyph: 'wrench', color: '#94a3b8' },
  { label: 'Company News', glyph: 'news', color: '#f59e0b' },
  { label: 'Zone Sizer', glyph: 'ruler', color: '#2dd4bf' },
  { label: 'Do Not Disturb', glyph: 'moon', color: '#f87171' },
]

function AppTile({ app }: { app: App }) {
  return (
    <button className="group relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all hover:-translate-y-0.5 hover:bg-white/[0.05]">
      {app.onRail && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ background: '#38bdf8', boxShadow: '0 0 6px #38bdf8' }} title="On your rail" />}
      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl transition-transform group-hover:scale-105" style={{ color: app.color, background: app.color + '1f', boxShadow: `inset 0 0 0 1px ${app.color}44` }}>
        {G[app.glyph]}
        {app.badge ? <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: 'linear-gradient(180deg,#fb923c,#f97316)', boxShadow: '0 0 0 2px #0e1626' }}>{app.badge}</span> : null}
      </span>
      <span className="text-center text-[11px] font-medium leading-tight text-white/65 group-hover:text-white">{app.label}</span>
    </button>
  )
}

// ---- page ----------------------------------------------------------------

export default function Mockup3Page() {
  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden text-white" style={{ background: 'radial-gradient(1200px 600px at 18% -10%, #102338 0%, transparent 55%), linear-gradient(160deg,#0a0f1c 0%,#0b1320 60%,#090d18 100%)' }}>
      {/* banner */}
      <div className="absolute left-1/2 top-3 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.08] bg-sky-500/[0.10] px-3.5 py-1.5 text-[11px] text-sky-100/90 backdrop-blur">
        ✨ <span className="font-semibold">Mockup #3</span> — redesigned rail + app drawer
      </div>

      {/* ---- redesigned rail ---- */}
      <nav className="flex w-[64px] flex-none flex-col items-center py-3" style={{ background: 'linear-gradient(180deg,#0b1626,#0a1120)', borderRight: '1px solid rgba(255,255,255,.06)' }}>
        <RailIcon label="Search" glyph={G.search} />
        <div className="my-2 h-px w-8 bg-white/[0.06]" />
        <div className="flex flex-1 flex-col gap-0.5">
          <RailIcon label="Hub" glyph={G.hub} dot />
          <RailIcon label="Txt2" glyph={G.txt2} badge={2} />
          <RailIcon label="Phone" glyph={G.phone} />
          <RailIcon label="Clock" glyph={G.clock} />
          <RailIcon label="Routing" glyph={G.route} />
          <RailIcon label="Daily Log" glyph={G.log} />
          <RailIcon label="Reports" glyph={G.reports} />
        </div>
        <div className="mt-1 flex w-full flex-col items-center gap-0.5 border-t border-white/[0.06] pt-2">
          {/* Apps button is ACTIVE because the drawer is open */}
          <RailIcon label="Apps" glyph={G.apps} active />
          <RailIcon label="Settings" glyph={G.gear} />
          <div className="pt-1.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: 'linear-gradient(140deg,#fbbf24,#f59e0b)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18)' }}>BS</div>
          </div>
        </div>
      </nav>

      {/* ---- dim scrim ---- */}
      <div className="relative flex-1">
        <div className="absolute inset-0" style={{ background: 'rgba(4,7,14,.55)', backdropFilter: 'blur(2px)' }} />

        {/* ---- app drawer (opened from the Apps button) ---- */}
        <div className="absolute inset-0 flex items-stretch p-3 md:p-5">
          {/* little caret pointing back toward the rail/Apps button */}
          <div className="relative flex w-full">
            <div className="hidden md:block" style={{ position: 'absolute', left: -10, bottom: 64, width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderRight: '10px solid rgba(20,30,49,.96)' }} />

            <div
              className="flex w-full flex-col overflow-hidden rounded-3xl"
              style={{ background: 'linear-gradient(170deg,#131e31,#0e1626)', border: '1px solid rgba(255,255,255,.09)', boxShadow: '0 40px 80px -30px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.08)' }}
            >
              {/* drawer header */}
              <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl text-sky-300" style={{ background: 'rgba(56,189,248,.14)', boxShadow: 'inset 0 0 0 1px rgba(56,189,248,.3)' }}>{G.apps}</div>
                <div>
                  <h2 className="text-base font-semibold text-white">Apps</h2>
                  <p className="text-xs text-white/40">Everything in your Hub · tap to open</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <div className="hidden items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/40 sm:flex" style={{ background: 'rgba(255,255,255,.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.07)' }}>
                    {G.search}<span>Search apps…</span>
                  </div>
                  <button className="flex h-9 w-9 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" {...s}><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              </div>

              {/* tile grid */}
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
                <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Blue dot = currently on your rail
                </div>
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {APPS.map((a) => <AppTile key={a.label} app={a} />)}
                </div>
              </div>

              {/* drawer footer */}
              <div className="flex flex-col items-stretch gap-2 border-t border-white/[0.07] px-5 py-4 sm:flex-row sm:items-center">
                <p className="text-xs text-white/40">Reorder, hide, or add shortcuts to your rail in the editor.</p>
                <button className="ml-auto flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]" style={{ background: 'linear-gradient(90deg,#2E7EB8,#38bdf8)', boxShadow: '0 8px 22px -8px rgba(56,189,248,.8)' }}>
                  {G.edit} Customize your Hub
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
