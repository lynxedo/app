'use client'

import { useState } from 'react'

type Emp = { id: string; name: string; job_title: string | null; department: string | null }
type Board = { slug: string; title: string }

export default function ScoreboardTechniciansPanel({
  boards,
  employees,
  initialAssignments,
}: {
  boards: Board[]
  employees: Emp[]
  initialAssignments: Record<string, string[]>
}) {
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {}
    for (const b of boards) m[b.slug] = new Set(initialAssignments[b.slug] ?? [])
    return m
  })
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Auto-save on toggle (no separate Save button).
  async function toggle(slug: string, empId: string) {
    const willAssign = !assignments[slug].has(empId)
    const key = `${slug}:${empId}`
    setSavingKey(key)
    const apply = (assign: boolean) =>
      setAssignments(prev => {
        const s = new Set(prev[slug])
        if (assign) s.add(empId); else s.delete(empId)
        return { ...prev, [slug]: s }
      })
    apply(willAssign) // optimistic
    const res = await fetch('/api/admin/scoreboards/technicians', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_slug: slug, employee_id: empId, assigned: willAssign }),
    })
    if (!res.ok) {
      apply(!willAssign) // revert
      const data = await res.json().catch(() => ({}))
      alert(data.error || 'Failed to save — try again')
    }
    setSavingKey(null)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Scoreboards</h1>
        <p className="text-gray-500 text-sm mt-1">
          Choose which technicians appear on each scoreboard&rsquo;s per-tech panel (revenue and $/hour).
          Job title and department come from Gusto and aren&rsquo;t reliable for this, so assignments are explicit here.
          Changes save automatically.
        </p>
      </div>

      {boards.map(board => (
        <div key={board.slug} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-semibold">{board.title}</h2>
            <span className="text-xs text-gray-500">{assignments[board.slug].size} assigned</span>
          </div>
          <div className="divide-y divide-gray-800">
            {employees.map(emp => {
              const on = assignments[board.slug].has(emp.id)
              const key = `${board.slug}:${emp.id}`
              return (
                <div key={emp.id} className="px-6 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm">{emp.name}</div>
                    <div className="text-xs text-gray-500">{[emp.job_title, emp.department].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={`${on ? 'Remove' : 'Add'} ${emp.name}`}
                    disabled={savingKey === key}
                    onClick={() => toggle(board.slug, emp.id)}
                    className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none flex-none ${on ? 'bg-sky-600' : 'bg-gray-700'} ${savingKey === key ? 'opacity-60' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              )
            })}
            {employees.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-gray-500">No active employees found.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
