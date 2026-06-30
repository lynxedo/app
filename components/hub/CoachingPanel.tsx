'use client'

import { useState } from 'react'

// Shared coaching display for the call logs. Both the Twilio dialer calls
// (calls.coaching_json) and the Unitel call_logs (call_logs.coaching_json) store
// the SAME coaching object shape produced by the Heroes coaching rubric, so this
// one component renders both. Gating (can_access_coaching) happens upstream — if
// a caller passes coaching, they're allowed to see (and override) it.

export type CoachingCategory = { score?: string; evidence?: string }

export type CoachingData = {
  overall_grade?: string
  headline?: string
  categories?: Record<string, CoachingCategory>
  industry_knowledge_issues?: string[]
  wins?: string[]
  improvements?: string[]
  red_flags?: string[]
  never_dos_triggered?: string[]
  must_listen?: boolean
  must_listen_reason?: string | null
  surprising_observation?: string | null
}

export type CoachingReview = {
  override_grade?: string | null
  manager_notes?: string | null
  acknowledged?: boolean
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-green-300 bg-green-900/40 border-green-700/50',
  B: 'text-teal-300 bg-teal-900/40 border-teal-700/50',
  C: 'text-amber-300 bg-amber-900/40 border-amber-700/50',
  D: 'text-orange-300 bg-orange-900/40 border-orange-700/50',
  F: 'text-red-300 bg-red-900/40 border-red-700/50',
}

export function coachingGradeColor(grade?: string | null) {
  if (!grade) return 'text-gray-300 bg-gray-800 border-gray-700'
  return GRADE_COLORS[grade.toUpperCase()] || 'text-gray-300 bg-gray-800 border-gray-700'
}

const SCORE_COLORS: Record<string, string> = {
  strong: 'text-green-400 bg-green-900/30',
  adequate: 'text-blue-300 bg-blue-900/30',
  'needs work': 'text-amber-400 bg-amber-900/30',
  'n/a': 'text-gray-500 bg-gray-800',
}

function scoreColor(score?: string) {
  if (!score) return 'text-gray-400 bg-gray-800'
  return SCORE_COLORS[score.toLowerCase()] || 'text-gray-400 bg-gray-800'
}

const CATEGORY_GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Universal',
    keys: [
      ['greeting', 'Greeting'],
      ['customer_name_use', 'Customer name use'],
      ['active_listening', 'Active listening'],
      ['tone_match', 'Tone match'],
      ['accuracy', 'Accuracy'],
      ['clear_next_step', 'Clear next step'],
      ['professionalism', 'Professionalism'],
    ],
  },
  {
    title: 'Sales',
    keys: [
      ['discovery', 'Discovery'],
      ['bundling', 'Cross-sell (one)'],
      ['differentiator', 'Differentiator'],
      ['program_explanation', 'Program explanation'],
      ['objection_handling', 'Objection handling'],
      ['asked_for_the_sale', 'Asked for the sale'],
      ['booked_next_step', 'Booked next step'],
    ],
  },
  {
    title: 'Customer service',
    keys: [
      ['acknowledged_before_defending', 'Acknowledged first'],
      ['ownership', 'Took ownership'],
      ['concrete_resolution', 'Concrete resolution'],
      ['loop_closed', 'Loop closed'],
      ['save_attempted', 'Save attempted'],
    ],
  },
]

/** Flat [key, label] list of every coaching category, in rubric order. */
export const COACHING_CATEGORIES: [string, string][] = CATEGORY_GROUPS.flatMap(g => g.keys)

const GRADE_CHOICES = ['A', 'B', 'C', 'D', 'F', 'N/A']

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function ListSection({
  title,
  items,
  icon,
  iconColor,
  textColor = 'text-gray-300',
}: {
  title: string
  items: string[]
  icon: string
  iconColor: string
  textColor?: string
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 mb-1.5">{title}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className={`text-sm ${textColor} flex gap-2`}>
            <span className={`${iconColor} shrink-0`}>{icon}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CoachingPanel({
  coaching,
  callId,
  source,
  review,
}: {
  coaching: CoachingData | null | undefined
  callId?: string
  source?: 'dialer' | 'unitel'
  review?: CoachingReview | null
}) {
  const [showCats, setShowCats] = useState(false)
  const [overrideGrade, setOverrideGrade] = useState<string | null>(review?.override_grade ?? null)
  const [notes, setNotes] = useState<string>(review?.manager_notes ?? '')
  const [acknowledged, setAcknowledged] = useState<boolean>(review?.acknowledged ?? false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  if (!coaching || !coaching.overall_grade) return null

  const cats = coaching.categories || {}
  const wins = asList(coaching.wins)
  const improvements = asList(coaching.improvements)
  const redFlags = asList(coaching.red_flags)
  const neverDos = asList(coaching.never_dos_triggered)
  const industry = asList(coaching.industry_knowledge_issues)

  const aiGrade = coaching.overall_grade
  const effectiveGrade = overrideGrade || aiGrade
  const isOverridden = !!overrideGrade && overrideGrade !== aiGrade
  const canReview = !!callId && !!source

  async function save(next: { grade?: string | null; notes?: string; ack?: boolean }) {
    if (!callId || !source) return
    setSaveState('saving')
    try {
      const res = await fetch('/api/dialer/calls/coaching-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          callId,
          override_grade: next.grade !== undefined ? next.grade : overrideGrade,
          manager_notes: next.notes !== undefined ? next.notes : notes,
          acknowledged: next.ack !== undefined ? next.ack : acknowledged,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Coaching</div>
        <div className="flex items-center gap-2">
          {(coaching.must_listen || acknowledged) && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                acknowledged ? 'text-green-300 bg-green-900/40' : 'text-red-300 bg-red-900/40'
              }`}
            >
              {acknowledged ? '✓ Reviewed' : '★ Must listen'}
            </span>
          )}
          <span className={`px-2.5 py-1 rounded-lg text-base font-bold border ${coachingGradeColor(effectiveGrade)}`}>
            {effectiveGrade}
          </span>
          {isOverridden && (
            <span className="text-xs text-gray-500">AI: {aiGrade}</span>
          )}
        </div>
      </div>

      {coaching.headline && <p className="text-sm text-gray-200 leading-relaxed">{coaching.headline}</p>}
      {coaching.must_listen && coaching.must_listen_reason && (
        <p className="text-xs text-red-300/80 leading-relaxed">{coaching.must_listen_reason}</p>
      )}

      <ListSection title="Wins" items={wins} icon="✓" iconColor="text-green-400" />
      <ListSection title="Improvements" items={improvements} icon="→" iconColor="text-amber-400" />
      <ListSection title="Red flags" items={redFlags} icon="⚠" iconColor="text-red-400" textColor="text-red-200" />
      <ListSection title="Never-dos" items={neverDos} icon="✕" iconColor="text-red-400" textColor="text-red-200" />
      <ListSection title="Industry knowledge" items={industry} icon="!" iconColor="text-amber-400" />

      <div>
        <button
          onClick={() => setShowCats(v => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
        >
          <span>Category breakdown</span>
          <span>{showCats ? '▲' : '▼'}</span>
        </button>
        {showCats && (
          <div className="mt-3 space-y-4">
            {CATEGORY_GROUPS.map(group => {
              const present = group.keys.filter(([k]) => cats[k] && cats[k].score)
              if (present.length === 0) return null
              return (
                <div key={group.title}>
                  <div className="text-xs text-gray-600 mb-1.5">{group.title}</div>
                  <div className="space-y-1.5">
                    {present.map(([k, label]) => {
                      const c = cats[k]
                      const isNA = (c.score || '').toLowerCase() === 'n/a'
                      return (
                        <div key={k} className={isNA ? 'opacity-50' : ''}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-gray-300">{label}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${scoreColor(c.score)}`}>
                              {c.score || '—'}
                            </span>
                          </div>
                          {!isNA && c.evidence && (
                            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{c.evidence}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {coaching.surprising_observation && (
        <p className="text-xs text-gray-400 italic border-t border-gray-800 pt-3 leading-relaxed">
          {coaching.surprising_observation}
        </p>
      )}

      {canReview && (
        <div className="border-t border-gray-800 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Your review</div>
            <span className="text-xs text-gray-500 h-4">
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Save failed' : ''}
            </span>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Override grade</div>
            <div className="flex flex-wrap gap-1.5">
              {GRADE_CHOICES.map(g => {
                const active = overrideGrade === g
                return (
                  <button
                    key={g}
                    onClick={() => { setOverrideGrade(g); save({ grade: g }) }}
                    className={`px-2.5 py-1 rounded-lg text-sm font-bold border transition-colors ${
                      active ? coachingGradeColor(g) : 'text-gray-400 bg-gray-800 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {g}
                  </button>
                )
              })}
              {overrideGrade && (
                <button
                  onClick={() => { setOverrideGrade(null); save({ grade: null }) }}
                  className="px-2.5 py-1 rounded-lg text-xs text-gray-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => save({ notes })}
              rows={2}
              placeholder="Private coaching notes…"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => { setAcknowledged(e.target.checked); save({ ack: e.target.checked }) }}
              className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500"
            />
            Mark reviewed{coaching.must_listen ? ' (clears must-listen)' : ''}
          </label>
        </div>
      )}
    </div>
  )
}
