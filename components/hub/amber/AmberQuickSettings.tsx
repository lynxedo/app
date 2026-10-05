'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Toggle from '@/components/ui/Toggle'
import { VR_LEVELS } from '@/app/hub/admin/ai/ReceptionistPanel'

// Amber's quick settings — the four switches Ben flips most, on the Right Now screen.
//
// Ben, Oct 5 2026: *"a quick way to change some settings so you don't have to go into
// admin"* — receptionist on/off, capability level, reply to texts, who takes transfers.
// These are NOT copies: every control writes the same voice_receptionist_settings row as
// Admin → AI → Receptionist, through the same PATCH route (same can_admin_ai gate as this
// screen), sending ONLY the field that changed so nothing else on the row is touched.
// Everything else (transfer method, cell numbers, greetings, playbook) stays in Admin.
//
// Each control saves the moment it is clicked — no Save button (Ben reads a checkbox that
// flips as "done"; see the Daily Log admin panel for the same pattern).

type Settings = {
  enabled: boolean
  level: number
  plan_max_level: number
  text_enabled: boolean
  transfer_method: string
  transfer_user_ids: string[]
  transfer_cell_numbers: Record<string, string>
}

type Person = { id: string; name: string }

type Status = 'idle' | 'saving' | 'saved' | 'error'

export default function AmberQuickSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  // The checklist batches rapid clicks into one save; the ref holds the latest list
  // because setState is async and the timer fires after several clicks.
  const transferRef = useRef<string[]>([])
  const transferTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/admin/voice-receptionist-settings'),
        fetch('/api/hub/voice-notes'),
      ])
      if (!sRes.ok) {
        setLoadFailed(true)
        return
      }
      const json = (await sRes.json()) as Settings
      const next: Settings = {
        enabled: json.enabled,
        level: json.level,
        plan_max_level: json.plan_max_level,
        text_enabled: json.text_enabled,
        transfer_method: json.transfer_method || 'off',
        transfer_user_ids: json.transfer_user_ids || [],
        transfer_cell_numbers: json.transfer_cell_numbers || {},
      }
      transferRef.current = next.transfer_user_ids
      setS(next)
      if (pRes.ok) setPeople(((await pRes.json()) as { people?: Person[] }).people ?? [])
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (transferTimer.current) clearTimeout(transferTimer.current)
    }
  }, [load])

  async function patch(fields: Record<string, unknown>) {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/voice-receptionist-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Save failed (${res.status})`)
      }
      setStatus('saved')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : "Couldn't save that.")
      // Put the screen back to what is really stored, so a failed save never looks saved.
      await load()
    }
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((p) => (p ? { ...p, [key]: value } : p))
    void patch({ [key]: value })
  }

  function toggleTransfer(id: string) {
    const cur = transferRef.current
    const next = (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]).sort()
    transferRef.current = next
    setS((p) => (p ? { ...p, transfer_user_ids: next } : p))
    setStatus('saving')
    if (transferTimer.current) clearTimeout(transferTimer.current)
    transferTimer.current = setTimeout(() => {
      void patch({ transfer_user_ids: transferRef.current })
    }, 500)
  }

  if (!s) {
    return (
      <section className="mb-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-500">
          {loadFailed ? "Couldn't load Amber's settings. Refresh the page to try again." : 'Loading Amber’s settings…'}
        </div>
      </section>
    )
  }

  // Why a ticked person might not actually get rung — said plainly next to the list,
  // because the list itself saves fine either way.
  const transferNote =
    s.level === 1
      ? 'Level 1 only takes messages — she won’t transfer anyone until you pick Level 2 or higher.'
      : s.level >= 5
        ? 'Level 5 routes calls with Call routing in Admin → AI → Receptionist, not this list.'
        : s.transfer_method === 'off'
          ? 'Transfers are turned off. Turn them on in Admin → AI → Receptionist.'
          : s.transfer_method === 'softphone'
            ? 'Rings the Dialer for the people ticked here who are logged in.'
            : 'Rings the cell of each person ticked here, one at a time.'
  const missingCell =
    s.transfer_method === 'cell'
      ? s.transfer_user_ids.filter((id) => !s.transfer_cell_numbers[id])
      : []
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone'

  return (
    <section className="mb-6">
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">Quick settings</h2>
          <span className={`text-xs ${status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
            {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : status === 'error' ? 'Not saved' : ''}
          </span>
        </div>

        <div className="mt-4 divide-y divide-gray-800">
          <Row title="Answers calls" hint="Off sends missed and after-hours calls to regular voicemail.">
            <Toggle checked={s.enabled} onChange={(v) => set('enabled', v)} label="Answers calls" />
          </Row>

          <Row title="Level" hint={VR_LEVELS.find((l) => l.level === s.level)?.blurb}>
            <select
              value={s.level}
              onChange={(e) => set('level', Number(e.target.value))}
              className="w-56 max-w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white focus:border-gray-500 focus:outline-none"
            >
              {VR_LEVELS.map((l) => (
                <option key={l.level} value={l.level} disabled={Boolean(l.comingSoon) || l.level > s.plan_max_level}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>

          <Row title="Replies to texts" hint="Answers texts on threads nobody has claimed.">
            <Toggle checked={s.text_enabled} onChange={(v) => set('text_enabled', v)} label="Replies to texts" />
          </Row>

          <div className="py-3">
            <p className="text-sm text-white">Who takes transfers</p>
            <p className="mt-0.5 text-xs text-gray-500">{transferNote}</p>
            {people.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">No people found.</p>
            ) : (
              <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {people.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={s.transfer_user_ids.includes(p.id)}
                      onChange={() => toggleTransfer(p.id)}
                      className="accent-brand"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            {missingCell.length > 0 && (
              <p className="mt-2 text-xs text-amber-300">
                No cell number saved for {missingCell.map(nameOf).join(', ')} — add it in Admin → AI → Receptionist, or
                they won’t be rung.
              </p>
            )}
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <p className="mt-2 text-xs text-gray-600">
          Same settings as Admin → AI → Receptionist. Takes effect on her next call.
        </p>
      </div>
    </section>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-white">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
