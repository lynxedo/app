'use client'

import { useEffect, useState } from 'react'

type RoomLite = { id: string; name: string }
type UserLite = { id: string; display_name: string }

type RuleRow = {
  id: string
  name: string | null
  trigger_source: string
  recipient_type: string | null
  trigger_config: Record<string, unknown> | null
  condition_config: Record<string, unknown> | null
  message_template: string
  active: boolean
  last_fired_at: string | null
  target_room: { id: string; name: string } | null
  target_user: { id: string; display_name: string } | null
}

type Geofence = {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  radius_m: number
}

type DeviceAssign = { id: string; name: string; assigned_user_id: string | null }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const M_PER_YD = 0.9144
const ydToM = (yd: number) => Math.max(1, Math.round(yd * M_PER_YD))
const mToYd = (m: number) => Math.round(m / M_PER_YD)

const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]'

export default function AutomationBuilder({
  rooms,
  hubUsers,
}: {
  rooms: RoomLite[]
  hubUsers: UserLite[]
}) {
  const users = hubUsers.filter((u) => !u.display_name.startsWith('Claude'))

  const [rules, setRules] = useState<RuleRow[]>([])
  const [geofences, setGeofences] = useState<Geofence[]>([])
  const [devices, setDevices] = useState<DeviceAssign[]>([])
  const [loaded, setLoaded] = useState(false)

  // ── New-rule form state ──
  const [kind, setKind] = useState<'schedule' | 'fleet_geofence'>('schedule')
  const [name, setName] = useState('')
  // schedule
  const [time, setTime] = useState('17:30')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [stillClockedIn, setStillClockedIn] = useState(true)
  // geofence
  const [deviceId, setDeviceId] = useState('')
  const [geofenceId, setGeofenceId] = useState('')
  const [direction, setDirection] = useState<'enter' | 'leave'>('enter')
  const [winStart, setWinStart] = useState('')
  const [winEnd, setWinEnd] = useState('')
  // shared
  const [recipientType, setRecipientType] = useState('condition_matches')
  const [targetUser, setTargetUser] = useState('')
  const [targetRoom, setTargetRoom] = useState('')
  const [template, setTemplate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    void (async () => {
      const [rRes, gRes, vRes] = await Promise.all([
        fetch('/api/hub/automation-rules'),
        fetch('/api/hub/geofences'),
        fetch('/api/hub/vehicle-assignments'),
      ])
      const r = await rRes.json()
      const g = await gRes.json()
      const v = await vRes.json()
      setRules(
        (r.rules ?? []).filter(
          (x: RuleRow) => x.trigger_source === 'schedule' || x.trigger_source === 'fleet_geofence',
        ),
      )
      setGeofences(g.geofences ?? [])
      setDevices(v.devices ?? [])
      setLoaded(true)
    })()
  }, [])

  // keep recipient sensible when switching kind
  useEffect(() => {
    if (kind === 'schedule' && recipientType === 'assigned_tech') setRecipientType('condition_matches')
    if (kind === 'fleet_geofence' && recipientType === 'condition_matches') setRecipientType('assigned_tech')
  }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  }

  async function createRule() {
    if (!template.trim()) { setErr('Add a message'); return }
    if (recipientType === 'fixed_user' && !targetUser) { setErr('Pick a person'); return }
    if (recipientType === 'room' && !targetRoom) { setErr('Pick a room'); return }
    if (kind === 'fleet_geofence' && !geofenceId) { setErr('Pick a geofence'); return }
    setSaving(true); setErr('')

    const trigger_config =
      kind === 'schedule'
        ? { time, days, tz: 'America/Chicago' }
        : {
            device_id: deviceId || null,
            geofence_id: geofenceId,
            direction,
            window_start: winStart || null,
            window_end: winEnd || null,
            tz: 'America/Chicago',
          }
    const condition_config =
      kind === 'schedule' && stillClockedIn ? { type: 'still_clocked_in' } : {}

    const res = await fetch('/api/hub/automation-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || null,
        trigger_source: kind,
        recipient_type: recipientType,
        target_user_id: recipientType === 'fixed_user' ? targetUser : null,
        target_room_id: recipientType === 'room' ? targetRoom : null,
        message_template: template.trim(),
        trigger_config,
        condition_config,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setErr(data.error ?? 'Failed to create'); return }
    setRules((prev) => [data, ...prev])
    setName(''); setTemplate('')
  }

  async function toggleRule(id: string, active: boolean) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)))
    await fetch(`/api/hub/automation-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
  }
  async function deleteRule(id: string) {
    if (!confirm('Delete this automation?')) return
    setRules((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/hub/automation-rules/${id}`, { method: 'DELETE' })
  }

  const recipientOptions =
    kind === 'schedule'
      ? [
          { v: 'condition_matches', label: 'Each person matching the rule' },
          { v: 'fixed_user', label: 'A specific person' },
          { v: 'room', label: 'A room' },
          { v: 'created_by', label: 'Me (rule creator)' },
        ]
      : [
          { v: 'assigned_tech', label: "The vehicle's assigned driver" },
          { v: 'fixed_user', label: 'A specific person' },
          { v: 'room', label: 'A room' },
          { v: 'created_by', label: 'Me (rule creator)' },
        ]

  return (
    <div className="space-y-8 mt-10 pt-8 border-t border-gray-800">
      <div>
        <h2 className="font-semibold text-white mb-1">Scheduled &amp; Fleet Automations</h2>
        <p className="text-xs text-gray-500">
          Send an @Guardian message on a schedule, or when a truck arrives at / leaves a place.
        </p>
      </div>

      {/* New rule */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <div className="flex gap-2">
          {([['schedule', '🕒 Scheduled'], ['fleet_geofence', '🚚 Vehicle arrives / leaves']] as const).map(
            ([k, lbl]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  kind === k ? 'bg-[#2E7EB8] text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {lbl}
              </button>
            ),
          )}
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clock-out reminder" className={inputCls} />
        </div>

        {/* WHEN */}
        {kind === 'schedule' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Days (none = every day)</label>
              <div className="flex gap-1">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(i)}
                    className={`flex-1 text-xs py-2 rounded-lg transition-colors ${
                      days.includes(i) ? 'bg-[#2E7EB8] text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {d[0]}
                  </button>
                ))}
              </div>
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={stillClockedIn} onChange={(e) => setStillClockedIn(e.target.checked)} className="accent-[#2E7EB8]" />
              Only for people still clocked in at that time
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Vehicle</label>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={inputCls}>
                <option value="">Any vehicle</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Geofence</label>
              <select value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)} className={inputCls}>
                <option value="">Select place…</option>
                {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Trigger on</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'enter' | 'leave')} className={inputCls}>
                <option value="enter">Arrives (enters)</option>
                <option value="leave">Leaves (exits)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Only after</label>
                <input type="time" value={winStart} onChange={(e) => setWinStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Only before</label>
                <input type="time" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
        )}

        {/* WHO */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notify</label>
            <select value={recipientType} onChange={(e) => setRecipientType(e.target.value)} className={inputCls}>
              {recipientOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div>
            {recipientType === 'fixed_user' && (
              <>
                <label className="text-xs text-gray-500 mb-1 block">Person</label>
                <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} className={inputCls}>
                  <option value="">Select person…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </>
            )}
            {recipientType === 'room' && (
              <>
                <label className="text-xs text-gray-500 mb-1 block">Room</label>
                <select value={targetRoom} onChange={(e) => setTargetRoom(e.target.value)} className={inputCls}>
                  <option value="">Select room…</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>#{r.name}</option>)}
                </select>
              </>
            )}
          </div>
        </div>

        {/* MESSAGE */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Message</label>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={2}
            placeholder={
              kind === 'schedule'
                ? 'Hi {tech_name}, looks like you may have forgotten to clock out.'
                : '{vehicle} arrived at {geofence}. Don’t forget to close out your route!'
            }
            className={`${inputCls} resize-none`}
          />
          <p className="text-[11px] text-gray-600 mt-1">
            Placeholders:{' '}
            <code className="bg-gray-800 px-1 rounded">{'{tech_name}'}</code>{' '}
            {kind === 'fleet_geofence' && (
              <>
                <code className="bg-gray-800 px-1 rounded">{'{vehicle}'}</code>{' '}
                <code className="bg-gray-800 px-1 rounded">{'{geofence}'}</code>{' '}
              </>
            )}
            <code className="bg-gray-800 px-1 rounded">{'{time}'}</code>{' '}
            <code className="bg-gray-800 px-1 rounded">{'{date}'}</code>
          </p>
        </div>

        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex justify-end">
          <button
            onClick={createRule}
            disabled={saving || !template.trim()}
            className="px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Create Automation'}
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div>
        <h3 className="font-semibold text-white mb-3">Automations ({rules.length})</h3>
        {!loaded ? (
          <p className="text-sm text-gray-500 px-1">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-gray-500 px-1">None yet.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className={`bg-gray-900 border rounded-xl px-4 py-3.5 flex items-start gap-4 ${r.active ? 'border-gray-800' : 'border-gray-800/50 opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-medium text-white">{r.name || (r.trigger_source === 'schedule' ? 'Scheduled' : 'Geofence')}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400">{ruleSummary(r)}</span>
                  </div>
                  <p className="text-sm text-gray-300 truncate">{r.message_template}</p>
                  {r.last_fired_at && (
                    <p className="text-[11px] text-gray-600 mt-0.5">Last fired {new Date(r.last_fired_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-none mt-0.5">
                  <button onClick={() => toggleRule(r.id, !r.active)} className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${r.active ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'}`}>
                    {r.active ? 'On' : 'Off'}
                  </button>
                  <button onClick={() => deleteRule(r.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Geofences + Vehicle drivers */}
      <div className="grid md:grid-cols-2 gap-6">
        <GeofencesCard geofences={geofences} setGeofences={setGeofences} />
        <DriversCard devices={devices} setDevices={setDevices} users={users} />
      </div>
    </div>
  )
}

function ruleSummary(r: RuleRow): string {
  const cfg = (r.trigger_config ?? {}) as Record<string, string | number | null | undefined>
  const who =
    r.recipient_type === 'assigned_tech' ? 'assigned driver'
    : r.recipient_type === 'condition_matches' ? 'matching people'
    : r.recipient_type === 'room' ? `#${r.target_room?.name ?? '?'}`
    : r.recipient_type === 'created_by' ? 'creator'
    : r.target_user?.display_name ?? 'a person'
  if (r.trigger_source === 'schedule') return `${cfg.time ?? '?'} → ${who}`
  return `${cfg.direction === 'leave' ? 'leaves' : 'arrives'} → ${who}`
}

// ── Geofences management ──
function GeofencesCard({
  geofences,
  setGeofences,
}: {
  geofences: Geofence[]
  setGeofences: React.Dispatch<React.SetStateAction<Geofence[]>>
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [radiusYd, setRadiusYd] = useState(150)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    if (!name.trim() || !address.trim()) { setErr('Name and address required'); return }
    setBusy(true); setErr('')
    const res = await fetch('/api/hub/geofences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), address: address.trim(), radius_m: ydToM(radiusYd) }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setErr(data.error ?? 'Failed'); return }
    setGeofences((p) => [data, ...p])
    setName(''); setAddress('')
  }
  async function del(id: string) {
    if (!confirm('Delete this place?')) return
    setGeofences((p) => p.filter((g) => g.id !== id))
    await fetch(`/api/hub/geofences/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">Places (geofences)</h3>
      <p className="text-xs text-gray-500 mb-3">An address + a radius. Used by vehicle automations.</p>
      <div className="space-y-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. The Shop)" className={inputCls} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" className={inputCls} />
        <div className="flex items-center gap-2">
          <input type="number" value={radiusYd} min={25} onChange={(e) => setRadiusYd(Number(e.target.value))} className={`${inputCls} w-28`} />
          <span className="text-xs text-gray-500">yards radius</span>
          <button onClick={add} disabled={busy} className="ml-auto px-4 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium">
            {busy ? 'Adding…' : 'Add place'}
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
      <div className="space-y-1.5">
        {geofences.length === 0 && <p className="text-sm text-gray-500">No places yet.</p>}
        {geofences.map((g) => (
          <div key={g.id} className="flex items-center gap-2 text-sm">
            <span className="text-white">{g.name}</span>
            <span className="text-xs text-gray-500 truncate">{g.address}</span>
            <span className="text-[11px] text-gray-600">· {mToYd(g.radius_m)} yd</span>
            <button onClick={() => del(g.id)} className="ml-auto text-xs text-red-400 hover:text-red-300">Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Vehicle → driver management ──
function DriversCard({
  devices,
  setDevices,
  users,
}: {
  devices: DeviceAssign[]
  setDevices: React.Dispatch<React.SetStateAction<DeviceAssign[]>>
  users: UserLite[]
}) {
  async function assign(device: DeviceAssign, userId: string) {
    setDevices((p) => p.map((d) => (d.id === device.id ? { ...d, assigned_user_id: userId || null } : d)))
    await fetch('/api/hub/vehicle-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: device.id, device_name: device.name, user_id: userId || null }),
    })
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="font-semibold text-white mb-1">Vehicle drivers</h3>
      <p className="text-xs text-gray-500 mb-3">Who drives each truck. Used for &quot;notify the assigned driver&quot;.</p>
      <div className="space-y-2">
        {devices.length === 0 && <p className="text-sm text-gray-500">No vehicles found.</p>}
        {devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3">
            <span className="text-sm text-white w-28 truncate">{d.name}</span>
            <select
              value={d.assigned_user_id ?? ''}
              onChange={(e) => assign(d, e.target.value)}
              className={`${inputCls} flex-1`}
            >
              <option value="">— No driver —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
