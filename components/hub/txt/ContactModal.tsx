'use client'

import { useState } from 'react'

export type ContactForModal = {
  id: string
  name: string
  phone: string
  email: string | null
  notes: string | null
  do_not_text: boolean
  jobber_client_id: string | null
}

type CreateProps = {
  mode: 'create'
  onClose: () => void
  // Called after save with the resolved conversation id; parent navigates.
  onCreated: (conversationId: string) => void
}

type EditProps = {
  mode: 'edit'
  contact: ContactForModal
  onClose: () => void
  onSaved: (updated: ContactForModal) => void
}

type Props = CreateProps | EditProps

export default function ContactModal(props: Props) {
  const isEdit = props.mode === 'edit'
  const initial = isEdit
    ? props.contact
    : { name: '', phone: '', email: '', notes: '', do_not_text: false }

  const [name, setName] = useState(initial.name)
  const [phone, setPhone] = useState(initial.phone)
  const [email, setEmail] = useState(initial.email ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [doNotText, setDoNotText] = useState(initial.do_not_text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!phone.trim()) {
      setError('Phone is required')
      return
    }
    setSaving(true)
    try {
      if (props.mode === 'create') {
        const res = await fetch('/api/txt/conversations/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            notes: notes.trim() || null,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Save failed')
          setSaving(false)
          return
        }
        props.onCreated(data.conversation_id)
      } else {
        const res = await fetch(`/api/txt/contacts/${props.contact.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            notes: notes.trim() || null,
            do_not_text: doNotText,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Save failed')
          setSaving(false)
          return
        }
        props.onSaved(data.contact)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-[#0F2E47] border border-white/10 rounded-lg w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">
            {isEdit ? 'Edit contact' : 'Add contact'}
          </h2>
          <button
            onClick={props.onClose}
            className="text-white/50 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs text-white/50 block mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              style={{ fontSize: 16 }}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">
              Phone <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(281) 555-1234"
              className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              style={{ fontSize: 16 }}
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              style={{ fontSize: 16 }}
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this contact…"
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30 resize-none"
              style={{ fontSize: 16 }}
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={doNotText}
                onChange={(e) => setDoNotText(e.target.checked)}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-sm">
                Do not text{' '}
                <span className="text-xs text-white/40">
                  (blocks outbound messages)
                </span>
              </span>
            </label>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            disabled={saving}
            className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Add & open'}
          </button>
        </div>
      </div>
    </div>
  )
}
