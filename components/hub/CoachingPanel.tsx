'use client'

import { useState } from 'react'

// Shared coaching display for the call logs. Both the Twilio dialer calls
// (calls.coaching_json) and the Unitel call_logs (call_logs.coaching_json) store
// the SAME coaching object shape produced by the Heroes coaching rubric, so this
// one component renders both. Gating (can_access_coaching) happens upstream — if
// a caller passes coaching, they're allowed to see it.

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

export function CoachingPanel({ coaching }: { coaching: CoachingData | null | undefined }) {
  const [showCats, setShowCats] = useState(false)
  if (!coaching || !coaching.overall_grade) return null

  const cats = coaching.categories || {}
  const wins = asList(coaching.wins)
  const improvements = asList(coaching.improvements)
  const redFlags = asList(coaching.red_flags)
  const neverDos = asList(coaching.never_dos_triggered)
  const industry = asList(coaching.industry_knowledge_issues)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Coaching</div>
        <div className="flex items-center gap-2">
          {coaching.must_listen && (
            <span className="px-2 py-0.5 rounded text-xs font-medium text-red-300 bg-red-900/40">★ Must listen</span>
          )}
          <span className={`px-2.5 py-1 rounded-lg text-base font-bold border ${coachingGradeColor(coaching.overall_grade)}`}>
            {coaching.overall_grade}
          </span>
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
    </div>
  )
}
