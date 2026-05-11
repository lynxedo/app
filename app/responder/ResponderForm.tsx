'use client'

import { useState } from 'react'

interface ResponderSettings {
  id: string
  is_active: boolean
  twilio_phone_number: string | null
  business_days: number[]
  business_hours_start: string
  business_hours_end: string
  business_hours_template: string
  afterhours_template: string
  voicemail_greeting: string
  notification_emails: string
}

interface ResponderCall {
  id: string
  call_sid: string
  from_number: string | null
  called_at: string
  has_voicemail: boolean
  text_sent: boolean
  email_sent: boolean
  template_used: string | null
  error_message: string | null
}

interface Props {
  initial: ResponderSettings | null
  recentCalls: ResponderCall[]
}

const DAY_LABELS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa']
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DEFAULT_SETTINGS: ResponderSettings = {
  id: '00000000-0000-0000-0000-000000000001',
  is_active: false,
  twilio_phone_number: null,
  business_days: [1, 2, 3, 4, 5],
  business_hours_start: '08:00:00',
  business_hours_end: '18:00:00',
  business_hours_template: "Hi {first_name}! Sorry we missed your call at Heroes Lawn Care. We're with another customer right now but will call you back shortly!",
  afterhours_template: "Hi {first_name}! Sorry we missed your call at Heroes Lawn Care. We're currently closed but will reach out first thing in the morning!",
  voicemail_greeting: "Thanks for calling Heroes Lawn Care! We missed you — please leave a message after the beep and we will get right back to you.",
  notification_emails: 'ben@heroeslawntx.com',
}

function pgTimeToHtml(t: string | null | undefined): string {
  if (!t) return '08:00'
  return t.slice(0, 5)
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Unknown'
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  )
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function ResponderForm({ initial, recentCalls }: Props) {
  const s = initial ?? DEFAULT_SETTINGS

  const [isActive, setIsActive] = useState(s.is_active)
  const [twilioPhone, setTwilioPhone] = useState(s.twilio_phone_number ?? '')
  const [businessDays, setBusinessDays] = useState<number[]>(s.business_days ?? [1, 2, 3, 4, 5])
  const [hoursStart, setHoursStart] = useState(pgTimeToHtml(s.business_hours_start))
  const [hoursEnd, setHoursEnd] = useState(pgTimeToHtml(s.business_hours_end))
  const [bhTemplate, setBhTemplate] = useState(s.business_hours_template)
  const [ahTemplate, setAhTemplate] = useState(s.afterhours_template)
  const [greeting, setGreeting] = useState(s.voicemail_greeting)
  const [notificationEmails, setNotificationEmails] = useState(s.notification_emails)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  function toggleDay(day: number) {
    setBusinessDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    )
  }

  async function save() {
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch('/api/responder/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: isActive,
          twilio_phone_number: twilioPhone.trim() || null,
          business_days: businessDays,
          business_hours_start: hoursStart + ':00',
          business_hours_end: hoursEnd + ':00',
          business_hours_template: bhTemplate,
          afterhours_template: ahTemplate,
          voicemail_greeting: greeting,
          notification_emails: notificationEmails,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveState('error')
        setSaveError(data.error ?? 'Save failed')
        return
      }
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (e) {
      setSaveState('error')
      setSaveError(e instanceof Error ? e.message : 'Network error')
    }
  }

  const inputCls =
    'w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors'
  const textareaCls = inputCls + ' resize-none'

  return (
    <div className="space-y-6">

      {/* Status toggle */}
      <div
        className={`rounded-2xl border p-5 flex items-center justify-between gap-4 transition-colors ${
          isActive ? 'bg-teal-900/20 border-teal-700' : 'bg-gray-900 border-gray-800'
        }`}
      >
        <div>
          <div className="font-semibold text-base">
            {isActive ? (
              <span className="text-teal-400">● Responder Active</span>
            ) : (
              <span className="text-gray-500">○ Responder Inactive</span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {isActive
              ? 'Missed calls will receive an auto-text and voicemails will be emailed.'
              : 'Turn on to start auto-texting missed calls.'}
          </div>
        </div>
        <button
          onClick={() => setIsActive(v => !v)}
          aria-label={isActive ? 'Deactivate Responder' : 'Activate Responder'}
          className={`relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            isActive ? 'bg-teal-600' : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              isActive ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Setup */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Setup</h2>
        <p className="text-gray-400 text-sm mb-5">
          Your Twilio number — set this as the missed-call forwarding destination in your Unitel account.
        </p>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Twilio Phone Number</label>
          <input
            value={twilioPhone}
            onChange={e => setTwilioPhone(e.target.value)}
            placeholder="+18321234567"
            className={inputCls}
          />
          <p className="text-xs text-gray-500 mt-1.5">
            E.164 format — e.g. +18321234567. Unitel forwards unanswered calls here.
          </p>
        </div>
      </section>

      {/* Business Hours */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Business Hours</h2>
        <p className="text-gray-400 text-sm mb-5">
          Calls inside these hours get the business hours message. Outside gets the after-hours message.
        </p>

        <div className="mb-5">
          <label className="block text-xs text-gray-400 mb-2">Business Days</label>
          <div className="flex gap-2">
            {DAY_LABELS.map((label, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                title={DAY_FULL[i]}
                className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                  businessDays.includes(i)
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1.5">Opens</label>
            <input
              type="time"
              value={hoursStart}
              onChange={e => setHoursStart(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="text-gray-600 pb-2.5">to</div>
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1.5">Closes</label>
            <input
              type="time"
              value={hoursEnd}
              onChange={e => setHoursEnd(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </section>

      {/* Text Templates */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Text Templates</h2>
        <p className="text-gray-400 text-sm mb-1">
          Sent via Captivated when a missed call comes in. Use{' '}
          <code className="bg-gray-800 px-1 py-0.5 rounded text-teal-400 text-xs">{'{first_name}'}</code>{' '}
          to personalize.
        </p>
        <p className="text-xs text-gray-600 mb-5">
          Captivated auto-appends the Heroes Lawn Care signature — do not add it manually.
        </p>

        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-400">Business Hours Message</label>
              <span className={`text-xs ${bhTemplate.length > 153 ? 'text-yellow-400' : 'text-gray-600'}`}>
                {bhTemplate.length} chars
              </span>
            </div>
            <textarea
              value={bhTemplate}
              onChange={e => setBhTemplate(e.target.value)}
              rows={3}
              className={textareaCls}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-400">After-Hours Message</label>
              <span className={`text-xs ${ahTemplate.length > 153 ? 'text-yellow-400' : 'text-gray-600'}`}>
                {ahTemplate.length} chars
              </span>
            </div>
            <textarea
              value={ahTemplate}
              onChange={e => setAhTemplate(e.target.value)}
              rows={3}
              className={textareaCls}
            />
          </div>
        </div>
      </section>

      {/* Voicemail */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Voicemail</h2>
        <p className="text-gray-400 text-sm mb-5">
          Configure the greeting callers hear and where recordings + transcripts are emailed.
        </p>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-400">Voicemail Greeting</label>
              <span className="text-xs text-gray-600">{greeting.length} chars</span>
            </div>
            <textarea
              value={greeting}
              onChange={e => setGreeting(e.target.value)}
              rows={3}
              placeholder="What Twilio reads before the beep..."
              className={textareaCls}
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Read aloud by Twilio before the caller can leave a message.
            </p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Send Voicemail Notifications To</label>
            <input
              value={notificationEmails}
              onChange={e => setNotificationEmails(e.target.value)}
              placeholder="ben@heroeslawntx.com"
              className={inputCls}
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Comma-separated. Each address gets an email with the recording and transcript.
            </p>
          </div>
        </div>
      </section>

      {/* Save */}
      {saveError && <p className="text-red-400 text-sm">{saveError}</p>}
      <button
        onClick={save}
        disabled={saveState === 'saving'}
        className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-semibold rounded-xl transition-colors"
      >
        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Settings Saved' : 'Save Settings'}
      </button>

      {/* Recent Activity */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Recent Activity</h2>
        <p className="text-gray-400 text-sm mb-4">Last 20 calls handled by Responder.</p>

        {recentCalls.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">
            No calls yet. Once Twilio is configured and a missed call comes in, it will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2 px-2 font-medium">Date / Time</th>
                  <th className="text-left pb-2 px-2 font-medium">Caller</th>
                  <th className="text-center pb-2 px-2 font-medium">VM</th>
                  <th className="text-center pb-2 px-2 font-medium">Texted</th>
                  <th className="text-center pb-2 px-2 font-medium">Emailed</th>
                  <th className="text-left pb-2 px-2 font-medium">Template</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {recentCalls.map(call => (
                  <tr key={call.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-2.5 px-2 text-gray-300 whitespace-nowrap">
                      {formatDateTime(call.called_at)}
                    </td>
                    <td className="py-2.5 px-2 text-gray-300">
                      {call.from_number ? formatPhone(call.from_number) : (
                        <span className="text-gray-600">Private</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {call.has_voicemail
                        ? <span className="text-teal-400 font-medium">✓</span>
                        : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {call.text_sent
                        ? <span className="text-teal-400 font-medium">✓</span>
                        : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {call.email_sent
                        ? <span className="text-teal-400 font-medium">✓</span>
                        : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="py-2.5 px-2 text-gray-500 text-xs">
                      {call.template_used === 'business_hours' ? 'Business hrs'
                        : call.template_used === 'afterhours' ? 'After hrs'
                        : call.error_message
                          ? <span className="text-red-400" title={call.error_message}>Error</span>
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  )
}
