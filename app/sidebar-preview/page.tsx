// Temporary sandbox preview for Session 37 follow-up — sidebar header color schemes.
// Delete this folder after Ben picks a scheme.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sidebar Preview',
  robots: { index: false, follow: false },
}

type Scheme = {
  id: string
  label: string
  description: string
  topClass: string
  subClass: string
}

const SCHEMES: Scheme[] = [
  {
    id: 'amber-emerald',
    label: 'A · Amber + Emerald',
    description: 'Top = warm amber gold. Sub = soft emerald green. Classic gold + green pairing.',
    topClass: 'text-amber-300',
    subClass: 'text-emerald-300',
  },
  {
    id: 'amber-violet',
    label: 'B · Amber + Violet',
    description: 'Top = amber gold. Sub = soft violet/purple. Maximum hue separation — gold and purple complement each other.',
    topClass: 'text-amber-300',
    subClass: 'text-violet-300',
  },
  {
    id: 'amber-teal',
    label: 'C · Amber + Teal',
    description: 'Top = amber gold. Sub = teal (blue-green). Cool sub like sky but more distinct from the brand active blue.',
    topClass: 'text-amber-300',
    subClass: 'text-teal-300',
  },
]

function Chevron({ size = 'top' }: { size?: 'top' | 'sub' }) {
  return (
    <svg
      className={`${size === 'top' ? 'w-3 h-3 text-white/30' : 'w-2.5 h-2.5 text-white/20'} -rotate-0`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function NavRow({ label, active = false, dot = false }: { label: string; active?: boolean; dot?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded-md text-sm ${
        active ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70'
      }`}
    >
      {dot && <span className="flex-none w-2 h-2 rounded-full bg-[#f97316]" />}
      <span>{label}</span>
    </div>
  )
}

function MiniSidebar({ scheme }: { scheme: Scheme }) {
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      <div className="bg-slate-900 px-4 py-3 border-b border-white/10">
        <div className="font-semibold text-white">{scheme.label}</div>
        <div className="text-xs text-white/60 mt-1">{scheme.description}</div>
      </div>
      <div className="bg-[#1A3D5C] px-3 py-4 space-y-4 min-h-[520px]">
        {/* FAVORITES */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-1">
            <Chevron size="top" />
            <span className={`text-sm md:text-xs font-semibold uppercase tracking-wider ${scheme.topClass}`}>
              Favorites
            </span>
          </div>
          <NavRow label="# announcements" />
          <NavRow label="# heroes-general" active />
        </div>

        {/* ROOMS */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-1">
            <Chevron size="top" />
            <span className={`text-sm md:text-xs font-semibold uppercase tracking-wider ${scheme.topClass}`}>
              Rooms
            </span>
          </div>
          <NavRow label="# field-team" dot />
          <NavRow label="# office" />
          <NavRow label="# random" />
        </div>

        {/* DIRECT MESSAGES */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-1">
            <Chevron size="top" />
            <span className={`text-sm md:text-xs font-semibold uppercase tracking-wider ${scheme.topClass}`}>
              Direct Messages
            </span>
          </div>
          <NavRow label="Jose Garcia" dot />
          <NavRow label="Sarah Miller" />
        </div>

        {/* TOOLS */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-1">
            <Chevron size="top" />
            <span className={`text-sm md:text-xs font-semibold uppercase tracking-wider ${scheme.topClass}`}>
              Tools
            </span>
          </div>

          {/* Operations */}
          <div className="ml-1 mt-1">
            <div className="flex items-center gap-1 px-2 mb-0.5">
              <Chevron size="sub" />
              <span className={`text-xs md:text-[11px] font-semibold uppercase tracking-wider ${scheme.subClass}`}>
                Operations
              </span>
            </div>
            <NavRow label="Route Optimizer" />
            <NavRow label="Daily Log" />
            <NavRow label="Time Records" />
          </div>

          {/* Sales */}
          <div className="ml-1 mt-2">
            <div className="flex items-center gap-1 px-2 mb-0.5">
              <Chevron size="sub" />
              <span className={`text-xs md:text-[11px] font-semibold uppercase tracking-wider ${scheme.subClass}`}>
                Sales
              </span>
            </div>
            <NavRow label="Tracker" />
            <NavRow label="Lawn Sizer" />
          </div>

          {/* Communications */}
          <div className="ml-1 mt-2">
            <div className="flex items-center gap-1 px-2 mb-0.5">
              <Chevron size="sub" />
              <span className={`text-xs md:text-[11px] font-semibold uppercase tracking-wider ${scheme.subClass}`}>
                Communications
              </span>
            </div>
            <NavRow label="Call Log" />
          </div>

          {/* Finance */}
          <div className="ml-1 mt-2">
            <div className="flex items-center gap-1 px-2 mb-0.5">
              <Chevron size="sub" />
              <span className={`text-xs md:text-[11px] font-semibold uppercase tracking-wider ${scheme.subClass}`}>
                Finance
              </span>
            </div>
            <NavRow label="Books" />
          </div>
        </div>

        {/* PAGES */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-1">
            <Chevron size="top" />
            <span className={`text-sm md:text-xs font-semibold uppercase tracking-wider ${scheme.topClass}`}>
              Pages
            </span>
          </div>
          <NavRow label="Company News" />
          <NavRow label="Files" />
        </div>

        {/* LINKS */}
        <div>
          <div className="flex items-center gap-1 px-2 mb-1">
            <Chevron size="top" />
            <span className={`text-sm md:text-xs font-semibold uppercase tracking-wider ${scheme.topClass}`}>
              Links
            </span>
          </div>
          <NavRow label="Jobber" />
          <NavRow label="Gusto" />
        </div>
      </div>
    </div>
  )
}

export default function SidebarPreviewPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Sidebar Color Scheme Preview</h1>
        <p className="text-white/60 mb-6 md:mb-8 text-sm md:text-base">
          Three options for headings (top-level: Rooms, Tools, Pages, etc.) and subheadings
          (Operations, Sales, etc.). Body links stay white in all three. Mobile: stacked.
          Desktop: side-by-side. Resize your window to see both.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SCHEMES.map(scheme => (
            <MiniSidebar key={scheme.id} scheme={scheme} />
          ))}
        </div>

        <div className="mt-8 p-4 rounded-xl bg-slate-900 border border-white/10 text-sm text-white/70">
          <div className="font-semibold text-white mb-2">After you pick:</div>
          <div>Tell me &quot;Scheme A&quot;, &quot;Scheme B&quot;, or &quot;Scheme C&quot; — I&apos;ll apply it to the real sidebar and delete this preview route.</div>
        </div>
      </div>
    </div>
  )
}
