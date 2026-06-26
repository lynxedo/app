'use client'

import { useEffect, useState } from 'react'
import { useToast, useConfirm } from '@/components/ui'

export type TxtNumber = {
  id: string
  twilio_number: string
  label: string | null
  is_default: boolean
  created_at: string
}

type UserNumberAssignment = {
  user_id: string
  display_name: string | null
  is_bot: boolean
  txt_default_number_id: string | null
  // [] = unrestricted (sees all numbers); non-empty = limited to these ids.
  access_number_ids: string[]
}

function formatPhone(e164: string) {
  const digits = e164.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return e164
}

export default function TxtNumbersPanel({
  initialNumbers,
}: {
  initialNumbers: TxtNumber[]
}) {
  const [numbers, setNumbers] = useState<TxtNumber[]>(initialNumbers)
  const [assignments, setAssignments] = useState<UserNumberAssignment[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)

  // Number form state
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<TxtNumber | null>(null)
  const [twilioNumber, setTwilioNumber] = useState('')
  const [label, setLabel] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirmDialog = useConfirm()

  useEffect(() => {
    fetch('/api/admin/txt/user-numbers')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setAssignments(data.users || []))
      .catch(() => setAssignments([]))
      .finally(() => setAssignmentsLoading(false))
  }, [])

  function openCreate() {
    setCreating(true)
    setEditing(null)
    setTwilioNumber('')
    setLabel('')
    setIsDefault(numbers.length === 0)
    setError('')
  }

  function openEdit(n: TxtNumber) {
    setCreating(false)
    setEditing(n)
    setTwilioNumber(n.twilio_number)
    setLabel(n.label || '')
    setIsDefault(n.is_default)
    setError('')
  }

  function closeForm() {
    setCreating(false)
    setEditing(null)
    setError('')
  }

  async function save() {
    setError('')
    setSaving(true)
    const payload = editing
      ? { label: label.trim() || null, is_default: isDefault }
      : { twilio_number: twilioNumber.trim(), label: label.trim() || null, is_default: isDefault }
    const url = editing
      ? `/api/admin/txt/numbers/${editing.id}`
      : '/api/admin/txt/numbers'
    const method = editing ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || 'Save failed')
      return
    }
    const saved = data.number as TxtNumber
    setNumbers((prev) => {
      const next = editing
        ? prev.map((n) => (n.id === saved.id ? saved : n))
        : [...prev, saved]
      // When something is_default flipped, demote everything else so the
      // local view stays in sync with the server-side partial-unique.
      const normalized = saved.is_default
        ? next.map((n) => (n.id === saved.id ? n : { ...n, is_default: false }))
        : next
      return normalized.sort(
        (a, b) =>
          (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) ||
          (a.label || a.twilio_number).localeCompare(b.label || b.twilio_number)
      )
    })
    closeForm()
  }

  async function remove(n: TxtNumber) {
    if (!(await confirmDialog({ message: `Delete ${n.label || formatPhone(n.twilio_number)}? Conversations using it will keep their history but lose the from-number stamp.`, danger: true }))) return
    const res = await fetch(`/api/admin/txt/numbers/${n.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Delete failed')
      return
    }
    setNumbers((prev) => prev.filter((x) => x.id !== n.id))
    setAssignments((prev) =>
      prev.map((a) => ({
        ...a,
        txt_default_number_id: a.txt_default_number_id === n.id ? null : a.txt_default_number_id,
        // The DB row cascades on delete; mirror that locally.
        access_number_ids: a.access_number_ids.filter((id) => id !== n.id),
      }))
    )
  }

  async function setAccessForUser(userId: string, nextIds: string[]) {
    const prevState = assignments
    setAssignments((prev) =>
      prev.map((a) => (a.user_id === userId ? { ...a, access_number_ids: nextIds } : a))
    )
    const res = await fetch('/api/admin/txt/number-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, phone_number_ids: nextIds }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Access update failed')
      setAssignments(prevState) // revert optimistic change
    }
  }

  function toggleAccess(u: UserNumberAssignment, numberId: string) {
    const has = u.access_number_ids.includes(numberId)
    const next = has
      ? u.access_number_ids.filter((id) => id !== numberId)
      : [...u.access_number_ids, numberId]
    setAccessForUser(u.user_id, next)
  }

  async function assignNumberToUser(userId: string, phoneNumberId: string | null) {
    setAssignments((prev) =>
      prev.map((a) => (a.user_id === userId ? { ...a, txt_default_number_id: phoneNumberId } : a))
    )
    const res = await fetch('/api/admin/txt/user-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, phone_number_id: phoneNumberId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Assignment failed')
      // Reload to undo the optimistic change
      fetch('/api/admin/txt/user-numbers')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setAssignments(d.users || []))
        .catch(() => {})
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Txt — Phone Numbers</h1>
          <p className="text-sm text-gray-400 mt-1">
            Twilio phone numbers your company sends from. Each user picks a default;
            individual conversations can override.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        >
          + Add number
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-xs text-gray-300 space-y-1">
        <div className="font-medium text-gray-100">How outbound routing works</div>
        <div>
          When someone sends a message, the from-number is picked in this order:
        </div>
        <ol className="ml-4 mt-1 list-decimal space-y-0.5 text-gray-400">
          <li>Per-conversation override (set from the header chip in a conversation)</li>
          <li>The sender&apos;s default (assigned below)</li>
          <li>The company default (marked &quot;Default&quot; in the table)</li>
        </ol>
        <div className="mt-2 text-gray-500">
          Inbound texts auto-stamp the conversation with the number they came in on.
        </div>
      </div>

      {(creating || editing) && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="text-sm font-medium">
            {editing ? `Edit ${editing.label || formatPhone(editing.twilio_number)}` : 'New phone number'}
          </div>
          {!editing && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Twilio number (E.164 or US format)</label>
              <input
                value={twilioNumber}
                onChange={(e) => setTwilioNumber(e.target.value)}
                placeholder="(281) 555-1234 or +12815551234"
                className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm"
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Main / Sales / Service"
              maxLength={80}
              className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4"
            />
            <span>Company default — used when a sender has no per-user default</span>
          </label>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || (!editing && !twilioNumber.trim())}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add number'}
            </button>
            <button
              onClick={closeForm}
              className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-gray-200 mb-2">Numbers</h2>
        <div className="rounded-lg border border-gray-800 overflow-hidden">
          {numbers.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No phone numbers added yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-xs text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 w-40">Label</th>
                  <th className="text-left px-3 py-2">Number</th>
                  <th className="text-left px-3 py-2 w-24">Default</th>
                  <th className="text-right px-3 py-2 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {numbers.map((n) => (
                  <tr key={n.id} className="border-t border-gray-800">
                    <td className="px-3 py-2 font-medium">{n.label || '—'}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{formatPhone(n.twilio_number)}</td>
                    <td className="px-3 py-2">
                      {n.is_default ? (
                        <span className="text-emerald-300 text-xs">✓ Default</span>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(n)}
                        className="text-xs px-2 py-1 rounded hover:bg-gray-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(n)}
                        className="text-xs px-2 py-1 rounded hover:bg-gray-800 text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-gray-200 mb-2">Per-user numbers</h2>
        <div className="text-xs text-gray-500 mb-2 space-y-0.5">
          <div>
            <span className="text-gray-300">Default number</span> — the number this
            person sends from when a conversation has no override. Empty = company default.
          </div>
          <div>
            <span className="text-gray-300">Access</span> — which numbers they see in
            Txt2 &amp; the Dialer. <span className="text-emerald-300">No boxes checked = all numbers</span>;
            check specific ones to declutter (e.g. limit a field tech to one line).
            Admins always see everything.
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 overflow-hidden">
          {assignmentsLoading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Loading…</div>
          ) : assignments.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No users.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-xs text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2 w-64">Default number</th>
                  <th className="text-left px-3 py-2">Access</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((u) => (
                  <tr key={u.user_id} className="border-t border-gray-800 align-top">
                    <td className="px-3 py-2">{u.display_name || u.user_id}</td>
                    <td className="px-3 py-2">
                      <select
                        value={u.txt_default_number_id || ''}
                        onChange={(e) =>
                          assignNumberToUser(u.user_id, e.target.value || null)
                        }
                        className="w-full px-2 py-1 rounded-md bg-gray-950 border border-gray-700 text-xs"
                        disabled={numbers.length === 0}
                      >
                        <option value="">— (use company default)</option>
                        {numbers.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.label ? `${n.label} · ${formatPhone(n.twilio_number)}` : formatPhone(n.twilio_number)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {numbers.length === 0 ? (
                        <span className="text-xs text-gray-600">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          {numbers.map((n) => (
                            <label
                              key={n.id}
                              className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5"
                                checked={u.access_number_ids.includes(n.id)}
                                onChange={() => toggleAccess(u, n.id)}
                              />
                              <span>
                                {n.label
                                  ? `${n.label} · ${formatPhone(n.twilio_number)}`
                                  : formatPhone(n.twilio_number)}
                              </span>
                            </label>
                          ))}
                          <span
                            className={
                              u.access_number_ids.length === 0
                                ? 'text-[11px] text-emerald-300'
                                : 'text-[11px] text-amber-300'
                            }
                          >
                            {u.access_number_ids.length === 0
                              ? 'All numbers'
                              : `Limited to ${u.access_number_ids.length}`}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
