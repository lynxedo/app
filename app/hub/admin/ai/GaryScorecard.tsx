'use client'

import { useState } from 'react'

// Gary's scorecard on Admin → AI → Gary's account — what Gary did and what came
// of it (lib/gary-scorecard.ts). Read-only.

export type GaryScoreWindow = {
  written: number
  costUsd: number
  sent: { email: number; text: number; byTouch: [number, number, number] }
  contacted: number
  replied: number
  declined: number
  optedOut: number
  approvedAsWritten: number
  edited: number
  turnedDown: number
  notSent: number
  expired: number
  becameCustomers: number
  jobs: number
  jobValue: number
}

export type GaryScorecardData = {
  last30: GaryScoreWindow
  allTime: GaryScoreWindow
  wins: { name: string; jobs: number; value: number; firstSentAt: string }[]
}

const usd = (n: number, cents = false) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents ? 2 : 0 }).format(n)

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—'
}

export default function GaryScorecard({ data }: { data: GaryScorecardData }) {
  const [win, setWin] = useState<'last30' | 'allTime'>('allTime')
  const w = data[win]
  const sent = w.sent.email + w.sent.text
  const decided = w.approvedAsWritten + w.edited + w.turnedDown

  const tiles: { label: string; value: string; note?: string }[] = [
    { label: 'People contacted', value: String(w.contacted), note: `${sent} messages sent (${w.sent.email} email, ${w.sent.text} text)` },
    { label: 'Replied', value: String(w.replied), note: `${pct(w.replied, w.contacted)} of people contacted` },
    { label: 'Became customers', value: String(w.becameCustomers), note: w.jobs ? `${w.jobs} new job${w.jobs === 1 ? '' : 's'}` : 'New Jobber job after Gary wrote' },
    { label: 'Job value', value: usd(w.jobValue), note: 'Jobber job totals' },
    { label: 'Said no / opted out', value: `${w.declined} / ${w.optedOut}` },
    { label: 'Approved as written', value: pct(w.approvedAsWritten, decided), note: `${w.edited} edited, ${w.turnedDown} turned down` },
    { label: 'Follow-ups sent', value: `${w.sent.byTouch[1]} / ${w.sent.byTouch[2]}`, note: '2nd message / last try' },
    { label: 'Gary’s cost', value: usd(w.costUsd, true), note: `${w.written} written${w.expired ? `, ${w.expired} expired` : ''}${w.notSent ? `, ${w.notSent} not sent` : ''}` },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-white/70">Gary&apos;s scorecard</p>
        <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs">
          {(
            [
              ['last30', 'Last 30 days'],
              ['allTime', 'All time'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setWin(k)}
              className={`px-2.5 py-1 ${win === k ? 'bg-brand text-white' : 'text-white/60 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-white/10 p-2.5 min-w-0">
            <p className="text-[11px] text-white/50">{t.label}</p>
            <p className="text-lg font-semibold text-white leading-tight">{t.value}</p>
            {t.note && <p className="text-[11px] text-white/40 mt-0.5">{t.note}</p>}
          </div>
        ))}
      </div>
      {data.wins.length > 0 && (
        <div className="text-xs text-white/50 space-y-0.5">
          <p className="text-white/60">Became customers after Gary wrote:</p>
          {data.wins.map((x) => (
            <p key={`${x.name}-${x.firstSentAt}`}>
              {x.name}: {x.jobs} job{x.jobs === 1 ? '' : 's'}, {usd(x.value)}
            </p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-white/40">
        &ldquo;Became customers&rdquo; counts anyone Gary contacted who got a new Jobber job for what he wrote about,
        after his first message. Some would have come back anyway, so treat it as the most Gary could be credited
        with.
      </p>
    </div>
  )
}
