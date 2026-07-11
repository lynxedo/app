'use client'

import { useState } from 'react'

// AI Voice Receptionist — stored form values + code/env defaults (placeholders).
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
  receptionist_name_default: string
  greeting_business_hours_default: string
  greeting_after_hours_default: string
  instructions_default: string
  voice_id_default: string
}

// Capability ladder (Ben's product tiers). Level 4 exists in the UI but is not
// built yet; the API rejects saving it. At SaaS time levels above the plan cap
// render locked with an upgrade nudge.
const VR_LEVELS: { level: number; name: string; blurb: string; comingSoon?: boolean }[] = [
  { level: 1, name: 'Level 1 — Message taker', blurb: 'A friendly voicemail replacement: collects name, number, and reason, then promises a callback. Politely deflects all questions.' },
  { level: 2, name: 'Level 2 — Conversational', blurb: 'Warm and human — brief small talk, answers approved basics, talks the company up, and offers the free assessment. Never states pricing.' },
  { level: 3, name: 'Level 3 — Soft sell', blurb: 'Conversational plus: states approved fixed pricing, asks qualifying questions, and works an assumptive soft close. A human specialist still confirms.' },
  { level: 4, name: 'Level 4 — Full receptionist', blurb: 'Owns the call start to close — real quotes and live scheduling into Jobber within your guardrails.', comingSoon: true },
]

export default function ReceptionistPanel({
  initialVoiceReceptionist,
}: {
  initialVoiceReceptionist: VoiceReceptionistInitial
}) {
  // AI Voice Receptionist — separate state + save from the main AI settings.
  const [vr, setVr] = useState({
    enabled: initialVoiceReceptionist.enabled,
    level: initialVoiceReceptionist.level,
    receptionist_name: initialVoiceReceptionist.receptionist_name,
    greeting_business_hours: initialVoiceReceptionist.greeting_business_hours,
    greeting_after_hours: initialVoiceReceptionist.greeting_after_hours,
    instructions: initialVoiceReceptionist.instructions,
    voice_id: initialVoiceReceptionist.voice_id,
    recap_text_enabled: initialVoiceReceptionist.recap_text_enabled,
  })
  const [vrSaving, setVrSaving] = useState(false)
  const [vrSavedAt, setVrSavedAt] = useState<number | null>(null)
  const [vrError, setVrError] = useState<string | null>(null)

  async function saveVr() {
    setVrSaving(true)
    setVrError(null)
    try {
      const res = await fetch('/api/admin/voice-receptionist-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: vr.enabled,
          level: vr.level,
          receptionist_name: vr.receptionist_name,
          greeting_business_hours: vr.greeting_business_hours,
          greeting_after_hours: vr.greeting_after_hours,
          instructions: vr.instructions,
          voice_id: vr.voice_id,
          recap_text_enabled: vr.recap_text_enabled,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      setVrSavedAt(Date.now())
    } catch (err) {
      setVrError(err instanceof Error ? err.message : String(err))
    } finally {
      setVrSaving(false)
    }
  }

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
          Leave any field blank to use the built-in default (shown as the
          placeholder). A greeting is spoken the instant the call connects; the
          instructions shape how the assistant behaves for the rest of the call.
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
            The level controls what the assistant is allowed to do on a call. Changes take effect on the next call.
          </p>
        </div>

        {/* Receptionist name */}
        <div>
          <label className="text-xs font-medium text-white/70 block mb-1">Receptionist name</label>
          <input
            type="text"
            value={vr.receptionist_name}
            onChange={e => setVr(p => ({ ...p, receptionist_name: e.target.value.slice(0, 40) }))}
            placeholder={initialVoiceReceptionist.receptionist_name_default || 'e.g. Amber'}
            className="w-full max-w-md bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-white/40 mt-1">
            The name the assistant gives callers (used in the default greetings and if a caller asks). Leave blank to use the default.
          </p>
        </div>

        {/* Business-hours greeting */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Greeting — during business hours</label>
            {!vr.greeting_business_hours.trim() && initialVoiceReceptionist.greeting_business_hours_default.trim() && (
              <button
                type="button"
                onClick={() => setVr(p => ({ ...p, greeting_business_hours: initialVoiceReceptionist.greeting_business_hours_default }))}
                className="text-xs text-brand hover:underline"
              >
                Load default to edit
              </button>
            )}
          </div>
          <textarea
            value={vr.greeting_business_hours}
            onChange={e => setVr(p => ({ ...p, greeting_business_hours: e.target.value.slice(0, 1000) }))}
            rows={3}
            placeholder="Leave blank to use the recommended default greeting."
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-white/40 mt-1">Spoken when a call comes in <strong>during</strong> your business hours (the team is busy with other customers). Blank uses the recommended default.</p>
        </div>

        {/* After-hours greeting */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Greeting — after hours</label>
            {!vr.greeting_after_hours.trim() && initialVoiceReceptionist.greeting_after_hours_default.trim() && (
              <button
                type="button"
                onClick={() => setVr(p => ({ ...p, greeting_after_hours: initialVoiceReceptionist.greeting_after_hours_default }))}
                className="text-xs text-brand hover:underline"
              >
                Load default to edit
              </button>
            )}
          </div>
          <textarea
            value={vr.greeting_after_hours}
            onChange={e => setVr(p => ({ ...p, greeting_after_hours: e.target.value.slice(0, 1000) }))}
            rows={3}
            placeholder="Leave blank to use the recommended default greeting."
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-white/40 mt-1">Spoken when a call comes in <strong>outside</strong> your business hours or on a holiday (the team isn&apos;t available). Blank uses the recommended default.</p>
        </div>

        {/* Instructions */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Instructions</label>
            {!vr.instructions.trim() && initialVoiceReceptionist.instructions_default.trim() && (
              <button
                type="button"
                onClick={() => setVr(p => ({ ...p, instructions: initialVoiceReceptionist.instructions_default }))}
                className="text-xs text-brand hover:underline"
              >
                Load default to edit
              </button>
            )}
          </div>
          <textarea
            value={vr.instructions}
            onChange={e => setVr(p => ({ ...p, instructions: e.target.value.slice(0, 8000) }))}
            rows={16}
            placeholder="Leave blank to use the recommended default instructions."
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y font-mono"
          />
          <p className="text-xs text-white/40 mt-1">
            The behavior that shapes how the assistant talks and what it collects. Blank uses the recommended default (which follows the capability level above). Click “Load default to edit” to write your own.
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
          <label className="text-xs font-medium text-white/70 block mb-1">Voice ID</label>
          <input
            type="text"
            value={vr.voice_id}
            onChange={e => setVr(p => ({ ...p, voice_id: e.target.value }))}
            placeholder={initialVoiceReceptionist.voice_id_default || 'e.g. GGRMgbKfr7QscdcrvWga'}
            className="w-full max-w-md bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-white/40 mt-1">
            The text-to-speech voice used for the spoken replies. Leave blank to use the server default.{' '}
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

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={saveVr}
            disabled={vrSaving}
            className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
          >
            {vrSaving ? 'Saving…' : 'Save AI Receptionist'}
          </button>
          {vrSavedAt && !vrError && <span className="text-xs text-emerald-300">Saved ✓</span>}
          {vrError && <span className="text-xs text-red-400">{vrError}</span>}
        </div>
      </section>
  )
}
