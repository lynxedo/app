'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui'
import { formatPhone, formatCurrency } from '@/lib/format'
import type { Lead, Stage } from '../TrackerPage'

// A single lead rendered as a card for the Board / Needs-me cockpit views.
// One-tap phone → opens (or creates) the Txt thread. A colored left border + a
// drip-state chip surface where the lead is in the SMS speed-to-lead sequence.
type CardState = 'waiting' | 'in_sequence' | 'won' | 'lost' | 'amber_on_it' | 'neutral'

// Accent per state. `amber_on_it` (someone is actively working the lead) is
// reserved for a future signal — its style is defined here but nothing lights it yet.
const STATE_ACCENT: Record<CardState, string> = {
  waiting: '#10b981',     // emerald — replied, waiting on a human
  in_sequence: '#0ea5e9', // sky — still being nurtured by the drip
  won: '#22c55e',         // green — closed/won stage
  lost: '#6b7280',        // gray — lost stage or opted out
  amber_on_it: '#f59e0b', // amber — reserved: a human is on it
  neutral: '#3f3f46',     // zinc — no active drip
}

function resolveState(lead: Lead, stages: Stage[]): CardState {
  const drip = lead.drip
  if (drip?.status === 'replied') return 'waiting'
  const role = stages.find(s => s.key === lead.stage)?.system_role
  if (role === 'won') return 'won'
  if (role === 'lost' || drip?.status === 'opted_out') return 'lost'
  if (drip?.status === 'active') return 'in_sequence'
  return 'neutral'
}

function stateChipLabel(state: CardState, lead: Lead): string | null {
  const drip = lead.drip
  switch (state) {
    case 'waiting': return '● Replied'
    case 'in_sequence': return `● Drip · step ${(drip?.current_step_index ?? 0) + 1}`
    case 'won': return '✓ Won'
    case 'lost': return drip?.status === 'opted_out' ? 'Opted out' : 'Lost'
    case 'amber_on_it': return '● On it'
    case 'neutral': return drip?.status === 'completed' ? 'Drip complete' : null
  }
}

// Compact relative age, e.g. "3d", "5h", "just now".
function relAge(ts: string | null | undefined): string {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  const mos = Math.floor(days / 30)
  if (mos < 12) return `${mos}mo`
  return `${Math.floor(mos / 12)}y`
}

export default function LeadCard({
  lead, stages, lightMode, showStage = false, onEdit, onOpenNotes,
}: {
  lead: Lead
  stages: Stage[]
  lightMode: boolean
  showStage?: boolean
  onEdit: (id: string) => void
  onOpenNotes: (id: string) => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [texting, setTexting] = useState(false)

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead'
  const state = resolveState(lead, stages)
  const accent = STATE_ACCENT[state]
  const chipLabel = stateChipLabel(state, lead)
  const age = relAge(lead.stage_changed_at)
  const value = formatCurrency(lead.annual_value)
  const stage = showStage ? stages.find(s => s.key === lead.stage) : null
  const note = lead.latest_note?.note ?? null
  const noteSnippet = note && note.length > 90 ? note.slice(0, 90) + '…' : note

  async function handleText() {
    if (texting) return
    if (!lead.phone) { toast.error('No phone number on this lead.'); return }
    setTexting(true)
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: lead.phone,
          name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || undefined,
          email: lead.email || undefined,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json().catch(() => null)
      const id = body?.conversation_id
      if (!id) throw new Error('no conversation')
      router.push(`/hub/txt/${id}`)
    } catch {
      toast.error("Couldn't open a text thread.")
      setTexting(false)
    }
  }

  const cardCls = lightMode
    ? 'bg-white border-gray-200 hover:border-gray-300'
    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
  const nameCls = lightMode ? 'text-gray-900' : 'text-white'
  const subCls = lightMode ? 'text-gray-500' : 'text-gray-400'
  const mutedCls = lightMode ? 'text-gray-400' : 'text-gray-600'
  const pillCls = lightMode ? 'bg-gray-100 text-gray-600' : 'bg-gray-800 text-gray-400'
  const actionCls = lightMode ? 'text-gray-500 hover:text-indigo-600' : 'text-gray-500 hover:text-indigo-400'

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-colors ${cardCls}`}
      style={{ borderLeftColor: accent, borderLeftWidth: 4 }}
    >
      {/* Name + drip chip */}
      <div className="flex items-start justify-between gap-2">
        <span className={`font-medium truncate ${nameCls}`} title={name}>{name}</span>
        {chipLabel && (
          <span
            style={{ backgroundColor: accent + (lightMode ? '2e' : '22'), color: lightMode ? '#374151' : accent, borderColor: accent + '55' }}
            className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap"
            title={lead.drip?.campaign_name ?? undefined}
          >
            {chipLabel}
          </span>
        )}
      </div>

      {/* Phone → one-tap to Txt */}
      <div className="mt-1">
        {lead.phone ? (
          <button
            onClick={handleText}
            disabled={texting}
            className={`text-sm ${lightMode ? 'text-indigo-600' : 'text-indigo-300'} hover:underline disabled:opacity-50 disabled:no-underline`}
            title="Text this lead"
          >
            {formatPhone(lead.phone)}
          </button>
        ) : (
          <span className={`text-sm ${mutedCls}`}>No phone</span>
        )}
      </div>

      {/* Source · service · value */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {lead.lead_source && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${pillCls}`}>{lead.lead_source}</span>
        )}
        {stage && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${pillCls}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
            {stage.label}
          </span>
        )}
        {(lead.service ?? []).length > 0 && (
          <span className={`text-xs truncate max-w-[55%] ${subCls}`} title={(lead.service ?? []).join(', ')}>
            {(lead.service ?? []).join(', ')}
          </span>
        )}
        {value && <span className={`text-xs font-medium ${lightMode ? 'text-gray-700' : 'text-gray-300'}`}>{value}</span>}
      </div>

      {/* Latest note snippet */}
      {noteSnippet && (
        <p
          className={`mt-2 text-xs line-clamp-2 cursor-pointer transition-colors ${lightMode ? 'text-gray-500 hover:text-indigo-600' : 'text-gray-400 hover:text-indigo-300'}`}
          title={note ?? ''}
          onClick={() => onOpenNotes(lead.id)}
        >
          {noteSnippet}
        </p>
      )}

      {/* Footer: owner · age · quick actions */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className={`text-[11px] truncate ${mutedCls}`}>
          {lead.salesperson || 'Unassigned'}{age ? ` · ${age} in stage` : ''}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleText} disabled={texting || !lead.phone} title="Text" className={`${actionCls} disabled:opacity-30`}>✉</button>
          <button onClick={() => onEdit(lead.id)} title="Edit lead" className={actionCls}>✎</button>
          <button onClick={() => onOpenNotes(lead.id)} title="Notes" className={actionCls}>💬</button>
        </div>
      </div>
    </div>
  )
}
