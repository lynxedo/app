'use client'

import { useState } from 'react'

type Stage = { id: string; key: string; label: string; color: string; sort_order: number; system_role?: string | null }
type ColType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'phone'

// Optional pipeline semantics — powers the Board / Needs-me cockpit views (won/lost
// = terminal columns) and the drip stage_changed trigger. One stage per role.
const SYSTEM_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No role' },
  { value: 'new', label: 'New' },
  { value: 'responded', label: 'Responded' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]
type CustomColumnDef = { id: string; name: string; type: ColType; options: string[]; sort_order: number }
type StatusStageRule = { status: string; stage: string }

type TrackerSettings = {
  status_options: string[]
  service_options: string[]
  lead_source_options: string[]
  salesperson_options: string[]
  base_program_sold_options: string[]
  auxiliary_services_options: string[]
  status_stage_rules: StatusStageRule[]
  status_colors?: Record<string, string>
}

const COL_TYPES: { value: ColType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'phone', label: 'Phone' },
]

const LIST_LABELS: { key: keyof Omit<TrackerSettings, 'status_stage_rules' | 'status_colors'>; label: string }[] = [
  { key: 'status_options', label: 'Status' },
  { key: 'service_options', label: 'Service' },
  { key: 'lead_source_options', label: 'Lead Source' },
  { key: 'salesperson_options', label: 'Salesperson' },
  { key: 'base_program_sold_options', label: 'Base Program Sold' },
  { key: 'auxiliary_services_options', label: 'Auxiliary Services' },
]

function ListEditor({
  label,
  items,
  onChange,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  const [newItem, setNewItem] = useState('')

  function add() {
    const v = newItem.trim()
    if (!v || items.includes(v)) return
    onChange([...items, v])
    setNewItem('')
  }

  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i))
  }

  function moveUp(i: number) {
    if (i === 0) return
    const next = [...items]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    onChange(next)
  }

  function moveDown(i: number) {
    if (i === items.length - 1) return
    const next = [...items]
    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
    onChange(next)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-4">{label}</h3>
      <div className="space-y-1.5 mb-4">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <span className="flex-1 text-sm text-gray-300 bg-gray-800 px-3 py-1.5 rounded-lg">{item}</span>
            <button
              onClick={() => moveUp(i)}
              disabled={i === 0}
              className="text-gray-600 hover:text-white transition-colors disabled:opacity-20 text-xs px-1"
              title="Move up"
            >▲</button>
            <button
              onClick={() => moveDown(i)}
              disabled={i === items.length - 1}
              className="text-gray-600 hover:text-white transition-colors disabled:opacity-20 text-xs px-1"
              title="Move down"
            >▼</button>
            <button
              onClick={() => remove(i)}
              className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1"
              title="Remove"
              aria-label="Remove"
            >✕</button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-gray-600 text-sm italic">No items yet.</p>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={`Add ${label.toLowerCase()} option…`}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={add}
          disabled={!newItem.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function StageManager({ stages, onChange }: { stages: Stage[]; onChange: (s: Stage[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [migrateTo, setMigrateTo] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [busy, setBusy] = useState(false)

  async function addStage() {
    const label = newLabel.trim()
    if (!label) return
    setBusy(true)
    const res = await fetch('/api/tracker/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, color: newColor }),
    })
    if (res.ok) {
      const stage = await res.json()
      onChange([...stages, stage])
      setNewLabel('')
      setNewColor('#6b7280')
    }
    setBusy(false)
  }

  async function saveLabel(id: string) {
    const label = editLabel.trim()
    if (!label) { setEditingId(null); return }
    const res = await fetch(`/api/tracker/stages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
    if (res.ok) {
      onChange(stages.map(s => s.id === id ? { ...s, label } : s))
    }
    setEditingId(null)
  }

  async function setColor(id: string, color: string) {
    onChange(stages.map(s => s.id === id ? { ...s, color } : s))
    await fetch(`/api/tracker/stages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    })
  }

  async function setRole(id: string, role: string) {
    const value = role || null
    const res = await fetch(`/api/tracker/stages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_role: value }),
    })
    if (res.ok) {
      // The server MOVES a role off any other stage — mirror that locally.
      onChange(stages.map(s => {
        if (s.id === id) return { ...s, system_role: value }
        if (value && s.system_role === value) return { ...s, system_role: null }
        return s
      }))
    }
  }

  async function reorder(id: string, dir: -1 | 1) {
    const idx = stages.findIndex(s => s.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= stages.length) return
    const next = [...stages]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    const updated = next.map((s, i) => ({ ...s, sort_order: i }))
    onChange(updated)
    await Promise.all([
      fetch(`/api/tracker/stages/${updated[idx].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: idx }),
      }),
      fetch(`/api/tracker/stages/${updated[newIdx].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: newIdx }),
      }),
    ])
  }

  async function deleteStage(id: string) {
    const target = migrateTo || stages.find(s => s.id !== id)?.key || ''
    if (!target) return
    setBusy(true)
    const res = await fetch(`/api/tracker/stages/${id}?migrate_to=${encodeURIComponent(target)}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      onChange(stages.filter(s => s.id !== id))
      setDeletingId(null)
      setMigrateTo('')
    }
    setBusy(false)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">Stages</h3>
      <p className="text-xs text-gray-500 mb-4">
        Add, rename, recolor, or remove pipeline stages. Click the color swatch to change it. Double-click a label to rename. Deleting a stage moves its leads to another stage. Tag a stage with a <span className="text-gray-400">pipeline role</span> (New / Responded / Quoted / Won / Lost) to power the Board &amp; Needs-me views and drip triggers — one stage per role.
      </p>

      <div className="space-y-2 mb-4">
        {stages.map((stage, i) => (
          <div key={stage.id}>
            <div className="flex items-center gap-2 group">
              {/* Clickable color swatch */}
              <div className="relative w-6 h-6 flex-shrink-0">
                <div
                  className="w-6 h-6 rounded-md border border-white/10"
                  style={{ backgroundColor: stage.color }}
                />
                <input
                  type="color"
                  value={stage.color}
                  onChange={e => setColor(stage.id, e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  title="Change color"
                />
              </div>

              {/* Label — inline edit on double-click */}
              {editingId === stage.id ? (
                <input
                  autoFocus
                  value={editLabel}
                  onChange={e => setEditLabel(e.target.value)}
                  onBlur={() => saveLabel(stage.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveLabel(stage.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 bg-gray-800 border border-indigo-500 rounded-lg px-3 py-1 text-sm text-white focus:outline-none"
                />
              ) : (
                <span
                  className="flex-1 text-sm text-gray-300 cursor-pointer hover:text-white select-none"
                  onDoubleClick={() => { setEditingId(stage.id); setEditLabel(stage.label) }}
                  title="Double-click to rename"
                >
                  {stage.label}
                </span>
              )}

              <button
                onClick={() => { setEditingId(stage.id); setEditLabel(stage.label) }}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white transition-all text-xs px-1"
                title="Rename"
              >✏</button>
              <select
                value={stage.system_role ?? ''}
                onChange={e => setRole(stage.id, e.target.value)}
                title="Pipeline role — powers the Board & Needs-me views and drip triggers (one stage per role)"
                className="bg-gray-800 border border-gray-700 rounded-md px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500 max-w-[7.5rem] shrink-0"
              >
                {SYSTEM_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                onClick={() => reorder(stage.id, -1)}
                disabled={i === 0}
                className="text-gray-600 hover:text-white transition-colors disabled:opacity-20 text-xs px-1"
                title="Move up"
              >▲</button>
              <button
                onClick={() => reorder(stage.id, 1)}
                disabled={i === stages.length - 1}
                className="text-gray-600 hover:text-white transition-colors disabled:opacity-20 text-xs px-1"
                title="Move down"
              >▼</button>
              <button
                onClick={() => {
                  setDeletingId(stage.id)
                  setMigrateTo(stages.find(s => s.id !== stage.id)?.key ?? '')
                }}
                className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1"
                title="Delete stage"
              >✕</button>
            </div>

            {/* Delete confirmation panel */}
            {deletingId === stage.id && (
              <div className="mt-2 ml-8 bg-gray-800 border border-red-900/40 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-300">
                  Move leads currently in <span className="font-medium">{stage.label}</span> to:
                </p>
                <select
                  value={migrateTo}
                  onChange={e => setMigrateTo(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
                >
                  {stages.filter(s => s.id !== stage.id).map(s => (
                    <option key={s.id} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setDeletingId(null)}
                    className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteStage(stage.id)}
                    disabled={busy}
                    className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1 rounded-lg transition-colors"
                  >
                    Delete Stage
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add new stage row */}
      <div className="flex gap-2 items-center border-t border-gray-800 pt-4">
        <div className="relative w-8 h-8 flex-shrink-0">
          <div className="w-8 h-8 rounded-md border border-gray-700" style={{ backgroundColor: newColor }} />
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            title="Choose color"
          />
        </div>
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStage() } }}
          placeholder="New stage name…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={addStage}
          disabled={!newLabel.trim() || busy}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Add Stage
        </button>
      </div>
    </div>
  )
}

const TYPE_BADGE_CLASSES: Record<ColType, string> = {
  text: 'bg-blue-900/50 text-blue-300',
  number: 'bg-purple-900/50 text-purple-300',
  date: 'bg-green-900/50 text-green-300',
  dropdown: 'bg-orange-900/50 text-orange-300',
  checkbox: 'bg-pink-900/50 text-pink-300',
  phone: 'bg-teal-900/50 text-teal-300',
}

function CustomColumnManager({
  columns,
  onChange,
}: {
  columns: CustomColumnDef[]
  onChange: (c: CustomColumnDef[]) => void
}) {
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<ColType>('text')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [newOption, setNewOption] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function addColumn() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const res = await fetch('/api/tracker/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: newType }),
    })
    if (res.ok) {
      const col = await res.json()
      onChange([...columns, { ...col, options: col.options ?? [] }])
      setNewName('')
      setNewType('text')
    }
    setBusy(false)
  }

  async function deleteColumn(id: string) {
    setBusy(true)
    const res = await fetch(`/api/tracker/columns/${id}`, { method: 'DELETE' })
    if (res.ok) {
      onChange(columns.filter(c => c.id !== id))
      setConfirmDeleteId(null)
    }
    setBusy(false)
  }

  async function addOption(id: string) {
    const option = newOption.trim()
    if (!option) return
    const col = columns.find(c => c.id === id)
    if (!col) return
    const options = [...(col.options ?? []), option]
    const res = await fetch(`/api/tracker/columns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options }),
    })
    if (res.ok) {
      onChange(columns.map(c => c.id === id ? { ...c, options } : c))
      setNewOption('')
    }
  }

  async function removeOption(id: string, optIdx: number) {
    const col = columns.find(c => c.id === id)
    if (!col) return
    const options = (col.options ?? []).filter((_, i) => i !== optIdx)
    const res = await fetch(`/api/tracker/columns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options }),
    })
    if (res.ok) {
      onChange(columns.map(c => c.id === id ? { ...c, options } : c))
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">Custom Columns</h3>
      <p className="text-xs text-gray-500 mb-4">
        Add extra columns to the lead tracker. Visible to all users. Column order is saved per-user.
      </p>

      <div className="space-y-2 mb-4">
        {columns.length === 0 && (
          <p className="text-gray-600 text-sm italic">No custom columns yet.</p>
        )}
        {columns.map(col => (
          <div key={col.id}>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_BADGE_CLASSES[col.type] ?? 'bg-gray-800 text-gray-400'}`}>
                {col.type}
              </span>
              <span className="flex-1 text-sm text-gray-300">{col.name}</span>
              {col.type === 'dropdown' && (
                <button
                  onClick={() => setExpandedId(expandedId === col.id ? null : col.id)}
                  className="text-xs text-gray-500 hover:text-indigo-400 transition-colors px-2 whitespace-nowrap"
                  title="Edit dropdown options"
                >
                  {expandedId === col.id ? '▲ Options' : '▼ Options'}
                </button>
              )}
              <button
                onClick={() => setConfirmDeleteId(confirmDeleteId === col.id ? null : col.id)}
                className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1"
                title="Delete column"
              >✕</button>
            </div>

            {/* Dropdown options editor */}
            {col.type === 'dropdown' && expandedId === col.id && (
              <div className="mt-2 ml-4 bg-gray-800 rounded-xl p-3 space-y-1.5">
                {(col.options ?? []).map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-gray-300 bg-gray-900 px-2 py-1 rounded">{opt}</span>
                    <button
                      onClick={() => removeOption(col.id, i)}
                      className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                    >✕</button>
                  </div>
                ))}
                {(col.options ?? []).length === 0 && (
                  <p className="text-xs text-gray-600 italic">No options yet.</p>
                )}
                <div className="flex gap-2 mt-2">
                  <input
                    value={newOption}
                    onChange={e => setNewOption(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(col.id) } }}
                    placeholder="Add option…"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => addOption(col.id)}
                    disabled={!newOption.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Delete confirmation */}
            {confirmDeleteId === col.id && (
              <div className="mt-2 ml-4 bg-gray-800 border border-red-900/40 rounded-xl p-3 flex flex-wrap items-center gap-3">
                <p className="flex-1 text-xs text-red-300 min-w-0">
                  Delete <span className="font-medium">{col.name}</span>? All lead data in this column will be lost.
                </p>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteColumn(col.id)}
                    disabled={busy}
                    className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add new column */}
      <div className="flex gap-2 border-t border-gray-800 pt-4">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColumn() } }}
          placeholder="Column name…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <select
          value={newType}
          onChange={e => setNewType(e.target.value as ColType)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          {COL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button
          onClick={addColumn}
          disabled={!newName.trim() || busy}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function StatusColorEditor({
  statusOptions,
  colors,
  onChange,
}: {
  statusOptions: string[]
  colors: Record<string, string>
  onChange: (colors: Record<string, string>) => void
}) {
  function setColor(status: string, value: string) {
    onChange({ ...colors, [status]: value })
  }

  function clearColor(status: string) {
    const next = { ...colors }
    delete next[status]
    onChange(next)
  }

  if (statusOptions.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="font-semibold text-white mb-1">Status Colors</h3>
        <p className="text-xs text-gray-500">Add status options above to assign colors.</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">Status Colors</h3>
      <p className="text-xs text-gray-500 mb-4">Assign a color chip to each status value in the tracker.</p>
      <div className="space-y-2">
        {statusOptions.map(status => {
          const color = colors[status]
          return (
            <div key={status} className="flex items-center gap-3">
              {color ? (
                <div
                  className="w-5 h-5 rounded-md flex-shrink-0 border border-white/10"
                  style={{ backgroundColor: color }}
                />
              ) : (
                <div className="w-5 h-5 rounded-md flex-shrink-0 border border-gray-700 bg-gray-800" />
              )}
              <span className="flex-1 text-sm text-gray-300">{status}</span>
              <input
                type="color"
                value={color ?? '#6b7280'}
                onChange={e => setColor(status, e.target.value)}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border border-gray-700 p-0.5"
                title="Pick color"
              />
              {color ? (
                <button
                  onClick={() => clearColor(status)}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors whitespace-nowrap"
                  title="Remove color"
                >
                  Clear
                </button>
              ) : (
                <span className="text-xs text-gray-700 w-9">none</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RulesEditor({
  rules,
  statusOptions,
  stages,
  onChange,
}: {
  rules: StatusStageRule[]
  statusOptions: string[]
  stages: Stage[]
  onChange: (rules: StatusStageRule[]) => void
}) {
  const MAX = 6

  function add() {
    if (rules.length >= MAX) return
    onChange([...rules, { status: '', stage: '' }])
  }

  function update(i: number, field: keyof StatusStageRule, value: string) {
    const next = [...rules]
    next[i] = { ...next[i], [field]: value }
    onChange(next)
  }

  function remove(i: number) {
    onChange(rules.filter((_, idx) => idx !== i))
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">Auto-Move Rules</h3>
      <p className="text-xs text-gray-500 mb-4">
        When a lead&apos;s status changes to the value below, it automatically moves to the specified stage.
      </p>
      <div className="space-y-3 mb-4">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-10 shrink-0">When</span>
            <select
              value={rule.status}
              onChange={e => update(i, 'status', e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">— status —</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-gray-500 shrink-0">→ move to</span>
            <select
              value={rule.stage}
              onChange={e => update(i, 'stage', e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">— stage —</option>
              {stages.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            <button
              onClick={() => remove(i)}
              className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1"
              title="Remove rule"
              aria-label="Remove"
            >✕</button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-gray-600 text-sm italic">No rules yet.</p>
        )}
      </div>
      {rules.length < MAX ? (
        <button onClick={add} className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors">
          + Add rule
        </button>
      ) : (
        <p className="text-xs text-gray-600">Maximum {MAX} rules configured.</p>
      )}
    </div>
  )
}

export default function SettingsPage({
  initialSettings,
  initialStages,
  initialColumnDefs,
}: {
  initialSettings: TrackerSettings | null
  initialStages: Stage[]
  initialColumnDefs: CustomColumnDef[]
}) {
  const defaults: TrackerSettings = {
    status_options: [],
    service_options: [],
    lead_source_options: [],
    salesperson_options: [],
    base_program_sold_options: [],
    auxiliary_services_options: [],
    status_stage_rules: [],
    status_colors: {},
  }

  const [settings, setSettings] = useState<TrackerSettings>(initialSettings ?? defaults)
  const [stages, setStages] = useState<Stage[]>(initialStages)
  const [columns, setColumns] = useState<CustomColumnDef[]>(initialColumnDefs)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function updateList(key: keyof Omit<TrackerSettings, 'status_stage_rules' | 'status_colors'>, items: string[]) {
    setSettings(prev => ({ ...prev, [key]: items }))
    setSaved(false)
  }

  function updateRules(rules: StatusStageRule[]) {
    setSettings(prev => ({ ...prev, status_stage_rules: rules }))
    setSaved(false)
  }

  function updateStatusColors(colors: Record<string, string>) {
    setSettings(prev => ({ ...prev, status_colors: colors }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    const res = await fetch('/api/tracker/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Tracker Settings</h2>
          <p className="text-sm text-gray-400 mt-0.5">Manage tracker options. Stage and column changes apply immediately. List changes require Save.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-green-400 text-sm">Saved ✓</span>}
          {error && <span className="text-red-400 text-sm">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <StageManager stages={stages} onChange={setStages} />
        <CustomColumnManager columns={columns} onChange={setColumns} />

        {LIST_LABELS.map(({ key, label }) => (
          <ListEditor
            key={key}
            label={label}
            items={settings[key]}
            onChange={items => updateList(key, items)}
          />
        ))}

        <RulesEditor
          rules={settings.status_stage_rules ?? []}
          statusOptions={settings.status_options}
          stages={stages}
          onChange={updateRules}
        />
        <StatusColorEditor
          statusOptions={settings.status_options}
          colors={settings.status_colors ?? {}}
          onChange={updateStatusColors}
        />
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
