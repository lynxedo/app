'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Form, FormField, FieldType } from '@/lib/forms'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

const TYPE_LABELS: Record<FieldType, string> = {
  section_title: 'Section Title',
  checkbox: 'Checkbox',
  date: 'Date',
  dropdown: 'Dropdown',
  signature: 'Signature',
  short_answer: 'Short Answer',
  long_answer: 'Long Answer',
}

const TYPE_COLORS: Record<FieldType, string> = {
  section_title: 'bg-gray-700 text-gray-200',
  checkbox: 'bg-emerald-900/60 text-emerald-300',
  date: 'bg-blue-900/60 text-blue-300',
  dropdown: 'bg-purple-900/60 text-purple-300',
  signature: 'bg-orange-900/60 text-orange-300',
  short_answer: 'bg-cyan-900/60 text-cyan-300',
  long_answer: 'bg-indigo-900/60 text-indigo-300',
}

const ADD_TYPES: FieldType[] = ['section_title', 'checkbox', 'date', 'dropdown', 'short_answer', 'long_answer', 'signature']

function FieldCard({
  field,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  field: FormField
  index: number
  total: number
  onUpdate: (id: string, patch: Partial<FormField>) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: 'up' | 'down') => void
}) {
  const [optionInput, setOptionInput] = useState('')

  function addOption() {
    const val = optionInput.trim()
    if (!val) return
    onUpdate(field.id, { options: [...(field.options ?? []), val] })
    setOptionInput('')
  }

  function removeOption(i: number) {
    onUpdate(field.id, { options: (field.options ?? []).filter((_, idx) => idx !== i) })
  }

  return (
    <div className="bg-gray-900 border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        {/* Reorder */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onMove(field.id, 'up')}
            disabled={index === 0}
            className="w-6 h-5 flex items-center justify-center text-gray-500 hover:text-white disabled:opacity-20 text-xs"
          >▲</button>
          <button
            type="button"
            onClick={() => onMove(field.id, 'down')}
            disabled={index === total - 1}
            className="w-6 h-5 flex items-center justify-center text-gray-500 hover:text-white disabled:opacity-20 text-xs"
          >▼</button>
        </div>

        {/* Type badge */}
        <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${TYPE_COLORS[field.type]}`}>
          {TYPE_LABELS[field.type]}
        </span>

        {/* Label */}
        <input
          value={field.label}
          onChange={e => onUpdate(field.id, { label: e.target.value })}
          placeholder="Field label…"
          className="flex-1 bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-brand focus:outline-none"
        />

        {/* Required toggle (not for section_title) */}
        {field.type !== 'section_title' && (
          <label className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={e => onUpdate(field.id, { required: e.target.checked })}
              className="accent-brand"
            />
            Req
          </label>
        )}

        {/* Delete */}
        <button
          type="button"
          onClick={() => onRemove(field.id)}
          className="text-red-500 hover:text-red-400 text-sm flex-shrink-0 px-1"
          title="Remove field"
          aria-label="Remove"
        >✕</button>
      </div>

      {/* Placeholder input for short/long answer */}
      {(field.type === 'short_answer' || field.type === 'long_answer') && (
        <input
          value={field.placeholder ?? ''}
          onChange={e => onUpdate(field.id, { placeholder: e.target.value })}
          placeholder="Placeholder text (optional)…"
          className="w-full bg-gray-800/50 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:border-brand focus:outline-none"
        />
      )}

      {/* Dropdown options */}
      {field.type === 'dropdown' && (
        <div className="pl-8 space-y-1">
          {(field.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-300 flex-1">{opt}</span>
              <button type="button" onClick={() => removeOption(i)} className="text-red-500 hover:text-red-400 text-xs" aria-label="Remove">✕</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={optionInput}
              onChange={e => setOptionInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addOption())}
              placeholder="Add option…"
              className="flex-1 bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:border-brand focus:outline-none"
            />
            <button type="button" onClick={addOption} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white">
              + Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FormBuilder({ initialForm }: { initialForm: Form }) {
  const router = useRouter()
  const [name, setName] = useState(initialForm.name)
  const [description, setDescription] = useState(initialForm.description ?? '')
  const [active, setActive] = useState(initialForm.active)
  const [fields, setFields] = useState<FormField[]>(initialForm.fields ?? [])
  const [smsTemplate, setSmsTemplate] = useState(initialForm.notification_sms_template ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateField = useCallback((id: string, patch: Partial<FormField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }, [])

  const removeField = useCallback((id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
  }, [])

  const moveField = useCallback((id: string, dir: 'up' | 'down') => {
    setFields(prev => {
      const idx = prev.findIndex(f => f.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }, [])

  function addField(type: FieldType) {
    const newField: FormField = { id: uid(), type, label: TYPE_LABELS[type] }
    if (type === 'dropdown') newField.options = []
    setFields(prev => [...prev, newField])
  }

  async function save() {
    if (!name.trim()) { setError('Form name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/forms/${initialForm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          active,
          fields,
          notification_sms_template: smsTemplate.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSavedAt(Date.now())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      {/* Header */}
      <header className="px-4 md:px-6 pt-4 pb-3 border-b border-white/10 flex items-center gap-3 sticky top-0 bg-gray-950 z-10">
        <button
          onClick={() => router.push('/hub/admin/forms')}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← Forms
        </button>
        <h1 className="flex-1 text-lg font-bold truncate">{name || 'Untitled Form'}</h1>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={active}
            onChange={e => setActive(e.target.checked)}
            className="accent-emerald-500"
          />
          <span className={active ? 'text-emerald-400' : 'text-gray-400'}>
            {active ? 'Active' : 'Inactive'}
          </span>
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium rounded"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {error && (
          <div className="px-4 py-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">{error}</div>
        )}
        {savedAt && !error && (
          <div className="px-4 py-2 bg-emerald-900/30 border border-emerald-700 rounded text-emerald-300 text-sm">
            Saved successfully
          </div>
        )}

        {/* Form metadata */}
        <section className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Form Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-900 border border-white/15 rounded px-3 py-2 text-white focus:border-brand focus:outline-none"
              placeholder="e.g. Irrigation Inspection Report"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-gray-900 border border-white/15 rounded px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
              placeholder="Brief description of when this form is used…"
            />
          </div>
        </section>

        {/* Fields */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Fields ({fields.length})
          </h2>
          {fields.length === 0 && (
            <p className="text-sm text-gray-500 mb-3">No fields yet — add your first field below.</p>
          )}
          <div className="space-y-2 mb-4">
            {fields.map((f, i) => (
              <FieldCard
                key={f.id}
                field={f}
                index={i}
                total={fields.length}
                onUpdate={updateField}
                onRemove={removeField}
                onMove={moveField}
              />
            ))}
          </div>

          {/* Add field buttons */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Add a field:</p>
            <div className="flex flex-wrap gap-2">
              {ADD_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addField(t)}
                  className={`text-xs px-2.5 py-1.5 rounded border border-white/15 hover:bg-white/10 font-medium ${TYPE_COLORS[t]}`}
                >
                  + {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* SMS notification template */}
        <section className="border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-1">SMS Notification Template</h2>
          <p className="text-xs text-gray-500 mb-3">
            Sent to the customer after submission. Leave blank to disable.
            Placeholders: <code className="text-sky-400">{'{customer_name}'}</code>{' '}
            <code className="text-sky-400">{'{tech_name}'}</code>{' '}
            <code className="text-sky-400">{'{date}'}</code>{' '}
            <code className="text-sky-400">{'{company_name}'}</code>
          </p>
          <textarea
            value={smsTemplate}
            onChange={e => setSmsTemplate(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full bg-gray-900 border border-white/15 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand focus:outline-none resize-none"
            placeholder="Hi {customer_name}, your service by {tech_name} on {date} is complete…"
          />
          <p className="text-xs text-gray-600 mt-1 text-right">{smsTemplate.length}/2000</p>
        </section>

        <div className="pt-2 pb-8">
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-medium rounded"
          >
            {saving ? 'Saving…' : 'Save Form'}
          </button>
        </div>
      </main>
    </div>
  )
}
