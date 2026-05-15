'use client'

import { useState } from 'react'

type TrackerSettings = {
  status_options: string[]
  service_options: string[]
  lead_source_options: string[]
  salesperson_options: string[]
  base_program_sold_options: string[]
  auxiliary_services_options: string[]
}

const LIST_LABELS: { key: keyof TrackerSettings; label: string }[] = [
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
  }

  const [settings, setSettings] = useState<TrackerSettings>(initialSettings ?? defaults)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function updateList(key: keyof TrackerSettings, items: string[]) {
    setSettings(prev => ({ ...prev, [key]: items }))
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
