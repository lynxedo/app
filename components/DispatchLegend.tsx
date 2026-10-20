'use client'

import { useState } from 'react'
import { DEFAULT_STOP_COLOR, type ColorRule } from '@/lib/dispatch'
import type { PinSettings } from '@/lib/pin-colors'

// 🎨 Legend (Ben, Oct 20 2026: "something that isn't viewable all the time,
// maybe a button you click"). Built from the company's own settings, so it
// always matches what's on screen.

const RULE_TEXT: Record<ColorRule['type'], (r: ColorRule, name: (id: string) => string) => string> = {
  promised: () => 'Promised time frame',
  line_item: r => `Line item contains “${r.match}”`,
  title: r => `Title contains “${r.match}”`,
  assigned: (r, name) => `Assigned to ${name(r.match)}`,
}

const Swatch = ({ c, round }: { c: string; round?: boolean }) => (
  <span className={`inline-block w-3.5 h-3.5 shrink-0 border border-black/30 ${round ? 'rounded-full' : 'rounded-sm'}`} style={{ background: c }} />
)

export default function DispatchLegend({ rules, pinSettings, team, userName, laneColor }: {
  rules: ColorRule[]
  pinSettings: PinSettings | null
  team: string[]
  userName: (id: string) => string
  laneColor: (id: string) => string
}) {
  const [open, setOpen] = useState(false)
  const base = pinSettings?.base_programs ?? []
  const aux = pinSettings?.aux_programs ?? []
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`px-3 py-1.5 rounded-lg text-sm ${open ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
        🎨 Legend
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[22rem] max-h-[75vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-3 text-xs space-y-3">
          <div className="flex items-center">
            <span className="font-semibold text-sm">Legend</span>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto text-gray-500 hover:text-white" aria-label="Close">✕</button>
          </div>

          <div>
            <div className="text-gray-300 font-medium mb-1">How to read a stop</div>
            <div className="flex items-center gap-3">
              <div className="relative h-9 w-40 rounded text-[10px] text-[#fff] pl-1.5 pr-2.5 py-0.5 overflow-hidden" style={{ background: '#0ea5e9', borderLeft: `4px solid ${team[0] ? laneColor(team[0]) : '#2563eb'}` }}>
                <b>1</b> <span className="bg-black/30 rounded px-0.5">18d</span><br />Smith
                <div className="absolute top-0 right-0 bottom-0 w-[5px] flex flex-col"><div className="flex-1 bg-[#db2777]" /><div className="flex-1 bg-[#f59e0b]" /></div>
              </div>
              <div className="text-gray-400 leading-snug">
                <b className="text-gray-200">Fill</b> = service<br />
                <b className="text-gray-200">Left edge</b> = tech<br />
                <b className="text-gray-200">Right edge</b> = add-ons<br />
                Pins match: center, border, halo
              </div>
            </div>
          </div>

          <div>
            <div className="text-gray-300 font-medium mb-1">Service (fill) — first match wins</div>
            {rules.length === 0 && <div className="text-gray-500">No Dispatch stop colors yet (Admin → Routing → Dispatch).</div>}
            {rules.map(r => (
              <div key={r.id} className="flex items-center gap-2 py-0.5"><Swatch c={r.color} /><span>{r.label ? <b>{r.label}</b> : null}{r.label ? ' — ' : ''}{RULE_TEXT[r.type](r, userName)}</span></div>
            ))}
            {base.length > 0 && (
              <>
                <div className="text-gray-500 mt-1">If none of those match — Pin Colors programs:</div>
                {base.map(b => <div key={b.id} className="flex items-center gap-2 py-0.5"><Swatch c={b.color} /><span>{b.label || b.match}</span></div>)}
              </>
            )}
            <div className="flex items-center gap-2 py-0.5 text-gray-500"><Swatch c={DEFAULT_STOP_COLOR} /><span>Nothing matched</span></div>
          </div>

          {aux.length > 0 && (
            <div>
              <div className="text-gray-300 font-medium mb-1">Add-ons (right edge · pin halo)</div>
              {aux.map(a => <div key={a.id} className="flex items-center gap-2 py-0.5"><Swatch c={a.color} round /><span>{a.label || a.match}</span></div>)}
            </div>
          )}

          {team.length > 0 && (
            <div>
              <div className="text-gray-300 font-medium mb-1">Techs (left edge · pin border · route line)</div>
              {team.map(t => <div key={t} className="flex items-center gap-2 py-0.5"><Swatch c={laneColor(t)} round /><span>{userName(t)}</span></div>)}
            </div>
          )}

          <div>
            <div className="text-gray-300 font-medium mb-1">Markings</div>
            <ul className="space-y-0.5 text-gray-400">
              <li>🔒 / pink glow / pink bracket — promised time frame</li>
              <li><span className="inline-block w-3 h-3 align-middle rounded-sm ring-2 ring-orange-400 mr-1" /> orange outline — moved, not sent to Jobber yet</li>
              <li>Faded — filtered out, or unticked in Route &amp; optimize</li>
              <li>✓ — completed · <b className="text-gray-200">1, 2, 3</b> — route order · <b className="text-gray-200">18d</b> — days since last visit</li>
            </ul>
          </div>

          <div>
            <div className="text-gray-300 font-medium mb-1">Day timeline</div>
            <ul className="space-y-0.5 text-gray-400">
              <li>Hollow ring — leaves the shop · solid dot — back at the shop</li>
              <li>Grey bar — drive minutes · red bar — would arrive late</li>
              <li>Hatched — open gap · green dashed lines — arrival hours</li>
              <li>Red line — now · green dashed box — a Find a slot suggestion</li>
            </ul>
          </div>

          <div>
            <div className="text-gray-300 font-medium mb-1">Map</div>
            <ul className="space-y-0.5 text-gray-400">
              <li>⌂ — shop · red square — unscheduled visit</li>
              <li>Colored line — the tech&apos;s drive · thin labeled line — back to shop</li>
              <li># switch — pins show route order or days since last visit</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
