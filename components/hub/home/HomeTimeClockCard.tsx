'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useClockPunch, type ClockEmployee } from '@/hooks/use-clock-punch'
import { formatDurationMs } from '@/lib/format'

export type HomeTimeClockInitial = {
  employee: ClockEmployee
  clocked_in: boolean
  since: string | null
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function HomeTimeClockCard({ initial }: { initial: HomeTimeClockInitial }) {
  // Shared clock logic (TS6). Home card ticks per-minute and shows h/m, not seconds.
  const {
    clockedIn,
    since,
    elapsed,
    clocking,
    lastOut,
    handleClock,
  } = useClockPunch({ initial, tickMs: 60000 })

  // Tell the Home announcement gate the moment the worker clocks in, so unread
  // announcements pop right after clocking in (not just on a fresh page load).
  const prevClockedIn = useRef(initial.clocked_in)
  useEffect(() => {
    if (clockedIn && !prevClockedIn.current) {
      window.dispatchEvent(new Event('lynxedo:clocked-in'))
    }
    prevClockedIn.current = clockedIn
  }, [clockedIn])

  return (
    <section className="mb-8">
      <div className={`rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors ${
        clockedIn
          ? 'bg-green-500/5 border-green-500/30'
          : lastOut
            ? 'bg-gray-900 border-gray-700'
            : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="min-w-0">
          {clockedIn && since ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-widest text-green-400/70">Clocked in</div>
              <div className="mt-1 text-white">
                <span className="text-2xl font-bold tabular-nums">{formatTime(since)}</span>
                <span className="text-gray-500 mx-2">·</span>
                <span className="text-lg tabular-nums text-gray-200">{formatDurationMs(elapsed, { style: 'verbose' })}</span>
              </div>
            </>
          ) : lastOut ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-widest text-gray-500">Shift complete</div>
              <div className="mt-1 text-white">
                <span className="text-2xl font-bold tabular-nums">{lastOut.hours.toFixed(2)}h</span>
                <span className="text-gray-500 mx-2">·</span>
                <span className="text-sm text-gray-400">Out at {formatTime(lastOut.time)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-widest text-gray-500">Time clock</div>
              <div className="mt-1 text-lg text-gray-400">Not clocked in</div>
            </>
          )}
          <Link
            href="/timesheet"
            className="inline-block mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            View full timesheet →
          </Link>
        </div>
        <button
          onClick={handleClock}
          disabled={clocking}
          className={`w-full sm:w-auto px-8 py-4 rounded-2xl text-base font-bold transition-all disabled:opacity-70 ${
            clockedIn
              ? 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-[#fff] shadow-lg shadow-red-500/25'
              : 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-[#fff] shadow-lg shadow-green-500/25'
          }`}
        >
          {clocking ? '…' : clockedIn ? 'Clock Out' : 'Clock In'}
        </button>
      </div>
    </section>
  )
}
