'use client'

import { useCallback, useEffect, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'

type TriggerType = 'new_lead' | 'lead_source' | 'manual'

type Campaign = {
  id: string
  name: string
  description: string
  trigger_type: TriggerType
  trigger_config: any
  status: 'draft' | 'active' | 'paused'
  active_enrollments: number
  step_count: number
}

// UI step model. Step 0 fires immediately; later steps carry a wait before them.
type UIStep = { body: string; unit: 'days' | 'hours'; value: number }
type DripUser = { id: string; display_name: string }
type Settings = {
  quiet_hours: { start: number; end: number; tz: string }
  send_as_user_id: string | null
  frequency_cap: number
  business_display_name: string | null
}

const BASE = '/api/hub/marketing/drip/campaigns'
const SETTINGS_URL = '/api/hub/marketing/drip/settings'

const TRIGGER_LABEL: Record<TriggerType, string> = {
  new_lead: 'Any new lead',
  lead_source: 'Lead source',
  manual: 'Manual',
}
const STATUS_STYLE: Record<Campaign['status'], string> = {
  draft: 'bg-gray-700/40 border-gray-600 text-gray-300',
  active: 'bg-green-500/15 border-green-500/40 text-green-300',
  paused: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
}

export default function DripView() {
  const toast = useToast()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [users, setUsers] = useState<DripUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null)
  const [monitorFor, setMonitorFor] = useState<Campaign | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const load = useCallback(async () => {
    try {
      const [cRes, sRes] = await Promise.all([fetch(BASE), fetch(SETTINGS_URL)])
      const cData = await cRes.json().catch(() => ({}))
      const sData = await sRes.json().catch(() => ({}))
      if (cRes.ok) setCampaigns(cData.campaigns || [])
      else toast.error(cData.error || 'Could not load campaigns.')
      if (sRes.ok) { setSettings(sData.settings || null); setUsers(sData.users || []) }
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

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Drip</h1>
            <p className="text-sm text-gray-500 mt-1">
              Text new leads the moment they arrive, then follow up automatically — and stop the instant they reply.
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <Button variant="ghost" onClick={() => setShowSettings(true)}>Settings</Button>
            <Button onClick={() => setEditing('new')}>+ New campaign</Button>
          </div>
        </div>

        {senderMissing && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
            Before a campaign can send, choose <strong>who texts are sent as</strong> in{' '}
            <button className="underline hover:text-amber-100" onClick={() => setShowSettings(true)}>Settings</button>.
          </div>
        )}
        {senderName && (
          <p className="text-xs text-gray-500">Texts send as <span className="text-gray-400">{senderName}</span> · they land in that person’s Txt inbox and replies pause the drip.</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
        ) : campaigns.length === 0 ? (
          <EmptyState title="No drip campaigns yet — build a speed-to-lead sequence that texts new leads instantly." />
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
                      Trigger: <span className="text-gray-400">{TRIGGER_LABEL[c.trigger_type]}{c.trigger_type === 'lead_source' && c.trigger_config?.lead_source ? ` · ${c.trigger_config.lead_source}` : ''}</span>
                      {' · '}{c.step_count} text{c.step_count === 1 ? '' : 's'}
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
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setLoading(true); load() }}
        />
      )}
      {monitorFor && <EnrollmentMonitor campaign={monitorFor} onClose={() => setMonitorFor(null)} />}
      {showSettings && (
        <DripSettingsModal
          settings={settings}
          users={users}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load() }}
        />
      )}
    </div>
  )
}

function CampaignEditor({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(campaign?.name || '')
  const [triggerType, setTriggerType] = useState<TriggerType>(campaign?.trigger_type || 'new_lead')
  const [leadSource, setLeadSource] = useState<string>(campaign?.trigger_config?.lead_source || '')
  const [steps, setSteps] = useState<UIStep[]>([])
  const [loadingSteps, setLoadingSteps] = useState(!!campaign)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!campaign) { setSteps([{ body: '', unit: 'days', value: 1 }]); return }
    (async () => {
      try {
        const res = await fetch(`${BASE}/${campaign.id}`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const ui: UIStep[] = (data.steps || []).map((s: any) => {
            const body = typeof s?.content_ref?.body === 'string' ? s.content_ref.body : ''
            const days = Number(s?.delay?.days)
            const hours = Number(s?.delay?.hours)
            if (hours > 0) return { body, unit: 'hours' as const, value: hours }
            if (days > 0) return { body, unit: 'days' as const, value: days }
            return { body, unit: 'days' as const, value: 1 }
          })
          setSteps(ui.length ? ui : [{ body: '', unit: 'days', value: 1 }])
        }
      } finally {
        setLoadingSteps(false)
      }
    })()
  }, [campaign])

  function addStep() { setSteps((p) => [...p, { body: '', unit: 'days', value: 1 }]) }
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
      trigger_config: triggerType === 'lead_source' ? { lead_source: leadSource.trim() } : {},
      steps: steps.map((s, i) => ({
        channel: 'sms',
        delay: i === 0 ? { minutes: 0 } : { [s.unit]: Math.max(1, Math.round(s.value || 1)) },
        content_ref: { body: s.body.trim() },
      })),
    }
  }

  async function save() {
    if (!name.trim()) { toast.error('Give it a name.'); return }
    if (triggerType === 'lead_source' && !leadSource.trim()) { toast.error('Enter the lead source (e.g. “Angi Lead”).'); return }
    if (steps.some((s) => !s.body.trim())) { toast.error('Every text needs a message.'); return }
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
            <option value="manual">Manual only (no auto-enroll)</option>
          </select>
          {triggerType === 'lead_source' && (
            <div className="mt-2">
              <label className="block text-xs text-gray-400 mb-1">Lead source</label>
              <input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="e.g. Angi Lead"
                list="drip-lead-sources"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
              <datalist id="drip-lead-sources">
                <option value="Angi Lead" /><option value="Google Local Services" /><option value="Google Ads" /><option value="Website" />
              </datalist>
              <p className="text-[11px] text-gray-500 mt-1">Must match the lead’s Lead Source exactly.</p>
            </div>
          )}
          {triggerType !== 'manual' && (
            <p className="text-xs text-gray-500 mt-1">Enrolls leads that arrive <em>after</em> you activate — it won’t text your existing leads.</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-gray-400">Texts</label>
            <button onClick={addStep} className="text-xs rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-gray-200 hover:bg-gray-700">+ Add text</button>
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
                  <textarea value={s.body} onChange={(e) => updateStep(i, { body: e.target.value })} rows={3}
                    placeholder={i === 0 ? 'Hi {{first_name}}! Thanks for reaching out to us…' : 'Just following up, {{first_name}}…'}
                    className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white resize-y" />
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11px] text-gray-500 mt-1.5">
            Use <code className="text-gray-400">{'{{first_name}}'}</code> to personalize. The first text goes out within ~2 minutes of the lead landing; the business name + a “Reply STOP to opt out” line are added automatically.
          </p>
        </div>

        <p className="text-xs text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
          Saved as a <strong className="text-gray-300">draft</strong>. Activate it from the list when ready — only active campaigns enroll and send. Quiet hours + opt-outs are always respected.
        </p>
      </div>
    </Modal>
  )
}

function EnrollmentMonitor({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/${campaign.id}/enrollments`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) { setCounts(data.counts || {}); setRows(data.enrollments || []) }
      } finally {
        setLoading(false)
      }
    })()
  }, [campaign.id])

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
                <span className="flex-none text-xs text-gray-500">text {r.current_step_index + 1} · {r.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function DripSettingsModal({ settings, users, onClose, onSaved }: {
  settings: Settings | null; users: DripUser[]; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [sendAs, setSendAs] = useState<string>(settings?.send_as_user_id || '')
  const [quietStart, setQuietStart] = useState<number>(settings?.quiet_hours?.start ?? 8)
  const [quietEnd, setQuietEnd] = useState<number>(settings?.quiet_hours?.end ?? 20)
  const [tz, setTz] = useState<string>(settings?.quiet_hours?.tz || 'America/Chicago')
  const [freqCap, setFreqCap] = useState<number>(settings?.frequency_cap ?? 6)
  const [businessName, setBusinessName] = useState<string>(settings?.business_display_name || '')
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
          <label className="block text-xs text-gray-400 mb-1">Quiet hours (no texts outside this window)</label>
          <div className="flex items-center gap-2 text-sm text-white">
            <input type="number" min={0} max={23} value={quietStart} onChange={(e) => setQuietStart(Number(e.target.value))}
              className="w-16 rounded bg-gray-800 border border-gray-700 px-2 py-1.5" />
            <span className="text-gray-400">to</span>
            <input type="number" min={1} max={24} value={quietEnd} onChange={(e) => setQuietEnd(Number(e.target.value))}
              className="w-16 rounded bg-gray-800 border border-gray-700 px-2 py-1.5" />
            <input value={tz} onChange={(e) => setTz(e.target.value)}
              className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1.5" />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">24-hour clock. A text due during quiet hours waits until the window opens (TCPA-safe; default 8–20).</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Max texts per lead per day</label>
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
