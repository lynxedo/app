'use client'

import { useEffect, useState } from 'react'
import { Button, EmptyState, useToast, useConfirm } from '@/components/ui'
import BlockComposer, { type Template } from '@/components/hub/marketing/email/BlockComposer'

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

  async function duplicate(t: Template) {
    const copyName = `Copy of ${t.name}`.slice(0, 120)
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: copyName, subject: t.subject, design: t.design }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.template) {
      toast.success('Template duplicated.')
      setTemplates((p) => [data.template, ...p])
      setEditing(data.template) // open the copy so they can tweak it
    } else {
      toast.error(data.error || 'Could not duplicate the template.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Reusable email designs — drag in your logo, pictures, buttons, and colors. Use merge fields like <code className="text-gray-300">{'{{first_name}}'}</code>.</p>
        <Button onClick={() => setEditing('new')}>+ New template</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : templates.length === 0 ? (
        <EmptyState title="No templates yet — create your first reusable email design." />
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
                <button onClick={() => duplicate(t)} className="text-sm text-gray-400 hover:text-white">Duplicate</button>
                <button onClick={() => remove(t)} className="text-sm text-red-400/80 hover:text-red-400">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <BlockComposer
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
