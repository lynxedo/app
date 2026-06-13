'use client'

import type { DndSchedule, DndWindow } from '@/lib/twilio-voice'

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const DAY_LABELS: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

interface Props {
  scheduleEnabled: boolean
  schedule: DndSchedule
  onToggleSchedule: (on: boolean) => void
  onScheduleChange: (s: DndSchedule) => void
  onCommit: () => void
  tz?: string
}

export default function DndScheduleEditor({
  scheduleEnabled, schedule, onToggleSchedule, onScheduleChange, onCommit, tz = 'America/Chicago',
}: Props) {
  function addWindow(day: DayKey) {
    const next: DndSchedule = {
      ...schedule,
      days: {
        ...(schedule.days || {}),
        [day]: [...(schedule.days?.[day] || []), { from: '18:00', to: '08:00' }],
      },
    }
    onScheduleChange(next)
    onCommit()
  }

  function removeWindow(day: DayKey, idx: number) {
    const arr = (schedule.days?.[day] || []).slice()
    arr.splice(idx, 1)
    const nextDays = { ...(schedule.days || {}) } as Record<string, DndWindow[]>
    if (arr.length === 0) delete nextDays[day]
    else nextDays[day] = arr
    const next: DndSchedule = { ...schedule, days: nextDays as DndSchedule['days'] }
    onScheduleChange(next)
    onCommit()
  }

  function patchWindow(day: DayKey, idx: number, patch: Partial<DndWindow>) {
    const arr = (schedule.days?.[day] || []).slice()
    arr[idx] = { ...arr[idx], ...patch }
    const next: DndSchedule = {
      ...schedule,
      days: { ...(schedule.days || {}), [day]: arr },
    }
    onScheduleChange(next)
  }

  return (
    <div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={scheduleEnabled}
          onChange={e => onToggleSchedule(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
        />
        <div className="flex-1">
          <div className="text-sm font-medium">Scheduled windows</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Auto-DND during set hours ({tz}). Set &ldquo;from&rdquo; later than &ldquo;to&rdquo; for overnight ranges.
          </p>
        </div>
      </label>

      {scheduleEnabled && (
        <div className="mt-3 space-y-2">
          {DAY_LABELS.map(({ key, label }) => {
            const windows = schedule.days?.[key] || []
            return (
              <div key={key} className="flex items-start gap-3 px-3 py-2 rounded border border-gray-800 bg-gray-950/50">
                <span className="text-xs text-gray-400 w-10 mt-2 font-mono">{label}</span>
                <div className="flex-1 space-y-1.5">
                  {windows.length === 0 ? (
                    <span className="text-xs text-gray-500">No windows.</span>
                  ) : (
                    windows.map((w, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <input
                          type="time"
                          value={w.from}
                          onChange={e => patchWindow(key, idx, { from: e.target.value })}
                          onBlur={onCommit}
                          className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-sm w-28"
                        />
                        <span className="text-xs text-gray-500">to</span>
                        <input
                          type="time"
                          value={w.to}
                          onChange={e => patchWindow(key, idx, { to: e.target.value })}
                          onBlur={onCommit}
                          className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-sm w-28"
                        />
                        <button
                          type="button"
                          onClick={() => removeWindow(key, idx)}
                          className="text-xs text-gray-500 hover:text-red-400 ml-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => addWindow(key)}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    + add window
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
