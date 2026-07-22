'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Form, FormField } from '@/lib/forms'
import { useConfirm, Spinner, EmptyState } from '@/components/ui'

export default function FormsAdminPanel() {
  const router = useRouter()
  const confirmDialog = useConfirm()
  const [forms, setForms] = useState<Form[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/forms')
      .then(r => r.json())
      .then(d => { setForms(d.forms ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  async function createForm(template?: string) {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template ? { template } : { name: 'New Form' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/hub/admin/forms/${data.form.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create form')
      setCreating(false)
    }
  }

  async function toggleActive(form: Form) {
    setForms(prev => prev.map(f => f.id === form.id ? { ...f, active: !f.active } : f))
    try {
      const res = await fetch(`/api/admin/forms/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !form.active }),
      })
      if (!res.ok) {
        // Revert on failure
        setForms(prev => prev.map(f => f.id === form.id ? { ...f, active: form.active } : f))
      }
    } catch {
      setForms(prev => prev.map(f => f.id === form.id ? { ...f, active: form.active } : f))
    }
  }

  async function deleteForm(id: string, name: string) {
    if (!(await confirmDialog({ message: `Delete "${name}"? All submissions for this form will also be deleted. This cannot be undone.`, danger: true }))) return
    setForms(prev => prev.filter(f => f.id !== id))
    try {
      await fetch(`/api/admin/forms/${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-3 border-b border-white/10 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">Form Builder</h1>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => createForm('irrigation')}
            disabled={creating}
            className="px-3 py-1.5 text-sm bg-sky-700 hover:bg-sky-600 text-[#fff] rounded font-medium disabled:opacity-50"
          >
            + Irrigation Inspection
          </button>
          <button
            onClick={() => createForm()}
            disabled={creating}
            className="px-3 py-1.5 text-sm bg-indigo-700 hover:bg-indigo-600 text-[#fff] rounded font-medium disabled:opacity-50"
          >
            + Blank Form
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center"><Spinner size={6} /></div>
        ) : forms.length === 0 ? (
          <EmptyState
            size="lg"
            title="No forms yet."
            hint="Create an Irrigation Inspection form to get started, or build a blank one from scratch."
          />
        ) : (
          <div className="space-y-3">
            {forms.map(form => {
              const fieldCount = (form.fields as FormField[]).filter(f => f.type !== 'section_title').length
              return (
                <div
                  key={form.id}
                  className="bg-gray-900 border border-white/10 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white">{form.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          form.active
                            ? 'bg-emerald-900/50 text-emerald-300'
                            : 'bg-gray-800 text-gray-400'
                        }`}>
                          {form.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {form.description && (
                        <p className="text-sm text-gray-400 mt-0.5">{form.description}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">{fieldCount} field{fieldCount !== 1 ? 's' : ''}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleActive(form)}
                        className="text-xs px-2.5 py-1.5 rounded border border-white/20 text-gray-300 hover:bg-white/10"
                      >
                        {form.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => router.push(`/hub/admin/forms/${form.id}`)}
                        className="text-xs px-2.5 py-1.5 rounded bg-brand hover:bg-brand-hover text-[#fff] font-medium"
                      >
                        Build
                      </button>
                      <button
                        onClick={() => deleteForm(form.id, form.name)}
                        className="text-xs px-2.5 py-1.5 rounded border border-red-800 text-red-400 hover:bg-red-900/30"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
