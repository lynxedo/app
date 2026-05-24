'use client'

import { useState } from 'react'
import type { DurationRulesConfig, DurationRule } from '@/app/api/settings/types'
import { DEFAULT_DURATION_RULES } from '@/app/api/settings/types'

interface Settings {
  display_name: string | null
  depot_address: string | null
  depot_lat: number | null
  depot_lng: number | null
  default_service_minutes: number
  default_drive_mph: number
  duration_method: string
  duration_rules: DurationRulesConfig
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
                      className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none px-1">
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
    </div>
  )
}
