'use client'

import { useState } from 'react'
import TxtContactMultiPicker from './TxtContactMultiPicker'

// New group conversation modal (Beta: txt_groups). Picks 2–9 contacts,
// optional friendly name. POSTs /api/txt/conversations/start-group; on success
// navigates to the new conversation page. Backed by TRUE Group MMS (projected
// address on our long code) — everyone in the group sees everyone's messages
// and numbers, like a native phone group text; a member's 1:1 texts to us stay
// in their own thread. Max 9 contacts (Twilio caps Group MMS at 10 total
// participants incl. our number); US/Canada mobile phones only.
const MAX_GROUP_CONTACTS = 9

export default function TxtGroupComposer({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    if (selected.length < 2 || selected.length > MAX_GROUP_CONTACTS || submitting) return
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/txt/conversations/start-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: selected, name: name.trim() || undefined }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok || !data.conversation_id) {
      setError(data.error || 'Group create failed')
      return
    }
    window.location.href = `/hub/txt/${data.conversation_id}`
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-stretch sm:items-center justify-center sm:px-4">
      <div className="bg-[var(--t-panel)] border border-white/10 sm:rounded-lg w-full h-full sm:h-auto sm:max-w-md sm:max-h-[85vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">New group conversation</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3 flex-1 flex flex-col min-h-0">
          <div>
            <label className="text-xs text-white/50 block mb-1">
              Group name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Smith property"
              className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              style={{ fontSize: 16 }}
            />
          </div>
          <div className="text-xs text-white/50">
            A real group text: <span className="text-white/70">everyone in the group sees everyone&apos;s
            messages and phone numbers</span>, and their replies go to the whole group — just like a
            group text on your phone. Their separate 1-on-1 texts with us stay private. Pick 2–9
            contacts (US/Canada cell phones; do-not-text contacts can&apos;t be added). Sends from our
            main number.
          </div>
          {/* overflow-hidden: belt-and-suspenders so the contact list can never
              paint over the Cancel / Create footer if flex sizing misbehaves. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TxtContactMultiPicker
              selectedIds={selected}
              onChange={setSelected}
              emptyHint="No contacts available. Add one from the sidebar first."
            />
          </div>
          {error && <div className="text-xs text-[var(--t-tint-danger)]">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/40">
            {selected.length < 2
              ? `Select ${2 - selected.length} more`
              : selected.length > MAX_GROUP_CONTACTS
              ? `Max ${MAX_GROUP_CONTACTS} — remove ${selected.length - MAX_GROUP_CONTACTS}`
              : `${selected.length} of ${MAX_GROUP_CONTACTS} contacts`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={create}
              disabled={selected.length < 2 || selected.length > MAX_GROUP_CONTACTS || submitting}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
            >
              {submitting ? '…' : 'Create group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
