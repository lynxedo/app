'use client'

import { useEffect, useState } from 'react'
import { useAutoSave } from '@/components/admin'
import {
  type ColorRule, type ColorRuleType, type DispatchSettings, type FilterGroup, type ReminderSettings, type ReminderTemplate,
  DEFAULT_DISPATCH_SETTINGS, LANE_COLORS, REMINDER_PLACEHOLDERS,
} from '@/lib/dispatch'

// Admin → Routing → Dispatch (Reference/PRDs/DISPATCH_ROUTING_PRD.md §4.7, §4.8).
// Arrival hours, the reminder cutoff, the default team, filter chips (matched on
// LINE ITEMS, never titles), color rules, and per-tech start/end overrides.
// The shop address and service minutes are the Route Optimizer's own settings
// above — Dispatch reuses them so the two never disagree.

interface JobberUser { id: string; name: string }
interface TechRow {
  jobber_user_id: string
  start_kind: 'depot' | 'address'; start_address: string | null
  end_kind: 'depot' | 'address'; end_address: string | null
}

const newId = () => Math.random().toString(36).slice(2, 10)
const RULE_LABEL: Record<ColorRuleType, string> = {
  line_item: 'Line item contains',
  assigned: 'Assigned to',
  title: 'Title contains',
  promised: 'Has a promised time frame',
}

export default function DispatchSettingsSection() {
  const [s, setS] = useState<DispatchSettings>(DEFAULT_DISPATCH_SETTINGS)
  const [techs, setTechs] = useState<TechRow[]>([])
  const [users, setUsers] = useState<JobberUser[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [techEdit, setTechEdit] = useState<TechRow | null>(null)
  const [hubUsers, setHubUsers] = useState<Array<{ id: string; display_name: string; is_bot: boolean }>>([])
  const [identities, setIdentities] = useState<Array<{ id: string; label: string; from_name: string | null; from_email: string; domain_verified: boolean; is_default: boolean }>>([])

  useEffect(() => {
    fetch('/api/hub/routing/dispatch/settings').then(r => r.json()).then(d => {
      if (d.settings) setS(d.settings)
      setTechs(d.techSettings ?? [])
      setHubUsers(d.hubUsers ?? [])
      setIdentities(d.emailIdentities ?? [])
      setCanEdit(!!d.canEdit)
      setLoaded(true)
    }).catch(() => setLoaded(true))
    fetch('/api/hub/routing/dispatch/users').then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => {})
  }, [])

  const name = (id: string) => users.find(u => u.id === id)?.name ?? id.slice(-6)
  const patch = (p: Partial<DispatchSettings>) => { setS(prev => ({ ...prev, ...p })); setState('idle') }

  const save = async () => {
    setState('saving'); setErr(null)
    const res = await fetch('/api/hub/routing/dispatch/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setState('error'); setErr(d.error || 'Could not save'); return }
    // Don't write the server's copy back into the form — the person may have
    // kept typing while this save was in flight.
    setState('saved')
  }
  // Admin settings save themselves (house rule) — no Save button.
  useAutoSave(s, save, { enabled: loaded && canEdit })

  const saveTech = async (t: TechRow) => {
    setErr(null)
    const res = await fetch('/api/hub/routing/dispatch/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tech: t }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(d.error || 'Could not save'); return }
    setTechs(prev => [...prev.filter(x => x.jobber_user_id !== t.jobber_user_id), d.tech])
    setTechEdit(null)
  }
  const removeTech = async (id: string) => {
    await fetch('/api/hub/routing/dispatch/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeTech: id }),
    })
    setTechs(prev => prev.filter(x => x.jobber_user_id !== id))
  }

  const moveRule = (i: number, dir: -1 | 1) => {
    const r = [...s.color_rules]; const j = i + dir
    if (j < 0 || j >= r.length) return
    ;[r[i], r[j]] = [r[j], r[i]]
    patch({ color_rules: r })
  }

  if (!loaded) return null
  const dis = !canEdit
  const input = 'bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm disabled:opacity-60'

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-lg">Dispatch</h2>
        <p className="text-gray-400 text-sm mt-1">
          Settings for the Dispatch tab (appointment-window days). The shop address and on-site minutes above are shared with it.
          {!canEdit && ' Only routing admins can change these.'}
        </p>
      </div>

      {/* Hours */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <div className="text-gray-300 mb-1">First arrival window starts</div>
          <input type="time" step={900} disabled={dis} value={s.arrival_first} onChange={e => patch({ arrival_first: e.target.value })} className={input} />
        </label>
        <label className="text-sm">
          <div className="text-gray-300 mb-1">Last arrival window starts by</div>
          <input type="time" step={900} disabled={dis} value={s.arrival_last} onChange={e => patch({ arrival_last: e.target.value })} className={input} />
        </label>
        <label className="text-sm">
          <div className="text-gray-300 mb-1">Jobber reminders go out (day before)</div>
          <input type="time" step={900} disabled={dis} value={s.reminder_cutoff} onChange={e => patch({ reminder_cutoff: e.target.value })} className={input} />
          <div className="text-xs text-gray-500 mt-1">Retiming tomorrow after this warns that customers were already told the old time.</div>
        </label>
        <label className="text-sm">
          <div className="text-gray-300 mb-1">Timeline shows</div>
          <div className="flex items-center gap-1.5">
            <input type="time" step={1800} disabled={dis} value={s.view_start} onChange={e => patch({ view_start: e.target.value })} className={input} />
            <span className="text-gray-500">to</span>
            <input type="time" step={1800} disabled={dis} value={s.view_end} onChange={e => patch({ view_end: e.target.value })} className={input} />
          </div>
        </label>
      </div>

      {/* Work days + title shorthand */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm">
          <div className="text-gray-300 mb-1">Days Find a slot may use</div>
          <div className="flex flex-wrap gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
              const on = s.work_days.includes(i)
              return (
                <button key={d} type="button" disabled={dis}
                  onClick={() => patch({ work_days: on ? s.work_days.filter(x => x !== i) : [...s.work_days, i].sort() })}
                  className={`px-2 py-1 rounded-lg text-xs border ${on ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-700 text-gray-400'}`}>{d}</button>
              )
            })}
          </div>
        </div>
        <label className="text-sm flex items-start gap-2">
          <input type="checkbox" disabled={dis} checked={s.title_windows} onChange={e => patch({ title_windows: e.target.checked })} className="mt-1" />
          <span>
            <span className="text-gray-300">Suggest promised times from visit titles</span>
            <span className="block text-xs text-gray-500">Reads “AM”, “PM”, “1-4PM”, “after 1PM”, “10AM” in a visit title as a suggested time frame (the office still clicks Lock), and Find a slot keeps to it. Titles are never used for filters.</span>
          </span>
        </label>
      </div>

      {/* Default team */}
      <div>
        <div className="text-sm text-gray-300 mb-1">Default team (lanes shown until each person picks their own)</div>
        <div className="flex flex-wrap gap-1.5">
          {users.map(u => {
            const on = s.default_team.includes(u.id)
            return (
              <button key={u.id} type="button" disabled={dis}
                onClick={() => patch({ default_team: on ? s.default_team.filter(x => x !== u.id) : [...s.default_team, u.id] })}
                className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-700 text-gray-300'}`}>
                {u.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tech colors */}
      <div>
        <div className="text-sm text-gray-300 mb-1">Tech colors <span className="text-gray-500">— the edge of each stop box, the pin border and the route line on the map</span></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {users.map(u => {
            const c = s.tech_colors[u.id]
            return (
              <div key={u.id} className="flex items-center gap-1.5 text-sm">
                <input type="color" disabled={dis} value={c ?? '#94a3b8'} title={c ? undefined : 'Automatic — pick a color to set one'}
                  onChange={e => patch({ tech_colors: { ...s.tech_colors, [u.id]: e.target.value } })}
                  className={`w-7 h-7 rounded bg-transparent ${c ? '' : 'opacity-50'}`} />
                <span className="text-gray-300">{u.name}</span>
                {c
                  ? <button type="button" disabled={dis} onClick={() => { const t = { ...s.tech_colors }; delete t[u.id]; patch({ tech_colors: t }) }} className="text-gray-500 hover:text-red-400 text-xs" title="Back to automatic">✕</button>
                  : <span className="text-gray-500 text-xs">auto</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Filter chips */}
      <div>
        <div className="text-sm text-gray-300 mb-1">Filter chips <span className="text-gray-500">— match a stop&apos;s line items (never its title)</span></div>
        <div className="space-y-1.5">
          {s.filter_groups.map((g, i) => (
            <div key={g.id} className="flex flex-wrap gap-1.5 items-center">
              <input disabled={dis} value={g.label} placeholder="Chip label" onChange={e => { const f = [...s.filter_groups]; f[i] = { ...g, label: e.target.value }; patch({ filter_groups: f }) }} className={`${input} w-36`} />
              <select disabled={dis} value={g.kind ?? 'line_item'} onChange={e => {
                const f = [...s.filter_groups]
                const v = e.target.value
                f[i] = v === 'line_item' ? { id: g.id, label: g.label, match: g.match } : { ...g, kind: v as FilterGroup['kind'] }
                patch({ filter_groups: f })
              }} className={input}>
                <option value="line_item">Line item contains</option>
                <option value="assessment">Is an assessment</option>
                <option value="task">Is a task</option>
              </select>
              {!g.kind && <input disabled={dis} value={g.match} placeholder="e.g. Service Call" onChange={e => { const f = [...s.filter_groups]; f[i] = { ...g, match: e.target.value }; patch({ filter_groups: f }) }} className={`${input} w-48`} />}
              <button type="button" disabled={dis} onClick={() => patch({ filter_groups: s.filter_groups.filter(x => x.id !== g.id) })} className="text-gray-500 hover:text-red-400 text-sm">✕</button>
            </div>
          ))}
          <button type="button" disabled={dis} onClick={() => patch({ filter_groups: [...s.filter_groups, { id: newId(), label: '', match: '' }] })} className="text-xs text-orange-400 hover:text-orange-300">+ Add chip</button>
        </div>
      </div>

      {/* Color rules */}
      <div>
        <div className="text-sm text-gray-300 mb-1">Stop colors <span className="text-gray-500">— first match wins, top to bottom</span></div>
        <div className="space-y-1.5">
          {s.color_rules.map((r, i) => (
            <div key={r.id} className="flex flex-wrap gap-1.5 items-center">
              <input type="color" disabled={dis} value={r.color} onChange={e => { const c = [...s.color_rules]; c[i] = { ...r, color: e.target.value }; patch({ color_rules: c }) }} className="w-8 h-8 rounded bg-transparent" />
              <select disabled={dis} value={r.type} onChange={e => { const c = [...s.color_rules]; c[i] = { ...r, type: e.target.value as ColorRuleType, match: '' }; patch({ color_rules: c }) }} className={input}>
                {(Object.keys(RULE_LABEL) as ColorRuleType[]).map(t => <option key={t} value={t}>{RULE_LABEL[t]}</option>)}
              </select>
              {(r.type === 'line_item' || r.type === 'title') && (
                <input disabled={dis} value={r.match} placeholder={r.type === 'title' ? 'e.g. HOLD' : 'e.g. Installation'} onChange={e => { const c = [...s.color_rules]; c[i] = { ...r, match: e.target.value }; patch({ color_rules: c }) }} className={`${input} w-44`} />
              )}
              {r.type === 'assigned' && (
                <select disabled={dis} value={r.match} onChange={e => { const c = [...s.color_rules]; c[i] = { ...r, match: e.target.value }; patch({ color_rules: c }) }} className={input}>
                  <option value="">Pick a person…</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              <input disabled={dis} value={r.label} placeholder="Label (optional)" onChange={e => { const c = [...s.color_rules]; c[i] = { ...r, label: e.target.value }; patch({ color_rules: c }) }} className={`${input} w-32`} />
              <button type="button" disabled={dis} onClick={() => moveRule(i, -1)} className="text-gray-500 hover:text-white text-sm" aria-label="Move up">↑</button>
              <button type="button" disabled={dis} onClick={() => moveRule(i, 1)} className="text-gray-500 hover:text-white text-sm" aria-label="Move down">↓</button>
              <button type="button" disabled={dis} onClick={() => patch({ color_rules: s.color_rules.filter(x => x.id !== r.id) })} className="text-gray-500 hover:text-red-400 text-sm">✕</button>
            </div>
          ))}
          <button type="button" disabled={dis}
            onClick={() => patch({ color_rules: [...s.color_rules, { id: newId(), type: 'line_item', match: '', label: '', color: LANE_COLORS[s.color_rules.length % LANE_COLORS.length] } as ColorRule] })}
            className="text-xs text-orange-400 hover:text-orange-300">+ Add color rule</button>
        </div>
      </div>

      <div className="text-xs h-4">
        {state === 'saving' && <span className="text-gray-400">Saving…</span>}
        {state === 'saved' && <span className="text-green-400">Saved ✓</span>}
        {err && <span className="text-red-400">{err}</span>}
      </div>

      <RemindersBlock
        r={s.reminders}
        dis={dis}
        input={input}
        hubUsers={hubUsers}
        identities={identities}
        onChange={reminders => patch({ reminders })}
      />

      {/* Per-tech start/end */}
      <div className="border-t border-gray-800 pt-4">
        <div className="text-sm text-gray-300 mb-1">Where each tech starts and ends <span className="text-gray-500">— everyone uses the shop unless listed here</span></div>
        <div className="space-y-1 text-sm">
          {techs.map(t => (
            <div key={t.jobber_user_id} className="flex items-center gap-2">
              <span className="font-medium">{name(t.jobber_user_id)}</span>
              <span className="text-gray-400 text-xs truncate">
                starts {t.start_kind === 'address' ? t.start_address : 'at the shop'} · ends {t.end_kind === 'address' ? t.end_address : 'at the shop'}
              </span>
              {canEdit && <button type="button" onClick={() => setTechEdit(t)} className="text-xs text-orange-400">Edit</button>}
              {canEdit && <button type="button" onClick={() => removeTech(t.jobber_user_id)} className="text-xs text-gray-500 hover:text-red-400">Back to shop</button>}
            </div>
          ))}
          {canEdit && !techEdit && (
            <select value="" onChange={e => e.target.value && setTechEdit({ jobber_user_id: e.target.value, start_kind: 'address', start_address: '', end_kind: 'depot', end_address: null })} className={input}>
              <option value="">+ Set a different start/end for…</option>
              {users.filter(u => !techs.some(t => t.jobber_user_id === u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {techEdit && (
            <div className="bg-gray-950/50 rounded-lg p-3 space-y-2">
              <div className="font-medium">{name(techEdit.jobber_user_id)}</div>
              {(['start', 'end'] as const).map(side => (
                <div key={side} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-12 text-gray-400 text-xs">{side === 'start' ? 'Starts' : 'Ends'}</span>
                  <select value={techEdit[`${side}_kind`]} onChange={e => setTechEdit({ ...techEdit, [`${side}_kind`]: e.target.value as 'depot' | 'address' })} className={input}>
                    <option value="depot">at the shop</option>
                    <option value="address">at an address</option>
                  </select>
                  {techEdit[`${side}_kind`] === 'address' && (
                    <input value={techEdit[`${side}_address`] ?? ''} onChange={e => setTechEdit({ ...techEdit, [`${side}_address`]: e.target.value })} placeholder="Street, city, state ZIP" className={`${input} flex-1 min-w-[200px]`} />
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={() => saveTech(techEdit)} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 text-[#fff] rounded-lg text-xs">Save</button>
                <button type="button" onClick={() => setTechEdit(null)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

const BLANK_TEMPLATE = (applies: 'timed' | 'anytime'): ReminderTemplate => ({
  id: newId(),
  name: applies === 'timed' ? 'Timed visit' : 'Anytime visit',
  match: '',
  applies_to: applies,
  sms: true,
  email: true,
  sms_body: applies === 'timed'
    ? 'Hi {first_name}, this is {company}. Reminder: your {service} visit is {day}, {date}, with an arrival time between {start} and {end}. Reply here with any questions.'
    : 'Hi {first_name}, this is {company}. Reminder: we\'ll be at {address} {day}, {date} for your {service}. Your technician will text when they\'re on the way.',
  email_subject: applies === 'timed' ? 'Your visit {day}: arrival between {start} and {end}' : 'Your visit {day}, {date}',
  email_body: applies === 'timed'
    ? 'Hi {first_name},\n\nThis is a reminder that your {service} visit is {day}, {date}, with an arrival time between {start} and {end}.\n\nThank you,\n{company}'
    : 'Hi {first_name},\n\nThis is a reminder that we\'ll be at {address} on {day}, {date} for your {service}. Your technician will text you when they\'re on the way.\n\nThank you,\n{company}',
})

// Day-before reminders (Ben, Oct 19 2026): built OFF; every visit gets one;
// templates by LINE ITEM with separate timed / anytime wording; text, email or
// both; sent as the company (unsigned).
function RemindersBlock({ r, dis, input, hubUsers, identities, onChange }: {
  r: ReminderSettings
  dis: boolean
  input: string
  hubUsers: Array<{ id: string; display_name: string; is_bot: boolean }>
  identities: Array<{ id: string; label: string; from_name: string | null; from_email: string; domain_verified: boolean; is_default: boolean }>
  onChange: (r: ReminderSettings) => void
}) {
  const set = (p: Partial<ReminderSettings>) => onChange({ ...r, ...p })
  const setT = (i: number, p: Partial<ReminderTemplate>) => {
    const t = [...r.templates]; t[i] = { ...t[i], ...p }; set({ templates: t })
  }
  const move = (i: number, d: -1 | 1) => {
    const t = [...r.templates]; const j = i + d
    if (j < 0 || j >= t.length) return
    ;[t[i], t[j]] = [t[j], t[i]]; set({ templates: t })
  }
  const toggleOn = () => {
    if (!r.enabled && !window.confirm('Turn ON Hub reminders? Turn OFF Jobber\'s own visit reminders first, or customers will get two. Nothing sends until the automatic sender is set up on the server.')) return
    set({ enabled: !r.enabled })
  }
  return (
    <div className="border-t border-gray-800 pt-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-sm text-gray-300">Day-before reminders</div>
          <div className="text-xs text-gray-500">A text and/or email to every customer with a visit tomorrow, sent as the company (no person&apos;s signature). Preview them on the Dispatch tab (📨 Reminders).</div>
        </div>
        <button type="button" disabled={dis} onClick={toggleOn}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${r.enabled ? 'bg-green-600 border-green-600 text-[#fff]' : 'border-gray-600 text-gray-300'}`}>
          {r.enabled ? 'ON — sending' : 'OFF'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <label>
          <div className="text-gray-300 mb-1">Send at (the day before)</div>
          <input type="time" step={900} disabled={dis} value={r.send_time} onChange={e => set({ send_time: e.target.value })} className={input} />
        </label>
        <label>
          <div className="text-gray-300 mb-1">Timed visit window length</div>
          <select disabled={dis} value={r.timed_window_minutes} onChange={e => set({ timed_window_minutes: Number(e.target.value) })} className={input}>
            {[60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{m / 60} hour{m === 60 ? '' : 's'}</option>)}
          </select>
          <div className="text-xs text-gray-500 mt-1">Used when a visit has a time but no promised time frame and no Jobber arrival window.</div>
        </label>
        <label>
          <div className="text-gray-300 mb-1">Text replies go to</div>
          <select disabled={dis} value={r.owner_user_id ?? ''} onChange={e => set({ owner_user_id: e.target.value || null })} className={input}>
            <option value="">Pick someone…</option>
            {hubUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}{u.is_bot ? ' (assistant)' : ''}</option>)}
          </select>
          <div className="text-xs text-gray-500 mt-1">Owns the text thread. The reminder itself isn&apos;t signed by them.</div>
        </label>
        <label>
          <div className="text-gray-300 mb-1">Email from</div>
          <select disabled={dis} value={r.email_identity_id ?? ''} onChange={e => set({ email_identity_id: e.target.value || null })} className={input}>
            <option value="">Company default sender</option>
            {identities.map(i => <option key={i.id} value={i.id}>{i.from_name ? `${i.from_name} <${i.from_email}>` : i.from_email}{i.domain_verified ? '' : ' (not verified)'}</option>)}
          </select>
        </label>
      </div>

      <div>
        <div className="text-sm text-gray-300 mb-1">Templates <span className="text-gray-500">— first match wins, top to bottom. Blanks: {REMINDER_PLACEHOLDERS.join(' ')}</span></div>
        <div className="space-y-2">
          {r.templates.map((t, i) => (
            <div key={t.id} className="bg-gray-950/50 rounded-lg p-3 space-y-2 text-sm">
              <div className="flex flex-wrap gap-1.5 items-center">
                <input disabled={dis} value={t.name} onChange={e => setT(i, { name: e.target.value })} placeholder="Template name" className={`${input} w-40`} />
                <select disabled={dis} value={t.applies_to} onChange={e => setT(i, { applies_to: e.target.value as 'timed' | 'anytime' })} className={input}>
                  <option value="timed">Timed visits (arrival window)</option>
                  <option value="anytime">Anytime visits</option>
                </select>
                <input disabled={dis} value={t.match} onChange={e => setT(i, { match: e.target.value })} placeholder="Line item contains (blank = any)" className={`${input} w-56`} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={dis} checked={t.sms} onChange={e => setT(i, { sms: e.target.checked })} /> Text</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={dis} checked={t.email} onChange={e => setT(i, { email: e.target.checked })} /> Email</label>
                <button type="button" disabled={dis} onClick={() => move(i, -1)} className="text-gray-500 hover:text-white" aria-label="Move up">↑</button>
                <button type="button" disabled={dis} onClick={() => move(i, 1)} className="text-gray-500 hover:text-white" aria-label="Move down">↓</button>
                <button type="button" disabled={dis} onClick={() => set({ templates: r.templates.filter(x => x.id !== t.id) })} className="text-gray-500 hover:text-red-400">✕</button>
              </div>
              {t.sms && (
                <textarea disabled={dis} value={t.sms_body} onChange={e => setT(i, { sms_body: e.target.value })} rows={3} placeholder="Text message" className={`${input} w-full`} />
              )}
              {t.email && (
                <>
                  <input disabled={dis} value={t.email_subject} onChange={e => setT(i, { email_subject: e.target.value })} placeholder="Email subject" className={`${input} w-full`} />
                  <textarea disabled={dis} value={t.email_body} onChange={e => setT(i, { email_body: e.target.value })} rows={5} placeholder="Email body" className={`${input} w-full`} />
                </>
              )}
            </div>
          ))}
          <div className="flex gap-3">
            <button type="button" disabled={dis} onClick={() => set({ templates: [...r.templates, BLANK_TEMPLATE('timed')] })} className="text-xs text-orange-400 hover:text-orange-300">+ Timed template</button>
            <button type="button" disabled={dis} onClick={() => set({ templates: [...r.templates, BLANK_TEMPLATE('anytime')] })} className="text-xs text-orange-400 hover:text-orange-300">+ Anytime template</button>
          </div>
        </div>
      </div>
    </div>
  )
}
