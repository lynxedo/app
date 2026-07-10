'use client'

import { useEffect, useState } from 'react'

// Shared "Add to Lead Tracker" modal, launched from a Txt conversation header and
// from a Call Log entry. Pre-fills the contact fields, generates/receives a first
// note, and creates a lead via POST /api/tracker/leads/from-source.
//
//  • Calls pass a ready-made `note` (built from the call's existing AI summary).
//  • Texts pass `draftNoteConversationId` and the modal fetches an AI summary.
//
// On open it first checks whether this source already has a lead; if so it shows a
// "already in the Lead Tracker" state instead of the form (no duplicates).

type Stage = { key: string; label: string }

type Prefill = {
  name?: string
  phone?: string
  email?: string
  serviceAddress?: string
  note?: string
}

type Props = {
  sourceType: 'txt' | 'call'
  sourceId: string
  prefill: Prefill
  /** Txt only: fetch an AI-suggested note from this conversation when the modal opens. */
  draftNoteConversationId?: string
  onClose: () => void
  /** Fired when this source is linked to a lead (freshly created OR already existed). */
  onLinked: (leadId: string) => void
}

export default function AddToTrackerModal({
  sourceType,
  sourceId,
  prefill,
  draftNoteConversationId,
  onClose,
  onLinked,
}: Props) {
  const [name, setName] = useState(prefill.name ?? '')
  const [phone, setPhone] = useState(prefill.phone ?? '')
  const [email, setEmail] = useState(prefill.email ?? '')
  const [address, setAddress] = useState(prefill.serviceAddress ?? '')
  const [note, setNote] = useState(prefill.note ?? '')
  const [stages, setStages] = useState<Stage[]>([])
  const [stage, setStage] = useState('current')
  const [noteLoading, setNoteLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [existingLeadId, setExistingLeadId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function init() {
      // 1) Already in the tracker? → short-circuit to the "existing" state.
      try {
        const res = await fetch(
          `/api/tracker/leads/from-source?source_type=${sourceType}&source_id=${encodeURIComponent(sourceId)}`,
        )
        const data = await res.json()
        if (!cancelled && res.ok && data.lead_id) {
          setExistingLeadId(data.lead_id)
          setChecking(false)
          return
        }
      } catch {
        /* fall through to the create form */
      }
      if (cancelled) return
      setChecking(false)

      // 2) Stage options for the dropdown.
      fetch('/api/tracker/stages')
        .then((r) => r.json())
        .then((rows) => {
          if (cancelled || !Array.isArray(rows)) return
          const opts: Stage[] = rows.map((r: { key: string; label: string }) => ({
            key: r.key,
            label: r.label,
          }))
          setStages(opts)
          if (opts.length && !opts.some((o) => o.key === 'current')) setStage(opts[0].key)
        })
        .catch(() => {})

      // 3) Texts only: suggest a first note (calls already pass one in).
      if (draftNoteConversationId && !(prefill.note && prefill.note.trim())) {
        setNoteLoading(true)
        try {
          const r = await fetch('/api/tracker/leads/draft-note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: draftNoteConversationId }),
          })
          const d = await r.json()
          if (!cancelled && d.note) setNote(d.note)
        } catch {
          /* leave the note blank */
        }
        if (!cancelled) setNoteLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setError('')
    if (!name.trim() && !phone.trim()) {
      setError('A name or phone is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/tracker/leads/from-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId,
          name: name.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          service_address: address.trim() || null,
          stage,
          note: note.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.lead_id) {
        setError(data.error || 'Could not add to the Lead Tracker')
        setSaving(false)
        return
      }
      onLinked(data.lead_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setSaving(false)
    }
  }

  const hasStage = stages.some((s) => s.key === stage)

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-[var(--t-panel)] border border-white/10 rounded-lg w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">Add to Lead Tracker</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>

        {checking ? (
          <div className="p-6 text-sm text-white/50">Checking…</div>
        ) : existingLeadId ? (
          <>
            <div className="p-4">
              <p className="text-sm text-white/80">
                This {sourceType === 'txt' ? 'conversation' : 'call'} is already in the Lead Tracker.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
              >
                Close
              </button>
              <a
                href="/hub/tracker"
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
              >
                View in Lead Tracker
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 space-y-3 overflow-y-auto">
              <div>
                <label className="text-xs text-white/50 block mb-1">Name</label>
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
                <label className="text-xs text-white/50 block mb-1">Phone</label>
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
                <label className="text-xs text-white/50 block mb-1">Service address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, The Woodlands"
                  className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
                  style={{ fontSize: 16 }}
                />
              </div>

              <div>
                <label className="text-xs text-white/50 block mb-1">Stage</label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm"
                  style={{ fontSize: 16 }}
                >
                  {!hasStage && (
                    <option value={stage}>{stage === 'current' ? 'Current' : stage}</option>
                  )}
                  {stages.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-white/50 block mb-1">
                  First note
                  {noteLoading && <span className="text-white/30"> · generating summary…</span>}
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={5}
                  placeholder={
                    noteLoading ? 'Summarizing the conversation…' : 'What does this lead want? (optional)'
                  }
                  className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30 resize-none"
                  style={{ fontSize: 16 }}
                />
              </div>

              <p className="text-[11px] text-white/40">
                Lead Source is left blank — set it in the Lead Tracker if you know it.
              </p>

              {error && <div className="text-xs text-[var(--t-tint-danger)]">{error}</div>}
            </div>

            <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
              <button
                onClick={onClose}
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
                {saving ? 'Adding…' : 'Add to Lead Tracker'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
