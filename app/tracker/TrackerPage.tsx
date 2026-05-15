'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

type Lead = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  service: string[] | null
  lead_source: string | null
  status: string | null
  stage: string | null
  lead_creation_date: string | null
  sold_date: string | null
  salesperson: string | null
  base_program_sold: string | null
  auxiliary_services: string[] | null
  annual_value: number | null
  service_address: string | null
  latest_note: { note: string; created_by: string; created_at: string } | null
}

type Note = {
  id: string
  lead_id: string
  note: string
  created_by: string
  created_at: string
}

type TrackerSettings = {
  status_options: string[]
  service_options: string[]
  lead_source_options: string[]
  salesperson_options: string[]
  base_program_sold_options: string[]
  auxiliary_services_options: string[]
}

type CurrentUser = { email: string; name: string; isAdmin: boolean }

const PIPELINE_GROUPS = [
  { key: 'current', label: 'Leads — Current' },
  { key: 'appointment_set', label: 'Appointment Set' },
  { key: 'follow_up_long_term', label: 'Follow Up — Long Term' },
  { key: 'closed_won', label: 'Closed Won' },
  { key: 'upsells', label: 'Upsells' },
  { key: 'closed_lost', label: 'Closed Lost' },
  { key: 'closed_other', label: 'Closed Other' },
  { key: 'saves', label: 'Saves' },
]

const GROUP_BADGE: Record<string, string> = {
  current: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  appointment_set: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  follow_up_long_term: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  closed_won: 'bg-green-500/15 text-green-400 border-green-500/30',
  upsells: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  closed_lost: 'bg-red-500/15 text-red-400 border-red-500/30',
  closed_other: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  saves: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${m}/${day}/${y.slice(2)}`
}

function fmtCurrency(v: number | null): string {
  if (v == null) return ''
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ────────────────────────────────────────────────
// Inline text cell
// ────────────────────────────────────────────────
function EditCell({
  value,
  placeholder = '—',
  onSave,
  type = 'text',
}: {
  value: string | null
  placeholder?: string
  onSave: (v: string | null) => void
  type?: string
}) {
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(value ?? '')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  function save() {
    setEditing(false)
    const trimmed = local.trim() || null
    if (trimmed !== (value || null)) onSave(trimmed)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type={type}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setLocal(value ?? ''); setEditing(false) }
        }}
        className="w-full bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
      />
    )
  }

  return (
    <span
      onClick={() => { setLocal(value ?? ''); setEditing(true) }}
      className="block w-full cursor-text hover:text-indigo-300 transition-colors truncate"
      title={value ?? ''}
    >
      {value || <span className="text-gray-600">{placeholder}</span>}
    </span>
  )
}

// ────────────────────────────────────────────────
// Single select cell
// ────────────────────────────────────────────────
function SelectCell({
  value,
  options,
  onSave,
}: {
  value: string | null
  options: string[]
  onSave: (v: string | null) => void
}) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onSave(e.target.value || null)}
      className="w-full bg-transparent text-sm text-white focus:outline-none cursor-pointer hover:text-indigo-300 transition-colors"
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ────────────────────────────────────────────────
// Multi-select cell
// ────────────────────────────────────────────────
function MultiSelectCell({
  values,
  options,
  onSave,
}: {
  values: string[] | null
  options: string[]
  onSave: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = values ?? []

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle(opt: string) {
    const next = selected.includes(opt)
      ? selected.filter(s => s !== opt)
      : [...selected, opt]
    onSave(next)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-left text-sm w-full truncate hover:text-indigo-300 transition-colors"
        title={selected.join(', ')}
      >
        {selected.length === 0
          ? <span className="text-gray-600">—</span>
          : selected.join(', ')}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl min-w-52 max-h-64 overflow-y-auto">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="rounded accent-indigo-500"
              />
              <span className="text-sm text-white">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────
// Lead row
// ────────────────────────────────────────────────
function LeadRow({
  lead,
  opts,
  onUpdate,
  onOpenNotes,
}: {
  lead: Lead
  opts: TrackerSettings
  onUpdate: (id: string, field: string, value: unknown) => void
  onOpenNotes: (id: string) => void
}) {
  const noteText = lead.latest_note?.note ?? null
  const truncatedNote = noteText && noteText.length > 60 ? noteText.slice(0, 60) + '…' : noteText

  return (
    <tr className="hover:bg-gray-900/40 group">
      <td className="px-3 py-2 text-sm">
        <div className="flex gap-1">
          <EditCell
            value={lead.first_name}
            placeholder="First"
            onSave={v => onUpdate(lead.id, 'first_name', v)}
          />
          <EditCell
            value={lead.last_name}
            placeholder="Last"
            onSave={v => onUpdate(lead.id, 'last_name', v)}
          />
        </div>
      </td>
      <td className="px-3 py-2 text-sm">
        <EditCell
          value={lead.phone}
          onSave={v => onUpdate(lead.id, 'phone', v)}
        />
      </td>
      <td className="px-3 py-2 text-sm max-w-[160px]">
        <MultiSelectCell
          values={lead.service}
          options={opts.service_options}
          onSave={v => onUpdate(lead.id, 'service', v)}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <SelectCell
          value={lead.status}
          options={opts.status_options}
          onSave={v => onUpdate(lead.id, 'status', v)}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <SelectCell
          value={lead.lead_source}
          options={opts.lead_source_options}
          onSave={v => onUpdate(lead.id, 'lead_source', v)}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <SelectCell
          value={lead.salesperson}
          options={opts.salesperson_options}
          onSave={v => onUpdate(lead.id, 'salesperson', v)}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <EditCell
          value={lead.annual_value != null ? String(lead.annual_value) : null}
          onSave={v => onUpdate(lead.id, 'annual_value', v ? parseFloat(v) : null)}
        />
      </td>
      <td className="px-3 py-2 text-sm text-gray-400">
        {fmtDate(lead.lead_creation_date)}
      </td>
      <td className="px-3 py-2 text-sm max-w-[200px]">
        {truncatedNote ? (
          <span
            className="text-gray-400 hover:text-indigo-300 cursor-pointer transition-colors truncate block"
            title={noteText ?? ''}
            onClick={() => onOpenNotes(lead.id)}
          >
            {truncatedNote}
          </span>
        ) : (
          <span className="text-gray-700 text-xs italic">no notes</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <button
          onClick={() => onOpenNotes(lead.id)}
          title="Notes"
          className="text-gray-600 hover:text-indigo-400 transition-colors text-base leading-none"
        >
          💬
        </button>
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────
// Group section
// ────────────────────────────────────────────────
function GroupSection({
  group,
  collapsed,
  onToggle,
  opts,
  onUpdate,
  onOpenNotes,
}: {
  group: { key: string; label: string; leads: Lead[] }
  collapsed: boolean
  onToggle: () => void
  opts: TrackerSettings
  onUpdate: (id: string, field: string, value: unknown) => void
  onOpenNotes: (id: string) => void
}) {
  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-2 bg-gray-900/60 border-y border-gray-800 cursor-pointer hover:bg-gray-900/80 transition-colors"
      >
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${GROUP_BADGE[group.key] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
          {group.label}
        </span>
        <span className="text-gray-600 text-xs">{group.leads.length} lead{group.leads.length !== 1 ? 's' : ''}</span>
        <span className="text-gray-600 ml-auto text-xs">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800/50">
                <th className="px-3 py-1.5 font-medium w-44">Name</th>
                <th className="px-3 py-1.5 font-medium w-36">Phone</th>
                <th className="px-3 py-1.5 font-medium w-40">Service</th>
                <th className="px-3 py-1.5 font-medium w-36">Status</th>
                <th className="px-3 py-1.5 font-medium w-36">Lead Source</th>
                <th className="px-3 py-1.5 font-medium w-28">Salesperson</th>
                <th className="px-3 py-1.5 font-medium w-24">Ann. Value</th>
                <th className="px-3 py-1.5 font-medium w-24">Created</th>
                <th className="px-3 py-1.5 font-medium">Latest Note</th>
                <th className="px-3 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/40">
              {group.leads.map(lead => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  opts={opts}
                  onUpdate={onUpdate}
                  onOpenNotes={onOpenNotes}
                />
              ))}
              {group.leads.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-4 text-gray-700 text-sm italic">No leads in this group.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────
// Notes panel
// ────────────────────────────────────────────────
function NotesPanel({
  lead,
  currentUser,
  onClose,
  onNoteAdded,
}: {
  lead: Lead | null
  currentUser: CurrentUser
  onClose: () => void
  onNoteAdded: (leadId: string, note: Note) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!lead) return
    setLoading(true)
    setNotes([])
    fetch(`/api/tracker/leads/${lead.id}/notes`)
      .then(r => r.json())
      .then(data => { setNotes(data); setLoading(false) })
  }, [lead?.id])

  async function addNote() {
    if (!newNote.trim() || !lead) return
    setSaving(true)
    const res = await fetch(`/api/tracker/leads/${lead.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: newNote }),
    })
    if (res.ok) {
      const saved = await res.json()
      setNotes(prev => [saved, ...prev])
      onNoteAdded(lead.id, saved)
      setNewNote('')
    }
    setSaving(false)
  }

  if (!lead) return null

  const groupLabel = PIPELINE_GROUPS.find(g => g.key === lead.stage)?.label ?? lead.stage ?? 'Unknown'
  const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead'

  function fmtNoteTime(ts: string) {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950 shrink-0">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800">
        <div>
          <div className="font-semibold text-white">{leadName}</div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border mt-1 inline-block ${GROUP_BADGE[lead.stage ?? ''] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
            {groupLabel}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none mt-0.5">✕</button>
      </div>

      {/* Notes thread */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && <p className="text-gray-600 text-sm">Loading…</p>}
        {!loading && notes.length === 0 && (
          <p className="text-gray-600 text-sm italic">No notes yet. Add the first one below.</p>
        )}
        {notes.map(note => (
          <div key={note.id} className="space-y-1">
            <p className="text-sm text-white whitespace-pre-wrap">{note.note}</p>
            <p className="text-xs text-gray-500">{note.created_by} · {fmtNoteTime(note.created_at)}</p>
          </div>
        ))}
      </div>

      {/* Add note */}
      <div className="px-5 py-4 border-t border-gray-800 space-y-2">
        <textarea
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
        />
        <button
          onClick={addNote}
          disabled={!newNote.trim() || saving}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Add Note'}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// New Lead slide-out form
// ────────────────────────────────────────────────
function NewLeadForm({
  opts,
  currentUser,
  onClose,
  onCreated,
}: {
  opts: TrackerSettings
  currentUser: CurrentUser
  onClose: () => void
  onCreated: (lead: Lead) => void
}) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    service_address: '',
    service: [] as string[],
    lead_source: '',
    status: 'Current',
    stage: 'current',
    salesperson: currentUser.name,
    annual_value: '',
    base_program_sold: '',
    auxiliary_services: [] as string[],
    initial_note: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const body = {
      ...form,
      annual_value: form.annual_value ? parseFloat(form.annual_value) : null,
      service: form.service.length ? form.service : null,
      auxiliary_services: form.auxiliary_services.length ? form.auxiliary_services : null,
      lead_source: form.lead_source || null,
      base_program_sold: form.base_program_sold || null,
    }

    const res = await fetch('/api/tracker/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const lead = await res.json()
      const noteObj = form.initial_note.trim()
        ? { note: form.initial_note, created_by: currentUser.name, created_at: new Date().toISOString() }
        : null
      onCreated({ ...lead, latest_note: noteObj })
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to create lead')
    }
    setSaving(false)
  }

  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950 shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h3 className="font-semibold text-white">New Lead</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">✕</button>
      </div>

      <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 flex-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">First Name</label>
            <input value={form.first_name} onChange={e => set('first_name', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Last Name</label>
            <input value={form.last_name} onChange={e => set('last_name', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Phone</label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} type="tel"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Email</label>
          <input value={form.email} onChange={e => set('email', e.target.value)} type="email"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Service Address</label>
          <input value={form.service_address} onChange={e => set('service_address', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Pipeline Group</label>
          <select value={form.stage} onChange={e => set('stage', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            {PIPELINE_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">—</option>
            {opts.status_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-2">Service</label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {opts.service_options.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.service.includes(s)}
                  onChange={() => set('service', form.service.includes(s) ? form.service.filter(x => x !== s) : [...form.service, s])}
                  className="rounded accent-indigo-500" />
                <span className="text-sm text-gray-300">{s}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Lead Source</label>
          <select value={form.lead_source} onChange={e => set('lead_source', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">—</option>
            {opts.lead_source_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Salesperson</label>
          <select value={form.salesperson} onChange={e => set('salesperson', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">—</option>
            {opts.salesperson_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Annual Value ($)</label>
          <input value={form.annual_value} onChange={e => set('annual_value', e.target.value)}
            type="number" min="0" step="0.01"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Base Program Sold</label>
          <select value={form.base_program_sold} onChange={e => set('base_program_sold', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">—</option>
            {opts.base_program_sold_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-2">Auxiliary Services</label>
          <div className="space-y-1">
            {opts.auxiliary_services_options.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.auxiliary_services.includes(s)}
                  onChange={() => set('auxiliary_services', form.auxiliary_services.includes(s) ? form.auxiliary_services.filter(x => x !== s) : [...form.auxiliary_services, s])}
                  className="rounded accent-indigo-500" />
                <span className="text-sm text-gray-300">{s}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Opening Note (optional)</label>
          <textarea value={form.initial_note} onChange={e => set('initial_note', e.target.value)}
            rows={3} placeholder="Call notes, first contact details…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none" />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2 pb-6">
          <button type="button" onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
            {saving ? 'Creating…' : 'Create Lead'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ────────────────────────────────────────────────
// Main TrackerPage
// ────────────────────────────────────────────────
export default function TrackerPage({
  settings,
  currentUser,
}: {
  settings: TrackerSettings | null
  currentUser: CurrentUser
}) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [salespersonFilter, setSalespersonFilter] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [notesLeadId, setNotesLeadId] = useState<string | null>(null)
  const [newLeadOpen, setNewLeadOpen] = useState(false)

  const opts: TrackerSettings = settings ?? {
    status_options: [],
    service_options: [],
    lead_source_options: [],
    salesperson_options: [],
    base_program_sold_options: [],
    auxiliary_services_options: [],
  }

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (stageFilter) params.set('stage', stageFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (salespersonFilter) params.set('salesperson', salespersonFilter)
    const res = await fetch(`/api/tracker/leads?${params}`)
    if (res.ok) setLeads(await res.json())
    setLoading(false)
  }, [search, stageFilter, statusFilter, salespersonFilter])

  useEffect(() => {
    const t = setTimeout(fetchLeads, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [fetchLeads])

  async function updateLead(id: string, field: string, value: unknown) {
    const res = await fetch(`/api/tracker/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (res.ok) {
      const updated = await res.json()
      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l))
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const groupedLeads = PIPELINE_GROUPS.map(g => ({
    ...g,
    leads: leads.filter(l => l.stage === g.key),
  }))

  const notesLead = notesLeadId ? leads.find(l => l.id === notesLeadId) ?? null : null
  const totalLeads = leads.length

  return (
    <div className="flex" style={{ height: 'calc(100vh - 104px)' }}>
      {/* Main */}
      <div className="flex-1 overflow-auto min-w-0">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search name, phone, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-48 max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Groups</option>
            {PIPELINE_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Statuses</option>
            {opts.status_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={salespersonFilter}
            onChange={e => setSalespersonFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Salespersons</option>
            {opts.salesperson_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-gray-600 px-1">{totalLeads} lead{totalLeads !== 1 ? 's' : ''}</span>
          <div className="flex-1" />
          <button
            onClick={() => setNewLeadOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            + New Lead
          </button>
        </div>

        {/* Groups */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading leads…</div>
        ) : (
          groupedLeads.map(group => (
            <GroupSection
              key={group.key}
              group={group}
              collapsed={collapsedGroups.has(group.key)}
              onToggle={() => toggleGroup(group.key)}
              opts={opts}
              onUpdate={updateLead}
              onOpenNotes={setNotesLeadId}
            />
          ))
        )}
      </div>

      {/* Notes panel */}
      {notesLeadId && (
        <NotesPanel
          lead={notesLead}
          currentUser={currentUser}
          onClose={() => setNotesLeadId(null)}
          onNoteAdded={(leadId, note) => {
            setLeads(prev => prev.map(l =>
              l.id === leadId ? { ...l, latest_note: note } : l
            ))
          }}
        />
      )}

      {/* New Lead form */}
      {newLeadOpen && !notesLeadId && (
        <NewLeadForm
          opts={opts}
          currentUser={currentUser}
          onClose={() => setNewLeadOpen(false)}
          onCreated={lead => {
            setLeads(prev => [lead, ...prev])
            setNewLeadOpen(false)
          }}
        />
      )}
    </div>
  )
}
