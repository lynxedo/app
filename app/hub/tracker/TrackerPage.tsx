'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'

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
  status_stage_rules: { status: string; stage: string }[]
  stage_colors?: Record<string, string>
  status_colors?: Record<string, string>
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

const DEFAULT_STAGE_COLORS: Record<string, string> = {
  current: '#3b82f6',
  appointment_set: '#8b5cf6',
  follow_up_long_term: '#d97706',
  closed_won: '#16a34a',
  upsells: '#0d9488',
  closed_lost: '#dc2626',
  closed_other: '#4b5563',
  saves: '#ea580c',
}

// kept for notes panel badge
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

function formatPhone(v: string | null): string {
  if (!v) return ''
  const digits = v.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// ────────────────────────────────────────────────
// Inline text cell
// ────────────────────────────────────────────────
function EditCell({
  value,
  displayValue,
  placeholder = '—',
  onSave,
  type = 'text',
  lightMode = false,
}: {
  value: string | null
  displayValue?: string
  placeholder?: string
  onSave: (v: string | null) => void
  type?: string
  lightMode?: boolean
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
        className={`w-full border rounded px-2 py-0.5 text-sm focus:outline-none ${
          lightMode
            ? 'bg-gray-100 border-indigo-400 text-gray-900'
            : 'bg-gray-800 border-indigo-500 text-white'
        }`}
      />
    )
  }

  return (
    <span
      onClick={() => { setLocal(value ?? ''); setEditing(true) }}
      className={`block w-full cursor-text transition-colors truncate ${
        lightMode ? 'text-gray-700 hover:text-indigo-600' : 'hover:text-indigo-300'
      }`}
      title={value ?? ''}
    >
      {(displayValue ?? value) || <span className={lightMode ? 'text-gray-400' : 'text-gray-600'}>{placeholder}</span>}
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
  lightMode = false,
}: {
  value: string | null
  options: string[]
  onSave: (v: string | null) => void
  lightMode?: boolean
}) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onSave(e.target.value || null)}
      className={`w-full bg-transparent text-sm focus:outline-none cursor-pointer transition-colors ${
        lightMode ? 'text-gray-700 hover:text-indigo-600' : 'text-white hover:text-indigo-300'
      }`}
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ────────────────────────────────────────────────
// Status cell — colored badge when color assigned
// ────────────────────────────────────────────────
function StatusCell({
  value,
  options,
  statusColors,
  lightMode,
  onSave,
}: {
  value: string | null
  options: string[]
  statusColors: Record<string, string>
  lightMode: boolean
  onSave: (v: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLSelectElement>(null)
  const color = value && statusColors[value] ? statusColors[value] : null

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  if (editing) {
    return (
      <select
        ref={ref}
        value={value ?? ''}
        onChange={e => { onSave(e.target.value || null); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className={`w-full text-sm focus:outline-none cursor-pointer ${
          lightMode ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'
        }`}
        autoFocus
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  if (color) {
    return (
      <span
        onClick={() => setEditing(true)}
        style={{ backgroundColor: color + '25', color, borderColor: color + '60' }}
        className="inline-block px-2 py-0.5 rounded text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity truncate max-w-full"
        title={value ?? ''}
      >
        {value || <span className="opacity-50">—</span>}
      </span>
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`block w-full cursor-text truncate transition-colors ${
        lightMode ? 'text-gray-700 hover:text-indigo-600' : 'text-white hover:text-indigo-300'
      }`}
      title={value ?? ''}
    >
      {value || <span className={lightMode ? 'text-gray-400' : 'text-gray-600'}>—</span>}
    </span>
  )
}

// ────────────────────────────────────────────────
// Multi-select cell
// ────────────────────────────────────────────────
function MultiSelectCell({
  values,
  options,
  onSave,
  lightMode = false,
}: {
  values: string[] | null
  options: string[]
  onSave: (v: string[]) => void
  lightMode?: boolean
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
        className={`text-left text-sm w-full truncate transition-colors ${
          lightMode ? 'text-gray-700 hover:text-indigo-600' : 'hover:text-indigo-300'
        }`}
        title={selected.join(', ')}
      >
        {selected.length === 0
          ? <span className={lightMode ? 'text-gray-400' : 'text-gray-600'}>—</span>
          : selected.join(', ')}
      </button>
      {open && (
        <div className={`absolute z-50 top-full left-0 mt-1 border rounded-lg shadow-xl min-w-52 max-h-64 overflow-y-auto ${
          lightMode ? 'bg-white border-gray-200' : 'bg-gray-800 border-gray-700'
        }`}>
          {options.map(opt => (
            <label key={opt} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
              lightMode ? 'hover:bg-gray-50' : 'hover:bg-gray-700'
            }`}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="rounded accent-indigo-500"
              />
              <span className={`text-sm ${lightMode ? 'text-gray-900' : 'text-white'}`}>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────
// Column definitions — reorderable + resizable middle columns.
// Fixed first (checkbox) and last (actions) columns sit outside this list.
// ────────────────────────────────────────────────
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
      <EditCell
        value={lead.phone}
        displayValue={formatPhone(lead.phone) || undefined}
        lightMode={lightMode}
        onSave={v => onUpdate(lead.id, 'phone', v ? formatPhone(v) : null)}
      />
    ),
  },
  {
    id: 'stage', label: 'Stage', defaultWidth: 144,
    render: (lead, { lightMode, onUpdate }) => (
      <select
        value={lead.stage ?? ''}
        onChange={e => onUpdate(lead.id, 'stage', e.target.value || null)}
        className={`w-full bg-transparent text-sm focus:outline-none cursor-pointer transition-colors ${
          lightMode ? 'text-gray-700 hover:text-indigo-600' : 'text-white hover:text-indigo-300'
        }`}
      >
        {PIPELINE_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
      </select>
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
      <StatusCell
        value={lead.status}
        options={opts.status_options}
        statusColors={statusColors}
        lightMode={lightMode}
        onSave={v => onUpdate(lead.id, 'status', v)}
      />
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
      <SelectCell
        value={lead.base_program_sold}
        options={opts.base_program_sold_options}
        lightMode={lightMode}
        onSave={v => onUpdate(lead.id, 'base_program_sold', v)}
      />
    ),
  },
  {
    id: 'aux_services', label: 'Aux Services', defaultWidth: 160,
    render: (lead, { opts, lightMode, onUpdate }) => (
      <MultiSelectCell
        values={lead.auxiliary_services}
        options={opts.auxiliary_services_options}
        lightMode={lightMode}
        onSave={v => onUpdate(lead.id, 'auxiliary_services', v)}
      />
    ),
  },
  {
    id: 'annual_value', label: 'Ann. Value', defaultWidth: 96,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell
        value={lead.annual_value != null ? String(lead.annual_value) : null}
        displayValue={fmtCurrency(lead.annual_value) || undefined}
        lightMode={lightMode}
        onSave={v => onUpdate(lead.id, 'annual_value', v ? parseFloat(v) : null)}
      />
    ),
  },
  {
    id: 'created', label: 'Created', defaultWidth: 96,
    render: (lead, { lightMode, onUpdate }) => (
      <EditCell
        value={lead.lead_creation_date}
        displayValue={fmtDate(lead.lead_creation_date) || undefined}
        type="date"
        lightMode={lightMode}
        onSave={v => onUpdate(lead.id, 'lead_creation_date', v)}
      />
    ),
  },
  {
    id: 'latest_note', label: 'Latest Note', defaultWidth: 200,
    render: (lead, { lightMode, onOpenNotes }) => {
      const noteText = lead.latest_note?.note ?? null
      const truncated = noteText && noteText.length > 60 ? noteText.slice(0, 60) + '…' : noteText
      return truncated ? (
        <span
          className={`cursor-pointer transition-colors truncate block ${
            lightMode ? 'text-gray-500 hover:text-indigo-600' : 'text-gray-400 hover:text-indigo-300'
          }`}
          title={noteText ?? ''}
          onClick={() => onOpenNotes(lead.id)}
        >
          {truncated}
        </span>
      ) : (
        <span className={`text-xs italic ${lightMode ? 'text-gray-400' : 'text-gray-700'}`}>no notes</span>
      )
    },
  },
]

type ColumnEntry = { id: string; width: number }

function resolveColumns(layout: ColumnEntry[] | null): Array<ColumnDef & { width: number }> {
  const byId = new Map(LEAD_COLUMNS.map(c => [c.id, c]))
  const seen = new Set<string>()
  const out: Array<ColumnDef & { width: number }> = []
  // Apply saved order first, skipping any unknown ids (e.g. column removed in code).
  if (layout) {
    for (const entry of layout) {
      const def = byId.get(entry.id)
      if (def && !seen.has(entry.id)) {
        out.push({ ...def, width: Math.max(50, Math.min(600, entry.width || def.defaultWidth)) })
        seen.add(entry.id)
      }
    }
  }
  // Append any new columns (added in code after layout was saved) at the end in default order.
  for (const def of LEAD_COLUMNS) {
    if (!seen.has(def.id)) out.push({ ...def, width: def.defaultWidth })
  }
  return out
}

// ────────────────────────────────────────────────
// Lead row
// ────────────────────────────────────────────────
function LeadRow({
  lead,
  opts,
  checked,
  onToggle,
  onUpdate,
  onOpenNotes,
  onEdit,
  lightMode,
  statusColors,
  columns,
}: {
  lead: Lead
  opts: TrackerSettings
  checked: boolean
  onToggle: () => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onOpenNotes: (id: string) => void
  onEdit: (id: string) => void
  lightMode: boolean
  statusColors: Record<string, string>
  columns: Array<ColumnDef & { width: number }>
}) {
  const rowCls = checked
    ? lightMode ? 'bg-indigo-50' : 'bg-indigo-950/30'
    : lightMode ? 'hover:bg-gray-50 group' : 'hover:bg-gray-900/40 group'

  const ctx: LeadCtx = { opts, lightMode, statusColors, onUpdate, onOpenNotes }

  return (
    <tr className={rowCls}>
      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="rounded accent-indigo-500 cursor-pointer"
        />
      </td>
      {columns.map(col => (
        <td key={col.id} className="px-3 py-2 text-sm overflow-hidden" style={{ maxWidth: col.width }}>
          {col.render(lead, ctx)}
        </td>
      ))}
      <td className="px-3 py-2 text-center whitespace-nowrap">
        <button onClick={() => onEdit(lead.id)} title="Edit lead" className="text-gray-600 hover:text-indigo-400 transition-colors text-sm leading-none mr-2">✎</button>
        <button onClick={() => onOpenNotes(lead.id)} title="Notes" className="text-gray-600 hover:text-indigo-400 transition-colors text-base leading-none">💬</button>
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────
// Group section
// ────────────────────────────────────────────────
function GroupCheckbox({ leads, selectedIds, onToggleGroupAll }: {
  leads: Lead[]
  selectedIds: Set<string>
  onToggleGroupAll: (ids: string[]) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const checkedCount = leads.filter(l => selectedIds.has(l.id)).length
  const allChecked = leads.length > 0 && checkedCount === leads.length
  const indeterminate = checkedCount > 0 && checkedCount < leads.length

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allChecked}
      onChange={() => onToggleGroupAll(leads.map(l => l.id))}
      className="rounded accent-indigo-500 cursor-pointer"
    />
  )
}

function GroupSection({
  group,
  collapsed,
  onToggle,
  opts,
  selectedIds,
  onToggleSelect,
  onToggleGroupAll,
  onUpdate,
  onOpenNotes,
  onEdit,
  stageColor,
  lightMode,
  columns,
  onColumnResize,
  onColumnReorder,
}: {
  group: { key: string; label: string; leads: Lead[] }
  collapsed: boolean
  onToggle: () => void
  opts: TrackerSettings
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleGroupAll: (ids: string[]) => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onOpenNotes: (id: string) => void
  onEdit: (id: string) => void
  stageColor: string
  lightMode: boolean
  columns: Array<ColumnDef & { width: number }>
  onColumnResize: (id: string, width: number) => void
  onColumnReorder: (fromId: string, toId: string) => void
}) {
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) + 32 + 56 // checkbox col + actions col
  return (
    <div className="rounded-lg overflow-hidden shadow-sm">
      {/* Full-width colored stage header */}
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ backgroundColor: stageColor }}
      >
        <div onClick={e => e.stopPropagation()}>
          <GroupCheckbox leads={group.leads} selectedIds={selectedIds} onToggleGroupAll={onToggleGroupAll} />
        </div>
        <span className="text-sm font-semibold text-white">{group.label}</span>
        <span className="text-white/70 text-xs">{group.leads.length} lead{group.leads.length !== 1 ? 's' : ''}</span>
        <span className="text-white/70 ml-auto text-xs">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className={`overflow-x-auto ${lightMode ? 'bg-white' : ''}`}>
          <table className="w-full" style={{ minWidth: totalWidth, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 32 }} />
              {columns.map(col => <col key={col.id} style={{ width: col.width }} />)}
              <col style={{ width: 56 }} />
            </colgroup>
            <thead>
              <tr className={`text-left text-xs border-b ${
                lightMode
                  ? 'text-gray-500 border-gray-200'
                  : 'text-gray-500 border-gray-800/50'
              }`}>
                <th className="px-3 py-1.5"></th>
                {columns.map(col => (
                  <th
                    key={col.id}
                    className="px-3 py-1.5 font-medium relative select-none"
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('text/x-tracker-col', col.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                    onDrop={e => {
                      e.preventDefault()
                      const fromId = e.dataTransfer.getData('text/x-tracker-col')
                      if (fromId && fromId !== col.id) onColumnReorder(fromId, col.id)
                    }}
                    title="Drag to reorder · drag right edge to resize"
                  >
                    <span className="cursor-grab active:cursor-grabbing">{col.label}</span>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        const startX = e.clientX
                        const startWidth = col.width
                        function onMove(ev: MouseEvent) {
                          const dx = ev.clientX - startX
                          const next = Math.max(50, Math.min(600, startWidth + dx))
                          onColumnResize(col.id, next)
                        }
                        function onUp() {
                          window.removeEventListener('mousemove', onMove)
                          window.removeEventListener('mouseup', onUp)
                        }
                        window.addEventListener('mousemove', onMove)
                        window.addEventListener('mouseup', onUp)
                      }}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400/40"
                      onDragStart={e => e.preventDefault()}
                    />
                  </th>
                ))}
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody className={`divide-y ${lightMode ? 'divide-gray-100' : 'divide-gray-800/40'}`}>
              {group.leads.map(lead => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  opts={opts}
                  checked={selectedIds.has(lead.id)}
                  onToggle={() => onToggleSelect(lead.id)}
                  onUpdate={onUpdate}
                  onOpenNotes={onOpenNotes}
                  onEdit={onEdit}
                  lightMode={lightMode}
                  statusColors={opts.status_colors ?? {}}
                  columns={columns}
                />
              ))}
              {group.leads.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} className={`px-4 py-4 text-sm italic ${lightMode ? 'text-gray-400' : 'text-gray-700'}`}>
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
      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800">
        <div>
          <div className="font-semibold text-white">{leadName}</div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border mt-1 inline-block ${GROUP_BADGE[lead.stage ?? ''] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
            {groupLabel}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none mt-0.5">✕</button>
      </div>

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
// Edit Lead drawer
// ────────────────────────────────────────────────
function EditLeadDrawer({
  lead,
  opts,
  onClose,
  onUpdated,
  onDeleted,
}: {
  lead: Lead
  opts: TrackerSettings
  onClose: () => void
  onUpdated: (lead: Lead) => void
  onDeleted: (id: string) => void
}) {
  const [form, setForm] = useState({
    first_name: lead.first_name ?? '',
    last_name: lead.last_name ?? '',
    phone: formatPhone(lead.phone),
    email: lead.email ?? '',
    service_address: lead.service_address ?? '',
    service: lead.service ?? [] as string[],
    lead_source: lead.lead_source ?? '',
    status: lead.status ?? '',
    stage: lead.stage ?? 'current',
    salesperson: lead.salesperson ?? '',
    annual_value: lead.annual_value != null ? String(lead.annual_value) : '',
    base_program_sold: lead.base_program_sold ?? '',
    auxiliary_services: lead.auxiliary_services ?? [] as string[],
    sold_date: lead.sold_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
      status: form.status || null,
      salesperson: form.salesperson || null,
      sold_date: form.sold_date || null,
    }

    const res = await fetch(`/api/tracker/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const updated = await res.json()
      onUpdated({ ...lead, ...updated })
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/tracker/leads/${lead.id}`, { method: 'DELETE' })
    if (res.ok) {
      onDeleted(lead.id)
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to delete')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed Lead'

  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950 shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h3 className="font-semibold text-white truncate pr-2">{leadName}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none shrink-0">✕</button>
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
          <input
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            onBlur={e => set('phone', formatPhone(e.target.value))}
            type="tel"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
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
          <label className="block text-xs text-gray-400 mb-1">Stage</label>
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
          <label className="block text-xs text-gray-400 mb-1">Sold Date</label>
          <input value={form.sold_date} onChange={e => set('sold_date', e.target.value)} type="date"
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

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="border-t border-gray-800 pt-4 pb-6">
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="w-full text-red-500 hover:text-red-400 text-sm font-medium py-2 rounded-lg border border-red-900/50 hover:border-red-700 transition-colors">
              Delete Lead
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 text-center">Delete this lead permanently?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={handleDelete} disabled={deleting}
                  className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors">
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
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
          <input
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            onBlur={e => set('phone', formatPhone(e.target.value))}
            type="tel"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
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
          <label className="block text-xs text-gray-400 mb-1">Stage</label>
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
  initialColumnLayout,
}: {
  settings: TrackerSettings | null
  currentUser: CurrentUser
  initialColumnLayout?: { id: string; width: number }[] | null
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
  const [editLeadId, setEditLeadId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [bulkWorking, setBulkWorking] = useState(false)
  const [lightMode, setLightMode] = useState(false)

  // Column layout — width + order persisted per-user via /api/tracker/column-layout.
  // null layout means "use defaults"; resolveColumns merges saved order/width with
  // any new defaults the code adds later.
  const [columnLayout, setColumnLayout] = useState<{ id: string; width: number }[] | null>(initialColumnLayout ?? null)
  const effectiveColumns = resolveColumns(columnLayout)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistLayout = useCallback((next: Array<ColumnDef & { width: number }>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const payload = next.map(c => ({ id: c.id, width: c.width }))
    setColumnLayout(payload)
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/tracker/column-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: payload }),
      }).catch(() => {})
    }, 600)
  }, [])
  const handleColumnResize = useCallback((id: string, width: number) => {
    const next = effectiveColumns.map(c => c.id === id ? { ...c, width } : c)
    persistLayout(next)
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

  useEffect(() => {
    const stored = localStorage.getItem('tracker-light-mode')
    if (stored === '1') setLightMode(true)
  }, [])

  function toggleLightMode() {
    const next = !lightMode
    setLightMode(next)
    localStorage.setItem('tracker-light-mode', next ? '1' : '0')
  }

  const opts: TrackerSettings = settings ?? {
    status_options: [],
    service_options: [],
    lead_source_options: [],
    salesperson_options: [],
    base_program_sold_options: [],
    auxiliary_services_options: [],
    status_stage_rules: [],
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
    const patchBody: Record<string, unknown> = { [field]: value }
    if (field === 'status' && typeof value === 'string') {
      const rule = (opts.status_stage_rules ?? []).find(r => r.status === value)
      if (rule) patchBody.stage = rule.stage
    }
    const res = await fetch(`/api/tracker/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
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

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleGroupAll(ids: string[]) {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id))
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  function handleExport() {
    const headers = [
      'First Name', 'Last Name', 'Phone', 'Email', 'Service Address',
      'Stage', 'Status', 'Service', 'Lead Source', 'Salesperson',
      'Base Program Sold', 'Auxiliary Services', 'Annual Value',
      'Created Date', 'Sold Date',
    ]
    const rows = leads.map(l => [
      l.first_name ?? '',
      l.last_name ?? '',
      l.phone ?? '',
      l.email ?? '',
      l.service_address ?? '',
      PIPELINE_GROUPS.find(g => g.key === l.stage)?.label ?? l.stage ?? '',
      l.status ?? '',
      (l.service ?? []).join('; '),
      l.lead_source ?? '',
      l.salesperson ?? '',
      l.base_program_sold ?? '',
      (l.auxiliary_services ?? []).join('; '),
      l.annual_value != null ? String(l.annual_value) : '',
      l.lead_creation_date ?? '',
      l.sold_date ?? '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleBulkMove() {
    if (!bulkStage || selectedIds.size === 0) return
    setBulkWorking(true)
    await Promise.all([...selectedIds].map(id =>
      fetch(`/api/tracker/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: bulkStage }),
      })
    ))
    setLeads(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, stage: bulkStage } : l))
    setSelectedIds(new Set())
    setBulkStage('')
    setBulkWorking(false)
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkWorking(true)
    await Promise.all([...selectedIds].map(id =>
      fetch(`/api/tracker/leads/${id}`, { method: 'DELETE' })
    ))
    setLeads(prev => prev.filter(l => !selectedIds.has(l.id)))
    setSelectedIds(new Set())
    setBulkWorking(false)
  }

  async function handleBulkDuplicate() {
    if (selectedIds.size === 0) return
    setBulkWorking(true)
    const today = new Date().toISOString().split('T')[0]
    const dupes = await Promise.all(
      leads
        .filter(l => selectedIds.has(l.id))
        .map(l => {
          const { id, latest_note, ...fields } = l
          void id; void latest_note
          return fetch('/api/tracker/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fields, lead_creation_date: today }),
          }).then(r => r.ok ? r.json() : null)
        })
    )
    const created = dupes.filter(Boolean) as Lead[]
    setLeads(prev => [...created.map(l => ({ ...l, latest_note: null })), ...prev])
    setSelectedIds(new Set())
    setBulkWorking(false)
  }

  const groupedLeads = PIPELINE_GROUPS.map(g => ({
    ...g,
    leads: leads.filter(l => l.stage === g.key),
  }))

  const notesLead = notesLeadId ? leads.find(l => l.id === notesLeadId) ?? null : null
  const editLead = editLeadId ? leads.find(l => l.id === editLeadId) ?? null : null
  const totalLeads = leads.length

  return (
    <div className="flex flex-1 overflow-hidden">
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
            <option value="">All Stages</option>
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
            onClick={toggleLightMode}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            title="Toggle light/dark table"
          >
            {lightMode ? 'Dark Table' : 'Light Table'}
          </button>
          <button
            onClick={handleExport}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            Export CSV
          </button>
          <button
            onClick={() => { setNewLeadOpen(true); setNotesLeadId(null); setEditLeadId(null) }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            + New Lead
          </button>
        </div>

        {/* Groups */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Loading leads…</div>
        ) : (
          <div className="space-y-3 p-3">
            {groupedLeads.map(group => (
              <GroupSection
                key={group.key}
                group={group}
                collapsed={collapsedGroups.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
                opts={opts}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleGroupAll={toggleGroupAll}
                onUpdate={updateLead}
                onOpenNotes={id => { setNotesLeadId(id); setEditLeadId(null); setNewLeadOpen(false) }}
                onEdit={id => { setEditLeadId(id); setNotesLeadId(null); setNewLeadOpen(false) }}
                stageColor={opts.stage_colors?.[group.key] ?? DEFAULT_STAGE_COLORS[group.key]}
                lightMode={lightMode}
                columns={effectiveColumns}
                onColumnResize={handleColumnResize}
                onColumnReorder={handleColumnReorder}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right panel — mutually exclusive */}
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

      {editLeadId && editLead && !notesLeadId && (
        <EditLeadDrawer
          lead={editLead}
          opts={opts}
          onClose={() => setEditLeadId(null)}
          onUpdated={updated => {
            setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l))
            setEditLeadId(null)
          }}
          onDeleted={id => {
            setLeads(prev => prev.filter(l => l.id !== id))
            setEditLeadId(null)
          }}
        />
      )}

      {newLeadOpen && !notesLeadId && !editLeadId && (
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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl px-5 py-3 whitespace-nowrap">
          <span className="text-sm text-gray-300 font-medium">{selectedIds.size} selected</span>
          <div className="w-px h-5 bg-gray-700" />
          <select
            value={bulkStage}
            onChange={e => setBulkStage(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Move to stage…</option>
            {PIPELINE_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <button
            onClick={handleBulkMove}
            disabled={!bulkStage || bulkWorking}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Move
          </button>
          <div className="w-px h-5 bg-gray-700" />
          <button
            onClick={handleBulkDuplicate}
            disabled={bulkWorking}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Duplicate
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkWorking}
            className="bg-red-900/60 hover:bg-red-800 disabled:opacity-40 text-red-300 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none ml-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
