'use client'

// Work Orders Phase 3 — the office's Report text: for each treatment, what it
// does and how to care for the lawn afterwards, in the customer's words. A tech's
// after-service report copies the matching text in when it is saved (a later
// edit here never changes a report already sent). Customers never see product
// names (Ben, Oct 5 2026) — this text is what they read instead.

import { useCallback, useEffect, useState } from 'react'

type Text = {
  id: string
  service_name: string
  round_label: string | null
  description: string
  care: string
  is_active: boolean
  /** Null until someone edits it — the seeded starter text. */
  updated_by: string | null
}
type Service = { name: string; rounds: string[] }
type Draft = { id?: string; service_name: string; round_label: string; description: string; care: string; is_active: boolean }

const inp = 'w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30 text-base md:text-sm'

export default function WorkOrderReportTexts() {
  const [texts, setTexts] = useState<Text[] | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/hub/work-orders/report-texts', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok) { setError(j.error ?? 'Could not load'); return }
    setTexts(j.texts)
    setServices(j.services)
  }, [])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editing || saving) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/hub/work-orders/report-texts', {
        method: editing.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? 'Could not save'); return }
      setEditing(null)
      await load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this text? Reports already saved keep their copy.')) return
    await fetch(`/api/hub/work-orders/report-texts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await load()
  }

  async function toggle(t: Text) {
    await fetch('/api/hub/work-orders/report-texts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
    })
    await load()
  }

  const roundsFor = (name: string) => {
    const n = name.trim().toLowerCase()
    if (!n) return []
    const out = new Set<string>()
    for (const s of services) if (s.name.toLowerCase().includes(n)) for (const r of s.rounds) out.add(r)
    return Array.from(out).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        What a customer reads on their after-service report. For each service, write <strong className="text-gray-200">what the treatment does</strong> and
        the <strong className="text-gray-200">care instructions</strong>. Customers never see product names. Leave the round empty to use the text for every
        round, or add text for one round (from Service Mapping) to say something different that time of year. The service name only has to be
        part of the Jobber line item: “Lawn Health Basic” matches “WF - Lawn Health Basic”.
      </p>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded px-3 py-2 text-sm">{error}</div>}

      {editing ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Service</span>
              <input list="asr-services" value={editing.service_name} onChange={e => setEditing({ ...editing, service_name: e.target.value })}
                placeholder="e.g. Lawn Health Basic" className={inp} />
              <datalist id="asr-services">
                {services.map(s => <option key={s.name} value={s.name} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Round (optional)</span>
              <select value={editing.round_label} onChange={e => setEditing({ ...editing, round_label: e.target.value })} className={inp}>
                <option value="">Every round</option>
                {roundsFor(editing.service_name).map(r => <option key={r} value={r}>{r}</option>)}
                {editing.round_label && !roundsFor(editing.service_name).includes(editing.round_label) && <option value={editing.round_label}>{editing.round_label}</option>}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">What the treatment does</span>
            <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={4}
              placeholder="In plain words — no product names." className={`${inp} resize-y`} />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Care instructions</span>
            <textarea value={editing.care} onChange={e => setEditing({ ...editing, care: e.target.value })} rows={4}
              placeholder="Watering, mowing, keeping kids and pets off until dry…" className={`${inp} resize-y`} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(null); setError(null) }} className="px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-gray-300">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing({ service_name: '', round_label: '', description: '', care: '', is_active: true })}
          className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm text-white">+ Add text</button>
      )}

      {!texts ? <div className="text-sm text-gray-500">Loading…</div> : texts.length === 0 ? (
        <div className="text-sm text-gray-500">No report text yet.</div>
      ) : (
        <div className="space-y-2">
          {texts.map(t => (
            <div key={t.id} className={`rounded-lg border border-white/10 p-3 ${t.is_active ? 'bg-white/[0.03]' : 'opacity-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {t.service_name} <span className="text-gray-400 font-normal">· {t.round_label || 'Every round'}</span>
                  </div>
                  {!t.updated_by && <div className="text-[11px] text-amber-300">Starter text — please review and rewrite</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <button type="button" onClick={() => toggle(t)} className="text-gray-400 hover:text-white">{t.is_active ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" onClick={() => setEditing({ id: t.id, service_name: t.service_name, round_label: t.round_label ?? '', description: t.description, care: t.care, is_active: t.is_active })}
                    className="text-sky-300 hover:text-sky-200">Edit</button>
                  <button type="button" onClick={() => remove(t.id)} className="text-red-300 hover:text-red-200">Delete</button>
                </div>
              </div>
              {t.description && <p className="text-sm text-gray-300 mt-1.5 whitespace-pre-wrap">{t.description}</p>}
              {t.care && <p className="text-[13px] text-gray-500 mt-1 whitespace-pre-wrap"><span className="text-gray-400">Care: </span>{t.care}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
