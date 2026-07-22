'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Compact "Schedule send" control — a button that opens a datetime picker and
 * calls onSchedule(ISO) once the user confirms a time at least ~2 minutes out.
 * Used beside the Send button in both composers.
 */
export default function ScheduleSendMenu({
  disabled,
  onSchedule,
}: {
  disabled?: boolean
  onSchedule: (iso: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Earliest selectable time (~2 min out), formatted for <input type="datetime-local">.
  function minLocal(): string {
    const d = new Date(Date.now() + 2 * 60_000)
    d.setSeconds(0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function confirm() {
    if (!val) return
    const ts = new Date(val).getTime()
    if (isNaN(ts) || ts < Date.now() + 60_000) return
    onSchedule(new Date(ts).toISOString())
    setOpen(false)
    setVal('')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="text-sm px-3 py-2 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
        title="Schedule this email to send later"
      >
        ⏱ Schedule
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-50 p-3 space-y-2">
          <label className="text-xs text-gray-500 block">Send at</label>
          <input
            type="datetime-local"
            value={val}
            min={minLocal()}
            onChange={(e) => setVal(e.target.value)}
            className="w-full px-2 py-1.5 rounded-md bg-white border border-gray-300 text-sm text-gray-900"
          />
          <button
            type="button"
            onClick={confirm}
            disabled={!val}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[#fff] font-medium disabled:opacity-50"
          >
            Schedule send
          </button>
        </div>
      )}
    </div>
  )
}
