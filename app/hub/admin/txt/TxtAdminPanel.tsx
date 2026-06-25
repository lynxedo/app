'use client'

import { useState } from 'react'
import { TEMPLATE_FIELDS } from '@/lib/txt-templates'
import { useToast, useConfirm } from '@/components/ui'

type Template = {
  id: string
  scope: 'org' | 'personal'
  title: string
  body: string
  media: string[]
  sort_order: number
  owner_user_id: string | null
  updated_at: string
}

export default function TxtAdminPanel({
  initialTemplates,
}: {
  initialTemplates: Template[]
}) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [editing, setEditing] = useState<Template | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [media, setMedia] = useState<string[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const confirmDialog = useConfirm()

  async function uploadMedia(file: File | undefined) {
    if (!file) return
    setError('')
    setUploadingMedia(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/txt/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Upload failed'); return }
      setMedia([data.storage_path]) // single image
    } finally {
      setUploadingMedia(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setTitle('')
    setBody('')
    setSortOrder(0)
    setMedia([])
    setError('')
  }

  function openEdit(t: Template) {
    setCreating(false)
    setEditing(t)
    setTitle(t.title)
    setBody(t.body)
    setSortOrder(t.sort_order)
    setMedia(t.media || [])
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
    const payload = { title: title.trim(), body: body.trim(), media, sort_order: sortOrder }
    const url = editing
      ? `/api/admin/txt/templates/${editing.id}`
      : '/api/admin/txt/templates'
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
          a.sort_order - b.sort_order ||
          a.title.localeCompare(b.title)
      )
    })
    closeForm()
  }

  async function remove(t: Template) {
    if (!(await confirmDialog({ message: `Delete template "${t.title}"?`, danger: true }))) return
    const res = await fetch(`/api/admin/txt/templates/${t.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Delete failed')
      return
    }
    setTemplates((prev) => prev.filter((x) => x.id !== t.id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Txt — Org Templates</h1>
          <p className="text-sm text-gray-400 mt-1">
            Canned messages everyone in your company can pick from in the Txt composer.
            Users can also create their own templates from Settings → Account → Communications.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        >
          + New template
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-xs text-gray-300 space-y-1">
        <div className="font-medium text-gray-100">Dynamic fields</div>
        <div>Use any of these in the body — they get replaced when the message is sent.</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TEMPLATE_FIELDS.map((f) => (
            <code
              key={f}
              className="px-1.5 py-0.5 rounded bg-gray-800 text-emerald-300 text-[11px]"
            >
              {'{' + f + '}'}
            </code>
          ))}
        </div>
      </div>

      {(creating || editing) && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="text-sm font-medium">
            {editing ? `Edit "${editing.title}"` : 'New template'}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Howdy"
              maxLength={80}
              className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {first_name}, this is {my_first_name} from {company}…"
              rows={5}
              maxLength={1500}
              className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm font-mono"
            />
            <div className="text-[10px] text-gray-500 mt-1">{body.length} / 1500</div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Sort order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
              className="w-24 px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm"
            />
            <div className="text-[10px] text-gray-500 mt-1">
              Lower numbers appear first in the picker.
            </div>
          </div>
          {/* Attachment — single image, auto-sent (as MMS) with the template. */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Attachment</label>
            {media.length === 0 ? (
              <label className="inline-block text-sm px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 cursor-pointer">
                {uploadingMedia ? 'Uploading…' : '📎 Attach image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  disabled={uploadingMedia}
                  onChange={(e) => uploadMedia(e.target.files?.[0])}
                />
              </label>
            ) : (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/txt/media/${media[0]}`}
                  alt="attachment"
                  className="h-16 w-16 object-cover rounded-md border border-gray-700"
                />
                <button
                  onClick={() => setMedia([])}
                  className="text-xs px-2 py-1 rounded hover:bg-gray-800 text-red-300"
                >
                  Remove
                </button>
              </div>
            )}
            <div className="text-[10px] text-gray-500 mt-1">
              Optional. Sends automatically with the message (JPEG/PNG/GIF/WebP, up to 5 MB).
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || uploadingMedia || !title.trim() || (!body.trim() && media.length === 0)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
            </button>
            <button
              onClick={closeForm}
              className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        {templates.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            No org templates yet. Click <span className="text-emerald-300">+ New template</span> to add one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-xs text-gray-400">
              <tr>
                <th className="text-left px-3 py-2 w-14">Order</th>
                <th className="text-left px-3 py-2 w-48">Title</th>
                <th className="text-left px-3 py-2">Body</th>
                <th className="text-right px-3 py-2 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-gray-800">
                  <td className="px-3 py-2 text-gray-500">{t.sort_order}</td>
                  <td className="px-3 py-2 font-medium">
                    {t.title}
                    {t.media?.length > 0 && <span className="ml-1 text-xs text-gray-400" title="Has attachment">📎</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-300 whitespace-pre-wrap line-clamp-3">
                    {t.body}
                  </td>
                  <td className="px-3 py-2 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
