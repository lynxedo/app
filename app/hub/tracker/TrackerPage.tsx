'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react'
import { compareValues, cycleSort, type SortState } from '@/lib/tracker-sort'
import { useToast } from '@/components/ui'
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard'
import { formatPhone, formatCurrency as fmtCurrency } from '@/lib/format'
import type { LeadDrip, DripStatus } from '@/lib/tracker/leads'
import TableView from './leads/TableView'
import BoardView from './leads/BoardView'
import NeedsMeView from './leads/NeedsMeView'

// ── Types ────────────────────────────────────────
export type Stage = { id: string; key: string; label: string; color: string; sort_order: number; system_role?: string | null }

// A pipeline stage plus the leads currently in it — the shape the Table/Board
// views iterate over (also used for the trailing "Other" catch-all group).
export type StageGroup = { id: string; key: string; label: string; color: string; sort_order: number; system_role?: string | null; leads: Lead[] }

// A lead's most-relevant drip enrollment is typed in lib/tracker/leads.ts (the
// server loader that computes it) and re-exported here for the view components.
export type { LeadDrip, DripStatus }

export type TrackerView = 'table' | 'board' | 'needs_me'

type CustomColumnDef = {
  id: string
  name: string
  type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'phone'
  options: string[]
  sort_order: number
}

type ContactTypes = { call: boolean; text: boolean; email: boolean }

type LeadAttempt = {
  id: string
  lead_id: string
  attempt_number: number
  attempted_date: string | null
  notes: string | null
  contact_types: ContactTypes
}

export type Lead = {
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
  custom_values?: Record<string, string | null>
  stage_changed_at?: string | null
  drip?: LeadDrip | null
}

type Note = {
  id: string
  lead_id: string
  note: string
  created_by: string
  created_at: string
}

export type TrackerSettings = {
  status_options: string[]
  service_options: string[]
  lead_source_options: string[]
  salesperson_options: string[]
  base_program_sold_options: string[]
  auxiliary_services_options: string[]
  status_stage_rules: { status: string; stage: string }[]
  status_colors?: Record<string, string>
}

export type CurrentUser = { email: string; name: string; isAdmin: boolean }

// ── Suggested contact types by attempt # (highlighted, not pre-checked) ───────────
const EXPECTED_CONTACT_TYPES: Record<number, ContactTypes> = {
  1: { call: true, text: true, email: true },
  2: { call: false, text: true, email: false },
  3: { call: false, text: false, email: true },
  4: { call: true, text: false, email: false },
  5: { call: true, text: true, email: true },
}

const BLANK_CONTACT_TYPES: ContactTypes = { call: false, text: false, email: false }

// Notes column resize (shared across all expanded rows, persisted per-browser)
const NOTES_WIDTH_KEY = 'tracker_attempt_notes_width'
const NOTES_WIDTH_DEFAULT = 280
const NOTES_WIDTH_MIN = 120
const NOTES_WIDTH_MAX = 640

// ── Formatters ───────────────────────────────────
function fmtDate(d: string | null): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${m}/${day}/${y.slice(2)}`
}


// ── Frozen-column background helper ──────────────
function frozenBg(lightMode: boolean, checked: boolean): string {
  if (checked) return lightMode ? 'bg-indigo-50' : 'bg-indigo-950'
  return lightMode ? 'bg-white group-hover:bg-gray-50' : 'bg-gray-950 group-hover:bg-gray-900'
}

// ── Primitive cell components ────────────────────
function EditCell({
  value, displayValue, placeholder = '—', onSave, type = 'text', lightMode = false,
}: {
  value: string | null; displayValue?: string; placeholder?: string
  onSave: (v: string | null) => void; type?: string; lightMode?: boolean
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
      <input ref={ref} type={type} value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setLocal(value ?? ''); setEditing(false) } }}
        className={`w-full border rounded px-2 py-0.5 text-sm focus:outline-none ${lightMode ? 'bg-gray-100 border-indigo-400 text-gray-900' : 'bg-gray-800 border-indigo-500 text-white'}`}
      />
    )
  }
  return (
    <span onClick={() => { setLocal(value ?? ''); setEditing(true) }}
      className={`block w-full cursor-text transition-colors truncate ${lightMode ? 'text-gray-700 hover:text-indigo-600' : 'hover:text-indigo-300'}`}
      title={value ?? ''}>
      {(displayValue ?? value) || <span className={lightMode ? 'text-gray-400' : 'text-gray-600'}>{placeholder}</span>}
    </span>
  )
}

function SelectCell({ value, options, onSave, lightMode = false }: {
  value: string | null; options: string[]; onSave: (v: string | null) => void; lightMode?: boolean
}) {
  return (
    <select value={value ?? ''} onChange={e => onSave(e.target.value || null)}
      className={`w-full bg-transparent text-sm focus:outline-none cursor-pointer transition-colors ${lightMode ? 'text-gray-700 hover:text-indigo-600' : 'text-white hover:text-indigo-300'}`}>
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function StatusCell({ value, options, statusColors, lightMode, onSave }: {
  value: string | null; options: string[]; statusColors: Record<string, string>
  lightMode: boolean; onSave: (v: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLSelectElement>(null)
  const color = value && statusColors[value] ? statusColors[value] : null
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  if (editing) {
    return (
      <select ref={ref} value={value ?? ''} autoFocus
        onChange={e => { onSave(e.target.value || null); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className={`w-full text-sm focus:outline-none cursor-pointer ${lightMode ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'}`}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (color) {
    return (
      <span onClick={() => setEditing(true)}
        style={{ backgroundColor: color + (lightMode ? '45' : '25'), color: lightMode ? '#374151' : color, borderColor: color + '60' }}
        className="inline-block px-2 py-0.5 rounded text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity truncate max-w-full"
        title={value ?? ''}>
        {value || <span className="opacity-50">—</span>}
      </span>
    )
  }
  return (
    <span onClick={() => setEditing(true)}
      className={`block w-full cursor-text truncate transition-colors ${lightMode ? 'text-gray-700 hover:text-indigo-600' : 'text-white hover:text-indigo-300'}`}
      title={value ?? ''}>
      {value || <span className={lightMode ? 'text-gray-400' : 'text-gray-600'}>—</span>}
    </span>
  )
}

function MultiSelectCell({ values, options, onSave, lightMode = false }: {
  values: string[] | null; options: string[]; onSave: (v: string[]) => void; lightMode?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selected = values ?? []

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current?.contains(e.target as Node)) return
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleScroll() { setOpen(false) }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [open])

  function handleOpen() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const estDropH = Math.min(256, options.length * 34 + 8)
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= estDropH ? rect.bottom + 2 : rect.top - estDropH - 2
    setDropdownPos({ top, left: rect.left, minWidth: Math.max(208, rect.width) })
    setOpen(o => !o)
  }

  function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]
    onSave(next)
  }

  return (
    <div>
      <button ref={triggerRef} onClick={handleOpen}
        className={`text-left text-sm w-full truncate transition-colors ${lightMode ? 'text-gray-700 hover:text-indigo-600' : 'hover:text-indigo-300'}`}
        title={selected.join(', ')}>
        {selected.length === 0 ? <span className={lightMode ? 'text-gray-400' : 'text-gray-600'}>—</span> : selected.join(', ')}
      </button>
      {open && dropdownPos && (
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.minWidth, zIndex: 9999 }}
          className={`border rounded-lg shadow-xl max-h-64 overflow-y-auto ${lightMode ? 'bg-white border-gray-200' : 'bg-gray-800 border-gray-700'}`}
        >
          {options.map(opt => (
            <label key={opt} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${lightMode ? 'hover:bg-gray-50' : 'hover:bg-gray-700'}`}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="rounded accent-indigo-500" />
              <span className={`text-sm ${lightMode ? 'text-gray-900' : 'text-white'}`}>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Custom column cell ───────────────────────────
function CustomColumnCell({ colDef, value, onSave, lightMode }: {
  colDef: CustomColumnDef; value: string | null
  onSave: (v: string | null) => void; lightMode: boolean
}) {
  if (colDef.type === 'checkbox') {
    const checked = value === 'true'
    return (
      <input type="checkbox" checked={checked}
        onChange={() => onSave(checked ? 'false' : 'true')}
        className="rounded accent-indigo-500 cursor-pointer" />
    )
  }
  if (colDef.type === 'dropdown') {
    return <SelectCell value={value} options={colDef.options} onSave={onSave} lightMode={lightMode} />
  }
  if (colDef.type === 'date') {
    return (
      <EditCell value={value} displayValue={fmtDate(value) || undefined}
        type="date" lightMode={lightMode} onSave={onSave} />
    )
  }
  if (colDef.type === 'phone') {
    return (
      <EditCell value={value} displayValue={formatPhone(value) || undefined}
        lightMode={lightMode} onSave={v => onSave(v ? formatPhone(v) : null)} />
    )
  }
  if (colDef.type === 'number') {
    return <EditCell value={value} type="number" lightMode={lightMode} onSave={onSave} />
  }
  return <EditCell value={value} lightMode={lightMode} onSave={onSave} />
}

// ── Built-in column definitions ──────────────────
type LeadCtx = {
  opts: TrackerSettings
  lightMode: boolean
  statusColors: Record<string, string>
  onUpdate: (id: string, field: string, value: unknown) => void
  onOpenNotes: (id: string) => void
}

type ColumnDef = {
  id: string
  label: string
  defaultWidth: number
  render: (lead: Lead, ctx: LeadCtx) => ReactNode
}

const LEAD_COLUMNS: ColumnDef[] = [
  {
    id: 'name', label: 'Name', defaultWidth: 176,
    render: (lead, { lightMode, onUpdate }) => (
      <div className="flex gap-1">
        <EditCell value={lead.first_name} placeholder="First" lightMode={lightMode} onSave={v => onUpdate(lead.id, 'first_name', v)} />
        <EditCell value={lead.last_name} placeholder="Last" lightMode={lightMode} onSave={v => onUpdate(lead.id, 'last_name', v)} />
      </div>
    ),
  },
  {
    id: 'phone', label: 'Phone', defaultWidth: 128,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell value={lead.phone} displayValue={formatPhone(lead.phone) || undefined}
        lightMode={lightMode} onSave={v => onUpdate(lead.id, 'phone', v ? formatPhone(v) : null)} />
    ),
  },
  {
    id: 'email', label: 'Email', defaultWidth: 200,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell value={lead.email} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'email', v)} />
    ),
  },
  {
    id: 'service_address', label: 'Address', defaultWidth: 220,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell value={lead.service_address} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'service_address', v)} />
    ),
  },
  {
    id: 'service', label: 'Service', defaultWidth: 160,
    render: (lead, { opts, lightMode, onUpdate }) => (
      <MultiSelectCell values={lead.service} options={opts.service_options} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'service', v)} />
    ),
  },
  {
    id: 'status', label: 'Status', defaultWidth: 128,
    render: (lead, { opts, lightMode, statusColors, onUpdate }) => (
      <StatusCell value={lead.status} options={opts.status_options} statusColors={statusColors}
        lightMode={lightMode} onSave={v => onUpdate(lead.id, 'status', v)} />
    ),
  },
  {
    id: 'lead_source', label: 'Lead Source', defaultWidth: 128,
    render: (lead, { opts, lightMode, onUpdate }) => (
      <SelectCell value={lead.lead_source} options={opts.lead_source_options} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'lead_source', v)} />
    ),
  },
  {
    id: 'salesperson', label: 'Salesperson', defaultWidth: 112,
    render: (lead, { opts, lightMode, onUpdate }) => (
      <SelectCell value={lead.salesperson} options={opts.salesperson_options} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'salesperson', v)} />
    ),
  },
  {
    id: 'base_program', label: 'Base Program', defaultWidth: 144,
    render: (lead, { opts, lightMode, onUpdate }) => (
      <SelectCell value={lead.base_program_sold} options={opts.base_program_sold_options} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'base_program_sold', v)} />
    ),
  },
  {
    id: 'aux_services', label: 'Aux Services', defaultWidth: 160,
    render: (lead, { opts, lightMode, onUpdate }) => (
      <MultiSelectCell values={lead.auxiliary_services} options={opts.auxiliary_services_options} lightMode={lightMode} onSave={v => onUpdate(lead.id, 'auxiliary_services', v)} />
    ),
  },
  {
    id: 'annual_value', label: 'Ann. Value', defaultWidth: 96,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell value={lead.annual_value != null ? String(lead.annual_value) : null}
        displayValue={fmtCurrency(lead.annual_value) || undefined}
        lightMode={lightMode} onSave={v => onUpdate(lead.id, 'annual_value', v ? parseFloat(v) : null)} />
    ),
  },
  {
    id: 'created', label: 'Created', defaultWidth: 96,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell value={lead.lead_creation_date} displayValue={fmtDate(lead.lead_creation_date) || undefined}
        type="date" lightMode={lightMode} onSave={v => onUpdate(lead.id, 'lead_creation_date', v)} />
    ),
  },
  {
    id: 'latest_note', label: 'Latest Note', defaultWidth: 200,
    render: (lead, { lightMode, onOpenNotes }) => {
      const noteText = lead.latest_note?.note ?? null
      const truncated = noteText && noteText.length > 60 ? noteText.slice(0, 60) + '…' : noteText
      return truncated ? (
        <span className={`cursor-pointer transition-colors truncate block ${lightMode ? 'text-gray-500 hover:text-indigo-600' : 'text-gray-400 hover:text-indigo-300'}`}
          title={noteText ?? ''} onClick={() => onOpenNotes(lead.id)}>{truncated}</span>
      ) : (
        <span className={`text-xs italic ${lightMode ? 'text-gray-400' : 'text-gray-700'}`}>no notes</span>
      )
    },
  },
]

function leadSortValue(lead: Lead, id: string, customColumnDefs: CustomColumnDef[]): unknown {
  switch (id) {
    case 'name': return `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim()
    case 'phone': return lead.phone
    case 'service': return (lead.service ?? []).join(', ')
    case 'status': return lead.status
    case 'lead_source': return lead.lead_source
    case 'salesperson': return lead.salesperson
    case 'base_program': return lead.base_program_sold
    case 'aux_services': return (lead.auxiliary_services ?? []).join(', ')
    case 'annual_value': return lead.annual_value
    case 'created': return lead.lead_creation_date
    case 'latest_note': return lead.latest_note?.note ?? null
    default: {
      const colDef = customColumnDefs.find(c => c.id === id)
      return colDef ? (lead.custom_values?.[colDef.id] ?? null) : null
    }
  }
}

type ColumnEntry = { id: string; width: number; hidden?: boolean }

function resolveColumns(
  layout: ColumnEntry[] | null,
  customColumnDefs: CustomColumnDef[]
): Array<(ColumnDef | { id: string; label: string; defaultWidth: number; isCustom: true; colDef: CustomColumnDef }) & { width: number; hidden: boolean }> {
  type AnyCol = ColumnDef | { id: string; label: string; defaultWidth: number; isCustom: true; colDef: CustomColumnDef }
  const builtinById = new Map(LEAD_COLUMNS.map(c => [c.id, c as AnyCol]))
  const customById = new Map(customColumnDefs.map(c => [c.id, { id: c.id, label: c.name, defaultWidth: 128, isCustom: true as const, colDef: c } as AnyCol]))
  const allById = new Map([...builtinById, ...customById])

  const seen = new Set<string>()
  const out: Array<AnyCol & { width: number; hidden: boolean }> = []

  if (layout) {
    for (const entry of layout) {
      const def = allById.get(entry.id)
      if (def && !seen.has(entry.id)) {
        out.push({ ...def, width: Math.max(50, Math.min(600, entry.width || def.defaultWidth)), hidden: entry.hidden === true })
        seen.add(entry.id)
      }
    }
  }
  for (const def of LEAD_COLUMNS) {
    if (!seen.has(def.id)) out.push({ ...def, width: def.defaultWidth, hidden: false })
    seen.add(def.id)
  }
  for (const c of customColumnDefs) {
    if (!seen.has(c.id)) out.push({ id: c.id, label: c.name, defaultWidth: 128, isCustom: true, colDef: c, width: 128, hidden: false })
    seen.add(c.id)
  }
  return out
}

// ── Attempts sub-rows ─────────────────────────────
function AttemptsRows({ leadId, lightMode, totalColSpan, onAttemptNoteSaved }: {
  leadId: string; lightMode: boolean; totalColSpan: number; onAttemptNoteSaved?: (note: string) => void
}) {
  const [attempts, setAttempts] = useState<LeadAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [notesWidth, setNotesWidth] = useState(NOTES_WIDTH_DEFAULT)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    fetch(`/api/tracker/leads/${leadId}/attempts`)
      .then(r => r.json())
      .then(data => { setAttempts(Array.isArray(data) ? data : []); setLoading(false) })
  }, [leadId])

  // Keep a ref in sync so the mouseup handler persists the final width
  const notesWidthRef = useRef(notesWidth)
  useEffect(() => { notesWidthRef.current = notesWidth }, [notesWidth])

  // Restore saved Notes column width
  useEffect(() => {
    const saved = Number(localStorage.getItem(NOTES_WIDTH_KEY))
    if (saved >= NOTES_WIDTH_MIN && saved <= NOTES_WIDTH_MAX) setNotesWidth(saved)
  }, [])

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: notesWidth }
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const w = Math.min(NOTES_WIDTH_MAX, Math.max(NOTES_WIDTH_MIN, dragRef.current.startW + (ev.clientX - dragRef.current.startX)))
      setNotesWidth(w)
    }
    function onUp() {
      if (dragRef.current) localStorage.setItem(NOTES_WIDTH_KEY, String(notesWidthRef.current))
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function getAttempt(n: number): LeadAttempt | null {
    return attempts.find(a => a.attempt_number === n) ?? null
  }

  async function save(n: number, patch: Partial<LeadAttempt>) {
    const existing = getAttempt(n)
    const payload = {
      attempt_number: n,
      attempted_date: patch.attempted_date ?? existing?.attempted_date ?? null,
      notes: patch.notes ?? existing?.notes ?? null,
      contact_types: patch.contact_types ?? existing?.contact_types ?? BLANK_CONTACT_TYPES,
    }
    const res = await fetch(`/api/tracker/leads/${leadId}/attempts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const saved: LeadAttempt = await res.json()
      setAttempts(prev => {
        const next = prev.filter(a => a.attempt_number !== n)
        return [...next, saved].sort((a, b) => a.attempt_number - b.attempt_number)
      })
      if ('notes' in patch && saved.notes) onAttemptNoteSaved?.(saved.notes)
    }
  }

  const rowBg = lightMode ? 'bg-gray-50' : 'bg-gray-900/60'
  const borderColor = lightMode ? 'border-gray-200' : 'border-gray-800'
  const textMuted = lightMode ? 'text-gray-500' : 'text-gray-500'
  const textBase = lightMode ? 'text-gray-800' : 'text-gray-200'
  const inputCls = `w-full text-xs border rounded px-2 py-1 focus:outline-none focus:border-indigo-500 ${lightMode ? 'bg-white border-gray-300 text-gray-900' : 'bg-gray-800 border-gray-700 text-white'}`

  return (
    <tr>
      <td colSpan={totalColSpan} className={`px-0 py-0 border-t ${borderColor}`}>
        <div className={`${rowBg} px-8 py-2 overflow-x-auto`}>
          {loading ? (
            <p className={`text-xs ${textMuted} py-2`}>Loading attempts…</p>
          ) : (
            <table className="text-xs" style={{ tableLayout: 'fixed', width: 64 + 128 + notesWidth + 192 + 24 }}>
              <thead>
                <tr className={textMuted}>
                  <th className="text-left font-medium py-1 pr-3" style={{ width: 64 }}>Attempt</th>
                  <th className="text-left font-medium py-1 pr-3" style={{ width: 128 }}>Date</th>
                  <th className="text-left font-medium py-1 pr-3 relative" style={{ width: notesWidth }}>
                    Notes
                    <span
                      onMouseDown={startResize}
                      className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none group flex items-center justify-end"
                      title="Drag to resize Notes column"
                    >
                      <span className={`h-3.5 w-px ${lightMode ? 'bg-gray-300 group-hover:bg-indigo-500' : 'bg-gray-600 group-hover:bg-indigo-400'} transition-colors`} />
                    </span>
                  </th>
                  <th className="text-left font-medium py-1" style={{ width: 192 }}>Type</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${lightMode ? 'divide-gray-100' : 'divide-gray-800'}`}>
                {[1, 2, 3, 4, 5].map(n => {
                  const a = getAttempt(n)
                  const ct: ContactTypes = a?.contact_types ?? BLANK_CONTACT_TYPES
                  const expected = EXPECTED_CONTACT_TYPES[n]
                  return (
                    <tr key={n} className={lightMode ? 'hover:bg-gray-100' : 'hover:bg-gray-800/40'}>
                      <td className={`py-1.5 pr-3 font-semibold ${textBase}`}>{n}</td>
                      <td className="py-1.5 pr-3">
                        <input
                          type="date"
                          value={a?.attempted_date ?? ''}
                          onChange={e => save(n, { attempted_date: e.target.value || null })}
                          className={inputCls}
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <AttemptNotesCell
                          value={a?.notes ?? ''}
                          onSave={v => save(n, { notes: v })}
                          inputCls={inputCls}
                          lightMode={lightMode}
                        />
                      </td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-2">
                          {(['call', 'text', 'email'] as const).map(k => {
                            const isExpected = expected[k]
                            return (
                              <label
                                key={k}
                                className={`flex items-center gap-1 cursor-pointer select-none rounded px-1.5 py-0.5 transition-colors ${
                                  isExpected
                                    ? (lightMode ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40')
                                    : (ct[k] ? textBase : textMuted)
                                }`}
                                title={isExpected ? 'Suggested for this attempt' : undefined}
                              >
                                <input
                                  type="checkbox"
                                  checked={ct[k]}
                                  onChange={() => save(n, { contact_types: { ...ct, [k]: !ct[k] } })}
                                  className="rounded accent-indigo-500 cursor-pointer"
                                />
                                <span className="capitalize">{k}</span>
                              </label>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  )
}

function AttemptNotesCell({ value, onSave, inputCls, lightMode }: {
  value: string; onSave: (v: string | null) => void; inputCls: string; lightMode: boolean
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  void lightMode
  return (
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => onSave(local.trim() || null)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder="Notes…"
      className={inputCls}
    />
  )
}

// ── Lead row ─────────────────────────────────────
export type AnyColWithMeta = (ColumnDef | { id: string; label: string; defaultWidth: number; isCustom: true; colDef: CustomColumnDef }) & { width: number; hidden: boolean }

function LeadRow({
  lead, opts, checked, onToggle, onUpdate, onCustomUpdate, onOpenNotes, onEdit,
  lightMode, statusColors, columns, freezeCount, colLeft, totalColSpan, onAttemptNoteSaved,
}: {
  lead: Lead; opts: TrackerSettings; checked: boolean; onToggle: () => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onCustomUpdate: (leadId: string, columnId: string, value: string | null) => void
  onOpenNotes: (id: string) => void; onEdit: (id: string) => void
  lightMode: boolean; statusColors: Record<string, string>
  columns: AnyColWithMeta[]; freezeCount: number; colLeft: number[]
  totalColSpan: number; onAttemptNoteSaved?: (leadId: string, note: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rowCls = checked
    ? lightMode ? 'bg-indigo-50' : 'bg-indigo-950/30'
    : lightMode ? 'hover:bg-gray-50 group' : 'hover:bg-gray-900/40 group'

  const ctx: LeadCtx = { opts, lightMode, statusColors, onUpdate, onOpenNotes }

  return (
    <>
      <tr className={rowCls}>
        {/* Expand + checkbox combined sticky cell */}
        <td
          className={`px-2 py-2 sticky z-10 ${frozenBg(lightMode, checked)}`}
          style={{ left: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(x => !x)}
              title={expanded ? 'Collapse attempts' : 'Expand attempts'}
              className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors shrink-0 ${
                expanded
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : lightMode ? 'text-gray-400 hover:text-gray-700' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {expanded ? '▼' : '▶'}
            </button>
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              className="rounded accent-indigo-500 cursor-pointer"
            />
          </div>
        </td>
        {columns.map((col, i) => {
          const frozen = i < freezeCount
          const isLastFrozen = i === freezeCount - 1
          const content = 'isCustom' in col
            ? <CustomColumnCell colDef={col.colDef} value={lead.custom_values?.[col.id] ?? null}
                onSave={v => onCustomUpdate(lead.id, col.id, v)} lightMode={lightMode} />
            : (col as ColumnDef).render(lead, ctx)
          return (
            <td key={col.id}
              className={`px-3 py-2 text-sm overflow-hidden ${frozen ? `sticky z-10 ${frozenBg(lightMode, checked)} ${isLastFrozen ? (lightMode ? 'border-r border-gray-200' : 'border-r border-gray-800') : ''}` : ''}`}
              style={frozen ? { maxWidth: col.width, left: colLeft[i] } : { maxWidth: col.width }}>
              {content}
            </td>
          )
        })}
        <td className="px-3 py-2 text-center whitespace-nowrap">
          <button onClick={() => onEdit(lead.id)} title="Edit lead" className="text-gray-600 hover:text-indigo-400 transition-colors text-sm leading-none mr-2">✎</button>
          <button onClick={() => onOpenNotes(lead.id)} title="Notes" className="text-gray-600 hover:text-indigo-400 transition-colors text-base leading-none">💬</button>
        </td>
      </tr>
      {expanded && (
        <AttemptsRows leadId={lead.id} lightMode={lightMode} totalColSpan={totalColSpan}
          onAttemptNoteSaved={(note) => onAttemptNoteSaved?.(lead.id, note)} />
      )}
    </>
  )
}

// ── Column header ─────────────────────────────────
function ColumnHeader({ col, sort, onToggleSort, onSetSort, onColumnResize, onColumnReorder, lightMode, frozen, leftOffset, isLastFrozen }: {
  col: AnyColWithMeta; sort: SortState; onToggleSort: (id: string) => void
  onSetSort: (id: string, dir: 'asc' | 'desc' | null) => void
  onColumnResize: (id: string, width: number) => void
  onColumnReorder: (fromId: string, toId: string) => void
  lightMode: boolean; frozen: boolean; leftOffset: number; isLastFrozen: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const active = sort?.key === col.id
  const frozenCls = frozen
    ? `sticky z-20 ${lightMode ? 'bg-white' : 'bg-gray-950'} ${isLastFrozen ? (lightMode ? 'border-r border-gray-200' : 'border-r border-gray-800') : ''}`
    : ''
  return (
    <th className={`px-3 py-1.5 font-medium relative select-none cursor-grab active:cursor-grabbing ${frozenCls}`}
      style={frozen ? { left: leftOffset } : undefined}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/x-tracker-col', col.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDrop={e => { e.preventDefault(); const fromId = e.dataTransfer.getData('text/x-tracker-col'); if (fromId && fromId !== col.id) onColumnReorder(fromId, col.id) }}>
      <span className="inline-flex items-center gap-1">
        <span onClick={() => onToggleSort(col.id)} className="cursor-pointer hover:text-gray-300 inline-flex items-center gap-1">
          {col.label}
          {active && <span className="text-indigo-400">{sort!.dir === 'asc' ? '▲' : '▼'}</span>}
        </span>
        <button onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }} onMouseDown={e => e.stopPropagation()}
          className={`text-[10px] leading-none px-0.5 ${active ? 'text-indigo-400' : 'text-gray-600 hover:text-gray-300'}`}>▾</button>
      </span>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className={`absolute left-2 top-full mt-1 z-50 w-36 rounded-lg border shadow-2xl py-1 text-xs font-normal ${lightMode ? 'bg-white border-gray-200 text-gray-700' : 'bg-gray-900 border-gray-700 text-gray-200'}`}>
            <button onClick={() => { onSetSort(col.id, 'asc'); setMenuOpen(false) }} className={`w-full text-left px-3 py-1.5 ${lightMode ? 'hover:bg-gray-100' : 'hover:bg-gray-800'} ${active && sort!.dir === 'asc' ? 'text-indigo-400' : ''}`}>Sort A → Z</button>
            <button onClick={() => { onSetSort(col.id, 'desc'); setMenuOpen(false) }} className={`w-full text-left px-3 py-1.5 ${lightMode ? 'hover:bg-gray-100' : 'hover:bg-gray-800'} ${active && sort!.dir === 'desc' ? 'text-indigo-400' : ''}`}>Sort Z → A</button>
            <button onClick={() => { onSetSort(col.id, null); setMenuOpen(false) }} className={`w-full text-left px-3 py-1.5 ${lightMode ? 'hover:bg-gray-100' : 'hover:bg-gray-800'}`}>Clear sort</button>
          </div>
        </>
      )}
      <span role="separator" aria-orientation="vertical"
        onMouseDown={e => {
          e.preventDefault(); e.stopPropagation()
          const startX = e.clientX; const startWidth = col.width
          function onMove(ev: MouseEvent) { onColumnResize(col.id, Math.max(50, Math.min(600, startWidth + ev.clientX - startX))) }
          function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
        }}
        className="group/resize absolute top-0 right-0 h-full w-2 flex items-center justify-center cursor-col-resize"
        onDragStart={e => e.preventDefault()}>
        <span className={`h-3/5 w-px transition-all group-hover/resize:w-0.5 group-hover/resize:bg-indigo-400 ${lightMode ? 'bg-gray-300' : 'bg-gray-700'}`} />
      </span>
    </th>
  )
}

// ── Group checkbox ────────────────────────────────
function GroupCheckbox({ leads, selectedIds, onToggleGroupAll }: {
  leads: Lead[]; selectedIds: Set<string>; onToggleGroupAll: (ids: string[]) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const checkedCount = leads.filter(l => selectedIds.has(l.id)).length
  const allChecked = leads.length > 0 && checkedCount === leads.length
  const indeterminate = checkedCount > 0 && checkedCount < leads.length
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input ref={ref} type="checkbox" checked={allChecked}
      onChange={() => onToggleGroupAll(leads.map(l => l.id))}
      className="rounded accent-indigo-500 cursor-pointer" />
  )
}

// ── Group section ─────────────────────────────────
export function GroupSection({
  group, collapsed, onToggle, opts, selectedIds, onToggleSelect, onToggleGroupAll,
  onUpdate, onCustomUpdate, onOpenNotes, onEdit, stageColor, lightMode, columns,
  onColumnResize, onColumnReorder, sort, onToggleSort, onSetSort, onAttemptNoteSaved,
}: {
  group: { key: string; label: string; leads: Lead[] }
  collapsed: boolean; onToggle: () => void; opts: TrackerSettings
  selectedIds: Set<string>; onToggleSelect: (id: string) => void
  onToggleGroupAll: (ids: string[]) => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onCustomUpdate: (leadId: string, columnId: string, value: string | null) => void
  onOpenNotes: (id: string) => void; onEdit: (id: string) => void
  stageColor: string; lightMode: boolean; columns: AnyColWithMeta[]
  onColumnResize: (id: string, width: number) => void
  onColumnReorder: (fromId: string, toId: string) => void
  sort: SortState; onToggleSort: (id: string) => void
  onSetSort: (id: string, dir: 'asc' | 'desc' | null) => void
  onAttemptNoteSaved?: (leadId: string, note: string) => void
}) {
  const EXPAND_CHECKBOX_W = 56 // expand(20) + gap(4) + checkbox(20) + px-2 on each side
  const freezeCount = Math.min(1, columns.length)
  const colLeft: number[] = []
  { let acc = EXPAND_CHECKBOX_W; for (let i = 0; i < columns.length; i++) { colLeft[i] = acc; acc += columns[i].width } }
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) + EXPAND_CHECKBOX_W + 56
  // colSpan = expand/checkbox col + all data cols + actions col
  const totalColSpan = 1 + columns.length + 1

  return (
    <div className="rounded-lg shadow-sm">
      {/* Stage header — collapse arrow on LEFT near checkbox */}
      <div onClick={onToggle}
        className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:opacity-90 transition-opacity rounded-t-lg ${collapsed ? 'rounded-b-lg' : ''}`}
        style={{ backgroundColor: stageColor }}>
        {/* Collapse/expand arrow — left side near select-all */}
        <span className="text-white/80 text-xs w-4 text-center shrink-0">{collapsed ? '▶' : '▼'}</span>
        <div onClick={e => e.stopPropagation()}>
          <GroupCheckbox leads={group.leads} selectedIds={selectedIds} onToggleGroupAll={onToggleGroupAll} />
        </div>
        <span className="text-sm font-semibold text-white">{group.label}</span>
        <span className="text-white/70 text-xs">{group.leads.length} lead{group.leads.length !== 1 ? 's' : ''}</span>
      </div>

      {!collapsed && (
        <div className={lightMode ? 'bg-white' : ''}>
          <table className="w-full" style={{ minWidth: totalWidth, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: EXPAND_CHECKBOX_W }} />
              {columns.map(col => <col key={col.id} style={{ width: col.width }} />)}
              <col style={{ width: 56 }} />
            </colgroup>
            <thead>
              <tr className={`text-left text-xs border-b ${lightMode ? 'text-gray-500 border-gray-200' : 'text-gray-500 border-gray-800/50'}`}>
                <th className={`px-2 py-1.5 sticky z-20 ${lightMode ? 'bg-white' : 'bg-gray-950'}`} style={{ left: 0 }}></th>
                {columns.map((col, i) => (
                  <ColumnHeader key={col.id} col={col} sort={sort}
                    onToggleSort={onToggleSort} onSetSort={onSetSort}
                    onColumnResize={onColumnResize} onColumnReorder={onColumnReorder}
                    lightMode={lightMode} frozen={i < freezeCount}
                    leftOffset={colLeft[i]} isLastFrozen={i === freezeCount - 1} />
                ))}
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody className={`divide-y ${lightMode ? 'divide-gray-100' : 'divide-gray-800/40'}`}>
              {group.leads.map(lead => (
                <LeadRow key={lead.id} lead={lead} opts={opts}
                  checked={selectedIds.has(lead.id)} onToggle={() => onToggleSelect(lead.id)}
                  onUpdate={onUpdate} onCustomUpdate={onCustomUpdate}
                  onOpenNotes={onOpenNotes} onEdit={onEdit}
                  lightMode={lightMode} statusColors={opts.status_colors ?? {}}
                  columns={columns} freezeCount={freezeCount} colLeft={colLeft}
                  totalColSpan={totalColSpan} onAttemptNoteSaved={onAttemptNoteSaved} />
              ))}
              {group.leads.length === 0 && (
                <tr>
                  <td colSpan={totalColSpan} className={`px-4 py-4 text-sm italic ${lightMode ? 'text-gray-400' : 'text-gray-700'}`}>
                    No leads in this stage.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Notes panel ───────────────────────────────────
function NotesPanel({ lead, currentUser, onClose, onNoteAdded }: {
  lead: Lead | null; currentUser: CurrentUser; onClose: () => void
  onNoteAdded: (leadId: string, note: Note) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!lead) return
    setLoading(true); setNotes([])
    fetch(`/api/tracker/leads/${lead.id}/notes`).then(r => r.json()).then(data => { setNotes(data); setLoading(false) })
  }, [lead?.id])

  async function addNote() {
    if (!newNote.trim() || !lead) return
    setSaving(true)
    const res = await fetch(`/api/tracker/leads/${lead.id}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: newNote }),
    })
    if (res.ok) {
      const saved = await res.json()
      setNotes(prev => [saved, ...prev]); onNoteAdded(lead.id, saved); setNewNote('')
    }
    setSaving(false)
  }

  if (!lead) return null
  const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead'
  function fmtNoteTime(ts: string) {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  void currentUser

  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950 shrink-0">
      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800">
        <div>
          <div className="font-semibold text-white">{leadName}</div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none mt-0.5" aria-label="Close">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && <p className="text-gray-600 text-sm">Loading…</p>}
        {!loading && notes.length === 0 && <p className="text-gray-600 text-sm italic">No notes yet.</p>}
        {notes.map(note => (
          <div key={note.id} className="space-y-1">
            <p className="text-sm text-white whitespace-pre-wrap">{note.note}</p>
            <p className="text-xs text-gray-500">{note.created_by} · {fmtNoteTime(note.created_at)}</p>
          </div>
        ))}
      </div>
      <div className="px-5 py-4 border-t border-gray-800 space-y-2">
        <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note…" rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }} />
        <button onClick={addNote} disabled={!newNote.trim() || saving}
          className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-[#fff] text-sm font-medium py-2 rounded-lg transition-colors">
          {saving ? 'Saving…' : 'Add Note'}
        </button>
      </div>
    </div>
  )
}

// ── Edit Lead drawer ──────────────────────────────
function EditLeadDrawer({ lead, opts, stages, onClose, onUpdated, onDeleted }: {
  lead: Lead; opts: TrackerSettings; stages: Stage[]
  onClose: () => void; onUpdated: (lead: Lead) => void; onDeleted: (id: string) => void
}) {
  const [form, setForm] = useState({
    first_name: lead.first_name ?? '', last_name: lead.last_name ?? '',
    phone: formatPhone(lead.phone), email: lead.email ?? '',
    service_address: lead.service_address ?? '',
    service: lead.service ?? [] as string[],
    lead_source: lead.lead_source ?? '', status: lead.status ?? '',
    stage: lead.stage ?? (stages[0]?.key ?? 'current'),
    salesperson: lead.salesperson ?? '', annual_value: lead.annual_value != null ? String(lead.annual_value) : '',
    base_program_sold: lead.base_program_sold ?? '',
    auxiliary_services: lead.auxiliary_services ?? [] as string[],
    sold_date: lead.sold_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    const body = {
      ...form, annual_value: form.annual_value ? parseFloat(form.annual_value) : null,
      service: form.service.length ? form.service : null,
      auxiliary_services: form.auxiliary_services.length ? form.auxiliary_services : null,
      lead_source: form.lead_source || null, base_program_sold: form.base_program_sold || null,
      status: form.status || null, salesperson: form.salesperson || null,
      sold_date: form.sold_date || null,
    }
    const res = await fetch(`/api/tracker/leads/${lead.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (res.ok) { const updated = await res.json(); onUpdated({ ...lead, ...updated }) }
    else { const data = await res.json(); setError(data.error ?? 'Failed to save') }
    setSaving(false)
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/tracker/leads/${lead.id}`, { method: 'DELETE' })
    if (res.ok) { onDeleted(lead.id) }
    else { const data = await res.json(); setError(data.error ?? 'Failed to delete'); setDeleting(false); setConfirmDelete(false) }
  }

  const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead'
  const fieldCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"

  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950 shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h3 className="font-semibold text-white truncate pr-2">{leadName}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none shrink-0" aria-label="Close">✕</button>
      </div>
      <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 flex-1">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-400 mb-1">First Name</label>
            <input value={form.first_name} onChange={e => set('first_name', e.target.value)} className={fieldCls} /></div>
          <div><label className="block text-xs text-gray-400 mb-1">Last Name</label>
            <input value={form.last_name} onChange={e => set('last_name', e.target.value)} className={fieldCls} /></div>
        </div>
        <div><label className="block text-xs text-gray-400 mb-1">Phone</label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatPhone(e.target.value))} type="tel" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Email</label>
          <input value={form.email} onChange={e => set('email', e.target.value)} type="email" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Service Address</label>
          <input value={form.service_address} onChange={e => set('service_address', e.target.value)} className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Stage</label>
          <select value={form.stage} onChange={e => set('stage', e.target.value)} className={fieldCls}>
            {stages.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.status_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-2">Service</label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {opts.service_options.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.service.includes(s)}
                  onChange={() => set('service', form.service.includes(s) ? form.service.filter((x: string) => x !== s) : [...form.service, s])}
                  className="rounded accent-indigo-500" />
                <span className="text-sm text-gray-300">{s}</span>
              </label>
            ))}
          </div></div>
        <div><label className="block text-xs text-gray-400 mb-1">Lead Source</label>
          <select value={form.lead_source} onChange={e => set('lead_source', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.lead_source_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-1">Salesperson</label>
          <select value={form.salesperson} onChange={e => set('salesperson', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.salesperson_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-1">Annual Value ($)</label>
          <input value={form.annual_value} onChange={e => set('annual_value', e.target.value)} type="number" min="0" step="0.01" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Sold Date</label>
          <input value={form.sold_date} onChange={e => set('sold_date', e.target.value)} type="date" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Base Program Sold</label>
          <select value={form.base_program_sold} onChange={e => set('base_program_sold', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.base_program_sold_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-2">Auxiliary Services</label>
          <div className="space-y-1">
            {opts.auxiliary_services_options.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.auxiliary_services.includes(s)}
                  onChange={() => set('auxiliary_services', form.auxiliary_services.includes(s) ? form.auxiliary_services.filter((x: string) => x !== s) : [...form.auxiliary_services, s])}
                  className="rounded accent-indigo-500" />
                <span className="text-sm text-gray-300">{s}</span>
              </label>
            ))}
          </div></div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 bg-brand hover:bg-brand-hover disabled:opacity-50 text-[#fff] text-sm font-medium py-2.5 rounded-lg transition-colors">{saving ? 'Saving…' : 'Save'}</button>
        </div>
        <div className="border-t border-gray-800 pt-4 pb-6">
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)} className="w-full text-red-500 hover:text-red-400 text-sm font-medium py-2 rounded-lg border border-red-900/50 hover:border-red-700 transition-colors">Delete Lead</button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 text-center">Delete this lead permanently?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors">Cancel</button>
                <button type="button" onClick={handleDelete} disabled={deleting} className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-[#fff] text-sm font-medium py-2 rounded-lg transition-colors">{deleting ? 'Deleting…' : 'Confirm Delete'}</button>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  )
}

// ── New Lead form ─────────────────────────────────
function NewLeadForm({ opts, stages, currentUser, onClose, onCreated }: {
  opts: TrackerSettings; stages: Stage[]; currentUser: CurrentUser
  onClose: () => void; onCreated: (lead: Lead) => void
}) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', email: '', service_address: '',
    service: [] as string[], lead_source: '', status: 'Current',
    stage: stages[0]?.key ?? 'current',
    salesperson: currentUser.name, annual_value: '', base_program_sold: '',
    auxiliary_services: [] as string[], initial_note: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Warn before a refresh/close throws away an in-progress new lead.
  useUnsavedGuard(
    !!(form.first_name || form.last_name || form.phone || form.email ||
       form.service_address || form.initial_note || form.annual_value ||
       form.lead_source || form.base_program_sold ||
       form.service.length || form.auxiliary_services.length)
  )

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    const body = {
      ...form, annual_value: form.annual_value ? parseFloat(form.annual_value) : null,
      service: form.service.length ? form.service : null,
      auxiliary_services: form.auxiliary_services.length ? form.auxiliary_services : null,
      lead_source: form.lead_source || null, base_program_sold: form.base_program_sold || null,
    }
    const res = await fetch('/api/tracker/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (res.ok) {
      const lead = await res.json()
      const noteObj = form.initial_note.trim()
        ? { note: form.initial_note, created_by: currentUser.name, created_at: new Date().toISOString() } : null
      onCreated({ ...lead, latest_note: noteObj })
    } else {
      const data = await res.json(); setError(data.error ?? 'Failed to create lead')
    }
    setSaving(false)
  }

  const fieldCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"

  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950 shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h3 className="font-semibold text-white">New Lead</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none" aria-label="Close">✕</button>
      </div>
      <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 flex-1">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-400 mb-1">First Name</label>
            <input value={form.first_name} onChange={e => set('first_name', e.target.value)} className={fieldCls} /></div>
          <div><label className="block text-xs text-gray-400 mb-1">Last Name</label>
            <input value={form.last_name} onChange={e => set('last_name', e.target.value)} className={fieldCls} /></div>
        </div>
        <div><label className="block text-xs text-gray-400 mb-1">Phone</label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatPhone(e.target.value))} type="tel" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Email</label>
          <input value={form.email} onChange={e => set('email', e.target.value)} type="email" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Service Address</label>
          <input value={form.service_address} onChange={e => set('service_address', e.target.value)} className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Stage</label>
          <select value={form.stage} onChange={e => set('stage', e.target.value)} className={fieldCls}>
            {stages.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.status_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-2">Service</label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {opts.service_options.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.service.includes(s)}
                  onChange={() => set('service', form.service.includes(s) ? form.service.filter((x: string) => x !== s) : [...form.service, s])}
                  className="rounded accent-indigo-500" />
                <span className="text-sm text-gray-300">{s}</span>
              </label>
            ))}
          </div></div>
        <div><label className="block text-xs text-gray-400 mb-1">Lead Source</label>
          <select value={form.lead_source} onChange={e => set('lead_source', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.lead_source_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-1">Salesperson</label>
          <select value={form.salesperson} onChange={e => set('salesperson', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.salesperson_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-1">Annual Value ($)</label>
          <input value={form.annual_value} onChange={e => set('annual_value', e.target.value)} type="number" min="0" step="0.01" className={fieldCls} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Base Program Sold</label>
          <select value={form.base_program_sold} onChange={e => set('base_program_sold', e.target.value)} className={fieldCls}>
            <option value="">—</option>
            {opts.base_program_sold_options.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><label className="block text-xs text-gray-400 mb-2">Auxiliary Services</label>
          <div className="space-y-1">
            {opts.auxiliary_services_options.map(s => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.auxiliary_services.includes(s)}
                  onChange={() => set('auxiliary_services', form.auxiliary_services.includes(s) ? form.auxiliary_services.filter((x: string) => x !== s) : [...form.auxiliary_services, s])}
                  className="rounded accent-indigo-500" />
                <span className="text-sm text-gray-300">{s}</span>
              </label>
            ))}
          </div></div>
        <div><label className="block text-xs text-gray-400 mb-1">Opening Note (optional)</label>
          <textarea value={form.initial_note} onChange={e => set('initial_note', e.target.value)} rows={3}
            placeholder="Call notes, first contact details…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none" /></div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3 pt-2 pb-6">
          <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 bg-brand hover:bg-brand-hover disabled:opacity-50 text-[#fff] text-sm font-medium py-2.5 rounded-lg transition-colors">{saving ? 'Creating…' : 'Create Lead'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Main TrackerPage ──────────────────────────────
export default function TrackerPage({
  settings, currentUser, initialColumnLayout, initialLeads, stages: initialStages, customColumnDefs: initialColumnDefs,
}: {
  settings: TrackerSettings | null; currentUser: CurrentUser
  initialColumnLayout?: { id: string; width: number; hidden?: boolean }[] | null
  initialLeads?: Lead[] | null
  stages: Stage[]
  customColumnDefs: CustomColumnDef[]
}) {
  const toast = useToast()
  const [leads, setLeads] = useState<Lead[]>(initialLeads ?? [])
  const [loading, setLoading] = useState(!initialLeads)
  const [stages] = useState<Stage[]>(initialStages)
  const [customColumnDefs] = useState<CustomColumnDef[]>(initialColumnDefs)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [salespersonFilter, setSalespersonFilter] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [notesLeadId, setNotesLeadId] = useState<string | null>(null)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [editLeadId, setEditLeadId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [bulkWorking, setBulkWorking] = useState(false)
  const [lightMode, setLightMode] = useState(false)

  const [columnLayout, setColumnLayout] = useState<{ id: string; width: number; hidden?: boolean }[] | null>(initialColumnLayout ?? null)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const effectiveColumns = resolveColumns(columnLayout, customColumnDefs)
  const visibleColumns = effectiveColumns.filter(c => !c.hidden)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistLayout = useCallback((next: AnyColWithMeta[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const payload = next.map(c => c.hidden ? { id: c.id, width: c.width, hidden: true } : { id: c.id, width: c.width })
    setColumnLayout(payload)
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/tracker/column-layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: payload }) }).catch(() => {})
    }, 600)
  }, [])

  const handleColumnResize = useCallback((id: string, width: number) => {
    persistLayout(effectiveColumns.map(c => c.id === id ? { ...c, width } : c))
  }, [effectiveColumns, persistLayout])

  const handleColumnReorder = useCallback((fromId: string, toId: string) => {
    const fromIdx = effectiveColumns.findIndex(c => c.id === fromId)
    const toIdx = effectiveColumns.findIndex(c => c.id === toId)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return
    const next = effectiveColumns.slice()
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    persistLayout(next)
  }, [effectiveColumns, persistLayout])

  const handleToggleColumn = useCallback((id: string) => {
    const next = effectiveColumns.map(c => c.id === id ? { ...c, hidden: !c.hidden } : c)
    if (next.every(c => c.hidden)) return
    persistLayout(next)
  }, [effectiveColumns, persistLayout])

  const handleResetColumns = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setColumnLayout(null)
    fetch('/api/tracker/column-layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: [] }) }).catch(() => {})
    setColumnsMenuOpen(false)
  }, [])

  const handleAttemptNoteSaved = useCallback((leadId: string, note: string) => {
    setLeads(prev => prev.map(l => l.id === leadId ? {
      ...l,
      latest_note: { note, created_by: currentUser.name, created_at: new Date().toISOString() },
    } : l))
  }, [currentUser.name])

  useEffect(() => {
    const stored = localStorage.getItem('tracker-light-mode')
    if (stored === '1') setLightMode(true)
  }, [])

  // ── View switcher (Table / Board / Needs me) ────────────────────────────────
  // Persisted per-browser (like tracker-light-mode) and reflected in the URL as
  // ?view= so a cockpit view is shareable. URL wins over localStorage on load.
  const [view, setView] = useState<TrackerView>('table')
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('view')
    const stored = localStorage.getItem('tracker-view')
    const initial = (fromUrl || stored || 'table') as TrackerView
    if (initial === 'table' || initial === 'board' || initial === 'needs_me') setView(initial)
  }, [])
  const changeView = useCallback((next: TrackerView) => {
    setView(next)
    localStorage.setItem('tracker-view', next)
    const url = new URL(window.location.href)
    if (next === 'table') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
    window.history.replaceState(null, '', url.toString())
  }, [])

  function toggleLightMode() { const next = !lightMode; setLightMode(next); localStorage.setItem('tracker-light-mode', next ? '1' : '0') }

  const opts: TrackerSettings = settings ?? {
    status_options: [], service_options: [], lead_source_options: [],
    salesperson_options: [], base_program_sold_options: [], auxiliary_services_options: [], status_stage_rules: [],
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

  const skipFirstFetch = useRef(!!initialLeads)
  useEffect(() => {
    if (skipFirstFetch.current) { skipFirstFetch.current = false; return }
    const t = setTimeout(fetchLeads, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [fetchLeads])

  async function updateLead(id: string, field: string, value: unknown) {
    const patchBody: Record<string, unknown> = { [field]: value }
    if (field === 'status' && typeof value === 'string') {
      const rule = (opts.status_stage_rules ?? []).find(r => r.status === value)
      if (rule) patchBody.stage = rule.stage
    }
    try {
      const res = await fetch(`/api/tracker/leads/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchBody),
      })
      if (!res.ok) throw new Error(String(res.status))
      const updated = await res.json()
      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l))
    } catch { toast.error("Couldn't save that change. Please try again.") }
  }

  async function updateCustomValue(leadId: string, columnId: string, value: string | null) {
    try {
      const res = await fetch(`/api/tracker/leads/${leadId}/column-values`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ column_id: columnId, value }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, custom_values: { ...l.custom_values, [columnId]: value } } : l))
    } catch { toast.error("Couldn't save that change. Please try again.") }
  }

  // Board drag-drop: optimistically move the card, PATCH via the existing
  // stage-move endpoint, revert + toast on failure. TrackerPage stays the single
  // state owner (the drip stage_changed_at stamp / auto-move lands server-side).
  async function moveLeadStage(id: string, stageKey: string) {
    const prevStage = leads.find(l => l.id === id)?.stage ?? null
    if (prevStage === stageKey) return
    setLeads(prev => prev.map(l => l.id === id ? { ...l, stage: stageKey } : l))
    try {
      const res = await fetch(`/api/tracker/leads/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: stageKey }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const updated = await res.json()
      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updated } : l))
    } catch {
      setLeads(prev => prev.map(l => l.id === id ? { ...l, stage: prevStage } : l))
      toast.error("Couldn't move that lead. Please try again.")
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  function toggleSelect(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function toggleGroupAll(ids: string[]) {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id))
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id)); else ids.forEach(id => next.add(id))
      return next
    })
  }

  function handleExport() {
    const headers = ['First Name', 'Last Name', 'Phone', 'Email', 'Service Address', 'Stage', 'Status', 'Service', 'Lead Source', 'Salesperson', 'Base Program Sold', 'Auxiliary Services', 'Annual Value', 'Created Date', 'Sold Date']
    const rows = leads.map(l => [
      l.first_name ?? '', l.last_name ?? '', l.phone ?? '', l.email ?? '', l.service_address ?? '',
      stages.find(g => g.key === l.stage)?.label ?? l.stage ?? '',
      l.status ?? '', (l.service ?? []).join('; '), l.lead_source ?? '', l.salesperson ?? '',
      l.base_program_sold ?? '', (l.auxiliary_services ?? []).join('; '),
      l.annual_value != null ? String(l.annual_value) : '', l.lead_creation_date ?? '', l.sold_date ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleBulkMove() {
    if (!bulkStage || selectedIds.size === 0) return
    setBulkWorking(true)
    await Promise.all([...selectedIds].map(id => fetch(`/api/tracker/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: bulkStage }) })))
    setLeads(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, stage: bulkStage } : l))
    setSelectedIds(new Set()); setBulkStage(''); setBulkWorking(false)
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkWorking(true)
    await Promise.all([...selectedIds].map(id => fetch(`/api/tracker/leads/${id}`, { method: 'DELETE' })))
    setLeads(prev => prev.filter(l => !selectedIds.has(l.id)))
    setSelectedIds(new Set()); setBulkWorking(false)
  }

  async function handleBulkDuplicate() {
    if (selectedIds.size === 0) return
    setBulkWorking(true)
    const today = new Date().toISOString().split('T')[0]
    const dupes = await Promise.all(
      leads.filter(l => selectedIds.has(l.id)).map(l => {
        const { id, latest_note, custom_values, ...fields } = l; void id; void latest_note; void custom_values
        return fetch('/api/tracker/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, lead_creation_date: today }) }).then(r => r.ok ? r.json() : null)
      })
    )
    const created = dupes.filter(Boolean) as Lead[]
    setLeads(prev => [...created.map(l => ({ ...l, latest_note: null, custom_values: {} })), ...prev])
    setSelectedIds(new Set()); setBulkWorking(false)
  }

  const sortedLeads = useMemo(() => {
    if (!sort) return leads
    return leads.map(l => ({ l, v: leadSortValue(l, sort.key, customColumnDefs) }))
      .sort((a, b) => compareValues(a.v, b.v, sort.dir)).map(d => d.l)
  }, [leads, sort, customColumnDefs])

  const groupedLeads = stages.map(g => ({ ...g, leads: sortedLeads.filter(l => l.stage === g.key) }))
  // Leads in unknown/deleted stages go into a catch-all at the bottom
  const knownKeys = new Set(stages.map(s => s.key))
  const unknownLeads = sortedLeads.filter(l => l.stage && !knownKeys.has(l.stage))
  if (unknownLeads.length > 0) groupedLeads.push({ id: '__unknown__', key: '__unknown__', label: 'Other', color: '#6b7280', sort_order: 999, leads: unknownLeads })

  const notesLead = notesLeadId ? leads.find(l => l.id === notesLeadId) ?? null : null
  const editLead = editLeadId ? leads.find(l => l.id === editLeadId) ?? null : null
  const totalLeads = leads.length
  const needsMeCount = leads.filter(l => l.drip?.status === 'replied').length

  return (
    <div className="flex flex-1 overflow-hidden">
      <style>{`
        .tracker-no-sb { scrollbar-width: none; -ms-overflow-style: none; }
        .tracker-no-sb::-webkit-scrollbar { display: none; }
        .tracker-vsb { scrollbar-width: auto; }
        .tracker-vsb::-webkit-scrollbar { width: 14px; }
        .tracker-vsb::-webkit-scrollbar-track { background: rgba(120,120,140,0.12); }
        .tracker-vsb::-webkit-scrollbar-thumb { background: #6366f1; border-radius: 7px; border: 3px solid transparent; background-clip: content-box; }
        .tracker-vsb::-webkit-scrollbar-thumb:hover { background: #818cf8; background-clip: content-box; }
      `}</style>

      <div className="flex-1 overflow-y-scroll overflow-x-hidden min-w-0 relative tracker-vsb">
        <div className="sticky top-0 z-30 bg-gray-950 border-b border-gray-800">
          <div className="px-4 pt-2.5 pb-1.5 flex items-center gap-2 max-md:pl-14">
            <Link href="/hub/tracker" className="text-gray-500 hover:text-white text-sm transition-colors whitespace-nowrap">← Trackers</Link>
            <span className="text-gray-700">/</span>
            <h1 className="text-base font-semibold text-white">Lead Tracker</h1>
          </div>
          <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap">
            <div className="flex items-center rounded-lg border border-gray-700 bg-gray-800 p-0.5 shrink-0">
              {([
                { id: 'table' as TrackerView, label: 'Table' },
                { id: 'board' as TrackerView, label: 'Board' },
                { id: 'needs_me' as TrackerView, label: 'Needs me' },
              ]).map(v => (
                <button key={v.id} onClick={() => changeView(v.id)}
                  className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-md transition-colors ${
                    view === v.id ? 'bg-brand text-[#fff]' : 'text-gray-300 hover:text-white hover:bg-gray-700'
                  }`}>
                  {v.label}
                  {v.id === 'needs_me' && needsMeCount > 0 && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${
                      view === v.id ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>{needsMeCount}</span>
                  )}
                </button>
              ))}
            </div>
            <input type="text" placeholder="Search name, phone, email…" value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-48 max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="">All Stages</option>
              {stages.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="">All Statuses</option>
              {opts.status_options.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={salespersonFilter} onChange={e => setSalespersonFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="">All Salespersons</option>
              {opts.salesperson_options.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-gray-600 px-1">{totalLeads} lead{totalLeads !== 1 ? 's' : ''}</span>
            <div className="flex-1" />
            {view === 'table' && (
            <div className="relative">
              <button onClick={() => setColumnsMenuOpen(o => !o)}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                Columns ▾
              </button>
              {columnsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setColumnsMenuOpen(false)} />
                  <div className="absolute right-0 mt-1 z-30 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1.5">
                    <div className="px-3 pb-1.5 mb-1 border-b border-gray-800 text-[11px] uppercase tracking-wide text-gray-500">Show columns</div>
                    <div className="max-h-72 overflow-y-auto">
                      {effectiveColumns.map(col => {
                        const isLastVisible = !col.hidden && visibleColumns.length === 1
                        return (
                          <label key={col.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${isLastVisible ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-800 text-gray-200'}`}>
                            <input type="checkbox" checked={!col.hidden} disabled={isLastVisible} onChange={() => handleToggleColumn(col.id)} className="rounded accent-indigo-500" />
                            {col.label}
                          </label>
                        )
                      })}
                    </div>
                    <div className="border-t border-gray-800 mt-1 pt-1">
                      <button onClick={handleResetColumns} className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">Reset to default</button>
                    </div>
                  </div>
                </>
              )}
            </div>
            )}
            {currentUser.isAdmin && (
              <Link href="/hub/tracker/settings"
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                ⚙ Settings
              </Link>
            )}
            <button onClick={toggleLightMode}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
              {lightMode ? 'Dark Table' : 'Light Table'}
            </button>
            <button onClick={handleExport}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap">
              Export CSV
            </button>
            <button onClick={() => { setNewLeadOpen(true); setNotesLeadId(null); setEditLeadId(null) }}
              className="bg-brand hover:bg-brand-hover text-[#fff] text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap">
              + New Lead
            </button>
          </div>
        </div>

        {view === 'table' && (
          <TableView
            loading={loading}
            groups={groupedLeads}
            columns={visibleColumns}
            opts={opts}
            collapsedGroups={collapsedGroups}
            selectedIds={selectedIds}
            lightMode={lightMode}
            sort={sort}
            onToggleGroup={toggleGroup}
            onToggleSelect={toggleSelect}
            onToggleGroupAll={toggleGroupAll}
            onUpdate={updateLead}
            onCustomUpdate={updateCustomValue}
            onOpenNotes={id => { setNotesLeadId(id); setEditLeadId(null); setNewLeadOpen(false) }}
            onEdit={id => { setEditLeadId(id); setNotesLeadId(null); setNewLeadOpen(false) }}
            onColumnResize={handleColumnResize}
            onColumnReorder={handleColumnReorder}
            onToggleSort={id => setSort(s => cycleSort(s, id))}
            onSetSort={(id, dir) => setSort(dir ? { key: id, dir } : null)}
            onAttemptNoteSaved={handleAttemptNoteSaved}
          />
        )}

        {view === 'board' && (
          loading
            ? <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading leads…</div>
            : <BoardView
                groups={groupedLeads}
                stages={stages}
                lightMode={lightMode}
                onMoveStage={moveLeadStage}
                onEdit={id => { setEditLeadId(id); setNotesLeadId(null); setNewLeadOpen(false) }}
                onOpenNotes={id => { setNotesLeadId(id); setEditLeadId(null); setNewLeadOpen(false) }}
              />
        )}

        {view === 'needs_me' && (
          loading
            ? <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading leads…</div>
            : <NeedsMeView
                leads={sortedLeads}
                stages={stages}
                lightMode={lightMode}
                onEdit={id => { setEditLeadId(id); setNotesLeadId(null); setNewLeadOpen(false) }}
                onOpenNotes={id => { setNotesLeadId(id); setEditLeadId(null); setNewLeadOpen(false) }}
              />
        )}
      </div>

      {/* Right panels */}
      {notesLeadId && (
        <NotesPanel lead={notesLead} currentUser={currentUser} onClose={() => setNotesLeadId(null)}
          onNoteAdded={(leadId, note) => setLeads(prev => prev.map(l => l.id === leadId ? { ...l, latest_note: note } : l))} />
      )}
      {editLeadId && editLead && !notesLeadId && (
        <EditLeadDrawer lead={editLead} opts={opts} stages={stages} onClose={() => setEditLeadId(null)}
          onUpdated={updated => { setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l)); setEditLeadId(null) }}
          onDeleted={id => { setLeads(prev => prev.filter(l => l.id !== id)); setEditLeadId(null) }} />
      )}
      {newLeadOpen && !notesLeadId && !editLeadId && (
        <NewLeadForm opts={opts} stages={stages} currentUser={currentUser} onClose={() => setNewLeadOpen(false)}
          onCreated={lead => { setLeads(prev => [lead, ...prev]); setNewLeadOpen(false) }} />
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl px-5 py-3 whitespace-nowrap">
          <span className="text-sm text-gray-300 font-medium">{selectedIds.size} selected</span>
          <div className="w-px h-5 bg-gray-700" />
          <select value={bulkStage} onChange={e => setBulkStage(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">Move to stage…</option>
            {stages.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <button onClick={handleBulkMove} disabled={!bulkStage || bulkWorking}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-[#fff] text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">Move</button>
          <div className="w-px h-5 bg-gray-700" />
          <button onClick={handleBulkDuplicate} disabled={bulkWorking}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">Duplicate</button>
          <button onClick={handleBulkDelete} disabled={bulkWorking}
            className="bg-red-900/60 hover:bg-red-800 disabled:opacity-40 text-red-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">Delete</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-gray-500 hover:text-white transition-colors text-lg leading-none ml-1" aria-label="Remove">✕</button>
        </div>
      )}
    </div>
  )
}
