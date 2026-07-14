'use client'

import { useMemo, useState, useRef } from 'react'
import IvrEditor, { type IvrConfig } from './IvrEditor'
import { pickIvrTree } from '@/lib/ivr-routing'
import ExtensionsPanel, { type ExtensionRow } from './ExtensionsPanel'
import RingGroupsPanel, { type RingGroup } from './RingGroupsPanel'
import { DEFAULT_DISPOSITIONS } from '@/lib/dialer-dispositions'
import { useConfirm } from '@/components/ui'

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
type BusinessHoursWindow = { from: string; to: string }
type BusinessHoursSchedule = {
  enabled?: boolean
  tz?: string
  days?: Partial<Record<DayKey, BusinessHoursWindow[]>>
}
type HolidayEntry =
  | { kind: 'date'; date: string; label?: string }
  | { kind: 'recurring'; month: number; day: number; label?: string }

const DAY_LABELS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

type Settings = {
  inbound_route_user_id: string | null
  ring_timeout_sec: number
  voicemail_recipient_user_ids: string[]
  fallback_voicemail_url: string | null
  fallback_voicemail_tts: string
  ivr_enabled: boolean
  ivr_config: IvrConfig
  business_hours: BusinessHoursSchedule
  holidays: HolidayEntry[]
  recording_enabled: boolean
  recording_consent_notice: string
  recording_consent_enabled: boolean
  recording_consent_url: string | null
  recording_pause_auto_resume_sec: number
  // After-call disposition options. null = use the built-in default set.
  disposition_options: string[] | null
  // Emergency fallback voicemail alerts (Twilio-hosted backup answered a call
  // because the main flow errored). 'hub' = Guardian DM + push (default).
  fallback_notify_method: 'hub' | 'sms' | 'both'
  fallback_notify_user_ids: string[]
  fallback_notify_sms_numbers: string[]
}

type HubUser = { id: string; display_name: string }

export default function DialerAdminPanel({
  initial,
  hubUsers,
  initialExtensions,
  initialRingGroups,
}: {
  initial: Settings
  hubUsers: HubUser[]
  initialExtensions: ExtensionRow[]
  initialRingGroups: RingGroup[]
}) {
  const confirmDialog = useConfirm()
  const [s, setS] = useState<Settings>(initial)
  const [extensions, setExtensions] = useState<ExtensionRow[]>(initialExtensions)
  const [ringGroups, setRingGroups] = useState<RingGroup[]>(initialRingGroups)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadingConsent, setUploadingConsent] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const consentFileInputRef = useRef<HTMLInputElement>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dialer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inbound_route_user_id: s.inbound_route_user_id,
          ring_timeout_sec: s.ring_timeout_sec,
          voicemail_recipient_user_ids: s.voicemail_recipient_user_ids,
          fallback_voicemail_tts: s.fallback_voicemail_tts || null,
          ivr_enabled: s.ivr_enabled,
          ivr_config: s.ivr_config,
          business_hours: s.business_hours,
          holidays: s.holidays,
          recording_enabled: s.recording_enabled,
          recording_consent_notice: s.recording_consent_notice,
          recording_consent_enabled: s.recording_consent_enabled,
          recording_consent_url: s.recording_consent_url,
          recording_pause_auto_resume_sec: s.recording_pause_auto_resume_sec,
          disposition_options: s.disposition_options,
          fallback_notify_method: s.fallback_notify_method,
          fallback_notify_user_ids: s.fallback_notify_user_ids,
          fallback_notify_sms_numbers: s.fallback_notify_sms_numbers,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function uploadGreeting(file: File) {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/dialer/general-greeting', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setS((prev) => ({ ...prev, fallback_voicemail_url: data.url }))
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function clearGreeting() {
    if (!(await confirmDialog({ message: 'Remove the custom greeting? Callers will hear the TTS text or spoken default.', danger: true }))) return
    setUploading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dialer/general-greeting', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Clear failed (${res.status})`)
      }
      setS((prev) => ({ ...prev, fallback_voicemail_url: null }))
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function uploadConsentAudio(file: File) {
    setUploadingConsent(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/dialer/consent-notice', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setS((prev) => ({ ...prev, recording_consent_url: data.url }))
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingConsent(false)
      if (consentFileInputRef.current) consentFileInputRef.current.value = ''
    }
  }

  async function clearConsentAudio() {
    if (!(await confirmDialog({ message: 'Remove the custom consent audio? The TTS text will be used instead.', danger: true }))) return
    setUploadingConsent(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dialer/consent-notice', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Clear failed (${res.status})`)
      }
      setS((prev) => ({ ...prev, recording_consent_url: null }))
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingConsent(false)
    }
  }

  const ivrExtensionList = useMemo(
    () =>
      extensions
        .filter((e) => e.extension)
        .map((e) => ({
          extension: e.extension!,
          user_id: e.user_id,
          display_name: e.display_name,
        }))
        .sort((a, b) => a.extension.localeCompare(b.extension)),
    [extensions]
  )

  function toggleId(field: 'voicemail_recipient_user_ids' | 'fallback_notify_user_ids', id: string) {
    setS((prev) => {
      const set = new Set(prev[field])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, [field]: [...set] }
    })
  }

  // Sub-section tabs. Inbound routing / IVR / ring groups / hours+holidays are
  // grouped; voicemail bundles greeting + notify + recording + dispositions;
  // extensions and the responder each stand alone.
  const [dtab, setDtab] = useState<'inbound' | 'voicemail' | 'extensions'>('inbound')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Dialer</h1>
        <p className="text-sm text-white/60 mt-1">
          Inbound call routing, voicemail, and extensions.
        </p>
      </header>

      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60">
        <span className="text-white/80 font-medium">Phone numbers &amp; access</span> are
        managed in one place — <a href="/hub/admin/txt" className="text-brand hover:underline">Txt → Phone Numbers</a>.
        The per-user access set there controls which numbers a person sees in
        both the Dialer and Txt2, and which numbers their &ldquo;Call from&rdquo;
        picker offers. Admins always see every number.
      </div>

      {/* Sub-section tabs */}
      <div className="flex gap-1 border-b border-gray-800 flex-wrap">
        {([
          ['inbound', 'Inbound & IVR'],
          ['voicemail', 'Voicemail'],
          ['extensions', 'Extensions'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setDtab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              dtab === key ? 'border-brand text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── INBOUND & IVR ── */}
      {dtab === 'inbound' && (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Inbound routing</h2>
          <p className="text-xs text-white/50 mt-1">
            Where calls to the Dialer number ring first. If no one is set, every
            call goes straight to voicemail.
          </p>
        </header>

        <div>
          <label className="block text-sm font-medium mb-1">Ring this person</label>
          <select
            value={s.inbound_route_user_id ?? ''}
            onChange={(e) =>
              setS((prev) => ({ ...prev, inbound_route_user_id: e.target.value || null }))
            }
            className="bg-gray-900 border border-white/15 rounded px-2 py-1.5 text-sm w-full max-w-xs"
          >
            <option value="">— No one (always voicemail) —</option>
            {hubUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Ring for</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={s.ring_timeout_sec}
              min={5}
              max={120}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v)) {
                  setS((prev) => ({ ...prev, ring_timeout_sec: v }))
                }
              }}
              className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-20"
            />
            <span className="text-sm text-white/60">seconds before voicemail</span>
          </div>
          <p className="text-xs text-white/40 mt-1">5–120 seconds. Default 20.</p>
        </div>
      </section>
      )}

      {/* ── VOICEMAIL ── */}
      {dtab === 'voicemail' && (<>
      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Voicemail greeting</h2>
          <p className="text-xs text-white/50 mt-1">
            Plays before the beep. MP3 or WAV, 2 MB max. Without a custom
            greeting we use a spoken default.
          </p>
        </header>

        {s.fallback_voicemail_url ? (
          <div className="flex items-center gap-3 flex-wrap">
            <audio
              src={s.fallback_voicemail_url}
              controls
              preload="metadata"
              className="h-8 max-w-xs"
            />
            <button
              type="button"
              onClick={clearGreeting}
              disabled={uploading}
              className="px-3 py-1.5 rounded text-xs border border-red-700/40 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
            >
              Remove greeting
            </button>
          </div>
        ) : (
          <p className="text-sm text-white/50">No custom greeting uploaded.</p>
        )}

        <div>
          <p className="text-xs text-white/50 mb-1.5">Upload audio (takes priority over text below):</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadGreeting(file)
            }}
            disabled={uploading}
            className="text-xs text-white/70 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-brand file:text-white file:text-sm hover:file:bg-brand-light file:cursor-pointer"
          />
          {uploading && <span className="ml-2 text-xs text-white/50">Uploading…</span>}
        </div>

        <div>
          <label className="text-xs font-medium text-white/70 block mb-1">
            Text-to-speech greeting
            {s.fallback_voicemail_url && <span className="ml-2 text-white/40">(overridden by uploaded audio above)</span>}
          </label>
          <textarea
            value={s.fallback_voicemail_tts}
            onChange={e => setS(p => ({ ...p, fallback_voicemail_tts: e.target.value.slice(0, 1000) }))}
            rows={3}
            placeholder="Type the greeting to speak before the beep, e.g. Hi, you've reached Heroes Lawn Care. Please leave a message and we'll get back to you shortly."
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-white/40 mt-1">Leave blank to use the spoken default.</p>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Notify on new voicemail</h2>
          <p className="text-xs text-white/50 mt-1">
            These users get a push notification (and any DND/notification
            preferences they have) whenever a voicemail lands.
          </p>
        </header>

        <RecipientGrid
          empty="No users in this company yet."
          items={hubUsers.map((u) => ({ id: u.id, label: u.display_name }))}
          selected={s.voicemail_recipient_user_ids}
          onToggle={(id) => toggleId('voicemail_recipient_user_ids', id)}
        />
      </section>

      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Fallback voicemail alerts</h2>
          <p className="text-xs text-white/50 mt-1">
            If the phone system ever errors on a live call, a Twilio-hosted backup
            answers, apologizes, and takes a voicemail so the caller never hears a
            dead-end error. This controls how your team is alerted when that
            backup catches a message. Rare by design — every alert means the main
            call flow failed and is worth investigating.
          </p>
        </header>

        <div>
          <label className="block text-sm font-medium mb-1.5">Alert method</label>
          <select
            value={s.fallback_notify_method}
            onChange={(e) =>
              setS((prev) => ({
                ...prev,
                fallback_notify_method: e.target.value as Settings['fallback_notify_method'],
              }))
            }
            className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="hub">Hub message (Guardian DM + push)</option>
            <option value="sms">Text message</option>
            <option value="both">Both</option>
          </select>
        </div>

        {s.fallback_notify_method !== 'sms' && (
          <div>
            <RecipientGrid
              empty="No users in this company yet."
              items={hubUsers.map((u) => ({ id: u.id, label: u.display_name }))}
              selected={s.fallback_notify_user_ids}
              onToggle={(id) => toggleId('fallback_notify_user_ids', id)}
            />
            <p className="text-xs text-white/40 mt-1.5">
              Leave everyone unchecked to alert the voicemail recipients above.
            </p>
          </div>
        )}

        {s.fallback_notify_method !== 'hub' && (
          <div>
            <label className="block text-sm font-medium mb-1.5">Text these numbers</label>
            <input
              type="text"
              value={s.fallback_notify_sms_numbers.join(', ')}
              onChange={(e) =>
                setS((prev) => ({
                  ...prev,
                  fallback_notify_sms_numbers: e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="+12815551234, +18325556789"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-xs text-white/40 mt-1">
              Comma-separated, with area code. Texts send from your business line.
            </p>
          </div>
        )}
      </section>
      </>)}

      {/* ── INBOUND & IVR (cont.) ── */}
      {dtab === 'inbound' && (<>
      <BusinessHoursSection
        schedule={s.business_hours}
        onChange={(next) => setS((prev) => ({ ...prev, business_hours: next }))}
      />

      <HolidaysSection
        holidays={s.holidays}
        onChange={(next) => setS((prev) => ({ ...prev, holidays: next }))}
      />

      <CurrentTreePreview
        ivrEnabled={s.ivr_enabled}
        ivrConfig={s.ivr_config}
        businessHours={s.business_hours}
        holidays={s.holidays}
      />

      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Auto-attendant (IVR)</h2>
          <p className="text-xs text-white/50 mt-1">
            Optional menu that greets callers and routes them based on keypresses
            (e.g. "press 1 for scheduling"). When off, calls follow the
            "ring this person → voicemail" flow above.
          </p>
          <p className="text-xs text-white/40 mt-1">
            Tip: TTS prompts ("type text") let Twilio read your menu in a synthetic
            voice — fast to iterate. Swap to "upload audio" once you've finalized
            wording and want a human voice.
          </p>
        </header>

        <IvrEditor
          enabled={s.ivr_enabled}
          config={s.ivr_config}
          onChange={({ enabled, config }) =>
            setS((prev) => ({ ...prev, ivr_enabled: enabled, ivr_config: config }))
          }
          hubUsers={hubUsers}
          extensions={ivrExtensionList}
          ringGroups={ringGroups.map((g) => ({ id: g.id, name: g.name }))}
        />
      </section>
      </>)}

      {/* ── EXTENSIONS ── */}
      {dtab === 'extensions' && (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Extensions</h2>
          <p className="text-xs text-white/50 mt-1">
            3-digit codes (100–999) any user can dial from the keypad to reach a coworker directly.
          </p>
        </header>
        <ExtensionsPanel initial={extensions} onChange={setExtensions} />
      </section>
      )}

      {/* ── INBOUND & IVR (cont.) ── */}
      {dtab === 'inbound' && (
      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Ring groups</h2>
          <p className="text-xs text-white/50 mt-1">
            Named groups that an IVR menu can ring. Wire them into the auto-attendant above.
          </p>
        </header>
        <RingGroupsPanel
          initial={ringGroups}
          hubUsers={hubUsers}
          onChange={setRingGroups}
        />
      </section>
      )}

      {/* ── VOICEMAIL (cont.) — recording + dispositions ── */}
      {dtab === 'voicemail' && (<>
      {/* Recording settings */}
      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Call Recording</h2>
          <p className="text-xs text-white/50 mt-1">
            When enabled, every inbound and outbound call is recorded in dual-channel
            (rep + customer separated) and transcribed with AI summaries.
            All recordings appear in Call Log 2.
          </p>
        </header>

        {/* Enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setS(p => ({ ...p, recording_enabled: !p.recording_enabled }))}
            className={`relative w-10 h-6 rounded-full transition-colors ${s.recording_enabled ? 'bg-brand' : 'bg-white/20'}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${s.recording_enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
          <span className="text-sm text-white">{s.recording_enabled ? 'Recording enabled' : 'Recording disabled'}</span>
        </label>

        {/* Consent notice */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-white/70">Inbound consent notice</label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setS(p => ({ ...p, recording_consent_enabled: !p.recording_consent_enabled }))}
                className={`relative w-8 h-5 rounded-full transition-colors ${s.recording_consent_enabled ? 'bg-brand' : 'bg-white/20'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${s.recording_consent_enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-white/70">{s.recording_consent_enabled ? 'On' : 'Off'}</span>
            </label>
          </div>

          {s.recording_consent_enabled && (
            <div className="space-y-3 pl-0">
              {s.recording_consent_url ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <audio src={s.recording_consent_url} controls preload="metadata" className="h-8 max-w-xs" />
                  <button
                    type="button"
                    onClick={clearConsentAudio}
                    disabled={uploadingConsent}
                    className="px-3 py-1.5 rounded text-xs border border-red-700/40 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
                  >
                    Remove audio
                  </button>
                </div>
              ) : (
                <p className="text-xs text-white/40">No custom audio uploaded — TTS text below will be used.</p>
              )}

              <div>
                <p className="text-xs text-white/50 mb-1.5">Upload audio (takes priority over text below):</p>
                <input
                  ref={consentFileInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadConsentAudio(file)
                  }}
                  disabled={uploadingConsent}
                  className="text-xs text-white/70 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-brand file:text-white file:text-sm hover:file:bg-brand-light file:cursor-pointer"
                />
                {uploadingConsent && <span className="ml-2 text-xs text-white/50">Uploading…</span>}
              </div>

              <div>
                <label className="text-xs font-medium text-white/70 block mb-1">
                  Text-to-speech notice
                  {s.recording_consent_url && <span className="ml-2 text-white/40">(overridden by uploaded audio above)</span>}
                </label>
                <textarea
                  value={s.recording_consent_notice}
                  onChange={e => setS(p => ({ ...p, recording_consent_notice: e.target.value.slice(0, 500) }))}
                  rows={2}
                  placeholder="This call may be recorded for quality and training purposes."
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
                <p className="text-xs text-white/40 mt-1">Played to the caller before connecting. Leave blank to use the default.</p>
              </div>
            </div>
          )}
        </div>

        {/* Pause auto-resume */}
        <div>
          <label className="text-xs font-medium text-white/70 block mb-1">Pause auto-resume (seconds)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={10}
              max={600}
              value={s.recording_pause_auto_resume_sec}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n) && n >= 10 && n <= 600) setS(p => ({ ...p, recording_pause_auto_resume_sec: n }))
              }}
              className="w-24 bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-sm text-white/60">seconds before recording auto-resumes</span>
          </div>
          <p className="text-xs text-white/40 mt-1">10–600 seconds. Default 60.</p>
        </div>
      </section>

      <DispositionsSection
        options={s.disposition_options}
        onChange={(next) => setS((prev) => ({ ...prev, disposition_options: next }))}
      />
      </>)}

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && !error && (
          <span className="text-xs text-emerald-300">Saved ✓</span>
        )}
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>
    </div>
  )
}

function BusinessHoursSection({
  schedule,
  onChange,
}: {
  schedule: BusinessHoursSchedule
  onChange: (next: BusinessHoursSchedule) => void
}) {
  const enabled = Boolean(schedule.enabled)
  const tz = schedule.tz || 'America/Chicago'

  function toggleEnabled(on: boolean) {
    onChange({ ...schedule, enabled: on })
  }
  function addWindow(day: DayKey) {
    const arr = (schedule.days?.[day] || []).slice()
    arr.push({ from: '08:00', to: '18:00' })
    onChange({ ...schedule, days: { ...(schedule.days || {}), [day]: arr } })
  }
  function removeWindow(day: DayKey, idx: number) {
    const arr = (schedule.days?.[day] || []).slice()
    arr.splice(idx, 1)
    const nextDays = { ...(schedule.days || {}) }
    if (arr.length === 0) delete nextDays[day]
    else nextDays[day] = arr
    onChange({ ...schedule, days: nextDays })
  }
  function patchWindow(day: DayKey, idx: number, patch: Partial<BusinessHoursWindow>) {
    const arr = (schedule.days?.[day] || []).slice()
    arr[idx] = { ...arr[idx], ...patch }
    onChange({ ...schedule, days: { ...(schedule.days || {}), [day]: arr } })
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
      <header>
        <h2 className="font-semibold">Business hours</h2>
        <p className="text-xs text-white/50 mt-1">
          When set, calls outside these hours run the <span className="font-mono">After-hours</span> IVR tree
          (if you've built one). Times are in {tz}. Don't forget to click Save.
        </p>
      </header>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggleEnabled(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-white/20 bg-gray-950 text-brand focus:ring-brand focus:ring-offset-0"
        />
        <div className="text-sm">Use business-hours routing</div>
      </label>

      {enabled && (
        <div className="space-y-2">
          {DAY_LABELS.map(({ key, label }) => {
            const windows = schedule.days?.[key] || []
            return (
              <div key={key} className="flex items-start gap-3 px-3 py-2 rounded border border-white/10 bg-gray-950/50">
                <span className="text-xs text-white/60 w-10 mt-2 font-mono">{label}</span>
                <div className="flex-1 space-y-1.5">
                  {windows.length === 0 ? (
                    <span className="text-xs text-white/40">Closed.</span>
                  ) : (
                    windows.map((w, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <input
                          type="time"
                          value={w.from}
                          onChange={(e) => patchWindow(key, idx, { from: e.target.value })}
                          className="bg-gray-900 border border-white/15 rounded px-2 py-0.5 text-sm w-28"
                        />
                        <span className="text-xs text-white/50">to</span>
                        <input
                          type="time"
                          value={w.to}
                          onChange={(e) => patchWindow(key, idx, { to: e.target.value })}
                          className="bg-gray-900 border border-white/15 rounded px-2 py-0.5 text-sm w-28"
                        />
                        <button
                          type="button"
                          onClick={() => removeWindow(key, idx)}
                          className="text-xs text-white/40 hover:text-red-400 ml-1"
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => addWindow(key)}
                    className="text-xs text-white/60 hover:text-white"
                  >
                    + add window
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function HolidaysSection({
  holidays,
  onChange,
}: {
  holidays: HolidayEntry[]
  onChange: (next: HolidayEntry[]) => void
}) {
  function addDateHoliday() {
    const today = new Date()
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    onChange([...holidays, { kind: 'date', date: ymd, label: '' }])
  }
  function addRecurringHoliday() {
    onChange([...holidays, { kind: 'recurring', month: 12, day: 25, label: '' }])
  }
  function removeAt(idx: number) {
    onChange(holidays.filter((_, i) => i !== idx))
  }
  function patchAt(idx: number, patch: Partial<HolidayEntry>) {
    const next = holidays.slice()
    next[idx] = { ...next[idx], ...patch } as HolidayEntry
    onChange(next)
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
      <header>
        <h2 className="font-semibold">Holidays</h2>
        <p className="text-xs text-white/50 mt-1">
          On a matching day, calls run the <span className="font-mono">Holiday</span> IVR tree (if you've built one).
          Holidays override business-hours routing.
        </p>
      </header>

      {holidays.length === 0 ? (
        <p className="text-sm text-white/50">No holidays configured.</p>
      ) : (
        <div className="space-y-2">
          {holidays.map((h, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-3 py-2 rounded border border-white/10 bg-gray-950/50"
            >
              {h.kind === 'date' ? (
                <>
                  <span className="text-xs font-mono text-white/60 w-20">One-off</span>
                  <input
                    type="date"
                    value={h.date}
                    onChange={(e) => patchAt(idx, { date: e.target.value })}
                    className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm"
                  />
                </>
              ) : (
                <>
                  <span className="text-xs font-mono text-white/60 w-20">Recurring</span>
                  <select
                    value={h.month}
                    onChange={(e) => patchAt(idx, { month: parseInt(e.target.value, 10) })}
                    className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {new Date(2000, m - 1, 1).toLocaleString('en-US', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                  <select
                    value={h.day}
                    onChange={(e) => patchAt(idx, { day: parseInt(e.target.value, 10) })}
                    className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </>
              )}
              <input
                type="text"
                value={h.label ?? ''}
                onChange={(e) => patchAt(idx, { label: e.target.value })}
                placeholder="Label (e.g. Christmas)"
                maxLength={80}
                className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm flex-1 min-w-0"
              />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="text-xs text-white/40 hover:text-red-400 px-1"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addDateHoliday}
          className="text-xs px-3 py-1.5 rounded border border-white/15 hover:bg-white/10"
        >
          + One-off date
        </button>
        <button
          type="button"
          onClick={addRecurringHoliday}
          className="text-xs px-3 py-1.5 rounded border border-white/15 hover:bg-white/10"
        >
          + Recurring (every year)
        </button>
      </div>
    </section>
  )
}

function CurrentTreePreview({
  ivrEnabled,
  ivrConfig,
  businessHours,
  holidays,
}: {
  ivrEnabled: boolean
  ivrConfig: IvrConfig
  businessHours: BusinessHoursSchedule
  holidays: HolidayEntry[]
}) {
  if (!ivrEnabled) return null

  const tz = businessHours.tz || 'America/Chicago'
  const now = new Date()
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const picked = pickIvrTree({ config: ivrConfig, businessHours, holidays, now })

  const explain: Record<string, string> = {
    holiday: "today matches a holiday entry and a Holiday tree is configured.",
    after_hours: "outside business hours and an After-hours tree is configured.",
    default: "default tree (no holiday match, inside business hours, or no after-hours tree built).",
  }

  return (
    <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/15 px-4 py-3 text-sm">
      <span className="text-emerald-300 font-medium">Right now:</span>{' '}
      using <span className="font-mono text-emerald-200">{picked}</span> tree — {explain[picked]}
      <span className="text-white/40 ml-2">({dateFmt.format(now)} {tz})</span>
    </div>
  )
}


function DispositionsSection({
  options,
  onChange,
}: {
  options: string[] | null
  onChange: (next: string[] | null) => void
}) {
  const usingDefault = options === null
  const list = options ?? []

  function setAt(i: number, v: string) {
    const next = list.slice()
    next[i] = v
    onChange(next)
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
      <header>
        <h2 className="font-semibold">Call dispositions</h2>
        <p className="text-xs text-white/50 mt-1">
          The quick outcome buttons shown when a call ends (logged to Call Log 2).
          Leave the default set or customize the list.
        </p>
      </header>

      {usingDefault ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {DEFAULT_DISPOSITIONS.map((d) => (
              <span key={d} className="px-2.5 py-1 rounded-md text-xs bg-white/10 text-white/80">
                {d}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange([...DEFAULT_DISPOSITIONS])}
            className="text-xs px-3 py-1.5 rounded border border-white/15 hover:bg-white/10"
          >
            Customize
          </button>
          <p className="text-xs text-white/40">Using the default set.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                maxLength={40}
                onChange={(e) => setAt(i, e.target.value)}
                placeholder="Disposition label"
                className="bg-gray-900 border border-white/15 rounded px-2 py-1.5 text-sm flex-1 min-w-0"
              />
              <button
                type="button"
                onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                className="text-xs text-white/40 hover:text-red-400 px-1"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onChange([...list, ''])}
              className="text-xs px-3 py-1.5 rounded border border-white/15 hover:bg-white/10"
            >
              + Add option
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-xs px-3 py-1.5 rounded border border-white/15 hover:bg-white/10 text-white/60"
            >
              Reset to default
            </button>
          </div>
          <p className="text-xs text-white/40">
            Blank rows are ignored on save. Reset to use the built-in default set.
          </p>
        </div>
      )}
    </section>
  )
}

function RecipientGrid({
  empty,
  items,
  selected,
  onToggle,
}: {
  empty: string
  items: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const selectedSet = new Set(selected)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">Recipients</span>
        <span className="text-xs text-white/40">{selectedSet.size} selected</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/50">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((it) => {
            const on = selectedSet.has(it.id)
            return (
              <label
                key={it.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                  on
                    ? 'bg-brand/20 border-brand/40'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(it.id)}
                  className="accent-brand"
                />
                <span className="text-sm">{it.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
