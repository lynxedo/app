'use client'

import { useEffect, useState } from 'react'
import type {
  RoutingDestKind,
  RoutingEntryKind,
  RoutingEntryRow,
  TransferMissBehavior,
} from '@/lib/voice-routing'

// Admin config for the AI Receptionist's Level 5 frontline routing. At Level 5
// the receptionist answers EVERY call as the front door (replacing the IVR); to
// get callers to the right person/department she reads this routing directory.
// Self-fetches its config + the destination catalogs (ring groups + Hub users)
// on mount from /api/admin/voice-routing, so it's gated purely on the AI admin
// area. Live frontline behavior activates at Level 5 (coming soon); this just
// holds the directory + two settings.

type EntryForm = {
  label: string
  kind: RoutingEntryKind
  description: string
  dest_kind: RoutingDestKind
  dest_value: string
  enabled: boolean
}

type RingGroup = { id: string; name: string }
type UserOpt = { id: string; full_name: string | null; dialer_extension: string | null }

const DEST_LABELS: Record<RoutingDestKind, string> = {
  user: 'A person (their softphone)',
  cell: 'A cell number',
  ring_group: 'A ring group',
  extension: 'An extension',
  voicemail: 'Company voicemail',
}

const MISS_LABELS: Record<TransferMissBehavior, { title: string; blurb: string }> = {
  offer_callback: {
    title: 'Keep helping / offer a callback',
    blurb: 'She returns to the caller, keeps helping if she can (answer, sell, book), otherwise promises a callback and takes a detailed message.',
  },
  message: { title: 'Take a message', blurb: 'She takes a message and ends warmly.' },
  voicemail: { title: 'Company voicemail', blurb: 'She sends the caller to the company voicemail.' },
}

const newEntry = (): EntryForm => ({
  label: '',
  kind: 'person',
  description: '',
  dest_kind: 'user',
  dest_value: '',
  enabled: true,
})

const toForm = (r: RoutingEntryRow): EntryForm => ({
  label: r.label,
  kind: r.kind,
  description: r.description,
  dest_kind: r.dest_kind,
  dest_value: r.dest_value,
  enabled: r.enabled,
})

const inputCls =
  'bg-white/5 border border-white/10 rounded px-2.5 py-1 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500'

const userLabel = (u: UserOpt) => u.full_name?.trim() || 'Unnamed user'

export default function RoutingPanel() {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [entries, setEntries] = useState<EntryForm[]>([])
  const [escapeRingGroup, setEscapeRingGroup] = useState('')
  const [missBehavior, setMissBehavior] = useState<TransferMissBehavior>('offer_callback')
  const [ringGroups, setRingGroups] = useState<RingGroup[]>([])
  const [users, setUsers] = useState<UserOpt[]>([])
  const [snapshot, setSnapshot] = useState('')

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const snap = (en: EntryForm[], esc: string, miss: TransferMissBehavior) =>
    JSON.stringify({ entries: en, escape: esc, miss })
  const dirty = snap(entries, escapeRingGroup, missBehavior) !== snapshot

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/voice-routing')
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `Load failed (${res.status})`)
        if (!alive) return
        const en = (data.directory as RoutingEntryRow[]).map(toForm)
        const esc = (data.escape_ring_group as string | null) ?? ''
        const miss = (data.transfer_miss_behavior as TransferMissBehavior) ?? 'offer_callback'
        setEntries(en)
        setEscapeRingGroup(esc)
        setMissBehavior(miss)
        setRingGroups((data.ring_groups as RingGroup[]) ?? [])
        setUsers((data.users as UserOpt[]) ?? [])
        setSnapshot(snap(en, esc, miss))
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const update = (i: number, patch: Partial<EntryForm>) =>
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const removeEntry = (i: number) => setEntries((prev) => prev.filter((_, idx) => idx !== i))
  const addEntry = () => setEntries((prev) => [...prev, newEntry()])

  // When the destination kind changes, clear the value so a stale id/number
  // from the previous kind can't be saved against the new kind.
  const setDestKind = (i: number, dest_kind: RoutingDestKind) =>
    update(i, { dest_kind, dest_value: '' })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/voice-routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directory: entries,
          escape_ring_group: escapeRingGroup,
          transfer_miss_behavior: missBehavior,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`)
      const en = (data.directory as RoutingEntryRow[]).map(toForm)
      const esc = (data.escape_ring_group as string | null) ?? ''
      const miss = (data.transfer_miss_behavior as TransferMissBehavior) ?? 'offer_callback'
      setEntries(en)
      setEscapeRingGroup(esc)
      setMissBehavior(miss)
      setSnapshot(snap(en, esc, miss))
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const revert = () => {
    try {
      const s = JSON.parse(snapshot) as { entries: EntryForm[]; escape: string; miss: TransferMissBehavior }
      setEntries(s.entries)
      setEscapeRingGroup(s.escape)
      setMissBehavior(s.miss)
      setError(null)
    } catch {
      /* no snapshot yet */
    }
  }

  // The value input for an entry depends on its destination kind.
  const renderDestValue = (e: EntryForm, i: number) => {
    switch (e.dest_kind) {
      case 'voicemail':
        return <p className="text-xs text-white/40 pt-1.5">Goes to the company voicemail box.</p>
      case 'user':
        return (
          <select value={e.dest_value} onChange={(ev) => update(i, { dest_value: ev.target.value })} className={`${inputCls} w-full`}>
            <option value="">— choose a person —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        )
      case 'extension':
        return (
          <select value={e.dest_value} onChange={(ev) => update(i, { dest_value: ev.target.value })} className={`${inputCls} w-full`}>
            <option value="">— choose an extension —</option>
            {users
              .filter((u) => u.dialer_extension)
              .map((u) => (
                <option key={u.id} value={u.dialer_extension!}>
                  {u.dialer_extension} · {userLabel(u)}
                </option>
              ))}
          </select>
        )
      case 'ring_group':
        return (
          <select value={e.dest_value} onChange={(ev) => update(i, { dest_value: ev.target.value })} className={`${inputCls} w-full`}>
            <option value="">— choose a ring group —</option>
            {ringGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )
      case 'cell':
        return (
          <input
            type="tel"
            value={e.dest_value}
            onChange={(ev) => update(i, { dest_value: ev.target.value })}
            placeholder="+18325551234"
            className={`${inputCls} w-full`}
          />
        )
    }
  }

  return (
    <section className="border border-white/10 rounded-lg p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Call routing (frontline)</h2>
        <p className="text-xs text-white/50 mt-0.5">
          Who and what the receptionist can send callers to. Each entry has a name, a plain-English note about what they
          handle (she uses it to route), and where the call goes.
        </p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/60 leading-relaxed">
        These are the people and departments the <strong>frontline receptionist</strong> (Level&nbsp;5) can send callers to.
        When a caller asks for someone by name or a department, she matches what they say against the notes below and connects
        them. Leave an entry off, or with no one available, and she takes a message instead.
      </div>

      {loading ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : loadErr ? (
        <p className="text-xs text-red-400">{loadErr}</p>
      ) : (
        <>
          {/* Directory entries */}
          <div className="space-y-3">
            {entries.length === 0 && (
              <p className="text-xs text-white/40">No routing entries yet. Add the people and departments callers ask for.</p>
            )}
            {entries.map((e, i) => (
              <div key={i} className="border border-white/10 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={e.label}
                    onChange={(ev) => update(i, { label: ev.target.value })}
                    placeholder="Name or department (e.g. Kathryn, Billing)"
                    className={`${inputCls} flex-1 min-w-0`}
                  />
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                      <input type="checkbox" checked={e.enabled} onChange={() => update(i, { enabled: !e.enabled })} className="accent-brand" />
                      On
                    </label>
                    <button type="button" onClick={() => removeEntry(i)} aria-label="Remove entry" className="text-white/40 hover:text-red-400 text-lg leading-none">
                      ×
                    </button>
                  </div>
                </div>

                {/* Person vs department */}
                <div className="flex gap-2">
                  {(['person', 'department'] as RoutingEntryKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => update(i, { kind: k })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        e.kind === k ? 'border-brand bg-brand/10 text-white' : 'border-white/10 hover:border-white/25 text-white/70'
                      }`}
                    >
                      {k === 'person' ? 'Person' : 'Department'}
                    </button>
                  ))}
                </div>

                {/* Triage description */}
                <label className="block">
                  <span className="text-xs text-white/50 block mb-1">What they handle (the receptionist reads this to route)</span>
                  <textarea
                    value={e.description}
                    onChange={(ev) => update(i, { description: ev.target.value })}
                    placeholder="e.g. Billing questions, invoices, and payments"
                    rows={2}
                    className={`${inputCls} w-full resize-y`}
                  />
                </label>

                {/* Destination */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-white/50 block mb-1">Send the call to</span>
                    <select value={e.dest_kind} onChange={(ev) => setDestKind(i, ev.target.value as RoutingDestKind)} className={`${inputCls} w-full`}>
                      {(Object.keys(DEST_LABELS) as RoutingDestKind[]).map((k) => (
                        <option key={k} value={k}>
                          {DEST_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="block">
                    <span className="text-xs text-white/50 block mb-1">&nbsp;</span>
                    {renderDestValue(e, i)}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addEntry}
              className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs font-medium text-white/80"
            >
              + Add entry
            </button>
          </div>

          {/* Escape / bypass ring group */}
          <div className="border border-white/10 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-white">If a caller wants a person, not the AI</p>
            <p className="text-xs text-white/50">
              Callers who ask to skip the receptionist ring this group, just like your phone menu today. No answer → your
              company voicemail. Leave blank to keep them with the receptionist.
            </p>
            <select value={escapeRingGroup} onChange={(e) => setEscapeRingGroup(e.target.value)} className={`${inputCls} w-full max-w-sm`}>
              <option value="">— none (stay with the receptionist) —</option>
              {ringGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Transfer-miss behavior */}
          <div className="border border-white/10 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-white">If a transfer isn&apos;t answered</p>
            <p className="text-xs text-white/50">What the receptionist does when she tries to reach someone and nobody picks up.</p>
            <div className="space-y-2 pt-1">
              {(Object.keys(MISS_LABELS) as TransferMissBehavior[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMissBehavior(k)}
                  className={`w-full text-left border rounded-lg p-2.5 transition-colors ${
                    missBehavior === k ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/25'
                  }`}
                >
                  <p className="text-sm font-medium text-white">{MISS_LABELS[k].title}</p>
                  <p className="text-xs text-white/50 mt-0.5">{MISS_LABELS[k].blurb}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Save / Revert */}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving || !dirty} className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium">
              {saving ? 'Saving…' : 'Save routing'}
            </button>
            <button onClick={revert} disabled={saving || !dirty} className="px-4 py-2 rounded border border-white/15 hover:border-white/30 disabled:opacity-40 text-sm font-medium text-white/80">
              Revert
            </button>
            {dirty && !error && <span className="text-xs text-amber-300/80">Unsaved changes</span>}
            {!dirty && savedAt && !error && <span className="text-xs text-emerald-300">Saved ✓</span>}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </>
      )}
    </section>
  )
}
