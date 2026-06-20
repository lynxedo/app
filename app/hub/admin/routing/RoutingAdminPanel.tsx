'use client'

import { useState, useEffect } from 'react'
import { useAutoSave } from '@/components/admin'
import type { DurationRulesConfig, DurationRule } from '@/app/api/settings/types'
import { DEFAULT_DURATION_RULES } from '@/app/api/settings/types'
import {
  EMPTY_PIN_SETTINGS, MAX_BASE_PROGRAMS, MAX_AUX_PROGRAMS, MAX_HALO_ARCS, PIN_COLOR_PALETTE,
  type PinSettings, type PinProgram, type MatchType,
} from '@/lib/pin-colors'

interface Settings {
  display_name: string | null
  depot_address: string | null
  depot_lat: number | null
  depot_lng: number | null
  default_service_minutes: number
  default_drive_mph: number
  duration_method: string
  duration_rules: DurationRulesConfig
  visible_tech_ids: string[] | null
}

interface JobberUser {
  id: string
  name: string
}

interface TankRow {
  id: string
  tank_number: number
  label: string | null
  gallon_capacity: number | null
  application_rate: number
  is_active: boolean
}

interface Props {
  initial: Settings
  jobberConnected: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const METHOD_OPTIONS = [
  { value: 'formula',      label: 'Formula (Line Items)',          desc: 'Sum line item times + lawn size + padding' },
  { value: 'default',      label: 'Default Time',                  desc: 'Same time for every stop' },
  { value: 'custom_field', label: 'Jobber Custom Field',           desc: 'Use "Onsite Time" field on each job — coming soon', disabled: true },
  { value: 'historical',   label: 'Historical Average (last 3)',   desc: 'Average of last 3 timed visits — coming soon', disabled: true },
]

export default function RoutingAdminPanel({ initial, jobberConnected }: Props) {
  const [profileName, setProfileName] = useState(initial.display_name ?? '')
  const [profileSave, setProfileSave] = useState<SaveState>('idle')
  const [profileErr, setProfileErr] = useState<string | null>(null)

  const [serviceMin, setServiceMin] = useState<number>(initial.default_service_minutes)
  const [driveMph, setDriveMph] = useState<number>(initial.default_drive_mph)
  const [routingSave, setRoutingSave] = useState<SaveState>('idle')
  const [routingErr, setRoutingErr] = useState<string | null>(null)

  const [depotAddr, setDepotAddr] = useState(initial.depot_address ?? '')
  const [depotLat, setDepotLat] = useState(initial.depot_lat)
  const [depotLng, setDepotLng] = useState(initial.depot_lng)
  const [depotSave, setDepotSave] = useState<SaveState>('idle')
  const [depotErr, setDepotErr] = useState<string | null>(null)

  const [durationMethod, setDurationMethod] = useState(initial.duration_method)
  const [rules, setRules] = useState<DurationRulesConfig>({ ...DEFAULT_DURATION_RULES, ...(initial.duration_rules ?? {}) })
  const [durationSave, setDurationSave] = useState<SaveState>('idle')
  const [durationErr, setDurationErr] = useState<string | null>(null)
  const [loadingLineItems, setLoadingLineItems] = useState(false)
  const [lineItemsErr, setLineItemsErr] = useState<string | null>(null)

  // Team members (tech allowlist for the Quick Route dropdown)
  const [jobberUsers, setJobberUsers] = useState<JobberUser[]>([])
  const [allowlist, setAllowlist] = useState<string[]>(initial.visible_tech_ids ?? [])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersErr, setUsersErr] = useState<string | null>(null)
  const [techsSave, setTechsSave] = useState<SaveState>('idle')
  const [techsErr, setTechsErr] = useState<string | null>(null)
  const [techsLoadedOnce, setTechsLoadedOnce] = useState(false)

  // Pin colors — base/aux programs that color the Advanced route planner's pins.
  const [pinSettings, setPinSettings] = useState<PinSettings>(EMPTY_PIN_SETTINGS)
  const [pinLineItems, setPinLineItems] = useState<string[]>([])
  const [pinLoadingItems, setPinLoadingItems] = useState(false)
  const [pinItemsErr, setPinItemsErr] = useState<string | null>(null)
  const [pinSave, setPinSave] = useState<SaveState>('idle')
  const [pinErr, setPinErr] = useState<string | null>(null)

  // ── Tanks (Route Capacity Part A) ─────────────────────────────────────────
  const [tanks, setTanks] = useState<TankRow[]>([])
  const [tanksErr, setTanksErr] = useState<string | null>(null)
  const [tanksBusy, setTanksBusy] = useState(false)

  useEffect(() => {
    fetch('/api/routing/pin-settings')
      .then(r => r.json())
      .then(d => { if (d.pin_settings) setPinSettings(d.pin_settings) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/admin/tanks')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.tanks)) setTanks(d.tanks) })
      .catch(() => {})
  }, [])

  const sprayableSqft = (t: TankRow): number | null =>
    t.gallon_capacity != null && t.application_rate ? (t.gallon_capacity / t.application_rate) * 1000 : null

  const addTank = async () => {
    setTanksErr(null); setTanksBusy(true)
    const used = new Set(tanks.map(t => t.tank_number))
    const next = [1, 2, 3, 4].find(n => !used.has(n))
    if (!next) { setTanksErr('All 4 tanks are configured.'); setTanksBusy(false); return }
    try {
      const res = await fetch('/api/admin/tanks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tank_number: next, label: `Tank ${next}`, gallon_capacity: null, application_rate: 2 }),
      })
      const d = await res.json()
      if (!res.ok) { setTanksErr(d.error || 'Could not add tank'); return }
      setTanks(prev => [...prev, d.tank].sort((a, b) => a.tank_number - b.tank_number))
    } catch { setTanksErr('Could not add tank') } finally { setTanksBusy(false) }
  }

  const updateTankLocal = (id: string, patch: Partial<TankRow>) =>
    setTanks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))

  const saveTank = async (id: string, patch: Partial<TankRow>) => {
    setTanksErr(null)
    try {
      const res = await fetch(`/api/admin/tanks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (!res.ok) { setTanksErr(d.error || 'Could not save tank'); return }
      setTanks(prev => prev.map(t => (t.id === id ? d.tank : t)).sort((a, b) => a.tank_number - b.tank_number))
    } catch { setTanksErr('Could not save tank') }
  }

  const deleteTank = async (id: string) => {
    setTanksErr(null)
    try {
      const res = await fetch(`/api/admin/tanks/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setTanksErr(d.error || 'Could not delete tank'); return }
      setTanks(prev => prev.filter(t => t.id !== id))
    } catch { setTanksErr('Could not delete tank') }
  }

  const refreshPinLineItems = async () => {
    setPinLoadingItems(true)
    setPinItemsErr(null)
    try {
      const res = await fetch('/api/jobber/line-items')
      const data = await res.json()
      if (!res.ok || data.error) { setPinItemsErr(data.error ?? 'Failed to load'); return }
      setPinLineItems(data.lineItems as string[])
    } catch (e) {
      setPinItemsErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setPinLoadingItems(false)
    }
  }

  const PIN_KEYS = { base: 'base_programs', aux: 'aux_programs' } as const
  const addPinProgram = (kind: 'base' | 'aux') => {
    const key = PIN_KEYS[kind]
    const max = kind === 'base' ? MAX_BASE_PROGRAMS : MAX_AUX_PROGRAMS
    setPinSettings(s => {
      if (s[key].length >= max) return s
      const next: PinProgram = {
        id: crypto.randomUUID(),
        label: '', match: '', matchType: 'line_item',
        color: PIN_COLOR_PALETTE[s[key].length % PIN_COLOR_PALETTE.length],
      }
      return { ...s, [key]: [...s[key], next] }
    })
  }
  const updatePinProgram = (kind: 'base' | 'aux', idx: number, patch: Partial<PinProgram>) => {
    const key = PIN_KEYS[kind]
    setPinSettings(s => {
      const arr = [...s[key]]
      arr[idx] = { ...arr[idx], ...patch }
      return { ...s, [key]: arr }
    })
  }
  const removePinProgram = (kind: 'base' | 'aux', idx: number) => {
    const key = PIN_KEYS[kind]
    setPinSettings(s => ({ ...s, [key]: s[key].filter((_, i) => i !== idx) }))
  }

  const savePins = async () => {
    setPinSave('saving')
    setPinErr(null)
    try {
      const res = await fetch('/api/routing/pin-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_settings: pinSettings }),
      })
      const data = await res.json()
      if (!res.ok) { setPinErr(data.error ?? 'Save failed'); setPinSave('error'); return }
      if (data.pin_settings) setPinSettings(data.pin_settings)
      setPinSave('saved')
      setTimeout(() => setPinSave('idle'), 2000)
    } catch (e) {
      setPinErr(e instanceof Error ? e.message : 'Network error')
      setPinSave('error')
    }
  }

  const renderPinRow = (kind: 'base' | 'aux', p: PinProgram, idx: number) => {
    const overHalo = kind === 'aux' && idx >= MAX_HALO_ARCS
    return (
      <div key={p.id} className="flex items-center gap-2 flex-wrap">
        <select
          value={p.matchType}
          onChange={e => updatePinProgram(kind, idx, { matchType: e.target.value as MatchType })}
          className="bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-orange-500"
        >
          <option value="line_item">Line item</option>
          <option value="keyword">Keyword</option>
        </select>
        {p.matchType === 'line_item' && pinLineItems.length > 0 ? (
          <select
            value={p.match}
            onChange={e => updatePinProgram(kind, idx, { match: e.target.value, label: e.target.value })}
            className="flex-1 min-w-[160px] bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="">— select line item —</option>
            {pinLineItems.map(li => <option key={li} value={li}>{li}</option>)}
          </select>
        ) : (
          <input
            value={p.match}
            onChange={e => updatePinProgram(kind, idx, { match: e.target.value, label: e.target.value })}
            placeholder={p.matchType === 'keyword' ? 'Keyword in line item (e.g. root rot)' : 'Line item name'}
            className="flex-1 min-w-[160px] bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
        )}
        <input
          type="color"
          value={p.color}
          onChange={e => updatePinProgram(kind, idx, { color: e.target.value })}
          className="w-10 h-9 bg-gray-950 border border-gray-800 rounded-lg cursor-pointer p-0.5"
          title="Pin color"
        />
        {overHalo && <span className="text-[10px] text-gray-500 whitespace-nowrap">not on halo</span>}
        <button onClick={() => removePinProgram(kind, idx)} className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none px-1" aria-label="Remove">
          ×
        </button>
      </div>
    )
  }

  async function patchSettings(
    body: Partial<Settings & { duration_method: string; duration_rules: DurationRulesConfig }>,
    setSave: (s: SaveState) => void,
    setErr: (e: string | null) => void,
  ): Promise<Settings | null> {
    setSave('saving')
    setErr(null)
    try {
      const res = await fetch('/api/admin/routing-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Save failed'); setSave('error'); return null }
      setSave('saved')
      setTimeout(() => setSave('idle'), 2000)
      return data.settings as Settings
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error')
      setSave('error')
      return null
    }
  }

  const saveProfile = () => patchSettings({ display_name: profileName || null }, setProfileSave, setProfileErr)
  const saveRouting = () => patchSettings({ default_service_minutes: serviceMin, default_drive_mph: driveMph }, setRoutingSave, setRoutingErr)
  const saveDepot = async () => {
    const s = await patchSettings({ depot_address: depotAddr || null }, setDepotSave, setDepotErr)
    if (s) { setDepotLat(s.depot_lat); setDepotLng(s.depot_lng) }
  }
  const saveDuration = () =>
    patchSettings({ duration_method: durationMethod, duration_rules: rules }, setDurationSave, setDurationErr)

  const refreshLineItems = async () => {
    setLoadingLineItems(true)
    setLineItemsErr(null)
    try {
      const res = await fetch('/api/jobber/line-items')
      const data = await res.json()
      if (!res.ok || data.error) { setLineItemsErr(data.error ?? 'Failed to load'); return }
      setRules(r => ({ ...r, cachedLineItems: data.lineItems as string[] }))
    } catch (e) {
      setLineItemsErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoadingLineItems(false)
    }
  }

  const refreshTeamMembers = async () => {
    setLoadingUsers(true)
    setUsersErr(null)
    try {
      const res = await fetch('/api/users?include_all=1')
      const data = await res.json()
      if (!res.ok || data.error) { setUsersErr(data.error ?? 'Failed to load'); return }
      const list = (data.users as JobberUser[]).slice().sort((a, b) => a.name.localeCompare(b.name))
      setJobberUsers(list)
      setTechsLoadedOnce(true)
    } catch (e) {
      setUsersErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoadingUsers(false)
    }
  }

  const toggleTech = (id: string) => {
    setAllowlist(curr => curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id])
  }
  const selectAllTechs = () => setAllowlist(jobberUsers.map(u => u.id))
  const clearAllTechs = () => setAllowlist([])

  const saveTeamMembers = () =>
    patchSettings(
      { visible_tech_ids: allowlist.length === 0 ? null : allowlist },
      setTechsSave,
      setTechsErr,
    )

  // AD1 — debounced auto-save so edits persist without a manual Save (changes
  // were lost on navigation). The Save buttons remain as explicit/status
  // affordances. Depot is excluded (its save geocodes server-side → stays manual).
  // Now via the shared AD-toolkit hook (same skip-first + debounce behavior).
  useAutoSave([serviceMin, driveMph], saveRouting)
  useAutoSave(profileName, saveProfile)
  useAutoSave([durationMethod, rules], saveDuration)
  useAutoSave(allowlist, saveTeamMembers)

  const updateCode = (idx: number, field: keyof DurationRule, value: string | number) => {
    setRules(r => {
      const codes = [...r.codes]
      codes[idx] = { ...codes[idx], [field]: value }
      return { ...r, codes }
    })
  }
  const addCode = () => {
    if (rules.codes.length >= 15) return
    setRules(r => ({ ...r, codes: [...r.codes, { lineItemName: '', minutes: 0 }] }))
  }
  const removeCode = (idx: number) => {
    setRules(r => ({ ...r, codes: r.codes.filter((_, i) => i !== idx) }))
  }

  const saveBtn = (label: string, state: SaveState, onClick: () => void, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled || state === 'saving'}
      className="px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : label}
    </button>
  )

  const inputCls = 'w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500'
  const numInputCls = 'bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 w-24 text-center'

  return (
    <div className="space-y-6">
      <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl px-4 py-3 text-sm">
        These settings apply to <strong>everyone at your company</strong> who uses Route Optimizer. Only admins can change them.
      </div>

      {/* Team Members */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-1 gap-4">
          <div>
            <h2 className="font-semibold text-lg">Team Members</h2>
            <p className="text-gray-400 text-sm mt-1">
              Choose which Jobber users appear in the Quick Route tech dropdown.
              {' '}Leave everyone unchecked to show all active Jobber users (default).
            </p>
          </div>
          <button
            onClick={refreshTeamMembers}
            disabled={loadingUsers || !jobberConnected}
            title={!jobberConnected ? 'Connect Jobber in Settings → Integrations first' : 'Pull the current user list from Jobber'}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
          >
            {loadingUsers ? 'Loading…' : '↻ Refresh from Jobber'}
          </button>
        </div>

        {usersErr && <p className="text-red-400 text-sm mt-3">{usersErr}</p>}

        {!techsLoadedOnce && jobberUsers.length === 0 && (
          <p className="text-xs text-gray-500 mt-4">
            {allowlist.length > 0
              ? `${allowlist.length} member${allowlist.length === 1 ? '' : 's'} currently selected. Click Refresh to see all available users.`
              : 'Click Refresh from Jobber to load the user list.'}
          </p>
        )}

        {jobberUsers.length > 0 && (
          <>
            <div className="flex items-center gap-3 mt-4 mb-3">
              <button onClick={selectAllTechs} className="text-xs text-orange-400 hover:text-orange-300">
                Select all
              </button>
              <span className="text-gray-700">·</span>
              <button onClick={clearAllTechs} className="text-xs text-orange-400 hover:text-orange-300">
                Clear all
              </button>
              <span className="text-xs text-gray-500 ml-auto">
                {allowlist.length} of {jobberUsers.length} selected
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {jobberUsers.map(u => {
                const checked = allowlist.includes(u.id)
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'border-orange-500 bg-orange-500/10'
                        : 'border-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTech(u.id)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="text-sm text-white">{u.name}</span>
                  </label>
                )
              })}
            </div>
          </>
        )}

        {techsErr && <p className="text-red-400 text-sm mt-3">{techsErr}</p>}
        <div className="mt-5">{saveBtn('Save', techsSave, saveTeamMembers, !techsLoadedOnce && jobberUsers.length === 0)}</div>
      </section>

      {/* Duration Rules */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">On-Site Duration</h2>
        <p className="text-gray-400 text-sm mb-5">
          How the optimizer estimates time spent at each stop.
        </p>

        <div className="mb-6">
          <label className="block text-xs text-gray-400 mb-2">Method</label>
          <div className="space-y-2">
            {METHOD_OPTIONS.map(opt => (
              <label key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  opt.disabled ? 'border-gray-800 opacity-40 cursor-not-allowed' :
                  durationMethod === opt.value ? 'border-orange-500 bg-orange-500/10' : 'border-gray-800 hover:border-gray-600'
                }`}>
                <input type="radio" name="duration_method" value={opt.value}
                  checked={durationMethod === opt.value}
                  disabled={opt.disabled}
                  onChange={() => !opt.disabled && setDurationMethod(opt.value)}
                  className="mt-0.5 accent-orange-500" />
                <div>
                  <div className="text-sm font-medium text-white">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {durationMethod === 'formula' && (
          <div className="space-y-6 border-t border-gray-800 pt-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-white">Line Item → Time</p>
                  <p className="text-xs text-gray-400 mt-0.5">All matching line items on a visit are summed.</p>
                </div>
                <button onClick={refreshLineItems} disabled={loadingLineItems || !jobberConnected}
                  title={!jobberConnected ? 'Connect Jobber in Settings → Integrations first' : 'Pull all line items from your Jobber account'}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium transition-colors">
                  {loadingLineItems ? 'Loading…' : '↻ Refresh from Jobber'}
                </button>
              </div>
              {lineItemsErr && <p className="text-red-400 text-xs mb-2">{lineItemsErr}</p>}
              {rules.cachedLineItems.length > 0 && (
                <p className="text-xs text-green-400 mb-3">✓ {rules.cachedLineItems.length} line items loaded from Jobber</p>
              )}
              {rules.codes.length === 0 && (
                <p className="text-xs text-gray-500 mb-3">No line items configured yet. Add one below.</p>
              )}
              <div className="space-y-2">
                {rules.codes.map((code, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {rules.cachedLineItems.length > 0 ? (
                      <select
                        value={code.lineItemName}
                        onChange={e => updateCode(idx, 'lineItemName', e.target.value)}
                        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                        <option value="">— select line item —</option>
                        {rules.cachedLineItems.map(li => (
                          <option key={li} value={li}>{li}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={code.lineItemName}
                        onChange={e => updateCode(idx, 'lineItemName', e.target.value)}
                        placeholder="Line item name (exact match)"
                        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                    )}
                    <input type="number" min={0} max={480}
                      value={code.minutes}
                      onChange={e => updateCode(idx, 'minutes', Number(e.target.value))}
                      className={numInputCls} />
                    <span className="text-xs text-gray-500 whitespace-nowrap">min</span>
                    <button onClick={() => removeCode(idx)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none px-1" aria-label="Remove">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {rules.codes.length < 15 && (
                <button onClick={addCode} className="mt-3 text-xs text-orange-400 hover:text-orange-300 transition-colors">
                  + Add line item
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <input type="checkbox" id="useLawnSize" checked={rules.useLawnSize}
                onChange={e => setRules(r => ({ ...r, useLawnSize: e.target.checked }))}
                className="w-4 h-4 accent-orange-500" />
              <label htmlFor="useLawnSize" className="text-sm text-white cursor-pointer">
                Add lawn size (K = minutes) — e.g. 6K adds 6 min
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Padding per stop (min)</label>
                <input type="number" min={0} max={60} value={rules.padMinutes}
                  onChange={e => setRules(r => ({ ...r, padMinutes: Number(e.target.value) }))}
                  className={inputCls} />
                <p className="text-xs text-gray-500 mt-1">Added to every stop regardless of services</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Minimum per stop (min)</label>
                <input type="number" min={1} max={120} value={rules.minMinutes}
                  onChange={e => setRules(r => ({ ...r, minMinutes: Number(e.target.value) }))}
                  className={inputCls} />
                <p className="text-xs text-gray-500 mt-1">Floor — no stop goes below this</p>
              </div>
            </div>

            <div className="border-t border-gray-800 pt-5">
              <label className="block text-xs text-gray-400 mb-1.5">Requests / Assessments (min)</label>
              <input type="number" min={1} max={240} value={rules.assessmentMinutes}
                onChange={e => setRules(r => ({ ...r, assessmentMinutes: Number(e.target.value) }))}
                className={inputCls} />
              <p className="text-xs text-gray-500 mt-1">
                Fixed duration for assessment stops — they have no line items to calculate from
              </p>
            </div>
          </div>
        )}

        {durationMethod === 'default' && (
          <div className="border-t border-gray-800 pt-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Minimum per stop (min)</label>
              <input type="number" min={1} max={120} value={rules.minMinutes}
                onChange={e => setRules(r => ({ ...r, minMinutes: Number(e.target.value) }))}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Requests / Assessments (min)</label>
              <input type="number" min={1} max={240} value={rules.assessmentMinutes}
                onChange={e => setRules(r => ({ ...r, assessmentMinutes: Number(e.target.value) }))}
                className={inputCls} />
            </div>
          </div>
        )}

        {durationErr && <p className="text-red-400 text-sm mt-4">{durationErr}</p>}
        <div className="mt-5">{saveBtn('Save', durationSave, saveDuration)}</div>
      </section>

      {/* Pin Colors (Advanced route planner) */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-1 gap-4">
          <div>
            <h2 className="font-semibold text-lg">Pin Colors</h2>
            <p className="text-gray-400 text-sm mt-1">
              Color-code the <strong>Advanced</strong> route planner&apos;s map pins by line item.
              Base programs set the pin&apos;s center color; aux programs add a halo ring around it.
              Matching is case-insensitive and hits when a visit&apos;s line item <em>contains</em> your
              text — so pick from the Jobber catalog or just type a keyword.
            </p>
          </div>
          <button
            onClick={refreshPinLineItems}
            disabled={pinLoadingItems || !jobberConnected}
            title={!jobberConnected ? 'Connect Jobber in Settings → Integrations first' : 'Pull line items from Jobber for the dropdowns'}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
          >
            {pinLoadingItems ? 'Loading…' : '↻ Load line items'}
          </button>
        </div>
        {pinItemsErr && <p className="text-red-400 text-xs mt-2">{pinItemsErr}</p>}
        {pinLineItems.length > 0 && <p className="text-xs text-green-400 mt-2">✓ {pinLineItems.length} line items loaded from Jobber</p>}
        {pinLineItems.length === 0 && (
          <p className="text-xs text-gray-500 mt-2">Tip: click <em>Load line items</em> to pick from your Jobber catalog — or use <em>Keyword</em> to match a word inside any line item.</p>
        )}

        {/* Base programs */}
        <div className="mt-5">
          <p className="text-sm font-medium text-white">
            Base Programs <span className="text-xs text-gray-500">— center color · up to {MAX_BASE_PROGRAMS}</span>
          </p>
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-lg px-3 py-2 text-xs mt-2">
            These line items shouldn&apos;t appear together on a single visit. If they do, the first match (top of this list) wins.
          </div>
          {pinSettings.base_programs.length === 0 && (
            <p className="text-xs text-gray-500 mt-3">No base programs yet. Add one below.</p>
          )}
          <div className="space-y-2 mt-3">
            {pinSettings.base_programs.map((p, idx) => renderPinRow('base', p, idx))}
          </div>
          {pinSettings.base_programs.length < MAX_BASE_PROGRAMS && (
            <button onClick={() => addPinProgram('base')} className="mt-3 text-xs text-orange-400 hover:text-orange-300 transition-colors">
              + Add base program
            </button>
          )}
        </div>

        {/* Aux programs */}
        <div className="mt-6 border-t border-gray-800 pt-5">
          <p className="text-sm font-medium text-white">
            Aux Programs <span className="text-xs text-gray-500">— halo ring · up to {MAX_AUX_PROGRAMS}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Add-ons that can appear alongside a base program. The halo draws the first {MAX_HALO_ARCS} that match a stop, in this order.
          </p>
          {pinSettings.aux_programs.length === 0 && (
            <p className="text-xs text-gray-500 mt-3">No aux programs yet. Add one below.</p>
          )}
          <div className="space-y-2 mt-3">
            {pinSettings.aux_programs.map((p, idx) => renderPinRow('aux', p, idx))}
          </div>
          {pinSettings.aux_programs.length < MAX_AUX_PROGRAMS && (
            <button onClick={() => addPinProgram('aux')} className="mt-3 text-xs text-orange-400 hover:text-orange-300 transition-colors">
              + Add aux program
            </button>
          )}
        </div>

        {pinErr && <p className="text-red-400 text-sm mt-4">{pinErr}</p>}
        <div className="mt-5">{saveBtn('Save', pinSave, savePins)}</div>
      </section>

      {/* Routing Defaults */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Routing Defaults</h2>
        <p className="text-gray-400 text-sm mb-5">Used by the optimizer for drive time estimates.</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Default service time per stop (min)</label>
            <input type="number" min={5} max={180} value={serviceMin}
              onChange={e => setServiceMin(Number(e.target.value))} className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">Used when formula can&apos;t calculate a stop</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Avg drive speed (mph)</label>
            <input type="number" min={10} max={70} value={driveMph}
              onChange={e => setDriveMph(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
        {routingErr && <p className="text-red-400 text-sm mb-3">{routingErr}</p>}
        {saveBtn('Save', routingSave, saveRouting)}
      </section>

      {/* Routing Profile Name */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Routing Profile Name</h2>
        <p className="text-gray-400 text-sm mb-5">Company or team name shown in the route optimizer.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Name</label>
            <input value={profileName} onChange={e => setProfileName(e.target.value)}
              placeholder="e.g. Heroes Lawn Care" className={inputCls} />
          </div>
          {profileErr && <p className="text-red-400 text-sm">{profileErr}</p>}
          {saveBtn('Save', profileSave, saveProfile)}
        </div>
      </section>

      {/* Depot */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Depot</h2>
        <p className="text-gray-400 text-sm mb-5">Starting and ending point for every optimized route.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Address</label>
            <input value={depotAddr} onChange={e => setDepotAddr(e.target.value)}
              placeholder="123 Main St, City ST 12345" className={inputCls} />
          </div>
          {depotLat !== null && depotLng !== null && (
            <p className="text-xs text-green-400">✓ Geocoded to {depotLat.toFixed(4)}, {depotLng.toFixed(4)}</p>
          )}
          {depotErr && <p className="text-red-400 text-sm">{depotErr}</p>}
          {saveBtn('Save', depotSave, saveDepot)}
        </div>
      </section>

      {/* Tanks (Route Capacity Part A) */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold text-lg">Tanks</h2>
          <button
            onClick={addTank}
            disabled={tanksBusy || tanks.length >= 4}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + Add tank
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-5">
          Up to 4 mixed tanks. The mix rate (gallons per 1,000 sq ft) sets how much area a full tank can spray —
          shown live below. Advanced Routing uses these to calculate how full each tank gets per route.
        </p>
        {tanksErr && <p className="text-red-400 text-sm mb-3">{tanksErr}</p>}
        {tanks.length === 0 ? (
          <p className="text-gray-500 text-sm">No tanks yet. Add one to get started.</p>
        ) : (
          <div className="space-y-3">
            {tanks.map(t => {
              const cov = sprayableSqft(t)
              return (
                <div key={t.id} className={`border rounded-xl p-4 ${t.is_active ? 'border-gray-800' : 'border-gray-800/50 opacity-60'}`}>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Tank #</label>
                      <select
                        value={t.tank_number}
                        onChange={e => { const v = Number(e.target.value); updateTankLocal(t.id, { tank_number: v }); saveTank(t.id, { tank_number: v }) }}
                        className={inputCls}
                      >
                        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="col-span-1 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1.5">Label</label>
                      <input
                        value={t.label ?? ''}
                        onChange={e => updateTankLocal(t.id, { label: e.target.value })}
                        onBlur={e => saveTank(t.id, { label: e.target.value })}
                        placeholder={`Tank ${t.tank_number}`}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Capacity (gal)</label>
                      <input
                        type="number" min={0} step="any"
                        value={t.gallon_capacity ?? ''}
                        onChange={e => updateTankLocal(t.id, { gallon_capacity: e.target.value === '' ? null : Number(e.target.value) })}
                        onBlur={e => saveTank(t.id, { gallon_capacity: e.target.value === '' ? null : Number(e.target.value) })}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Mix rate (gal/1k)</label>
                      <input
                        type="number" min={0} step="any"
                        value={t.application_rate}
                        onChange={e => updateTankLocal(t.id, { application_rate: Number(e.target.value) })}
                        onBlur={e => saveTank(t.id, { application_rate: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3">
                    <p className="text-xs text-gray-400">
                      {cov != null
                        ? <>Covers <span className="text-green-400 font-medium">~{Math.round(cov).toLocaleString()} sq ft</span> per full tank</>
                        : <span className="text-gray-500">Enter a capacity to see coverage</span>}
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                        <input
                          type="checkbox" checked={t.is_active}
                          onChange={e => { updateTankLocal(t.id, { is_active: e.target.checked }); saveTank(t.id, { is_active: e.target.checked }) }}
                        />
                        Active
                      </label>
                      <button onClick={() => deleteTank(t.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
