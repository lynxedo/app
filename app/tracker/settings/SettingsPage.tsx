'use client'

import { useState } from 'react'

type StatusStageRule = { status: string; stage: string }

type TrackerSettings = {
  status_options: string[]
  service_options: string[]
  lead_source_options: string[]
  salesperson_options: string[]
  base_program_sold_options: string[]
  auxiliary_services_options: string[]
  status_stage_rules: StatusStageRule[]
}

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

const LIST_LABELS: { key: keyof Omit<TrackerSettings, 'status_stage_rules'>; label: string }[] = [
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

function RulesEditor({
  rules,
  statusOptions,
  onChange,
}: {
  rules: StatusStageRule[]
  statusOptions: string[]
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
              {PIPELINE_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            <button
              onClick={() => remove(i)}
              className="text-gray-700 hover:text-red-400 transition-colors text-sm px-1"
              title="Remove rule"
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
}: {
  initialSettings: TrackerSettings | null
}) {
  const defaults: TrackerSettings = {
    status_options: [],
    service_options: [],
    lead_source_options: [],
    salesperson_options: [],
    base_program_sold_options: [],
    auxiliary_services_options: [],
    status_stage_rules: [],
  }

  const [settings, setSettings] = useState<TrackerSettings>(initialSettings ?? defaults)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function updateList(key: keyof Omit<TrackerSettings, 'status_stage_rules'>, items: string[]) {
    setSettings(prev => ({ ...prev, [key]: items }))
    setSaved(false)
  }

  function updateRules(rules: StatusStageRule[]) {
    setSettings(prev => ({ ...prev, status_stage_rules: rules }))
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
    <div className="px-6 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Tracker Settings</h2>
          <p className="text-sm text-gray-400 mt-0.5">Manage dropdown options for the tracker. Changes apply to all users.</p>
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
          onChange={updateRules}
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
