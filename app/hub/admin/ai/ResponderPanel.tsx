'use client'

import { useEffect, useState } from 'react'
import { type ResponderSettings, type ResponderCall, RESPONDER_DEFAULTS } from '@/lib/responder'

const RESP_DAY_LABELS = [
  { num: 1, label: 'Mon' }, { num: 2, label: 'Tue' }, { num: 3, label: 'Wed' },
  { num: 4, label: 'Thu' }, { num: 5, label: 'Fri' }, { num: 6, label: 'Sat' },
  { num: 0, label: 'Sun' },
]

export default function ResponderPanel({
  initialResponder,
  initialResponderCalls,
}: {
  initialResponder: Omit<ResponderSettings, 'id' | 'company_id'> | null
  initialResponderCalls: ResponderCall[]
}) {
  // Responder — separate state + save from main dialer settings
  const [resp, setResp] = useState<Omit<ResponderSettings, 'id' | 'company_id'>>(
    initialResponder ?? RESPONDER_DEFAULTS
  )
  const [respSaving, setRespSaving] = useState(false)
  const [respSavedAt, setRespSavedAt] = useState<number | null>(null)
  const [respError, setRespError] = useState<string | null>(null)
  const [respCalls, setRespCalls] = useState<ResponderCall[]>(initialResponderCalls)

  // Voicemail auto-reply instructions (Responder AI prompt — stored on
  // responder_settings.ai_reply_prompt, loaded/saved via /api/admin/responder-settings).
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiPromptDefault, setAiPromptDefault] = useState('')
  const [aiPromptLoaded, setAiPromptLoaded] = useState(false)
  const [aiPromptLoading, setAiPromptLoading] = useState(false)
  const [aiPromptSaving, setAiPromptSaving] = useState(false)
  const [aiPromptSavedAt, setAiPromptSavedAt] = useState<number | null>(null)
  const [aiPromptError, setAiPromptError] = useState<string | null>(null)
  const [aiPromptUsingDefault, setAiPromptUsingDefault] = useState(false)

  async function saveResp() {
    setRespSaving(true)
    setRespError(null)
    try {
      const res = await fetch('/api/admin/responder-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resp),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      setRespSavedAt(Date.now())
      // Refresh the activity log
      const callsRes = await fetch('/api/admin/responder-calls')
      if (callsRes.ok) setRespCalls(await callsRes.json())
    } catch (err) {
      setRespError(err instanceof Error ? err.message : String(err))
    } finally {
      setRespSaving(false)
    }
  }

  // Load the voicemail auto-reply prompt when the panel opens.
  useEffect(() => {
    if (aiPromptLoaded || aiPromptLoading) return
    setAiPromptLoading(true)
    setAiPromptError(null)
    fetch('/api/admin/responder-settings')
      .then(r => r.json().then(b => ({ ok: r.ok, body: b })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body?.error ?? 'Failed to load auto-reply instructions')
        const def = (body?.ai_reply_prompt_default as string) ?? ''
        const saved = (body?.ai_reply_prompt as string | null) ?? null
        setAiPromptDefault(def)
        setAiPromptUsingDefault(!saved || !saved.trim())
        setAiPrompt(saved && saved.trim() ? saved : def)
        setAiPromptLoaded(true)
      })
      .catch(e => setAiPromptError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAiPromptLoading(false))
  }, [aiPromptLoaded, aiPromptLoading])

  async function saveAiPrompt() {
    setAiPromptSaving(true)
    setAiPromptError(null)
    try {
      const res = await fetch('/api/admin/responder-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_reply_prompt: aiPrompt }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      setAiPromptUsingDefault(!aiPrompt.trim())
      setAiPromptSavedAt(Date.now())
      setTimeout(() => setAiPromptSavedAt(null), 4000)
    } catch (e) {
      setAiPromptError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiPromptSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="border border-white/10 rounded-lg p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Responder</h2>
          <p className="text-xs text-white/50 mt-0.5">Auto-text callers who reach voicemail</p>
        </div>

        {/* Mode selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/70 block">Mode</label>
          <div className="grid gap-2">
            {[
              { val: 'off', title: 'Off', desc: 'Normal IVR and agent routing. No auto-text.' },
              { val: 'forwarded_line', title: 'Forwarded Line', desc: 'For the 888 today. Calls forwarded here skip ringing → straight to voicemail. Auto-text sent after the call.' },
              { val: 'main_line', title: 'Main Line', desc: 'For after we port our local number. Calls ring the team normally; only unanswered calls get the voicemail + auto-text.' },
            ].map(opt => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setResp(p => ({ ...p, mode: opt.val as typeof p.mode }))}
                className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                  resp.mode === opt.val
                    ? 'border-brand bg-brand/15'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${resp.mode === opt.val ? 'border-brand' : 'border-white/30'}`}>
                    {resp.mode === opt.val && <span className="w-1.5 h-1.5 rounded-full bg-brand" />}
                  </span>
                  <span className="text-sm font-medium text-white">{opt.title}</span>
                </div>
                <p className="text-xs text-white/50 mt-1 ml-[22px]">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {resp.mode === 'forwarded_line' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-white/70 block">Ring before voicemail</label>
            <p className="text-xs text-white/50">
              Let the call ring first so a missed call appears in the Dialer and triggers a notification — even if the caller hangs up without leaving a voicemail. Set to Off to keep the current behavior (straight to voicemail, no ring).
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {[0, 1, 2, 3, 5, 10, 15, 20].map(sec => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setResp(p => ({ ...p, forwarded_line_ring_sec: sec }))}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    resp.forwarded_line_ring_sec === sec
                      ? 'bg-brand text-[#fff]'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  {sec === 0 ? 'Off' : `${sec}s`}
                </button>
              ))}
            </div>
          </div>
        )}

        {resp.mode !== 'off' && (
          <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-3 text-xs text-sky-200 leading-relaxed">
            Callers hear the <strong>voicemail greeting from your regular Dialer settings above</strong> — there's no separate greeting here. The auto-text is sent a moment after the call ends.
          </div>
        )}

        {/* AI personalized reply */}
        <div className="border border-white/10 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">AI personalized reply</p>
              <p className="text-xs text-white/50 mt-0.5">
                After transcribing a voicemail, sends a second SMS that references what the caller actually said — feels human, not automated.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={resp.ai_reply_enabled}
              onClick={() => setResp(p => ({ ...p, ai_reply_enabled: !p.ai_reply_enabled }))}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
                resp.ai_reply_enabled ? 'bg-brand' : 'bg-white/20'
              }`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                resp.ai_reply_enabled ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
          {resp.ai_reply_enabled && (
            <p className="text-xs text-amber-300/80">
              Only fires when the caller leaves a voicemail. SMS #1 (the generic template above) sends at call time; this AI reply sends ~30–90s later once transcription completes.
            </p>
          )}
        </div>

        {/* Business days */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/70 block">Business days</label>
          <div className="flex gap-1.5 flex-wrap">
            {RESP_DAY_LABELS.map(d => (
              <button
                key={d.num}
                type="button"
                onClick={() => setResp(p => ({
                  ...p,
                  business_days: p.business_days.includes(d.num)
                    ? p.business_days.filter(x => x !== d.num)
                    : [...p.business_days, d.num],
                }))}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  resp.business_days.includes(d.num)
                    ? 'bg-brand text-[#fff]'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Business hours */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-white/70 block mb-1">Opens</label>
            <input
              type="time"
              value={resp.business_hours_start}
              onChange={e => setResp(p => ({ ...p, business_hours_start: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-white/70 block mb-1">Closes</label>
            <input
              type="time"
              value={resp.business_hours_end}
              onChange={e => setResp(p => ({ ...p, business_hours_end: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Templates — time-of-day × voicemail-or-not */}
        <div className="space-y-4">
          <p className="text-xs text-white/50">
            Text messages vary by time of day and whether the caller left a voicemail. Variable: <code className="bg-white/10 px-1 rounded">{'{first_name}'}</code>
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Business hours column */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-white/80">Business hours</p>
              <div>
                <label className="text-xs font-medium text-white/60 block mb-1">Left a voicemail</label>
                <textarea
                  value={resp.business_hours_template}
                  onChange={e => setResp(p => ({ ...p, business_hours_template: e.target.value.slice(0, 600) }))}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/60 block mb-1">No message left</label>
                <textarea
                  value={resp.business_hours_no_message_template}
                  onChange={e => setResp(p => ({ ...p, business_hours_no_message_template: e.target.value.slice(0, 600) }))}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            {/* After-hours column */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-white/80">After hours / weekends</p>
              <div>
                <label className="text-xs font-medium text-white/60 block mb-1">Left a voicemail</label>
                <textarea
                  value={resp.afterhours_template}
                  onChange={e => setResp(p => ({ ...p, afterhours_template: e.target.value.slice(0, 600) }))}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/60 block mb-1">No message left</label>
                <textarea
                  value={resp.afterhours_no_message_template}
                  onChange={e => setResp(p => ({ ...p, afterhours_no_message_template: e.target.value.slice(0, 600) }))}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={saveResp}
            disabled={respSaving}
            className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
          >
            {respSaving ? 'Saving…' : 'Save Responder'}
          </button>
          {respSavedAt && !respError && <span className="text-xs text-emerald-300">Saved ✓</span>}
          {respError && <span className="text-xs text-red-400">{respError}</span>}
        </div>

        {/* Recent activity */}
        {respCalls.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Recent Activity</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="text-left pb-1.5 font-medium">Time</th>
                    <th className="text-left pb-1.5 font-medium">From</th>
                    <th className="text-left pb-1.5 font-medium">Texted</th>
                    <th className="text-left pb-1.5 font-medium">VM</th>
                    <th className="text-left pb-1.5 font-medium">Template</th>
                  </tr>
                </thead>
                <tbody>
                  {respCalls.map(c => (
                    <tr key={c.id} className="border-b border-white/5 text-white/70">
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {new Date(c.called_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit', hour12: true,
                          timeZone: 'America/Chicago',
                        })}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{c.from_number || '—'}</td>
                      <td className="py-1.5 pr-3">
                        {c.text_sent ? <span className="text-emerald-300">✓</span> : <span className="text-white/30">—</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {c.has_voicemail ? <span className="text-sky-300">✓</span> : <span className="text-white/30">—</span>}
                      </td>
                      <td className="py-1.5 text-white/40">
                        {c.error_message === 'do_not_text' ? 'opted out' : (c.template_used || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* AI voicemail reply — the instructions the AI uses to write the personalized
          text it sends back after a customer leaves a voicemail. */}
      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Voicemail auto-reply instructions</h2>
          <p className="text-xs text-white/50 mt-1">
            The instructions that tell the AI how to write the personalized text it sends back
            after a customer leaves a voicemail. Turn the feature on/off at{' '}
            <span className="text-white/70">Admin → AI → Auto Responder → "AI personalized reply."</span>{' '}
            The AI also uses all the knowledge docs in the Knowledge tab — keep those up to date and this reply
            will automatically reflect your services, pricing, and tone.
            Leave it blank to use the built-in default.
          </p>
        </div>

        {aiPromptLoading && <p className="text-sm text-white/50">Loading…</p>}
        {aiPromptError && <p className="text-sm text-red-300">{aiPromptError}</p>}

        {aiPromptLoaded && (
          <>
            {aiPromptUsingDefault && (
              <p className="text-xs text-amber-300/90">
                Currently using the built-in default (shown below). Edit and save to customize it.
              </p>
            )}
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={18}
              spellCheck={false}
              className="w-full bg-gray-900 border border-white/15 rounded px-3 py-2 text-sm font-mono leading-relaxed"
              placeholder="Instructions for the AI auto-reply…"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={saveAiPrompt}
                disabled={aiPromptSaving}
                className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
              >
                {aiPromptSaving ? 'Saving…' : 'Save instructions'}
              </button>
              <button
                onClick={() => setAiPrompt(aiPromptDefault)}
                disabled={aiPromptSaving || aiPrompt === aiPromptDefault}
                className="px-3 py-2 rounded bg-white/10 hover:bg-white/15 disabled:opacity-40 text-sm"
              >
                Reset to default
              </button>
              <span className="text-xs text-white/40">{aiPrompt.length.toLocaleString()} characters</span>
              {aiPromptSavedAt && <span className="text-xs text-emerald-300">Saved ✓</span>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
