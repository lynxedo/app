'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import type { InboxRule, RuleAction, RuleCondition } from '@/lib/inbox/rules'

/**
 * Inbox rules manager (slide-over, light theme — matches the inbox main pane).
 * Rules run automatically on new incoming email: conditions (all/any) → actions
 * (assign / move to folder / mark urgent / auto-close), in order, with an
 * Outlook-style "stop processing more rules" flag.
 *
 * Admin-gated server-side (Integrations admin); non-admins get a friendly
 * "manager access required" note if the gear menu surfaced this to them.
 * Self-contained: all fetches live here.
 */

type HubUser = { id: string; display_name: string; is_bot?: boolean }
type InboxFolder = { id: string; provider_folder_id: string; name: string | null }

const FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'from_email', label: 'From address' },
  { value: 'from_name', label: 'From name' },
  { value: 'subject', label: 'Subject' },
  { value: 'body', label: 'Body' },
  { value: 'to', label: 'To' },
]
const OP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'equals', label: 'equals' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
]
const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'assign_to_user', label: 'Assign to user' },
  { value: 'move_to_folder', label: 'Move to folder' },
  { value: 'mark_urgent', label: 'Mark urgent' },
  { value: 'auto_close', label: 'Auto-close' },
]

const label = (opts: Array<{ value: string; label: string }>, v: string) =>
  opts.find((o) => o.value === v)?.label || v

const newCondition = (): RuleCondition => ({ field: 'from_email', op: 'contains', value: '' })
const newAction = (): RuleAction => ({ type: 'assign_to_user', user_id: '' })

export default function RulesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rules, setRules] = useState<InboxRule[]>([])
  const [users, setUsers] = useState<HubUser[]>([])
  const [folders, setFolders] = useState<InboxFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState(false)

  // Form state (null editingId + formOpen=false → list view; editingId null + formOpen → new rule).
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all')
  const [conditions, setConditions] = useState<RuleCondition[]>([newCondition()])
  const [actions, setActions] = useState<RuleAction[]>([newAction()])
  const [stopProcessing, setStopProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/email/rules')
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setRules((data.rules || []) as InboxRule[])
    } catch {
      /* leave the current list */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setForbidden(false)
    Promise.all([
      loadRules(),
      // Same teammate source as AssignMenu.
      fetch('/api/hub/users')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setUsers(((d.users || []) as HubUser[]).filter((u) => !u.is_bot)))
        .catch(() => setUsers([])),
      // Shared-mailbox folders for the move-to-folder picker.
      fetch('/api/hub/email/folders?account=shared')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setFolders((d.folders || []) as InboxFolder[]))
        .catch(() => setFolders([])),
    ]).finally(() => setLoading(false))
  }, [open, loadRules])

  const userName = useCallback(
    (id?: string) => users.find((u) => u.id === id)?.display_name || 'teammate',
    [users]
  )

  function summarize(rule: InboxRule): string {
    const conds = (rule.conditions || [])
      .map((c) => `${label(FIELD_OPTIONS, c.field)} ${label(OP_OPTIONS, c.op)} ${c.value}`)
      .join(rule.match_mode === 'any' ? ' or ' : ' and ')
    const acts = (rule.actions || [])
      .map((a) => {
        if (a.type === 'assign_to_user') return `Assign to ${userName(a.user_id)}`
        if (a.type === 'move_to_folder') return `Move to ${a.folder_name || 'folder'}`
        return label(ACTION_OPTIONS, a.type)
      })
      .join(', ')
    return `${conds || 'No conditions'} → ${acts || 'no actions'}`
  }

  function openNew() {
    setEditingId(null)
    setName('')
    setMatchMode('all')
    setConditions([newCondition()])
    setActions([newAction()])
    setStopProcessing(false)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(rule: InboxRule) {
    setEditingId(rule.id)
    setName(rule.name)
    setMatchMode(rule.match_mode === 'any' ? 'any' : 'all')
    setConditions(rule.conditions?.length ? rule.conditions.map((c) => ({ ...c })) : [newCondition()])
    setActions(rule.actions?.length ? rule.actions.map((a) => ({ ...a })) : [newAction()])
    setStopProcessing(!!rule.stop_processing)
    setFormError(null)
    setFormOpen(true)
  }

  async function toggleEnabled(rule: InboxRule) {
    if (busy) return
    setBusy(true)
    const next = !rule.enabled
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r))) // optimistic
    try {
      const res = await fetch(`/api/hub/email/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)))
    } finally {
      setBusy(false)
    }
  }

  async function move(rule: InboxRule, dir: -1 | 1) {
    if (busy) return
    const idx = rules.findIndex((r) => r.id === rule.id)
    const swapWith = rules[idx + dir]
    if (!swapWith) return
    setBusy(true)
    try {
      // Swap the two rules' sort_order values.
      await fetch(`/api/hub/email/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: swapWith.sort_order }),
      })
      await fetch(`/api/hub/email/rules/${swapWith.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: rule.sort_order }),
      })
      await loadRules()
    } finally {
      setBusy(false)
    }
  }

  async function remove(rule: InboxRule) {
    if (busy) return
    if (!window.confirm(`Delete the rule "${rule.name}"? This can't be undone.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/hub/email/rules/${rule.id}`, { method: 'DELETE' })
      if (res.ok) setRules((rs) => rs.filter((r) => r.id !== rule.id))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (saving) return
    setFormError(null)
    if (!name.trim()) return setFormError('Give the rule a name.')
    if (conditions.length === 0) return setFormError('Add at least one condition.')
    if (conditions.some((c) => !c.value.trim())) return setFormError('Every condition needs a value.')
    if (actions.length === 0) return setFormError('Add at least one action.')
    for (const a of actions) {
      if (a.type === 'assign_to_user' && !a.user_id) return setFormError('Pick a user for the assign action.')
      if (a.type === 'move_to_folder' && !a.provider_folder_id)
        return setFormError('Pick a folder for the move action.')
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        match_mode: matchMode,
        conditions: conditions.map((c) => ({ field: c.field, op: c.op, value: c.value.trim() })),
        actions,
        stop_processing: stopProcessing,
      }
      const res = await fetch(editingId ? `/api/hub/email/rules/${editingId}` : '/api/hub/email/rules', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setFormError((data?.error as string) || 'Save failed — try again.')
        return
      }
      setFormOpen(false)
      await loadRules()
    } finally {
      setSaving(false)
    }
  }

  function setCondition(i: number, patch: Partial<RuleCondition>) {
    setConditions((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  function setActionType(i: number, type: string) {
    setActions((as) =>
      as.map((a, idx) => {
        if (idx !== i) return a
        if (type === 'assign_to_user') return { type, user_id: '' }
        if (type === 'move_to_folder') return { type, provider_folder_id: '', folder_name: '' }
        return { type }
      })
    )
  }

  function setActionParam(i: number, patch: Partial<RuleAction>) {
    setActions((as) => as.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  if (!open) return null

  const inputCls =
    'border border-gray-200 rounded-md px-2 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="email-light-surface relative h-full w-full max-w-xl bg-white text-gray-900 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold">Inbox rules</h2>
            <p className="text-xs text-gray-500">Rules run automatically on new incoming email.</p>
          </div>
          <div className="flex items-center gap-2">
            {!forbidden && !formOpen && (
              <button
                type="button"
                onClick={openNew}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                + New rule
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center">
              <Spinner size={6} />
            </div>
          ) : forbidden ? (
            <div className="p-6 text-sm text-gray-600">
              <p className="font-medium text-gray-900 mb-1">Manager access required</p>
              <p>
                Inbox rules are managed by Integrations admins. Ask a manager if a rule needs to be added or
                changed.
              </p>
            </div>
          ) : formOpen ? (
            /* ---------------- Add / Edit form ---------------- */
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rule name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Angi leads to Kathryn"
                  className={`w-full ${inputCls}`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">
                    When{' '}
                    <select
                      value={matchMode}
                      onChange={(e) => setMatchMode(e.target.value === 'any' ? 'any' : 'all')}
                      className="border border-gray-200 rounded px-1 py-0.5 text-xs bg-white"
                    >
                      <option value="all">all</option>
                      <option value="any">any</option>
                    </select>{' '}
                    of these match:
                  </label>
                </div>
                <div className="space-y-2">
                  {conditions.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={c.field}
                        onChange={(e) => setCondition(i, { field: e.target.value })}
                        className={inputCls}
                      >
                        {FIELD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={c.op}
                        onChange={(e) => setCondition(i, { op: e.target.value })}
                        className={inputCls}
                      >
                        {OP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={c.value}
                        onChange={(e) => setCondition(i, { value: e.target.value })}
                        placeholder="value"
                        className={`flex-1 min-w-0 ${inputCls}`}
                      />
                      <button
                        type="button"
                        onClick={() => setConditions((cs) => cs.filter((_, idx) => idx !== i))}
                        disabled={conditions.length <= 1}
                        aria-label="Remove condition"
                        className="text-gray-400 hover:text-red-600 disabled:opacity-30 px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setConditions((cs) => [...cs, newCondition()])}
                  className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  + Add condition
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Then:</label>
                <div className="space-y-2">
                  {actions.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={a.type}
                        onChange={(e) => setActionType(i, e.target.value)}
                        className={inputCls}
                      >
                        {ACTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {a.type === 'assign_to_user' && (
                        <select
                          value={a.user_id || ''}
                          onChange={(e) => setActionParam(i, { user_id: e.target.value })}
                          className={`flex-1 min-w-0 ${inputCls}`}
                        >
                          <option value="">Choose a teammate…</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.display_name}
                            </option>
                          ))}
                        </select>
                      )}
                      {a.type === 'move_to_folder' && (
                        <select
                          value={a.provider_folder_id || ''}
                          onChange={(e) => {
                            const f = folders.find((x) => x.provider_folder_id === e.target.value)
                            setActionParam(i, {
                              provider_folder_id: e.target.value,
                              folder_name: f?.name || '',
                            })
                          }}
                          className={`flex-1 min-w-0 ${inputCls}`}
                        >
                          <option value="">Choose a folder…</option>
                          {folders.map((f) => (
                            <option key={f.provider_folder_id} value={f.provider_folder_id}>
                              {f.name || '(unnamed)'}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => setActions((as) => as.filter((_, idx) => idx !== i))}
                        disabled={actions.length <= 1}
                        aria-label="Remove action"
                        className="text-gray-400 hover:text-red-600 disabled:opacity-30 px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setActions((as) => [...as, newAction()])}
                  className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  + Add action
                </button>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={stopProcessing}
                  onChange={(e) => setStopProcessing(e.target.checked)}
                  className="accent-emerald-600"
                />
                Stop processing more rules
              </label>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create rule'}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : rules.length === 0 ? (
            /* ---------------- Empty state ---------------- */
            <div className="p-8 text-center text-sm text-gray-600">
              <div className="text-3xl mb-2">📥</div>
              <p className="font-medium text-gray-900 mb-1">No rules yet</p>
              <p className="max-w-sm mx-auto">
                Rules run automatically on new incoming email — assign conversations to the right person, file
                them into folders, flag them urgent, or close ones nobody needs to answer.
              </p>
              <button
                type="button"
                onClick={openNew}
                className="mt-4 px-4 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Create your first rule
              </button>
            </div>
          ) : (
            /* ---------------- Rule list ---------------- */
            <ul className="divide-y divide-gray-200">
              {rules.map((rule, i) => (
                <li key={rule.id} className="px-4 py-3 flex items-start gap-3">
                  {/* Enabled toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    onClick={() => toggleEnabled(rule)}
                    disabled={busy}
                    title={rule.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                    className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                      rule.enabled ? 'bg-emerald-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                      style={{ transform: rule.enabled ? 'translateX(16px)' : 'translateX(0)' }}
                    />
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${rule.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                      {rule.name}
                      {rule.stop_processing && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">stops</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 truncate" title={summarize(rule)}>
                      {summarize(rule)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => move(rule, -1)}
                      disabled={busy || i === 0}
                      aria-label="Move up"
                      className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(rule, 1)}
                      disabled={busy || i === rules.length - 1}
                      aria-label="Move down"
                      className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(rule)}
                      className="px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(rule)}
                      disabled={busy}
                      className="px-2 py-1 text-xs font-medium rounded border border-gray-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
