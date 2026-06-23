'use client'

import { useEffect, useRef, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'
import { markdownToHtml, renderMergeFields, MERGE_FIELDS } from '@/lib/email-markdown'

type Template = {
  id: string
  name: string
  subject: string
  body_markdown: string
  body_html: string
  updated_at: string
}

const BASE = '/api/hub/marketing/email/templates'

export default function TemplatesTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | 'new' | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(BASE)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setTemplates(data.templates || [])
      else toast.error(data.error || 'Could not load templates.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(t: Template) {
    if (!(await confirm({ message: `Delete the template “${t.name}”? This can’t be undone.`, confirmText: 'Delete', danger: true }))) return
    const res = await fetch(`${BASE}/${t.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Template deleted.'); setTemplates((p) => p.filter((x) => x.id !== t.id)) }
    else toast.error('Could not delete the template.')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Reusable email content. Use merge fields like <code className="text-gray-300">{'{{first_name}}'}</code>.</p>
        <Button onClick={() => setEditing('new')}>+ New template</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : templates.length === 0 ? (
        <EmptyState title="No templates yet — create your first reusable email template." />
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex items-start justify-between gap-3">
              <button className="text-left min-w-0 flex-1" onClick={() => setEditing(t)}>
                <div className="font-medium text-gray-100 truncate">{t.name}</div>
                <div className="text-sm text-gray-400 truncate">{t.subject || <span className="italic text-gray-600">No subject</span>}</div>
              </button>
              <div className="flex-none flex gap-2">
                <button onClick={() => setEditing(t)} className="text-sm text-gray-400 hover:text-white">Edit</button>
                <button onClick={() => remove(t)} className="text-sm text-red-400/80 hover:text-red-400">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setTemplates((prev) => {
              const i = prev.findIndex((x) => x.id === saved.id)
              if (i === -1) return [saved, ...prev]
              const copy = [...prev]; copy[i] = saved; return copy
            })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function TemplateEditor({
  template, onClose, onSaved,
}: { template: Template | null; onClose: () => void; onSaved: (t: Template) => void }) {
  const toast = useToast()
  const [name, setName] = useState(template?.name || '')
  const [subject, setSubject] = useState(template?.subject || '')
  const [markdown, setMarkdown] = useState(template?.body_markdown || '')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Sample-render the preview against a fake recipient so merge fields are visible.
  const previewHtml = markdownToHtml(renderMergeFields(markdown, { first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.com' }))
  const previewSubject = renderMergeFields(subject || '(no subject)', { first_name: 'Alex' })

  function insertMerge(field: string) {
    const token = `{{${field}}}`
    const el = bodyRef.current
    if (!el) { setMarkdown((m) => m + token); return }
    const start = el.selectionStart ?? markdown.length
    const end = el.selectionEnd ?? markdown.length
    const next = markdown.slice(0, start) + token + markdown.slice(end)
    setMarkdown(next)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length })
  }

  async function save() {
    if (!name.trim()) { toast.error('Give the template a name.'); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), subject: subject.trim(), body_markdown: markdown }
      const res = template
        ? await fetch(`${BASE}/${template.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(template ? 'Template updated.' : 'Template created.')
      onSaved(data.template)
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/hub/marketing/email/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body_markdown: markdown }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not send the test.')
      else toast.success(`Test sent to ${data.sent_to}.`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <Button variant="ghost" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test to myself'}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Template name</label>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spring promo"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Subject line</label>
          <input
            value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="Hi {{first_name}}, your lawn is ready for spring"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-400">Body (Markdown)</label>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-gray-500">Insert:</span>
              {MERGE_FIELDS.map((f) => (
                <button
                  key={f} onClick={() => insertMerge(f)}
                  className="text-[11px] rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-gray-300 hover:bg-gray-700"
                >{`{{${f}}}`}</button>
              ))}
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="text-[11px] rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-gray-300 hover:bg-gray-700 ml-1"
              >{showPreview ? 'Edit' : 'Preview'}</button>
            </div>
          </div>
          {showPreview ? (
            <div className="rounded-lg border border-gray-700 bg-white text-black p-4 min-h-[220px]">
              <div className="text-xs text-gray-500 border-b border-gray-200 pb-2 mb-3">
                <span className="font-semibold">Subject:</span> {previewSubject}
              </div>
              <div dangerouslySetInnerHTML={{ __html: previewHtml || '<p style="color:#999">Nothing to preview yet.</p>' }} />
              <p className="text-[11px] text-gray-400 mt-4">Preview shows sample merge values (Alex Rivera).</p>
            </div>
          ) : (
            <textarea
              ref={bodyRef}
              value={markdown} onChange={(e) => setMarkdown(e.target.value)}
              rows={11}
              placeholder={'Hi {{first_name}},\n\nThanks for being a Heroes customer! **Spring is here** and your lawn...\n\n- Point one\n- Point two\n\n[Book now](https://example.com)'}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white font-mono leading-relaxed"
            />
          )}
          <p className="text-[11px] text-gray-500 mt-1">
            Supports **bold**, *italic*, # headings, - lists, and [links](url). Merge fields render per-recipient at send time.
          </p>
        </div>
      </div>
    </Modal>
  )
}
