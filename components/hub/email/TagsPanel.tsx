'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import { LIGHT_SURFACE_STYLE } from './emailFormat'

/**
 * Inbox tags manager (slide-over, light theme — matches the inbox main pane).
 * Manages the two admin-defined tag catalogs:
 *   • Type tags     — what an email IS (Quote Request / Scheduling / Billing / …)
 *   • Outcome tags  — what happened or what's next (Quoted / Booked / Lost / …)
 * Each section supports add (name + color), inline edit (name/color), reorder
 * (up/down), and deactivate (soft delete — history on tagged threads is kept).
 *
 * Admin-gated server-side (Integrations admin); non-admins who somehow open this
 * get a friendly "manager access required" note. Self-contained: all fetches live
 * here. Mount from the sidebar gear menu with an open/onClose pair (mirrors
 * RulesPanel).
 */

type TagKind = 'type' | 'outcome'

type InboxTag = {
  id: string
  kind: TagKind
  name: string
  color: string
  outlook_category: string | null
  sort_order: number
  active: boolean
}

// Chip color presets (the seeded palette) + a native picker for anything custom.
const PRESET_COLORS = [
  '#2563eb',
  '#0891b2',
  '#0d9488',
  '#16a34a',
  '#a16207',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#7c3aed',
  '#4f46e5',
  '#64748b',
  '#6b7280',
]

const inputCls =
  'border border-gray-200 rounded-md px-2 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500'

// A row of preset swatches + a custom color input; `value` shows the current pick.
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Use color ${c}`}
          className={`w-5 h-5 rounded-full border ${
            value.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-offset-1 ring-gray-500' : 'border-gray-300'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Custom color"
        className="w-6 h-6 p-0 border border-gray-200 rounded cursor-pointer bg-white"
      />
    </div>
  )
}

function TagSection({
  title,
  subtitle,
  tags,
  busy,
  onCreate,
  onUpdate,
  onDeactivate,
  onMove,
}: {
  title: string
  subtitle: string
  tags: InboxTag[] // already filtered to active + sorted by sort_order
  busy: boolean
  onCreate: (name: string, color: string) => Promise<string | null>
  onUpdate: (id: string, patch: { name?: string; color?: string }) => Promise<string | null>
  onDeactivate: (tag: InboxTag) => void
  onMove: (tag: InboxTag, dir: -1 | 1) => void
}) {
  const [addName, setAddName] = useState('')
  const [addColor, setAddColor] = useState(PRESET_COLORS[0])
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(PRESET_COLORS[0])
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  function startEdit(tag: InboxTag) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color || PRESET_COLORS[0])
    setEditError(null)
  }

  async function submitAdd() {
    if (adding) return
    if (!addName.trim()) return setAddError('Enter a tag name.')
    setAdding(true)
    setAddError(null)
    const err = await onCreate(addName.trim(), addColor)
    setAdding(false)
    if (err) return setAddError(err)
    setAddName('')
    setAddColor(PRESET_COLORS[0])
  }

  async function submitEdit(id: string) {
    if (savingEdit) return
    if (!editName.trim()) return setEditError('Enter a tag name.')
    setSavingEdit(true)
    setEditError(null)
    const err = await onUpdate(id, { name: editName.trim(), color: editColor })
    setSavingEdit(false)
    if (err) return setEditError(err)
    setEditingId(null)
  }

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500 mb-3">{subtitle}</p>

      {tags.length === 0 ? (
        <p className="text-xs text-gray-400 italic mb-3">No tags yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md mb-3">
          {tags.map((tag, i) => (
            <li key={tag.id} className="px-3 py-2">
              {editingId === tag.id ? (
                /* ---- inline edit ---- */
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={`w-full ${inputCls}`}
                  />
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  {editError && <p className="text-xs text-red-600">{editError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => submitEdit(tag.id)}
                      disabled={savingEdit}
                      className="px-3 py-1 text-xs font-medium rounded-md bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={savingEdit}
                      className="px-3 py-1 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ---- display row ---- */
                <div className="flex items-center gap-3">
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: tag.color || '#64748b' }}
                  />
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-900">{tag.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onMove(tag, -1)}
                      disabled={busy || i === 0}
                      aria-label="Move up"
                      className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(tag, 1)}
                      disabled={busy || i === tags.length - 1}
                      aria-label="Move down"
                      className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(tag)}
                      className="px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeactivate(tag)}
                      disabled={busy}
                      title="Deactivate — hides the tag from the picker; keeps it on already-tagged threads"
                      className="px-2 py-1 text-xs font-medium rounded border border-gray-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ---- add form ---- */}
      <div className="rounded-md border border-dashed border-gray-300 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAdd()
            }}
            placeholder="New tag name…"
            className={`flex-1 min-w-0 ${inputCls}`}
          />
          <button
            type="button"
            onClick={submitAdd}
            disabled={adding}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        <ColorPicker value={addColor} onChange={setAddColor} />
        {addError && <p className="text-xs text-red-600">{addError}</p>}
      </div>
    </div>
  )
}

export default function TagsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tags, setTags] = useState<InboxTag[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadTags = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/email/tags')
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setTags((data.tags || []) as InboxTag[])
    } catch {
      /* leave the current list */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setForbidden(false)
    loadTags().finally(() => setLoading(false))
  }, [open, loadTags])

  // Create → POST; returns an error message (or null) for the section's add form.
  const createTag = useCallback(
    async (kind: TagKind, name: string, color: string): Promise<string | null> => {
      try {
        const res = await fetch('/api/hub/email/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, name, color }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => null)
          return (d?.error as string) || 'Could not add the tag.'
        }
        await loadTags()
        return null
      } catch {
        return 'Could not add the tag.'
      }
    },
    [loadTags]
  )

  const updateTag = useCallback(
    async (id: string, patch: { name?: string; color?: string }): Promise<string | null> => {
      try {
        const res = await fetch(`/api/hub/email/tags/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => null)
          return (d?.error as string) || 'Could not save the tag.'
        }
        await loadTags()
        return null
      } catch {
        return 'Could not save the tag.'
      }
    },
    [loadTags]
  )

  const deactivateTag = useCallback(
    async (tag: InboxTag) => {
      if (busy) return
      if (!window.confirm(`Deactivate "${tag.name}"? It stays on already-tagged threads but is hidden from the picker.`))
        return
      setBusy(true)
      // Optimistic: drop it from the list (GET only re-adds it as inactive, filtered out).
      setTags((ts) => ts.filter((t) => t.id !== tag.id))
      try {
        const res = await fetch(`/api/hub/email/tags/${tag.id}`, { method: 'DELETE' })
        if (!res.ok) await loadTags() // revert on failure
      } finally {
        setBusy(false)
      }
    },
    [busy, loadTags]
  )

  // Swap two tags' sort_order (within the same kind) to reorder.
  const moveTag = useCallback(
    async (tag: InboxTag, dir: -1 | 1) => {
      if (busy) return
      const kindTags = tags
        .filter((t) => t.kind === tag.kind && t.active)
        .sort((a, b) => a.sort_order - b.sort_order)
      const idx = kindTags.findIndex((t) => t.id === tag.id)
      const swapWith = kindTags[idx + dir]
      if (!swapWith) return
      setBusy(true)
      try {
        await fetch(`/api/hub/email/tags/${tag.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: swapWith.sort_order }),
        })
        await fetch(`/api/hub/email/tags/${swapWith.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: tag.sort_order }),
        })
        await loadTags()
      } finally {
        setBusy(false)
      }
    },
    [busy, tags, loadTags]
  )

  if (!open) return null

  const activeSorted = (kind: TagKind) =>
    tags.filter((t) => t.kind === kind && t.active).sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="email-light-surface relative h-full w-full max-w-xl bg-white text-gray-900 shadow-2xl flex flex-col"
        style={LIGHT_SURFACE_STYLE}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold">Manage tags</h2>
            <p className="text-xs text-gray-500">Label conversations by what they are and how they end up.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center">
              <Spinner size={6} />
            </div>
          ) : forbidden ? (
            <div className="p-6 text-sm text-gray-600">
              <p className="font-medium text-gray-900 mb-1">Manager access required</p>
              <p>Tags are managed by Integrations admins. Ask a manager if a tag needs to be added or changed.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              <TagSection
                title="Type tags"
                subtitle="What the email is — set when it arrives."
                tags={activeSorted('type')}
                busy={busy}
                onCreate={(name, color) => createTag('type', name, color)}
                onUpdate={updateTag}
                onDeactivate={deactivateTag}
                onMove={moveTag}
              />
              <TagSection
                title="Outcome / Follow-up tags"
                subtitle="What happened or what's next."
                tags={activeSorted('outcome')}
                busy={busy}
                onCreate={(name, color) => createTag('outcome', name, color)}
                onUpdate={updateTag}
                onDeactivate={deactivateTag}
                onMove={moveTag}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
