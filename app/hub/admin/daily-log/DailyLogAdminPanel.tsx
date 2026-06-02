'use client'

import { useState } from 'react'
import AdminTabNav from '@/components/AdminTabNav'

type HubUser = { id: string; display_name: string }
type Room = { id: string; name: string }

export type PesticideMapping = {
  id: string
  match_text: string
  match_type: 'exact' | 'contains'
  chemical_name: string
  epa_registration_number: string | null
  active_ingredients: string | null
  target_pests: string | null
  application_rate: string | null
  notes: string | null
  active: boolean
}

export type SkipReason = {
  id: string
  label: string
  sort_order: number
  active: boolean
}

const DEFAULT_ON_MY_WAY_TEMPLATE =
  "Hi {first_name}, this is {tech_name} from Heroes Lawn Care. I'm on my way — should be there in about {eta} minutes."

export default function DailyLogAdminPanel({
  initialRecipientIds,
  initialRoomIds,
  initialUpdateNotifyIds,
  initialOnMyWayTemplate,
  users,
  rooms,
  initialMappings,
  initialSkipReasons,
}: {
  initialRecipientIds: string[]
  initialRoomIds: string[]
  initialUpdateNotifyIds: string[]
  initialOnMyWayTemplate: string | null
  users: HubUser[]
  rooms: Room[]
  initialMappings: PesticideMapping[]
  initialSkipReasons: SkipReason[]
}) {
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set(initialRecipientIds))
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set(initialRoomIds))
  const [updateNotifyUsers, setUpdateNotifyUsers] = useState<Set<string>>(new Set(initialUpdateNotifyIds))
  const [onMyWayTemplate, setOnMyWayTemplate] = useState<string>(initialOnMyWayTemplate ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleUser(id: string) {
    setSelectedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleRoom(id: string) {
    setSelectedRooms((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleUpdateNotify(id: string) {
    setUpdateNotifyUsers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/daily-log-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completion_notify_user_ids: [...selectedUsers],
          completion_notify_room_ids: [...selectedRooms],
          update_notify_user_ids: [...updateNotifyUsers],
          // Empty string means "use the system default" — server stores NULL.
          on_my_way_template: onMyWayTemplate.trim() || null,
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

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-950 text-white">
      <div className="border-b border-gray-800">
        <div className="px-4 md:px-6">
          <AdminTabNav />
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Daily Log</h1>
          <p className="text-sm text-white/60 mt-1">
            Configure who gets notified about Daily Log activity — both <strong>new updates</strong> as
            they&apos;re posted, and the <strong>end-of-day summary</strong> when a tech marks a route complete.
          </p>
        </header>

        <PickerSection
          title="Notify on every update"
          subtitle="These users always get a push notification (plus the in-app unread dot + chime) for every new Daily Log update — no need to Follow. The assigned tech is always notified automatically; this list is for anyone else who should stay in the loop."
          empty="No users in this company yet."
          items={users.map((u) => ({ id: u.id, label: u.display_name }))}
          selected={updateNotifyUsers}
          onToggle={toggleUpdateNotify}
        />

        <PickerSection
          title="On completion — DM these users"
          subtitle="When a route is marked complete, @Guardian DMs each selected user a one-on-one summary of the day."
          empty="No users in this company yet."
          items={users.map((u) => ({ id: u.id, label: u.display_name }))}
          selected={selectedUsers}
          onToggle={toggleUser}
        />

        <PickerSection
          title="On completion — post in these rooms"
          subtitle="When a route is marked complete, @Guardian posts the summary in each selected room (auto-joins if needed)."
          empty="No active rooms to choose from."
          items={rooms.map((r) => ({ id: r.id, label: `#${r.name}` }))}
          selected={selectedRooms}
          onToggle={toggleRoom}
        />

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <div>
            <h2 className="font-semibold">On-My-Way SMS template <span className="text-xs text-violet-200 bg-violet-500/20 px-1.5 py-0.5 rounded ml-1 align-middle">v2</span></h2>
            <p className="text-xs text-white/50 mt-0.5">
              Used by the <strong>💬 On My Way</strong> button in Daily Log v2 stop details. Placeholders <code className="text-amber-300">{'{first_name}'}</code>, <code className="text-amber-300">{'{tech_name}'}</code>, and <code className="text-amber-300">{'{eta}'}</code> are substituted at send time. Leave blank to use the system default.
            </p>
          </div>

          <textarea
            value={onMyWayTemplate}
            onChange={(e) => setOnMyWayTemplate(e.target.value)}
            placeholder={DEFAULT_ON_MY_WAY_TEMPLATE}
            rows={3}
            maxLength={500}
            className="w-full bg-gray-900 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#2E7EB8] resize-y"
          />
          <div className="flex justify-between text-xs text-white/40">
            <span>{onMyWayTemplate.length}/500 chars</span>
            {!onMyWayTemplate.trim() && <span className="text-white/30">— using system default</span>}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Preview (Sarah / Ben / 15 min)</div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2 text-sm text-emerald-100">
              {(onMyWayTemplate.trim() || DEFAULT_ON_MY_WAY_TEMPLATE)
                .replace(/\{first_name\}/g, 'Sarah')
                .replace(/\{tech_name\}/g, 'Ben')
                .replace(/\{eta\}/g, '15')}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && !saving && (
            <span className="text-xs text-emerald-400">Saved</span>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>

        <SkipReasonsSection initialReasons={initialSkipReasons} />

        <PesticideMappingsSection initialMappings={initialMappings} />
      </div>
    </div>
  )
}

function PesticideMappingsSection({ initialMappings }: { initialMappings: PesticideMapping[] }) {
  const [mappings, setMappings] = useState<PesticideMapping[]>(initialMappings)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [sectionError, setSectionError] = useState<string | null>(null)

  async function createMapping(input: Omit<PesticideMapping, 'id'>) {
    setSectionError(null)
    try {
      const res = await fetch('/api/admin/pesticide-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`)
      setMappings(prev => [...prev, body.mapping as PesticideMapping].sort((a, b) =>
        a.chemical_name.localeCompare(b.chemical_name)))
      setShowAddForm(false)
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function updateMapping(id: string, patch: Partial<PesticideMapping>) {
    setSectionError(null)
    try {
      const res = await fetch(`/api/admin/pesticide-mappings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`)
      setMappings(prev => prev.map(m => m.id === id ? (body.mapping as PesticideMapping) : m))
      setEditingId(null)
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function deleteMapping(id: string) {
    if (!confirm('Delete this mapping? Existing pesticide records will be preserved.')) return
    setSectionError(null)
    try {
      const res = await fetch(`/api/admin/pesticide-mappings/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Delete failed (${res.status})`)
      }
      setMappings(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Pesticide line-item mappings <span className="text-xs text-violet-200 bg-violet-500/20 px-1.5 py-0.5 rounded ml-1 align-middle">v2</span></h2>
        <p className="text-xs text-white/50 mt-0.5">
          When a Daily Log v2 stop is marked complete, its Jobber line items are scanned against these mappings. Each match creates a <strong>pesticide application record</strong> for TDA compliance — visible in <a href="/hub/pesticide-records" className="text-sky-400 hover:underline">Pesticide Records</a>, exportable as CSV.
        </p>
      </div>

      {sectionError && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 rounded px-3 py-2 text-xs">
          {sectionError}
        </div>
      )}

      <div className="space-y-2">
        {mappings.length === 0 && !showAddForm && (
          <div className="text-sm text-white/40 italic py-2">
            No mappings configured. Add one to start auto-creating pesticide records.
          </div>
        )}

        {mappings.map(m => (
          editingId === m.id ? (
            <MappingForm
              key={m.id}
              initial={m}
              onCancel={() => setEditingId(null)}
              onSave={(patch) => updateMapping(m.id, patch)}
            />
          ) : (
            <MappingRow
              key={m.id}
              mapping={m}
              onEdit={() => setEditingId(m.id)}
              onDelete={() => deleteMapping(m.id)}
              onToggleActive={() => updateMapping(m.id, { active: !m.active })}
            />
          )
        ))}

        {showAddForm ? (
          <MappingForm
            onCancel={() => setShowAddForm(false)}
            onSave={(input) => createMapping({
              match_text: input.match_text ?? '',
              match_type: input.match_type ?? 'contains',
              chemical_name: input.chemical_name ?? '',
              epa_registration_number: input.epa_registration_number ?? null,
              active_ingredients: input.active_ingredients ?? null,
              target_pests: input.target_pests ?? null,
              application_rate: input.application_rate ?? null,
              notes: input.notes ?? null,
              active: input.active ?? true,
            })}
          />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full px-3 py-2 border border-dashed border-white/20 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
          >
            + Add mapping
          </button>
        )}
      </div>
    </section>
  )
}

function MappingRow({
  mapping,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  mapping: PesticideMapping
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  return (
    <div className={`rounded-lg border border-white/10 bg-gray-950/50 px-3 py-2.5 ${mapping.active ? '' : 'opacity-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{mapping.chemical_name}</span>
            {!mapping.active && (
              <span className="text-[10px] uppercase tracking-wide bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">Inactive</span>
            )}
          </div>
          <div className="text-xs text-white/60 mt-0.5">
            Match: <code className="text-amber-300">{mapping.match_text}</code> ({mapping.match_type})
            {mapping.epa_registration_number && <> · EPA <span className="text-white/80">{mapping.epa_registration_number}</span></>}
          </div>
          {(mapping.active_ingredients || mapping.target_pests || mapping.application_rate) && (
            <div className="text-[11px] text-white/50 mt-1 space-y-0.5">
              {mapping.active_ingredients && <div>Active: {mapping.active_ingredients}</div>}
              {mapping.target_pests && <div>Pests: {mapping.target_pests}</div>}
              {mapping.application_rate && <div>Rate: {mapping.application_rate}</div>}
            </div>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          <button
            onClick={onToggleActive}
            className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            title={mapping.active ? 'Disable this mapping' : 'Enable this mapping'}
          >
            {mapping.active ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-300 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function MappingForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: PesticideMapping
  onCancel: () => void
  onSave: (input: Partial<PesticideMapping>) => void
}) {
  const [matchText, setMatchText] = useState(initial?.match_text ?? '')
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(initial?.match_type ?? 'contains')
  const [chemicalName, setChemicalName] = useState(initial?.chemical_name ?? '')
  const [epa, setEpa] = useState(initial?.epa_registration_number ?? '')
  const [activeIngredients, setActiveIngredients] = useState(initial?.active_ingredients ?? '')
  const [targetPests, setTargetPests] = useState(initial?.target_pests ?? '')
  const [appRate, setAppRate] = useState(initial?.application_rate ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [active, setActive] = useState(initial?.active ?? true)

  function submit() {
    if (matchText.trim().length < 2 || chemicalName.trim().length < 1) return
    onSave({
      match_text: matchText.trim(),
      match_type: matchType,
      chemical_name: chemicalName.trim(),
      epa_registration_number: epa.trim() || null,
      active_ingredients: activeIngredients.trim() || null,
      target_pests: targetPests.trim() || null,
      application_rate: appRate.trim() || null,
      notes: notes.trim() || null,
      active,
    })
  }

  return (
    <div className="rounded-lg border border-[#2E7EB8]/40 bg-[#2E7EB8]/5 px-3 py-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Match text *</label>
          <input
            type="text"
            value={matchText}
            onChange={e => setMatchText(e.target.value)}
            placeholder="e.g. Fire Ant Treatment"
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Match type</label>
          <select
            value={matchType}
            onChange={e => setMatchType(e.target.value as 'exact' | 'contains')}
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="contains">Contains (case-insensitive)</option>
            <option value="exact">Exact match (case-insensitive)</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Chemical / product name *</label>
          <input
            type="text"
            value={chemicalName}
            onChange={e => setChemicalName(e.target.value)}
            placeholder="e.g. Bifenthrin 0.69G"
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">EPA registration #</label>
          <input
            type="text"
            value={epa}
            onChange={e => setEpa(e.target.value)}
            placeholder="e.g. 279-3187"
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Application rate</label>
          <input
            type="text"
            value={appRate}
            onChange={e => setAppRate(e.target.value)}
            placeholder="e.g. 2 lb / 1000 sq ft"
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Active ingredients</label>
          <input
            type="text"
            value={activeIngredients}
            onChange={e => setActiveIngredients(e.target.value)}
            placeholder="e.g. Bifenthrin 0.69%"
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Target pests</label>
          <input
            type="text"
            value={targetPests}
            onChange={e => setTargetPests(e.target.value)}
            placeholder="e.g. Fire ants"
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Notes (internal)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white resize-y"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          checked={active}
          onChange={e => setActive(e.target.checked)}
          className="accent-[#2E7EB8]"
        />
        Active — apply this mapping when stops are completed
      </label>

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={matchText.trim().length < 2 || chemicalName.trim().length < 1}
          className="px-3 py-1.5 rounded bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-sm font-medium transition-colors disabled:opacity-40"
        >
          {initial ? 'Save changes' : 'Add mapping'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SkipReasonsSection({ initialReasons }: { initialReasons: SkipReason[] }) {
  const [reasons, setReasons] = useState<SkipReason[]>(initialReasons)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [sectionError, setSectionError] = useState<string | null>(null)

  async function createReason(label: string, sortOrder: number) {
    setSectionError(null)
    try {
      const res = await fetch('/api/admin/daily-log/skip-reasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, sort_order: sortOrder }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`)
      setReasons(prev => [...prev, body.reason as SkipReason].sort((a, b) => a.sort_order - b.sort_order))
      setShowAddForm(false)
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function updateReason(id: string, patch: Partial<SkipReason>) {
    setSectionError(null)
    try {
      const res = await fetch(`/api/admin/daily-log/skip-reasons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`)
      setReasons(prev =>
        prev.map(r => r.id === id ? (body.reason as SkipReason) : r)
          .sort((a, b) => a.sort_order - b.sort_order)
      )
      setEditingId(null)
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function deleteReason(id: string) {
    if (!confirm('Delete this skip reason? Stops already marked as skipped with this reason will retain the label text.')) return
    setSectionError(null)
    try {
      const res = await fetch(`/api/admin/daily-log/skip-reasons/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Delete failed (${res.status})`)
      }
      setReasons(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      setSectionError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const nextSortOrder = reasons.length > 0 ? Math.max(...reasons.map(r => r.sort_order)) + 10 : 10

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <div>
        <h2 className="font-semibold">
          Skip reasons <span className="text-xs text-violet-200 bg-violet-500/20 px-1.5 py-0.5 rounded ml-1 align-middle">v2</span>
        </h2>
        <p className="text-xs text-white/50 mt-0.5">
          Reason codes techs can select when marking a Daily Log v2 stop as skipped — e.g. &ldquo;Locked gate&rdquo;, &ldquo;Dog out&rdquo;, &ldquo;Customer request&rdquo;. Sort order controls the display sequence in the picker.
        </p>
      </div>

      {sectionError && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 rounded px-3 py-2 text-xs">
          {sectionError}
        </div>
      )}

      <div className="space-y-2">
        {reasons.length === 0 && !showAddForm && (
          <div className="text-sm text-white/40 italic py-2">
            No skip reasons configured. Techs must type a custom reason or skip without one until you add some.
          </div>
        )}

        {reasons.map(r =>
          editingId === r.id ? (
            <SkipReasonForm
              key={r.id}
              initial={r}
              onCancel={() => setEditingId(null)}
              onSave={(label, sortOrder) => updateReason(r.id, { label, sort_order: sortOrder })}
            />
          ) : (
            <SkipReasonRow
              key={r.id}
              reason={r}
              onEdit={() => setEditingId(r.id)}
              onDelete={() => deleteReason(r.id)}
              onToggleActive={() => updateReason(r.id, { active: !r.active })}
            />
          )
        )}

        {showAddForm ? (
          <SkipReasonForm
            defaultSortOrder={nextSortOrder}
            onCancel={() => setShowAddForm(false)}
            onSave={(label, sortOrder) => createReason(label, sortOrder)}
          />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full px-3 py-2 border border-dashed border-white/20 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
          >
            + Add skip reason
          </button>
        )}
      </div>
    </section>
  )
}

function SkipReasonRow({
  reason,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  reason: SkipReason
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  return (
    <div className={`rounded-lg border border-white/10 bg-gray-950/50 px-3 py-2.5 ${reason.active ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-xs text-white/30 font-mono w-8 shrink-0">{reason.sort_order}</span>
          <span className="font-medium text-white truncate">{reason.label}</span>
          {!reason.active && (
            <span className="text-[10px] uppercase tracking-wide bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded shrink-0">Inactive</span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          <button
            onClick={onToggleActive}
            className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            title={reason.active ? 'Disable — hides from tech picker' : 'Enable — shows in tech picker'}
          >
            {reason.active ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-300 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function SkipReasonForm({
  initial,
  defaultSortOrder = 10,
  onCancel,
  onSave,
}: {
  initial?: SkipReason
  defaultSortOrder?: number
  onCancel: () => void
  onSave: (label: string, sortOrder: number) => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? defaultSortOrder)

  function submit() {
    const trimmed = label.trim()
    if (!trimmed || trimmed.length > 100) return
    onSave(trimmed, sortOrder)
  }

  return (
    <div className="rounded-lg border border-[#2E7EB8]/40 bg-[#2E7EB8]/5 px-3 py-3 space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Label *</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="e.g. Locked gate"
            maxLength={100}
            autoFocus
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <div className="w-24">
          <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">Sort order</label>
          <input
            type="number"
            value={sortOrder}
            onChange={e => setSortOrder(parseInt(e.target.value) || 0)}
            min={0}
            step={10}
            className="w-full bg-gray-900 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={label.trim().length === 0 || label.trim().length > 100}
          className="px-3 py-1.5 rounded bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-sm font-medium transition-colors disabled:opacity-40"
        >
          {initial ? 'Save changes' : 'Add reason'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function PickerSection({
  title,
  subtitle,
  empty,
  items,
  selected,
  onToggle,
}: {
  title: string
  subtitle: string
  empty: string
  items: { id: string; label: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-xs text-white/40">{selected.size} selected</span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-white/50">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((it) => {
            const on = selected.has(it.id)
            return (
              <label
                key={it.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                  on
                    ? 'bg-[#2E7EB8]/20 border-[#2E7EB8]/40'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(it.id)}
                  className="accent-[#2E7EB8]"
                />
                <span className="text-sm">{it.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}
