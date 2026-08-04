'use client'

import { useCallback, useEffect, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'

type TriggerType = 'new_lead' | 'lead_source' | 'manual' | 'stage_changed'
type Channel = 'sms' | 'email'
type EnrollWindow = 'always' | 'business_hours' | 'after_hours'

type Campaign = {
  id: string
  name: string
  description: string
  trigger_type: TriggerType
  trigger_config: any
  status: 'draft' | 'active' | 'paused'
  enroll_window?: EnrollWindow
  active_enrollments: number
  step_count: number
  channels?: Channel[]
}

// UI step model. Step 0 fires immediately; later steps carry a wait before them.
// One shape holds every channel's fields; buildPayload emits the right content_ref.
type UIStep = {
  channel: Channel
  unit: 'days' | 'hours'
  value: number
  body: string // sms message OR email markdown body
  subject: string // email
  identityId: string // email "send from" ('' = company default)
  ignoreQuietHours: boolean // send even inside the quiet-hours window
  // Text steps only. resolve = what happens to the Txt thread after this sends.
  // smsTarget = where it sends for a Google Local Services lead.
  resolve: ResolveMode
  resolveUserId: string // '' unless resolve === 'assign'
  smsTarget: SmsTarget
}

type ResolveMode = 'archive' | 'unassigned' | 'assign'
type SmsTarget = 'direct' | 'lsa' | 'both'

type DripUser = { id: string; display_name: string }
type Identity = { id: string; label: string; from_email: string; is_default: boolean }
type Stage = { key: string; label: string }
type Settings = {
  quiet_hours: { start: number; end: number; tz: string }
  send_as_user_id: string | null
  frequency_cap: number
  business_display_name: string | null
  default_email_identity_id: string | null
  text_autonomy: string
}

const BASE = '/api/hub/marketing/drip/campaigns'
const SETTINGS_URL = '/api/hub/marketing/drip/settings'
const STAGES_URL = '/api/tracker/stages'

const TRIGGER_LABEL: Record<TriggerType, string> = {
  new_lead: 'Any new lead',
  lead_source: 'Lead source',
  manual: 'Manual',
  stage_changed: 'Stage changed',
}
const ENROLL_WINDOW_LABEL: Record<EnrollWindow, string> = {
  always: 'Anytime',
  business_hours: 'Business hours only',
  after_hours: 'After hours & weekends only',
}
const CHANNEL_LABEL: Record<Channel, string> = { sms: 'Text', email: 'Email' }
const RESOLVE_LABEL: Record<ResolveMode, string> = {
  archive: 'Archive it (out of the inbox until they reply)',
  unassigned: 'Leave it in the Queue for anyone to claim',
  assign: 'Assign it to…',
}
const SMS_TARGET_LABEL: Record<SmsTarget, string> = {
  direct: 'Text their own number',
  lsa: 'Reply in the Google LSA conversation',
  both: 'Both — Google reply and a direct text',
}
const CHANNEL_WORD: Record<Channel, string> = { sms: 'text', email: 'email' }
const STATUS_STYLE: Record<Campaign['status'], string> = {
  draft: 'bg-gray-700/40 border-gray-600 text-gray-300',
  active: 'bg-green-500/15 border-green-500/40 text-green-300',
  paused: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
}

function newStep(channel: Channel = 'sms'): UIStep {
  return {
    channel, unit: 'days', value: 1, body: '', subject: '', identityId: '', ignoreQuietHours: false,
    resolve: 'archive', resolveUserId: '', smsTarget: 'direct',
  }
}

// Format an hour (0–24) as a friendly AM/PM clock label for the quiet-hours pickers.
function hourLabel(h: number): string {
  if (h === 24 || h === 0) return h === 24 ? 'Midnight (12 AM)' : '12:00 AM (midnight)'
  if (h === 12) return '12:00 PM (noon)'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

export default function DripView() {
  const toast = useToast()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [users, setUsers] = useState<DripUser[]>([])
  const [identities, setIdentities] = useState<Identity[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null)
  const [monitorFor, setMonitorFor] = useState<Campaign | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const load = useCallback(async () => {
    try {
      const [cRes, sRes, stRes] = await Promise.all([fetch(BASE), fetch(SETTINGS_URL), fetch(STAGES_URL)])
      const cData = await cRes.json().catch(() => ({}))
      const sData = await sRes.json().catch(() => ({}))
      const stData = await stRes.json().catch(() => ([]))
      if (cRes.ok) setCampaigns(cData.campaigns || [])
      else toast.error(cData.error || 'Could not load campaigns.')
      if (sRes.ok) {
        setSettings(sData.settings || null)
        setUsers(sData.users || [])
        setIdentities(sData.email_identities || [])
      }
      if (stRes.ok && Array.isArray(stData)) {
        setStages(stData.map((s: any) => ({ key: s.key, label: s.label })).filter((s: Stage) => s.key))
      }
    } finally {
      setLoading(false)
    }
  }, [toast])
  useEffect(() => { load() }, [load])

  async function setStatus(c: Campaign, status: 'active' | 'paused' | 'draft') {
    const res = await fetch(`${BASE}/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error || 'Could not update status.'); return }
    toast.success(status === 'active' ? 'Campaign activated.' : status === 'paused' ? 'Campaign paused.' : 'Set to draft.')
    load()
  }

  async function remove(c: Campaign) {
    if (!(await confirm({ message: `Delete “${c.name}”? Enrollments and history are removed.`, confirmText: 'Delete', danger: true }))) return
    const res = await fetch(`${BASE}/${c.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Campaign deleted.'); setCampaigns((p) => p.filter((x) => x.id !== c.id)) }
    else toast.error('Could not delete.')
  }

  const senderMissing = !!settings && !settings.send_as_user_id
  const senderName = settings?.send_as_user_id ? users.find((u) => u.id === settings.send_as_user_id)?.display_name : null
  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label || key

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Drip</h1>
            <p className="text-sm text-gray-500 mt-1">
              Reach new leads the moment they arrive — by text or email — then follow up automatically, and stop the instant they reply.
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <Button variant="ghost" onClick={() => setShowSettings(true)}>Settings</Button>
            <Button onClick={() => setEditing('new')}>+ New campaign</Button>
          </div>
        </div>

        {senderMissing && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
            Before a <strong>text</strong> campaign can send, choose <strong>who texts are sent as</strong> in{' '}
            <button className="underline hover:text-amber-100" onClick={() => setShowSettings(true)}>Settings</button>.
          </div>
        )}
        {senderName && (
          <p className="text-xs text-gray-500">Texts send as <span className="text-gray-400">{senderName}</span> · they land in that person’s Txt inbox and replies pause the drip.</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
        ) : campaigns.length === 0 ? (
          <EmptyState title="No drip campaigns yet — build a speed-to-lead sequence that reaches new leads instantly." />
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={'text-xs px-2 py-0.5 rounded-full border ' + STATUS_STYLE[c.status]}>{c.status}</span>
                      <span className="font-medium text-gray-100 truncate">{c.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Trigger: <span className="text-gray-400">{TRIGGER_LABEL[c.trigger_type]}{c.trigger_type === 'lead_source' && c.trigger_config?.lead_source ? ` · ${c.trigger_config.lead_source}` : ''}{c.trigger_type === 'stage_changed' && c.trigger_config?.stage ? ` · ${stageLabel(c.trigger_config.stage)}` : ''}</span>
                      {' · '}{c.step_count} step{c.step_count === 1 ? '' : 's'}
                      {c.channels && c.channels.length > 0 && (
                        <> · {c.channels.map((ch) => CHANNEL_LABEL[ch] || ch).join(', ')}</>
                      )}
                      {' · '}{c.active_enrollments} active
                    </div>
                  </div>
                  <div className="flex-none flex flex-col items-end gap-1.5 text-sm">
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(c)} className="text-gray-400 hover:text-white">Edit</button>
                      <button onClick={() => setMonitorFor(c)} className="text-gray-400 hover:text-white">Monitor</button>
                    </div>
                    <div className="flex gap-2">
                      {c.status === 'active' ? (
                        <button onClick={() => setStatus(c, 'paused')} className="text-amber-300/90 hover:text-amber-300">Pause</button>
                      ) : (
                        <button onClick={() => setStatus(c, 'active')} className="text-green-300/90 hover:text-green-300">Activate</button>
                      )}
                      <button onClick={() => remove(c)} className="text-red-400/80 hover:text-red-400">Delete</button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <CampaignEditor
          campaign={editing === 'new' ? null : editing}
          identities={identities}
          stages={stages}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setLoading(true); load() }}
        />
      )}
      {monitorFor && <EnrollmentMonitor campaign={monitorFor} onClose={() => setMonitorFor(null)} />}
      {showSettings && (
        <DripSettingsModal
          settings={settings}
          users={users}
          identities={identities}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load() }}
        />
      )}
    </div>
  )
}

function CampaignEditor({ campaign, identities, stages, users, onClose, onSaved }: {
  campaign: Campaign | null; identities: Identity[]; stages: Stage[]; users: DripUser[]; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(campaign?.name || '')
  const [triggerType, setTriggerType] = useState<TriggerType>(campaign?.trigger_type || 'new_lead')
  const [leadSource, setLeadSource] = useState<string>(campaign?.trigger_config?.lead_source || '')
  const [stage, setStage] = useState<string>(campaign?.trigger_config?.stage || '')
  const [enrollWindow, setEnrollWindow] = useState<EnrollWindow>(campaign?.enroll_window || 'always')
  const [steps, setSteps] = useState<UIStep[]>([])
  const [loadingSteps, setLoadingSteps] = useState(!!campaign)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!campaign) { setSteps([newStep('sms')]); return }
    (async () => {
      try {
        const res = await fetch(`${BASE}/${campaign.id}`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const ui: UIStep[] = (data.steps || []).map((s: any) => {
            const days = Number(s?.delay?.days)
            const hours = Number(s?.delay?.hours)
            const unit: 'days' | 'hours' = hours > 0 ? 'hours' : 'days'
            const value = hours > 0 ? hours : days > 0 ? days : 1
            const channel: Channel = ['sms', 'email'].includes(s?.channel) ? s.channel : 'sms'
            return {
              channel, unit, value,
              body: typeof s?.content_ref?.body === 'string' ? s.content_ref.body : '',
              subject: typeof s?.content_ref?.subject === 'string' ? s.content_ref.subject : '',
              identityId: typeof s?.content_ref?.identity_id === 'string' ? s.content_ref.identity_id : '',
              ignoreQuietHours: s?.ignore_quiet_hours === true,
              resolve: (['archive', 'unassigned', 'assign'].includes(s?.resolve) ? s.resolve : 'archive') as ResolveMode,
              resolveUserId: typeof s?.resolve_user_id === 'string' ? s.resolve_user_id : '',
              smsTarget: (['direct', 'lsa', 'both'].includes(s?.sms_target) ? s.sms_target : 'direct') as SmsTarget,
            }
          })
          setSteps(ui.length ? ui : [newStep('sms')])
        }
      } finally {
        setLoadingSteps(false)
      }
    })()
  }, [campaign])

  function addStep() { setSteps((p) => [...p, newStep(p[p.length - 1]?.channel || 'sms')]) }
  function move(i: number, dir: -1 | 1) {
    setSteps((p) => {
      const j = i + dir
      if (j < 0 || j >= p.length) return p
      const copy = [...p]; const [x] = copy.splice(i, 1); copy.splice(j, 0, x); return copy
    })
  }
  function removeStep(i: number) { setSteps((p) => p.filter((_, k) => k !== i)) }
  function updateStep(i: number, patch: Partial<UIStep>) { setSteps((p) => p.map((s, k) => (k === i ? { ...s, ...patch } : s))) }

  function buildPayload() {
    return {
      name: name.trim(),
      trigger_type: triggerType,
      trigger_config:
        triggerType === 'lead_source' ? { lead_source: leadSource.trim() }
          : triggerType === 'stage_changed' ? { stage }
            : {},
      enroll_window: enrollWindow,
      steps: steps.map((s, i) => {
        const delay = i === 0 ? { minutes: 0 } : { [s.unit]: Math.max(1, Math.round(s.value || 1)) }
        const content_ref: any = s.channel === 'email'
          ? { subject: s.subject.trim(), body: s.body.trim(), ...(s.identityId ? { identity_id: s.identityId } : {}) }
          : { body: s.body.trim() }
        return {
          channel: s.channel, delay, content_ref, ignore_quiet_hours: s.ignoreQuietHours,
          // Text-only settings; the server ignores them for other channels.
          resolve: s.resolve,
          resolve_user_id: s.resolve === 'assign' ? s.resolveUserId : null,
          sms_target: s.smsTarget,
        }
      }),
    }
  }

  function firstStepError(): string | null {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      if (s.channel === 'sms' && !s.body.trim()) return `Step ${i + 1}: write the text message.`
      if (s.channel === 'sms' && s.resolve === 'assign' && !s.resolveUserId)
        return `Step ${i + 1}: choose who the conversation goes to.`
      if (s.channel === 'email' && !s.subject.trim()) return `Step ${i + 1}: add an email subject.`
      if (s.channel === 'email' && !s.body.trim()) return `Step ${i + 1}: write the email message.`
    }
    return null
  }

  async function save() {
    if (!name.trim()) { toast.error('Give it a name.'); return }
    if (triggerType === 'lead_source' && !leadSource.trim()) { toast.error('Enter the lead source (e.g. “Angi Lead”).'); return }
    if (triggerType === 'stage_changed' && !stage) { toast.error('Pick the stage that triggers this campaign.'); return }
    const stepErr = firstStepError()
    if (stepErr) { toast.error(stepErr); return }
    setSaving(true)
    try {
      const payload = buildPayload()
      const res = campaign
        ? await fetch(`${BASE}/${campaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(campaign ? 'Campaign saved.' : 'Campaign created (draft).')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={campaign ? 'Edit campaign' : 'New campaign'}
      maxWidth="max-w-2xl"
      fullScreenOnMobile
      footer={
        <div className="flex items-center justify-end w-full gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New lead speed-to-lead"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Trigger — which leads enter this campaign</label>
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
            <option value="new_lead">Any new lead (all sources)</option>
            <option value="lead_source">A specific lead source</option>
            <option value="stage_changed">A lead moves to a stage</option>
            <option value="manual">Manual only (no auto-enroll)</option>
          </select>
          {triggerType === 'lead_source' && (
            <div className="mt-2">
              <label className="block text-xs text-gray-400 mb-1">Lead source</label>
              <input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="e.g. Angi Lead"
                list="drip-lead-sources"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
              <datalist id="drip-lead-sources">
                <option value="Angi Lead" /><option value="Google (GBP / LSA)" /><option value="Google Ads" /><option value="Website" />
              </datalist>
              <p className="text-[11px] text-gray-500 mt-1">Must match the lead’s Lead Source exactly.</p>
            </div>
          )}
          {triggerType === 'stage_changed' && (
            <div className="mt-2">
              <label className="block text-xs text-gray-400 mb-1">Stage</label>
              {stages.length === 0 ? (
                <p className="text-[11px] text-gray-500">No Lead Tracker stages found. Add stages in the Lead Tracker first.</p>
              ) : (
                <select value={stage} onChange={(e) => setStage(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
                  <option value="">Choose a stage…</option>
                  {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              )}
              <p className="text-[11px] text-gray-500 mt-1">Enrolls a lead when its Lead Tracker card moves into this stage.</p>
            </div>
          )}
          {triggerType !== 'manual' && (
            <p className="text-xs text-gray-500 mt-1">Enrolls leads that qualify <em>after</em> you activate — it won’t reach your existing leads.</p>
          )}
        </div>

        {triggerType !== 'manual' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">When can leads enter this campaign?</label>
            <select value={enrollWindow} onChange={(e) => setEnrollWindow(e.target.value as EnrollWindow)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
              <option value="always">Anytime</option>
              <option value="business_hours">Only during business hours</option>
              <option value="after_hours">Only after hours &amp; weekends</option>
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Uses your business hours from <span className="text-gray-400">Admin → Dialer → Responder</span>. Pick <em>after hours &amp; weekends</em> to auto-nurture leads that arrive when no one’s in the office — e.g. let the office text Google leads manually during the day, and let this run at night.
            </p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-gray-400">Steps</label>
            <button onClick={addStep} className="text-xs rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-gray-200 hover:bg-gray-700">+ Add step</button>
          </div>

          {loadingSteps ? (
            <p className="text-sm text-gray-500 py-3 text-center">Loading…</p>
          ) : (
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="rounded-lg border border-gray-800 bg-gray-900 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">
                      <span className="text-gray-500">{i + 1}.</span>{' '}
                      {i === 0 ? (
                        <span className="text-sky-300/90">Sends immediately</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          Wait
                          <input type="number" min={1} value={s.value}
                            onChange={(e) => updateStep(i, { value: Number(e.target.value) })}
                            className="w-14 rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-sm text-white" />
                          <select value={s.unit} onChange={(e) => updateStep(i, { unit: e.target.value as 'days' | 'hours' })}
                            className="rounded bg-gray-800 border border-gray-700 px-1 py-0.5 text-sm text-white">
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                          </select>
                          then send
                        </span>
                      )}
                    </span>
                    <div className="flex-none flex items-center gap-1 text-gray-500">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1 hover:text-white disabled:opacity-30">↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="px-1 hover:text-white disabled:opacity-30">↓</button>
                      <button onClick={() => removeStep(i)} disabled={steps.length === 1} className="px-1 text-red-400/80 hover:text-red-400 disabled:opacity-30">✕</button>
                    </div>
                  </div>

                  {/* Channel picker */}
                  <div className="flex gap-1">
                    {(['sms', 'email'] as Channel[]).map((ch) => (
                      <button
                        key={ch}
                        onClick={() => updateStep(i, { channel: ch })}
                        className={
                          'text-xs px-2.5 py-1 rounded-lg border ' +
                          (s.channel === ch
                            ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                            : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200')
                        }
                      >
                        {CHANNEL_LABEL[ch]}
                      </button>
                    ))}
                  </div>

                  {/* Channel-specific content */}
                  {s.channel === 'sms' && (
                    <div className="space-y-2">
                      <textarea value={s.body} onChange={(e) => updateStep(i, { body: e.target.value })} rows={3}
                        placeholder={i === 0 ? 'Hi {{first_name}}! Thanks for reaching out to us…' : 'Just following up, {{first_name}}…'}
                        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white resize-y" />

                      {/* Where the text goes. Only changes anything for a lead that came
                          from Google Local Services — everyone else gets a direct text. */}
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Send to</label>
                        <select value={s.smsTarget} onChange={(e) => updateStep(i, { smsTarget: e.target.value as SmsTarget })}
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white">
                          {(['direct', 'lsa', 'both'] as SmsTarget[]).map((t) => (
                            <option key={t} value={t}>{SMS_TARGET_LABEL[t]}</option>
                          ))}
                        </select>
                        {s.smsTarget !== 'direct' && (
                          <p className="text-[11px] text-gray-500 mt-1">
                            Google only counts a response it can see, so replying in their conversation is what earns
                            credit for responding fast. Applies to Google Local Services leads; anyone else still gets a
                            normal text. If Google won’t take the reply, we text them directly instead.
                          </p>
                        )}
                      </div>

                      {/* What happens to the Txt thread once this step has sent. */}
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Afterwards</label>
                        <select value={s.resolve} onChange={(e) => updateStep(i, { resolve: e.target.value as ResolveMode })}
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white">
                          {(['archive', 'unassigned', 'assign'] as ResolveMode[]).map((r) => (
                            <option key={r} value={r}>{RESOLVE_LABEL[r]}</option>
                          ))}
                        </select>
                        {s.resolve === 'assign' && (
                          <select value={s.resolveUserId} onChange={(e) => updateStep(i, { resolveUserId: e.target.value })}
                            className="mt-1.5 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white">
                            <option value="">Choose a person…</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                          </select>
                        )}
                        <p className="text-[11px] text-gray-500 mt-1">
                          Either way, a reply from the customer reopens the conversation.
                        </p>
                      </div>
                    </div>
                  )}

                  {s.channel === 'email' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Subject</label>
                        <input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value })}
                          placeholder="e.g. Thanks for reaching out"
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Message (Markdown)</label>
                        <textarea value={s.body} onChange={(e) => updateStep(i, { body: e.target.value })} rows={4}
                          placeholder={'Hi there,\n\nThanks for reaching out — we’d love to help…'}
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white resize-y font-mono" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Send from</label>
                        {identities.length === 0 ? (
                          <p className="text-[11px] text-amber-300/80">No verified email domains yet — add one in Email Marketing before an email step can send.</p>
                        ) : (
                          <select value={s.identityId} onChange={(e) => updateStep(i, { identityId: e.target.value })}
                            className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white">
                            <option value="">Default sending address</option>
                            {identities.map((idn) => (
                              <option key={idn.id} value={idn.id}>{idn.label}{idn.is_default ? ' · default' : ''}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Ignore quiet hours — useful for the instant first touch so a 2am lead still gets answered. */}
                  <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer select-none">
                    <input type="checkbox" checked={s.ignoreQuietHours}
                      onChange={(e) => updateStep(i, { ignoreQuietHours: e.target.checked })}
                      className="h-3.5 w-3.5" />
                    Ignore quiet hours{i === 0 ? ' (answer instantly, even overnight)' : ''}
                  </label>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11px] text-gray-500 mt-1.5">
            Text steps: use <code className="text-gray-400">{'{{first_name}}'}</code> to personalize; the first text goes out within ~2 minutes of the lead landing, and the business name + a “Reply STOP to opt out” line are added automatically. Sends normally wait for quiet hours unless a step is set to ignore them.
          </p>
        </div>

        <p className="text-xs text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
          Saved as a <strong className="text-gray-300">draft</strong>. Activate it from the list when ready — only active campaigns enroll and send. Each channel’s prerequisites (a text sender, a verified email domain) are checked when you activate.
        </p>
      </div>
    </Modal>
  )
}

function EnrollmentMonitor({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<any[]>([])
  const [stepChannels, setStepChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [enrRes, cRes] = await Promise.all([
          fetch(`${BASE}/${campaign.id}/enrollments`),
          fetch(`${BASE}/${campaign.id}`),
        ])
        const enrData = await enrRes.json().catch(() => ({}))
        const cData = await cRes.json().catch(() => ({}))
        if (enrRes.ok) { setCounts(enrData.counts || {}); setRows(enrData.enrollments || []) }
        if (cRes.ok) setStepChannels((cData.steps || []).map((s: any) => (['sms', 'email'].includes(s?.channel) ? s.channel : 'sms')))
      } finally {
        setLoading(false)
      }
    })()
  }, [campaign.id])

  function stepLabel(idx: number): string {
    const ch = stepChannels[idx]
    return ch ? `${CHANNEL_WORD[ch]} ${idx + 1}` : `step ${idx + 1}`
  }

  return (
    <Modal open onClose={onClose} title={`Enrollments — ${campaign.name}`} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['active', 'replied', 'completed', 'opted_out'] as const).map((k) => (
            <div key={k} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
              <div className="text-xs text-gray-500 capitalize">{k.replace('_', ' ')}</div>
              <div className="text-lg font-semibold text-white">{loading ? '…' : counts[k] || 0}</div>
            </div>
          ))}
        </div>

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-3">No one is enrolled yet.</p>
        ) : (
          <ul className="rounded-lg border border-gray-800 divide-y divide-gray-800 text-sm max-h-80 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-gray-300 truncate">{r.label}</span>
                <span className="flex-none text-xs text-gray-500">{stepLabel(r.current_step_index)} · {r.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function DripSettingsModal({ settings, users, identities, onClose, onSaved }: {
  settings: Settings | null; users: DripUser[]; identities: Identity[]; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [sendAs, setSendAs] = useState<string>(settings?.send_as_user_id || '')
  const [quietStart, setQuietStart] = useState<number>(settings?.quiet_hours?.start ?? 8)
  const [quietEnd, setQuietEnd] = useState<number>(settings?.quiet_hours?.end ?? 20)
  const [tz, setTz] = useState<string>(settings?.quiet_hours?.tz || 'America/Chicago')
  const [freqCap, setFreqCap] = useState<number>(settings?.frequency_cap ?? 6)
  const [businessName, setBusinessName] = useState<string>(settings?.business_display_name || '')
  const [defaultIdentity, setDefaultIdentity] = useState<string>(settings?.default_email_identity_id || '')
  const [textAutonomy, setTextAutonomy] = useState<string>(settings?.text_autonomy || 'draft')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(SETTINGS_URL, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          send_as_user_id: sendAs || null,
          quiet_hours: { start: quietStart, end: quietEnd, tz },
          frequency_cap: freqCap,
          business_display_name: businessName,
          default_email_identity_id: defaultIdentity || null,
          text_autonomy: textAutonomy,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save settings.'); return }
      toast.success('Settings saved.')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Drip settings" maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end w-full gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Texts are sent as</label>
          <select value={sendAs} onChange={(e) => setSendAs(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
            <option value="">Choose a team member…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">Drip texts land in this person’s Txt inbox, so replies surface there for a human to take over.</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Default “Send from” (email)</label>
          {identities.length === 0 ? (
            <p className="text-[11px] text-gray-500">No verified email domains yet — add one in Email Marketing to send email drips.</p>
          ) : (
            <select value={defaultIdentity} onChange={(e) => setDefaultIdentity(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
              <option value="">Company default</option>
              {identities.map((idn) => <option key={idn.id} value={idn.id}>{idn.label}{idn.is_default ? ' · default' : ''}</option>)}
            </select>
          )}
          <p className="text-[11px] text-gray-500 mt-1">Email steps use this address unless a step picks its own.</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Amber autonomy (when a lead replies)</label>
          <select value={textAutonomy} onChange={(e) => setTextAutonomy(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
            <option value="draft">Draft for approval</option>
            <option value="auto">Auto-send</option>
          </select>
          <p className="text-[11px] text-gray-500 mt-1">Draft = Amber writes the reply for a human to approve; Auto-send = she replies on her own. Set Auto-send only once you trust her for straightforward service conversations.</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Quiet hours (no sends outside this window)</label>
          <div className="flex items-center gap-2 text-sm text-white">
            <select value={quietStart} onChange={(e) => setQuietStart(Number(e.target.value))}
              className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span className="text-gray-400">to</span>
            <select value={quietEnd} onChange={(e) => setQuietEnd(Number(e.target.value))}
              className="rounded bg-gray-800 border border-gray-700 px-2 py-1.5">
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <input value={tz} onChange={(e) => setTz(e.target.value)}
              className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1.5" />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">A send due during quiet hours waits until the window opens (TCPA-safe; default 8 AM to 8 PM). A step set to “ignore quiet hours” sends anyway.</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Max touches per lead per day</label>
          <input type="number" min={1} max={50} value={freqCap} onChange={(e) => setFreqCap(Number(e.target.value))}
            className="w-24 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Business name (shown in texts, optional)</label>
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Heroes Lawn Care"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
        </div>
      </div>
    </Modal>
  )
}
