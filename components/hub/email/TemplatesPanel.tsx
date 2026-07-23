'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import { LIGHT_SURFACE_STYLE, textToHtmlParagraphs, htmlToPlainText, type InboxTemplate } from './emailFormat'

/**
 * Inbox templates manager (slide-over, light theme — matches the inbox main pane).
 * Manages the company-shared canned responses that reps insert from the reply /
 * new-email composers via "Insert template".
 *
 * Each template has a name, an optional subject line, and a plain-text body a
 * manager types in a simple textarea — saved as paragraph HTML so the composer
 * inserts clean formatting. Supports add, inline edit, reorder (up/down), and
 * deactivate (soft delete — the template just stops appearing in the picker).
 *
 * Admin-gated server-side (Integrations admin); non-admins who somehow open this
 * get a friendly "manager access required" note. Self-contained: all fetches live
 * here. Mount from the sidebar with an open/onClose pair (mirrors TagsPanel).
 */

const inputCls =
  'border border-gray-200 rounded-md px-2 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500'

// Manager types plain text; store it as paragraph HTML. If they pasted something
// that already looks like HTML, keep it verbatim (mirrors signatureToHtml).
function bodyToHtml(text: string): string {
  const t = (text || '').trim()
  if (!t) return ''
  if (/<[a-z][^>]*>/i.test(t)) return t
  return textToHtmlParagraphs(t)
}

export default function TemplatesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [templates, setTemplates] = useState<InboxTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState(false)

  // Form: formOpen=false → list view; editingId null + formOpen → new; else edit.
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/email/templates')
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setTemplates((data.templates || []) as InboxTemplate[])
    } catch {
      /* leave the current list */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setForbidden(false)
    setFormOpen(false)
    loadTemplates().finally(() => setLoading(false))
  }, [open, loadTemplates])

  function openNew() {
    setEditingId(null)
    setName('')
    setSubject('')
    setBodyText('')
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(t: InboxTemplate) {
    setEditingId(t.id)
    setName(t.name)
    setSubject(t.subject || '')
    // Show the stored HTML as editable plain text (round-trips paragraphs).
    setBodyText(htmlToPlainText(t.body_html || ''))
    setFormError(null)
    setFormOpen(true)
  }

  async function save() {
    if (saving) return
    setFormError(null)
    if (!name.trim()) return setFormError('Give the template a name.')
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        subject: subject.trim(),
        body_html: bodyToHtml(bodyText),
      }
      const res = await fetch(
        editingId ? `/api/hub/email/templates/${editingId}` : '/api/hub/email/templates',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setFormError((data?.error as string) || 'Save failed — try again.')
        return
      }
      setFormOpen(false)
      await loadTemplates()
    } finally {
      setSaving(false)
    }
  }

  const deactivate = useCallback(
    async (t: InboxTemplate) => {
      if (busy) return
      if (!window.confirm(`Remove the template "${t.name}"? It stops appearing in the composer.`)) return
      setBusy(true)
      // Optimistic: drop it (GET only re-adds it as inactive, filtered out).
      setTemplates((ts) => ts.filter((x) => x.id !== t.id))
      try {
        const res = await fetch(`/api/hub/email/templates/${t.id}`, { method: 'DELETE' })
        if (!res.ok) await loadTemplates() // revert on failure
      } finally {
        setBusy(false)
      }
    },
    [busy, loadTemplates]
  )

  // Swap two templates' sort_order to reorder (within the active list).
  const move = useCallback(
    async (t: InboxTemplate, dir: -1 | 1) => {
      if (busy) return
      const active = templates.filter((x) => x.active).sort((a, b) => a.sort_order - b.sort_order)
      const idx = active.findIndex((x) => x.id === t.id)
      const swapWith = active[idx + dir]
      if (!swapWith) return
      setBusy(true)
      try {
        await fetch(`/api/hub/email/templates/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: swapWith.sort_order }),
        })
        await fetch(`/api/hub/email/templates/${swapWith.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: t.sort_order }),
        })
        await loadTemplates()
      } finally {
        setBusy(false)
      }
    },
    [busy, templates, loadTemplates]
  )

  if (!open) return null

  const activeSorted = templates.filter((t) => t.active).sort((a, b) => a.sort_order - b.sort_order)

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
            <h2 className="text-base font-semibold">Manage templates</h2>
            <p className="text-xs text-gray-500">Canned responses your team can drop into any email.</p>
          </div>
          <div className="flex items-center gap-2">
            {!forbidden && !formOpen && (
              <button
                type="button"
                onClick={openNew}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-[#fff] hover:bg-emerald-700"
              >
                + New template
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            >
              ✕
            </button>
          </div>
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
              <p>
                Templates are managed by Integrations admins. Ask a manager if a canned response needs to be
                added or changed.
              </p>
            </div>
          ) : formOpen ? (
            /* ---------------- Add / Edit form ---------------- */
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Template name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Quote follow-up"
                  className={`w-full ${inputCls}`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Subject <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Leave blank to keep the conversation's subject"
                  className={`w-full ${inputCls}`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={10}
                  placeholder={
                    'Type the message here.\n\nLeave a blank line between paragraphs.\n\nUse {{first_name}} or {{name}} to drop in the customer’s name.'
                  }
                  className={`w-full font-sans ${inputCls}`}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Tip: <code className="bg-gray-100 px-1 rounded">{'{{first_name}}'}</code> and{' '}
                  <code className="bg-gray-100 px-1 rounded">{'{{name}}'}</code> fill in the customer's name
                  when it's known.
                </p>
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create template'}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : activeSorted.length === 0 ? (
            /* ---------------- Empty state ---------------- */
            <div className="p-8 text-center text-sm text-gray-600">
              <div className="text-3xl mb-2">📝</div>
              <p className="font-medium text-gray-900 mb-1">No templates yet</p>
              <p className="max-w-sm mx-auto">
                Templates are canned responses your whole team can drop into a reply or a new email — quote
                follow-ups, scheduling confirmations, common answers.
              </p>
              <button
                type="button"
                onClick={openNew}
                className="mt-4 px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-[#fff] hover:bg-emerald-700"
              >
                Create your first template
              </button>
            </div>
          ) : (
            /* ---------------- Template list ---------------- */
            <ul className="divide-y divide-gray-200">
              {activeSorted.map((t, i) => {
                const preview = htmlToPlainText(t.body_html || '').replace(/\s+/g, ' ').trim()
                return (
                  <li key={t.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.name}</p>
                      {t.subject && (
                        <p className="text-xs text-gray-500 truncate">Subject: {t.subject}</p>
                      )}
                      <p className="text-xs text-gray-400 truncate" title={preview}>
                        {preview || '(empty)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => move(t, -1)}
                        disabled={busy || i === 0}
                        aria-label="Move up"
                        className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(t, 1)}
                        disabled={busy || i === activeSorted.length - 1}
                        aria-label="Move down"
                        className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deactivate(t)}
                        disabled={busy}
                        title="Remove — stops the template appearing in the composer"
                        className="px-2 py-1 text-xs font-medium rounded border border-gray-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
