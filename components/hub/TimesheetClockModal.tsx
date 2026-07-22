'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useClockPunch } from '@/hooks/use-clock-punch'
import { Spinner } from '@/components/ui'
import { formatDurationMs } from '@/lib/format'

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function TimesheetClockModal({ onClose }: { onClose: () => void }) {
  // Shared clock logic (TS6). Modal ticks per-second and supports a shift note.
  const {
    employee,
    loading,
    notLinked,
    clockedIn,
    since,
    elapsed,
    clocking,
    note,
    setNote,
    lastOut,
    handleClock,
  } = useClockPunch({ tickMs: 1000 })
  const [showNote, setShowNote] = useState(false)

  const displayName = employee
    ? (employee.preferred_name || employee.first_name)
    : ''

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60">
      <div className="bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <div>
            <div className="font-semibold text-white">Time Clock</div>
            {employee && <div className="text-xs text-gray-500 mt-0.5">{displayName} · {employee.job_title}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-6 flex flex-col items-center gap-5">
          {loading ? (
            <div className="py-12 text-center"><Spinner size={6} /></div>
          ) : notLinked ? (
            <div className="text-center space-y-3 py-4">
              <div className="text-4xl">🕐</div>
              <p className="text-white font-medium">Account not linked</p>
              <p className="text-gray-400 text-sm">Ask your admin to link your account to an employee record.</p>
            </div>
          ) : (
            <>
              {/* Status card */}
              <div className={`w-full rounded-2xl border-2 p-6 text-center transition-colors ${
                clockedIn ? 'bg-green-500/5 border-green-500/30' : lastOut ? 'bg-gray-900 border-gray-700' : 'bg-gray-900 border-gray-800'
              }`}>
                {clockedIn && since ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Shift in progress</div>
                    <div className="text-4xl font-bold tabular-nums tracking-tight text-green-400 my-2">
                      {formatDurationMs(elapsed)}
                    </div>
                    <div className="text-sm text-gray-500">Since {formatTime(since)}</div>
                  </>
                ) : lastOut ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Shift complete</div>
                    <div className="text-3xl font-bold tabular-nums text-white my-2">
                      {lastOut.hours.toFixed(2)}h
                    </div>
                    <div className="text-sm text-gray-400">Clocked out at {formatTime(lastOut.time)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Not clocked in</div>
                    <div className="text-3xl my-3 text-gray-700">—</div>
                  </>
                )}
              </div>

              {/* Note field */}
              {showNote && (
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={clockedIn ? 'End of shift note…' : 'Start of shift note…'}
                  rows={2}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              )}

              <button
                onClick={handleClock}
                disabled={clocking}
                className={`w-full py-4 rounded-2xl text-base font-bold transition-all disabled:opacity-70 ${
                  clockedIn
                    ? 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-[#fff] shadow-lg shadow-red-500/25'
                    : 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-[#fff] shadow-lg shadow-green-500/25'
                }`}
              >
                {clocking ? '…' : clockedIn ? 'Clock Out' : 'Clock In'}
              </button>
              <button
                onClick={() => setShowNote(v => !v)}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors -mt-2"
              >
                {showNote ? 'Hide note' : '+ Add note'}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1 flex-none border-t border-gray-800/50">
          <Link
            href="/timesheet"
            onClick={onClose}
            className="block text-center text-xs text-gray-600 hover:text-gray-400 transition-colors py-1"
          >
            View full timesheet →
          </Link>
        </div>
      </div>
    </div>
  )
}
