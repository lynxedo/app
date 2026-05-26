'use client'

import { useState } from 'react'

type Tag = {
  id: string
  label: string
  color: string
  sort_order: number
  created_at: string
  count: number
}

const SUGGESTED_COLORS = [
  '#6B7280', // gray
  '#EF4444', // red
  '#F59E0B', // amber
  '#10B981', // emerald
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
]

export default function ContactsAdminPanel({ initialTags }: { initialTags: Tag[] }) {
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  async function createTag(label: string, color: string) {
    setError('')
    const res = await fetch('/api/admin/contact-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, color, sort_order: tags.length }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Create failed'); return }
    setTags(prev => [...prev, data.tag].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)))
    setAdding(false)
  }

  async function updateTag(id: string, patch: Partial<Pick<Tag, 'label' | 'color' | 'sort_order'>>) {
    setError('')
    const res = await fetch(`/api/admin/contact-tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Update failed'); return }
    setTags(prev => prev.map(t => t.id === id ? { ...t, ...data.tag } : t))
    setEditingId(null)
  }

  async function deleteTag(id: string, label: string, count: number) {
    const msg = count > 0
      ? `Delete "${label}"? It's currently on ${count} contact${count === 1 ? '' : 's'} — they'll lose this tag.`
      : `Delete "${label}"?`
    if (!confirm(msg)) return
    const res = await fetch(`/api/admin/contact-tags/${id}`, { method: 'DELETE' })
    if (res.ok) setTags(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Contact tags</h1>
        <p className="text-sm text-gray-400">
          Tags help organize contacts so users can filter to just vendors, just customers, or whatever categories matter to your business.
          Tags are visible to everyone in the company; only admins can create or edit them.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-2">{error}</div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg">
        {tags.length === 0 && !adding && (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            No tags yet. Create some categories to help organize contacts.
          </div>
        )}

        {tags.map(tag => (
          <TagRow
            key={tag.id}
            tag={tag}
            editing={editingId === tag.id}
            onEdit={() => setEditingId(tag.id)}
            onCancel={() => setEditingId(null)}
            onSave={(patch) => updateTag(tag.id, patch)}
            onDelete={() => deleteTag(tag.id, tag.label, tag.count)}
          />
        ))}

        {adding && (
          <NewTagRow
            onCancel={() => setAdding(false)}
            onSave={createTag}
          />
        )}

        <div className="px-4 py-3 border-t border-gray-800">
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={adding}
            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
          >
            + Add tag
          </button>
        </div>
      </div>
    </div>
  )
}

function TagRow({
  tag,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  tag: Tag
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (patch: { label?: string; color?: string }) => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(tag.label)
  const [color, setColor] = useState(tag.color)

  if (!editing) {
    return (
      <div className="px-4 py-2.5 border-b border-gray-800 last:border-b-0 flex items-center gap-3">
        <span
          className="text-xs px-2 py-1 rounded-full border border-white/10"
          style={{ backgroundColor: tag.color + '33', color: tag.color }}
        >
          {tag.label}
        </span>
        <span className="text-xs text-gray-500">{tag.count} contact{tag.count === 1 ? '' : 's'}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onEdit} className="text-xs text-gray-400 hover:text-white px-2 py-1">Edit</button>
          <button type="button" onClick={onDelete} className="text-xs text-red-400 hover:text-red-300 px-2 py-1">Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-b border-gray-800 last:border-b-0 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          maxLength={60}
          className="flex-1 px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-sm"
          style={{ fontSize: 16 }}
        />
        <button type="button" onClick={() => onSave({ label: label.trim(), color })}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">
          Save
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm">
          Cancel
        </button>
      </div>
      <ColorPicker value={color} onChange={setColor} />
    </div>
  )
}

function NewTagRow({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (label: string, color: string) => void
}) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState(SUGGESTED_COLORS[0])

  return (
    <div className="px-4 py-3 border-b border-gray-800 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Tag label (e.g. Customer, Vendor, VIP)"
          maxLength={60}
          autoFocus
          className="flex-1 px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-sm placeholder-gray-500"
          style={{ fontSize: 16 }}
        />
        <button type="button" onClick={() => label.trim() && onSave(label.trim(), color)}
          disabled={!label.trim()}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50">
          Create
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm">
          Cancel
        </button>
      </div>
      <ColorPicker value={color} onChange={setColor} />
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {SUGGESTED_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full border-2 transition ${value === c ? 'border-white' : 'border-transparent'}`}
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value.toUpperCase())}
        className="w-6 h-6 ml-1 cursor-pointer rounded"
      />
    </div>
  )
}
