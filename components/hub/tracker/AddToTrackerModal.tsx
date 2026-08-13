'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Shared "Add to Lead Tracker" modal, launched from a Txt conversation header and
// from a Call Log entry. Pre-fills the contact fields, generates/receives a first
// note, and creates a lead via POST /api/tracker/leads/from-source.
//
//  • Calls pass a ready-made `note` (built from the call's existing AI summary).
//  • Texts pass `draftNoteConversationId` and the modal fetches an AI summary.
//
// On open it checks whether this source already produced a lead:
//
//   • no prior lead        → the form, as always.
//   • prior lead CLOSED    → the form, with a line saying so. A returning customer
//                            texting the same (permanent) thread about a new job
//                            is the normal case, not a mistake.
//   • prior lead still OPEN → a warning, because you'd be duplicating live work —
//                            but with "Add another anyway", never a dead end.
//
// Reaching the form despite a prior lead sends force:true, so the server only
// short-circuits on an unforced add (which is what still collapses double-clicks).

type Stage = { key: string; label: string }

type PriorLead = { id: string; stage: string | null; closed: boolean }

// Stage keys are admin-editable, so fall back to the raw key rather than
// inventing a label the tracker doesn't use.
function stageLabel(stages: Stage[], key: string | null): string | null {
  if (!key) return null
  return stages.find((s) => s.key === key)?.label ?? key
}

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
  const [priorLead, setPriorLead] = useState<PriorLead | null>(null)
  // Only an OPEN prior lead gates the form; "Add another anyway" clears it.
  const [gated, setGated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Texts only: suggest a first note (calls already pass one in). Deliberately
  // NOT run while gated — it's a Claude call, and someone who opens the modal on
  // an already-tracked thread usually just closes it. "Add another anyway" runs
  // it then, which is the first moment we know a note will actually be used.
  const loadDraftNote = useCallback(async () => {
    if (!draftNoteConversationId) return
    if (prefill.note && prefill.note.trim()) return
    setNoteLoading(true)
    try {
      const r = await fetch('/api/tracker/leads/draft-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: draftNoteConversationId }),
      })
      const d = await r.json()
      if (alive.current && d.note) setNote(d.note)
    } catch {
      /* leave the note blank */
    }
    if (alive.current) setNoteLoading(false)
  }, [draftNoteConversationId, prefill.note])

  useEffect(() => {
    let cancelled = false
    async function init() {
      // 1) Did this source already produce a lead? An open one gates the form;
      //    a closed one is just noted, since that's the returning-customer case.
      let openPrior = false
      try {
        const res = await fetch(
          `/api/tracker/leads/from-source?source_type=${sourceType}&source_id=${encodeURIComponent(sourceId)}`,
        )
        const data = await res.json()
        if (!cancelled && res.ok && data.lead_id) {
          setPriorLead({ id: data.lead_id, stage: data.stage ?? null, closed: !!data.closed })
          openPrior = !data.closed
          setGated(openPrior)
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

      if (!openPrior) await loadDraftNote()
    }
    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addAnother() {
    setGated(false)
    void loadDraftNote()
  }

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
          // The user has seen that a prior lead exists and still chose to add.
          // Without this an open prior short-circuits — which is what keeps a
          // double-click from producing two cards.
          force: !!priorLead,
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
        ) : gated ? (
          <>
            <div className="p-4 space-y-2">
              <p className="text-sm text-white/80">
                This {sourceType === 'txt' ? 'conversation' : 'call'} already has an open lead in
                the Lead Tracker
                {stageLabel(stages, priorLead?.stage ?? null)
                  ? ` (${stageLabel(stages, priorLead?.stage ?? null)})`
                  : ''}
                .
              </p>
              <p className="text-xs text-white/50">
                If this is a new job for the same customer, you can still add a second lead.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-white/10 flex flex-wrap justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
              >
                Close
              </button>
              <button
                onClick={addAnother}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
              >
                Add another anyway
              </button>
              <a
                href="/hub/tracker/leads"
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
              >
                View in Lead Tracker
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 space-y-3 overflow-y-auto">
              {priorLead && (
                <div className="rounded-md bg-white/5 border border-white/10 px-3 py-2 text-xs text-white/60">
                  {priorLead.closed ? (
                    <>
                      This {sourceType === 'txt' ? 'conversation' : 'call'} was already a lead
                      {stageLabel(stages, priorLead.stage)
                        ? ` (${stageLabel(stages, priorLead.stage)})`
                        : ''}
                      . This adds a new one.
                    </>
                  ) : (
                    <>Adding a second lead for this {sourceType === 'txt' ? 'conversation' : 'call'}.</>
                  )}
                </div>
              )}
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
