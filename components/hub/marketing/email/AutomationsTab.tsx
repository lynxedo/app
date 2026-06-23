'use client'

import { useCallback, useEffect, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'

type Tag = { id: string; label: string }
type Template = { id: string; name: string; subject: string }
type TriggerType = 'new_client' | 'tag_added' | 'manual'

type Automation = {
  id: string
  name: string
  description: string
  trigger_type: TriggerType
  trigger_config: any
  status: 'draft' | 'active' | 'paused'
  active_enrollments: number
  step_count: number
}

type Step =
  | { type: 'send'; config: { template_id: string } }
  | { type: 'wait'; config: { days?: number; hours?: number } }
  | { type: 'condition'; config: any }

const BASE = '/api/hub/marketing/email/automations'

const TRIGGER_LABEL: Record<TriggerType, string> = {
  new_client: 'New customer',
  tag_added: 'Tag added',
  manual: 'Manual',
}
const STATUS_STYLE: Record<Automation['status'], string> = {
  draft: 'bg-gray-700/40 border-gray-600 text-gray-300',
  active: 'bg-green-500/15 border-green-500/40 text-green-300',
  paused: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
}

export default function AutomationsTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)
  const [monitorFor, setMonitorFor] = useState<Automation | null>(null)

  const load = useCallback(async () => {
    try {
      const [aRes, tRes, gRes] = await Promise.all([
        fetch(BASE),
        fetch('/api/hub/marketing/email/templates'),
        fetch('/api/hub/marketing/email/tags'),
      ])
      const aData = await aRes.json().catch(() => ({}))
      const tData = await tRes.json().catch(() => ({}))
      const gData = await gRes.json().catch(() => ({}))
      if (aRes.ok) setAutomations(aData.automations || [])
      else toast.error(aData.error || 'Could not load automations.')
      if (tRes.ok) setTemplates(tData.templates || [])
      if (gRes.ok) setTags(gData.tags || [])
    } finally {
      setLoading(false)
    }
  }, [toast])
  useEffect(() => { load() }, [load])

  async function setStatus(a: Automation, status: 'active' | 'paused' | 'draft') {
    const res = await fetch(`${BASE}/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error || 'Could not update status.'); return }
    toast.success(status === 'active' ? 'Automation activated.' : status === 'paused' ? 'Automation paused.' : 'Set to draft.')
    load()
  }

  async function remove(a: Automation) {
    if (!(await confirm({ message: `Delete “${a.name}”? Enrollments and history are removed.`, confirmText: 'Delete', danger: true }))) return
    const res = await fetch(`${BASE}/${a.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Automation deleted.'); setAutomations((p) => p.filter((x) => x.id !== a.id)) }
    else toast.error('Could not delete.')
  }

  const tagLabel = (id: string) => tags.find((t) => t.id === id)?.label || '(tag)'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Drip sequences + tag-triggered sends that run on autopilot.</p>
        <Button onClick={() => setEditing('new')}>+ New automation</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : automations.length === 0 ? (
        <EmptyState title="No automations yet — build a welcome drip or a tag-triggered sequence." />
      ) : (
        <ul className="space-y-2">
          {automations.map((a) => (
            <li key={a.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={'text-xs px-2 py-0.5 rounded-full border ' + STATUS_STYLE[a.status]}>{a.status}</span>
                    <span className="font-medium text-gray-100 truncate">{a.name}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Trigger: <span className="text-gray-400">{TRIGGER_LABEL[a.trigger_type]}{a.trigger_type === 'tag_added' && a.trigger_config?.tag_id ? ` · ${tagLabel(a.trigger_config.tag_id)}` : ''}</span>
                    {' · '}{a.step_count} step{a.step_count === 1 ? '' : 's'}
                    {' · '}{a.active_enrollments} active
                  </div>
                </div>
                <div className="flex-none flex flex-col items-end gap-1.5 text-sm">
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(a)} className="text-gray-400 hover:text-white">Edit</button>
                    <button onClick={() => setMonitorFor(a)} className="text-gray-400 hover:text-white">Monitor</button>
                  </div>
                  <div className="flex gap-2">
                    {a.status === 'active' ? (
                      <button onClick={() => setStatus(a, 'paused')} className="text-amber-300/90 hover:text-amber-300">Pause</button>
                    ) : (
                      <button onClick={() => setStatus(a, 'active')} className="text-green-300/90 hover:text-green-300">Activate</button>
                    )}
                    <button onClick={() => remove(a)} className="text-red-400/80 hover:text-red-400">Delete</button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AutomationEditor
          automation={editing === 'new' ? null : editing}
          templates={templates}
          tags={tags}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setLoading(true); load() }}
        />
      )}

      {monitorFor && <EnrollmentMonitor automation={monitorFor} onClose={() => setMonitorFor(null)} />}
    </div>
  )
}

function AutomationEditor({
  automation, templates, tags, onClose, onSaved,
}: { automation: Automation | null; templates: Template[]; tags: Tag[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(automation?.name || '')
  const [description, setDescription] = useState(automation?.description || '')
  const [triggerType, setTriggerType] = useState<TriggerType>(automation?.trigger_type || 'new_client')
  const [triggerTagId, setTriggerTagId] = useState<string>(automation?.trigger_config?.tag_id || '')
  const [steps, setSteps] = useState<Step[]>([])
  const [loadingSteps, setLoadingSteps] = useState(!!automation)
  const [saving, setSaving] = useState(false)

  // Load existing steps when editing.
  useEffect(() => {
    if (!automation) return
    (async () => {
      try {
        const res = await fetch(`${BASE}/${automation.id}`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) setSteps((data.steps || []).map((s: any) => ({ type: s.type, config: s.config })))
      } finally {
        setLoadingSteps(false)
      }
    })()
  }, [automation])

  function addStep(type: 'send' | 'wait') {
    setSteps((p) => [...p, type === 'send' ? { type: 'send', config: { template_id: '' } } : { type: 'wait', config: { days: 3 } }])
  }
  function move(i: number, dir: -1 | 1) {
    setSteps((p) => {
      const j = i + dir
      if (j < 0 || j >= p.length) return p
      const copy = [...p]; const [x] = copy.splice(i, 1); copy.splice(j, 0, x); return copy
    })
  }
  function removeStep(i: number) { setSteps((p) => p.filter((_, k) => k !== i)) }
  function updateStep(i: number, config: any) { setSteps((p) => p.map((s, k) => (k === i ? { ...s, config } : s))) }

  function buildPayload() {
    return {
      name: name.trim(),
      description: description.trim(),
      trigger_type: triggerType,
      trigger_config: triggerType === 'tag_added' ? { tag_id: triggerTagId } : {},
      steps: steps.map((s) =>
        s.type === 'send'
          ? { type: 'send', config: { template_id: s.config.template_id } }
          : s.type === 'wait'
          ? { type: 'wait', config: { days: Number(s.config.days) || 0, hours: Number(s.config.hours) || 0 } }
          : s,
      ),
    }
  }

  async function save() {
    if (!name.trim()) { toast.error('Give it a name.'); return }
    if (triggerType === 'tag_added' && !triggerTagId) { toast.error('Pick the trigger tag.'); return }
    setSaving(true)
    try {
      const payload = buildPayload()
      const res = automation
        ? await fetch(`${BASE}/${automation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(automation ? 'Automation saved.' : 'Automation created (draft).')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={automation ? 'Edit automation' : 'New automation'}
      maxWidth="max-w-2xl"
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New customer welcome"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Trigger — who enters this automation</label>
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
            <option value="new_client">A new customer is added</option>
            <option value="tag_added">A contact gets a tag</option>
            <option value="manual">Manual only (no auto-enroll)</option>
          </select>
          {triggerType === 'tag_added' && (
            <div className="mt-2">
              <label className="block text-xs text-gray-400 mb-1">Trigger tag</label>
              {tags.length === 0 ? (
                <p className="text-xs text-gray-500">No tags exist yet — tags light up once Jobber/Mailchimp tags are synced.</p>
              ) : (
                <select value={triggerTagId} onChange={(e) => setTriggerTagId(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white">
                  <option value="">Choose a tag…</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              )}
            </div>
          )}
          {triggerType === 'new_client' && (
            <p className="text-xs text-gray-500 mt-1">Enrolls customers added <em>after</em> you activate — it won&apos;t blast your whole existing list.</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-gray-400">Steps</label>
            <div className="flex gap-2">
              <button onClick={() => addStep('send')} className="text-xs rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-gray-200 hover:bg-gray-700">+ Send email</button>
              <button onClick={() => addStep('wait')} className="text-xs rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-gray-200 hover:bg-gray-700">+ Wait</button>
            </div>
          </div>

          {loadingSteps ? (
            <p className="text-sm text-gray-500 py-3 text-center">Loading steps…</p>
          ) : steps.length === 0 ? (
            <p className="text-sm text-gray-500 rounded-lg border border-dashed border-gray-700 p-3 text-center">
              No steps yet. Add a <strong className="text-gray-300">Send email</strong> step, then a <strong className="text-gray-300">Wait</strong>, then another send — that&apos;s a drip.
            </p>
          ) : (
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="rounded-lg border border-gray-800 bg-gray-900 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-5">{i + 1}.</span>
                    {s.type === 'send' ? (
                      <>
                        <span className="text-xs text-gray-400 flex-none">Send</span>
                        <select
                          value={s.config.template_id || ''}
                          onChange={(e) => updateStep(i, { template_id: e.target.value })}
                          className="flex-1 min-w-0 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-white"
                        >
                          <option value="">Choose a template…</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-gray-400 flex-none">Wait</span>
                        <input
                          type="number" min={0}
                          value={s.config.days ?? 0}
                          onChange={(e) => updateStep(i, { ...s.config, days: Number(e.target.value) })}
                          className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-white"
                        />
                        <span className="text-xs text-gray-400">days</span>
                      </>
                    )}
                    <div className="flex-none flex items-center gap-1 text-gray-500">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1 hover:text-white disabled:opacity-30">↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="px-1 hover:text-white disabled:opacity-30">↓</button>
                      <button onClick={() => removeStep(i)} className="px-1 text-red-400/80 hover:text-red-400">✕</button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <p className="text-xs text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
          Saved as a <strong className="text-gray-300">draft</strong>. Activate it from the list when you&apos;re ready — only active
          automations enroll and send. Every send respects unsubscribes + the suppression list automatically.
        </p>
      </div>
    </Modal>
  )
}

function EnrollmentMonitor({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/${automation.id}/enrollments`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) { setCounts(data.counts || {}); setRows(data.enrollments || []) }
      } finally {
        setLoading(false)
      }
    })()
  }, [automation.id])

  return (
    <Modal open onClose={onClose} title={`Enrollments — ${automation.name}`} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {(['active', 'completed', 'paused', 'exited'] as const).map((k) => (
            <div key={k} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
              <div className="text-xs text-gray-500 capitalize">{k}</div>
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
                <span className="text-gray-300 truncate">{r.email}</span>
                <span className="flex-none text-xs text-gray-500">step {r.current_step_index + 1} · {r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
