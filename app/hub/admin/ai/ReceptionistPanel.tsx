'use client'

import { useEffect, useState } from 'react'

// AI Voice Receptionist — stored form values + code/env defaults.
type VoiceReceptionistInitial = {
  enabled: boolean
  level: number
  plan_max_level: number
  receptionist_name: string
  greeting_business_hours: string
  greeting_after_hours: string
  instructions: string
  voice_id: string
  recap_text_enabled: boolean
  transfer_method: string
  transfer_user_ids: string[]
  transfer_cell_numbers: Record<string, string>
  title_service_map: { match: string; say: string }[]
  receptionist_name_default: string
  greeting_business_hours_default: string
  greeting_after_hours_default: string
  instructions_default: string
  voice_id_default: string
  title_service_map_default: { match: string; say: string }[]
}

// Capability ladder (Ben's product tiers). Levels 1–4 answer only missed /
// after-hours calls; Level 5 (frontline) answers EVERY call as the front desk.
// At SaaS time levels above the plan cap render locked with an upgrade nudge.
const VR_LEVELS: { level: number; name: string; blurb: string; comingSoon?: boolean }[] = [
  { level: 1, name: 'Level 1 — Message taker', blurb: 'A friendly voicemail replacement: collects name, number, and reason, then promises a callback. Politely deflects all questions.' },
  { level: 2, name: 'Level 2 — Conversational', blurb: 'Warm and human — brief small talk, answers approved basics, and talks the company up. Promotes any free/no-obligation offer. Never states pricing.' },
  { level: 3, name: 'Level 3 — Soft sell', blurb: 'Conversational plus: states approved fixed pricing, asks qualifying questions, and works an assumptive soft close. A human specialist still confirms.' },
  { level: 4, name: 'Level 4 — Full receptionist', blurb: 'Everything in Level 3, plus live scheduling — checks availability and books appointments. Set up Scheduling below. Answers missed / after-hours calls only.' },
  { level: 5, name: 'Level 5 — Frontline receptionist', blurb: 'Answers EVERY call as your front desk (replaces a phone menu): greets, figures out who they need, and routes them to the right person or department — and can still sell + book like Level 4. Set up Call routing below.' },
]

// Transfer methods. Admin picks one; recipients are Hub users (checkbox list).
// The 'cell' method also needs a phone number per recipient (entered below).
const TRANSFER_METHODS: { value: string; name: string; blurb: string; comingSoon?: boolean }[] = [
  { value: 'off', name: 'Off', blurb: 'No live transfer — Amber takes a message or offers voicemail.' },
  { value: 'softphone', name: 'Ring the Dialer softphone', blurb: 'Rings the Dialer app for the selected people who are logged in; whoever answers first takes the call.' },
  { value: 'cell', name: 'Ring a cell + press 1', blurb: 'Calls the selected people on their cell, one at a time, with a quick “press 1 to take it” screen. Enter each person’s number below.' },
]

export default function ReceptionistPanel({
  initialVoiceReceptionist,
  people,
  onLevelChange,
}: {
  initialVoiceReceptionist: VoiceReceptionistInitial
  people: { id: string; display_name: string }[]
  // Notifies the parent shell of the currently-selected level so it can show
  // only the sections that level uses (Scheduling at 4+, Call routing at 5).
  onLevelChange?: (level: number) => void
}) {
  // Generic (SaaS-neutral) code/env defaults for each editable box. Editing a box
  // back to exactly its default saves as blank, so the field keeps tracking the
  // built-in default; anything else is saved as a company customization.
  const DEFAULTS = {
    receptionist_name: initialVoiceReceptionist.receptionist_name_default,
    greeting_business_hours: initialVoiceReceptionist.greeting_business_hours_default,
    greeting_after_hours: initialVoiceReceptionist.greeting_after_hours_default,
    instructions: initialVoiceReceptionist.instructions_default,
    voice_id: initialVoiceReceptionist.voice_id_default,
  }

  // The form shows the CURRENT wording in every box (the saved value, or the
  // default when nothing is customized) — never blank.
  const buildForm = () => ({
    enabled: initialVoiceReceptionist.enabled,
    level: initialVoiceReceptionist.level,
    recap_text_enabled: initialVoiceReceptionist.recap_text_enabled,
    receptionist_name: initialVoiceReceptionist.receptionist_name || DEFAULTS.receptionist_name,
    greeting_business_hours: initialVoiceReceptionist.greeting_business_hours || DEFAULTS.greeting_business_hours,
    greeting_after_hours: initialVoiceReceptionist.greeting_after_hours || DEFAULTS.greeting_after_hours,
    instructions: initialVoiceReceptionist.instructions || DEFAULTS.instructions,
    voice_id: initialVoiceReceptionist.voice_id || DEFAULTS.voice_id,
    transfer_method: initialVoiceReceptionist.transfer_method || 'off',
    transfer_user_ids: [...(initialVoiceReceptionist.transfer_user_ids || [])].sort(),
    transfer_cell_numbers: { ...(initialVoiceReceptionist.transfer_cell_numbers || {}) },
    title_service_map: (initialVoiceReceptionist.title_service_map || []).map(r => ({ match: r.match, say: r.say })),
  })

  const [vr, setVr] = useState(buildForm)
  const [loaded, setLoaded] = useState(buildForm) // last-saved snapshot (for dirty + revert)
  const [vrSaving, setVrSaving] = useState(false)
  const [vrSavedAt, setVrSavedAt] = useState<number | null>(null)
  const [vrError, setVrError] = useState<string | null>(null)

  // Jobber service catalog for the "Load from Jobber" picker, loaded on demand.
  const [svcCatalog, setSvcCatalog] = useState<string[]>([])
  const [svcLoading, setSvcLoading] = useState(false)
  const [svcLoaded, setSvcLoaded] = useState(false)
  const [svcErr, setSvcErr] = useState<string | null>(null)
  const [svcAddSel, setSvcAddSel] = useState('')

  const dirty = JSON.stringify(vr) !== JSON.stringify(loaded)

  // Tell the shell which level is selected (on mount + whenever it changes) so
  // it shows only the sections that level uses.
  useEffect(() => {
    onLevelChange?.(vr.level)
  }, [vr.level, onLevelChange])

  type TextField = 'receptionist_name' | 'greeting_business_hours' | 'greeting_after_hours' | 'instructions' | 'voice_id'

  async function saveVr() {
    setVrSaving(true)
    setVrError(null)
    try {
      // Send blank for any field left at exactly the default (so it keeps
      // tracking the built-in default); send the text for anything customized.
      const asCustom = (v: string, def: string) => (v === def ? '' : v)
      const res = await fetch('/api/admin/voice-receptionist-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: vr.enabled,
          level: vr.level,
          recap_text_enabled: vr.recap_text_enabled,
          receptionist_name: asCustom(vr.receptionist_name, DEFAULTS.receptionist_name),
          greeting_business_hours: asCustom(vr.greeting_business_hours, DEFAULTS.greeting_business_hours),
          greeting_after_hours: asCustom(vr.greeting_after_hours, DEFAULTS.greeting_after_hours),
          instructions: asCustom(vr.instructions, DEFAULTS.instructions),
          voice_id: asCustom(vr.voice_id, DEFAULTS.voice_id),
          transfer_method: vr.transfer_method,
          transfer_user_ids: vr.transfer_user_ids,
          transfer_cell_numbers: vr.transfer_cell_numbers,
          title_service_map: vr.title_service_map,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      setLoaded(vr) // snapshot becomes the new baseline → form is no longer dirty
      setVrSavedAt(Date.now())
    } catch (err) {
      setVrError(err instanceof Error ? err.message : String(err))
    } finally {
      setVrSaving(false)
    }
  }

  const setCell = (uid: string, value: string) =>
    setVr(p => ({ ...p, transfer_cell_numbers: { ...p.transfer_cell_numbers, [uid]: value } }))

  // Service-naming rule editing (line-item match → spoken phrase).
  const setRule = (i: number, field: 'match' | 'say', value: string) =>
    setVr(p => ({ ...p, title_service_map: p.title_service_map.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)) }))
  const addRule = () => setVr(p => ({ ...p, title_service_map: [...p.title_service_map, { match: '', say: '' }] }))
  const removeRule = (i: number) =>
    setVr(p => ({ ...p, title_service_map: p.title_service_map.filter((_, idx) => idx !== i) }))
  const resetMap = () =>
    setVr(p => ({ ...p, title_service_map: (initialVoiceReceptionist.title_service_map_default || []).map(r => ({ ...r })) }))
  const mapIsDefault =
    JSON.stringify(vr.title_service_map) === JSON.stringify(initialVoiceReceptionist.title_service_map_default || [])

  // Pull the real Jobber service catalog (same source the Scheduling panel uses)
  // so the admin can pick an actual service to name instead of typing it.
  const loadServicesFromJobber = async () => {
    setSvcLoading(true)
    setSvcErr(null)
    try {
      const res = await fetch('/api/jobber/line-items')
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `Could not load services (${res.status})`)
      setSvcCatalog((data.lineItems as string[]) ?? [])
      setSvcLoaded(true)
    } catch (e) {
      setSvcErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSvcLoading(false)
    }
  }
  const addRuleFromService = (name: string) => {
    if (!name) return
    setVr(p => ({ ...p, title_service_map: [...p.title_service_map, { match: name, say: '' }] }))
    setSvcAddSel('')
  }

  const resetLink = (field: TextField) =>
    vr[field] !== DEFAULTS[field] ? (
      <button
        type="button"
        onClick={() => setVr(p => ({ ...p, [field]: DEFAULTS[field] }))}
        className="text-xs text-white/50 hover:text-white/80 hover:underline"
      >
        Reset to default
      </button>
    ) : null

  return (
      <section className="border border-white/10 rounded-lg p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">AI Receptionist</h2>
          <p className="text-xs text-white/50 mt-0.5">
            When the team can&apos;t pick up, an AI voice assistant answers, takes a
            detailed message, and files a lead so someone can follow up.
          </p>
        </div>

        <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-3 text-xs text-sky-200 leading-relaxed">
          Every box shows the current wording. Edit anything and click <strong>Save</strong>, or <strong>Revert</strong> to undo unsaved changes.
          <strong> Reset to default</strong> restores the built-in (generic) starting template for that field.
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium text-white">Receptionist enabled</p>
            <p className="text-xs text-white/50 mt-0.5">
              When off, unanswered calls go to voicemail instead of the AI assistant.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={vr.enabled}
            onClick={() => setVr(p => ({ ...p, enabled: !p.enabled }))}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
              vr.enabled ? 'bg-brand' : 'bg-white/20'
            }`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              vr.enabled ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {/* Capability level */}
        <div>
          <label className="text-xs font-medium text-white/70 block mb-1">Capability level</label>
          <div className="space-y-2">
            {VR_LEVELS.map((l) => {
              const overPlanCap = l.level > initialVoiceReceptionist.plan_max_level
              const locked = Boolean(l.comingSoon) || overPlanCap
              const selected = vr.level === l.level
              return (
                <button
                  key={l.level}
                  type="button"
                  disabled={locked}
                  onClick={() => setVr(p => ({ ...p, level: l.level }))}
                  className={`w-full text-left border rounded-lg p-3 transition-colors ${
                    selected
                      ? 'border-brand bg-brand/10'
                      : locked
                        ? 'border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed'
                        : 'border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{l.name}</p>
                    {selected && <span className="text-xs text-brand font-medium flex-shrink-0">Active</span>}
                    {l.comingSoon && <span className="text-xs text-white/40 flex-shrink-0">Coming soon</span>}
                    {!l.comingSoon && overPlanCap && <span className="text-xs text-amber-300/80 flex-shrink-0">Upgrade to unlock</span>}
                  </div>
                  <p className="text-xs text-white/50 mt-0.5">{l.blurb}</p>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-white/40 mt-1">
            The level controls what the assistant is allowed to do on a call, and sets the default Greeting + Instructions
            wording. If you&apos;ve customized those below, they stay as-is — use “Reset to default” there to load the current
            level&apos;s wording. Changes take effect on the next call.
          </p>
        </div>

        {/* Receptionist name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Receptionist name</label>
            {resetLink('receptionist_name')}
          </div>
          <input
            type="text"
            value={vr.receptionist_name}
            onChange={e => setVr(p => ({ ...p, receptionist_name: e.target.value.slice(0, 40) }))}
            className="w-full max-w-md bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-white/40 mt-1">
            The name the assistant gives callers (used in the greetings and if a caller asks).
          </p>
        </div>

        {/* Business-hours greeting */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Greeting — during business hours</label>
            {resetLink('greeting_business_hours')}
          </div>
          <textarea
            value={vr.greeting_business_hours}
            onChange={e => setVr(p => ({ ...p, greeting_business_hours: e.target.value.slice(0, 1000) }))}
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-white/40 mt-1">Spoken when a call comes in <strong>during</strong> your business hours (team busy with other customers).</p>
        </div>

        {/* After-hours greeting */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Greeting — after hours</label>
            {resetLink('greeting_after_hours')}
          </div>
          <textarea
            value={vr.greeting_after_hours}
            onChange={e => setVr(p => ({ ...p, greeting_after_hours: e.target.value.slice(0, 1000) }))}
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-white/40 mt-1">Spoken when a call comes in <strong>outside</strong> your business hours or on a holiday (team isn&apos;t available).</p>
        </div>

        {/* Instructions */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Instructions</label>
            {resetLink('instructions')}
          </div>
          <textarea
            value={vr.instructions}
            onChange={e => setVr(p => ({ ...p, instructions: e.target.value.slice(0, 8000) }))}
            rows={16}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y font-mono"
          />
          <p className="text-xs text-white/40 mt-1">
            The behavior that shapes how the assistant talks and what it collects. Service specifics like pricing come from your
            Knowledge docs; this is the behavior around them. “Reset to default” loads the generic template for the current level.
          </p>
        </div>

        {/* Service naming — a line-item match → spoken phrase */}
        <div className="border border-white/10 rounded-lg p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">Service names for scheduled visits</p>
              <p className="text-xs text-white/50 mt-0.5">
                When a customer asks about their next visit, the assistant looks it up live in Jobber and names the
                service from the visit’s line items. Add a rule per service: when a line item matches the text on the
                left, the assistant says the phrase on the right. On a visit with several line items it names the main
                (highest-priced) one, so add-ons and discounts are ignored.
              </p>
            </div>
            {!mapIsDefault && (
              <button
                type="button"
                onClick={resetMap}
                className="text-xs text-white/50 hover:text-white/80 hover:underline flex-shrink-0"
              >
                Reset to default
              </button>
            )}
          </div>

          {/* Load the real Jobber service list, then pick one to add as a rule. */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={loadServicesFromJobber}
              disabled={svcLoading}
              className="px-3 py-1.5 border border-white/15 hover:border-white/30 disabled:opacity-50 rounded-lg text-xs font-medium text-white/80 whitespace-nowrap"
            >
              {svcLoading ? 'Loading…' : svcLoaded ? '↻ Reload from Jobber' : '↻ Load from Jobber'}
            </button>
            {svcLoaded && (
              <>
                <select
                  value={svcAddSel}
                  onChange={e => setSvcAddSel(e.target.value)}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2.5 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— add one of your services —</option>
                  {svcCatalog.map(li => (
                    <option key={li} value={li}>
                      {li}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => addRuleFromService(svcAddSel)}
                  disabled={!svcAddSel}
                  className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-40 text-sm font-medium whitespace-nowrap"
                >
                  + Add
                </button>
              </>
            )}
          </div>
          {svcErr && <p className="text-xs text-red-400">{svcErr}</p>}
          {svcLoaded && <p className="text-xs text-emerald-300">{svcCatalog.length} services loaded</p>}

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/40">
              <span className="w-40">When a line item matches</span>
              <span className="flex-1">Assistant says</span>
              <span className="w-6" />
            </div>
            {vr.title_service_map.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={r.match}
                  onChange={e => setRule(i, 'match', e.target.value.slice(0, 60))}
                  placeholder="Irrigation"
                  className="w-40 bg-white/5 border border-white/10 rounded px-2.5 py-1 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={r.say}
                  onChange={e => setRule(i, 'say', e.target.value.slice(0, 80))}
                  placeholder="sprinkler service call"
                  className="flex-1 bg-white/5 border border-white/10 rounded px-2.5 py-1 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  aria-label="Remove"
                  className="w-6 text-white/40 hover:text-red-400 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRule} className="text-xs text-brand hover:underline">
            + Add a service manually
          </button>
          <p className="text-xs text-white/40">
            Matching is case-insensitive and matches whole words, so a short match like “IR” hits “IR - Irrigation” but
            not “Repair.” Keep the match broad (e.g. “Pet Waste”) to cover every variant of a service. If a visit
            matches nothing here, the assistant just gives the date and says a team member can confirm the service.
          </p>
        </div>

        {/* Recap text toggle */}
        <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
          <div className="pr-3">
            <p className="text-sm font-medium text-white">Send a recap text</p>
            <p className="text-xs text-white/50 mt-0.5">
              Near the end of the call, the assistant offers to text the caller a quick recap — a natural way to capture a text opt-in. When off, it won&apos;t ask or send.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={vr.recap_text_enabled}
            onClick={() => setVr(p => ({ ...p, recap_text_enabled: !p.recap_text_enabled }))}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
              vr.recap_text_enabled ? 'bg-brand' : 'bg-white/20'
            }`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              vr.recap_text_enabled ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {/* Voice ID */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Voice ID</label>
            {resetLink('voice_id')}
          </div>
          <input
            type="text"
            value={vr.voice_id}
            onChange={e => setVr(p => ({ ...p, voice_id: e.target.value }))}
            placeholder="e.g. GGRMgbKfr7QscdcrvWga"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-white/40 mt-1">
            The text-to-speech voice used for the spoken replies.{' '}
            <a
              href="https://www.twilio.com/docs/voice/conversationrelay/voice-configuration"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              Pick a voice
            </a>
          </p>
        </div>

        {/* Transfer to a person — a single live transfer. Applies to Levels 2–4;
            Level 1 takes messages only, and Level 5 uses Call routing (a separate
            section below) instead of this flat transfer. */}
        {vr.level >= 2 && vr.level <= 4 && (
        <div className="border border-white/10 rounded-lg p-3 space-y-3">
          <div>
            <p className="text-sm font-medium text-white">Transfer to a person</p>
            <p className="text-xs text-white/50 mt-0.5">
              During business hours, if a caller asks for a live person, the assistant can try to reach your team before falling back to a message. Choose how.
            </p>
          </div>
          <div className="space-y-2">
            {TRANSFER_METHODS.map((m) => {
              const locked = Boolean(m.comingSoon)
              const selected = vr.transfer_method === m.value
              return (
                <button
                  key={m.value}
                  type="button"
                  disabled={locked}
                  onClick={() => setVr(p => ({ ...p, transfer_method: m.value }))}
                  className={`w-full text-left border rounded-lg p-2.5 transition-colors ${
                    selected
                      ? 'border-brand bg-brand/10'
                      : locked
                        ? 'border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed'
                        : 'border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{m.name}</p>
                    {selected && <span className="text-xs text-brand font-medium flex-shrink-0">Active</span>}
                    {m.comingSoon && <span className="text-xs text-white/40 flex-shrink-0">Coming soon</span>}
                  </div>
                  <p className="text-xs text-white/50 mt-0.5">{m.blurb}</p>
                </button>
              )
            })}
          </div>
          {vr.transfer_method !== 'off' && (
            <div>
              <label className="text-xs font-medium text-white/70 block mb-1">Who can take transfers</label>
              {people.length === 0 ? (
                <p className="text-xs text-white/40">No Hub users found.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto border border-white/10 rounded p-2">
                  {people.map((u) => {
                    const checked = vr.transfer_user_ids.includes(u.id)
                    return (
                      <label key={u.id} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setVr(p => ({
                              ...p,
                              transfer_user_ids: (checked
                                ? p.transfer_user_ids.filter(id => id !== u.id)
                                : [...p.transfer_user_ids, u.id]
                              ).sort(),
                            }))
                          }
                          className="accent-brand"
                        />
                        {u.display_name}
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-white/40 mt-1">
                {vr.transfer_method === 'softphone'
                  ? 'Rings the Dialer softphone for the checked people who are logged in; whoever answers first is connected. If no one answers in ~25 seconds, the caller can leave a message.'
                  : vr.transfer_method === 'cell'
                    ? 'We call the checked people on their cell (below), one at a time, until someone presses 1 to take the call. If no one does, the caller can leave a message.'
                    : 'The checked people will be reached when a caller asks for a live person.'}
              </p>

              {/* Cell numbers — only for the 'cell' method. One field per checked
                  recipient; a blank/invalid number just means that person isn't dialed. */}
              {vr.transfer_method === 'cell' && (
                <div className="mt-3">
                  <label className="text-xs font-medium text-white/70 block mb-1">Cell numbers to ring</label>
                  {vr.transfer_user_ids.length === 0 ? (
                    <p className="text-xs text-white/40">Check the people above first, then enter their cell numbers here.</p>
                  ) : (
                    <div className="space-y-1.5 border border-white/10 rounded p-2">
                      {vr.transfer_user_ids.map((uid) => {
                        const person = people.find((p) => p.id === uid)
                        return (
                          <div key={uid} className="flex items-center gap-2">
                            <span className="text-sm text-white/80 flex-1 min-w-0 truncate">
                              {person?.display_name ?? 'User'}
                            </span>
                            <input
                              type="tel"
                              inputMode="tel"
                              value={vr.transfer_cell_numbers[uid] ?? ''}
                              onChange={(e) => setCell(uid, e.target.value)}
                              placeholder="(832) 555-1234"
                              className="w-44 bg-white/5 border border-white/10 rounded px-2.5 py-1 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-xs text-white/40 mt-1">
                    Enter a mobile number for each person who should get a cell transfer. Numbers save when you click Save below.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Save / Revert */}
        <div className="flex items-center gap-3">
          <button
            onClick={saveVr}
            disabled={vrSaving || !dirty}
            className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
          >
            {vrSaving ? 'Saving…' : 'Save AI Receptionist'}
          </button>
          <button
            onClick={() => { setVr(loaded); setVrError(null) }}
            disabled={vrSaving || !dirty}
            className="px-4 py-2 rounded border border-white/15 hover:border-white/30 disabled:opacity-40 text-sm font-medium text-white/80"
          >
            Revert
          </button>
          {dirty && !vrError && <span className="text-xs text-amber-300/80">Unsaved changes</span>}
          {!dirty && vrSavedAt && !vrError && <span className="text-xs text-emerald-300">Saved ✓</span>}
          {vrError && <span className="text-xs text-red-400">{vrError}</span>}
        </div>
      </section>
  )
}
