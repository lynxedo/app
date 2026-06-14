'use client'

import { useEffect, useState } from 'react'
import { TEMPLATE_FIELDS } from '@/lib/txt-templates'
import { useToast } from '@/components/ui'

type Template = {
  id: string
  scope: 'org' | 'personal'
  title: string
  body: string
  sort_order: number
  owner_user_id: string | null
  updated_at: string
}

export default function TxtPersonalTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    fetch('/api/txt/templates')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const all = (data.templates || []) as Template[]
        setTemplates(all.filter((t) => t.scope === 'personal'))
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [])

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setTitle('')
    setBody('')
    setSortOrder(0)
    setError('')
  }

  function openEdit(t: Template) {
    setCreating(false)
    setEditing(t)
    setTitle(t.title)
    setBody(t.body)
    setSortOrder(t.sort_order)
    setError('')
  }

  function closeForm() {
    setCreating(false)
    setEditing(null)
    setError('')
  }

  async function save() {
    setError('')
    setSaving(true)
    const payload = { title: title.trim(), body: body.trim(), sort_order: sortOrder }
    const url = editing ? `/api/txt/templates/${editing.id}` : '/api/txt/templates'
    const method = editing ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || 'Save failed')
      return
    }
    const saved = data.template as Template
    setTemplates((prev) => {
      const next = editing
        ? prev.map((t) => (t.id === saved.id ? saved : t))
        : [...prev, saved]
      return next.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.title.localeCompare(b.title)
      )
    })
    closeForm()
  }

  async function remove(t: Template) {
    if (!confirm(`Delete template "${t.title}"?`)) return
    const res = await fetch(`/api/txt/templates/${t.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Delete failed')
      return
    }
    setTemplates((prev) => prev.filter((x) => x.id !== t.id))
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-800">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h3 className="font-medium text-base">My Txt templates</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Personal canned messages — only you see these. Pick them in the Txt
            composer via the 📋 button or by typing <code className="text-emerald-300">/</code>.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm"
        >
          + New
        </button>
      </div>

      <div className="rounded-md border border-gray-800 bg-gray-950/60 p-3 text-xs text-gray-400 mt-2">
        <span className="text-gray-300">Dynamic fields: </span>
        {TEMPLATE_FIELDS.map((f, i) => (
          <span key={f}>
            <code className="text-emerald-300">{'{' + f + '}'}</code>
            {i < TEMPLATE_FIELDS.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>

      {(creating || editing) && (
        <div className="mt-3 rounded-md border border-gray-800 bg-gray-950 p-3 space-y-2">
          <div className="text-xs font-medium">
            {editing ? `Edit "${editing.title}"` : 'New template'}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Howdy)"
            maxLength={80}
            className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {first_name}, this is {my_first_name} from {company}…"
            rows={4}
            maxLength={1500}
            className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-sm font-mono resize-none"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Sort</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
              className="w-20 px-2 py-1 rounded-md bg-gray-900 border border-gray-700 text-xs"
            />
            <span className="text-[10px] text-gray-500">{body.length} / 1500</span>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !title.trim() || !body.trim()}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs disabled:opacity-50"
            >
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </button>
            <button
              onClick={closeForm}
              className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="text-xs text-gray-500">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="text-xs text-gray-500">No personal templates yet.</div>
        ) : (
          templates.map((t) => (
            <div
              key={t.id}
              className="rounded-md border border-gray-800 bg-gray-950/40 p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium text-sm">{t.title}</div>
                <div className="flex gap-1 flex-none">
                  <button
                    onClick={() => openEdit(t)}
                    className="text-xs px-2 py-1 rounded hover:bg-gray-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(t)}
                    className="text-xs px-2 py-1 rounded hover:bg-gray-800 text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-400 whitespace-pre-wrap mt-1 line-clamp-3">
                {t.body}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
