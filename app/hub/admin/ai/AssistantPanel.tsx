'use client'

// Admin → AI → Assistant — the action-layer settings (hub_assistant_settings).
//
// Self-fetching panel (the SchedulingPanel pattern): loads on mount, tracks a
// snapshot for dirty detection, saves with an explicit button — consistent with
// the rest of the AI admin area.
//
// `sections` picks which pieces render, so the Assistant tab can place them
// where they belong instead of stacking everything in one column: the on/off
// switches + connected apps live under Settings, the action allow-list under
// Permissions. Each instance fetches the whole settings row on mount and saves
// the whole row. Two instances can be mounted at once (Settings mounts
// 'switches' and 'apps' separately), but at most ONE mounted instance is ever
// editable ('apps' has no Save), and tab switches unmount + refetch — so a save
// can never write another instance's stale state.

import { useCallback, useEffect, useState } from 'react'

export type AssistantSection = 'switches' | 'actions' | 'apps'

type Settings = {
  enabled: boolean
  mcpEnabled: boolean
  requireConfirmation: boolean
  allowOutwardOverMcp: boolean
  requireJobberConfirmation: boolean
  disabledActions: string[]
  enabledActions: string[]
  memoryMode: MemoryMode
}

type MemoryMode = 'off' | 'light' | 'full'

const MEMORY_OPTIONS: Array<{ value: MemoryMode; label: string; hint: string }> = [
  {
    value: 'light',
    label: 'Light — remembers what it did',
    hint: 'Recommended. Between messages it keeps a short note of which lookups it ran and which records it touched, so it stops repeating work and can finish something you approve. Costs very little.',
  },
  {
    value: 'full',
    label: 'Full — remembers the detail',
    hint: 'Carries the actual results forward, not just a note. Best for a long piece of work in one conversation, where it needs to reason over what it found. Uses noticeably more tokens on every message.',
  },
  {
    value: 'off',
    label: 'Off — no memory',
    hint: 'Every message starts from nothing. It will re-run lookups it already did, and may not be able to complete something you approve.',
  },
]

type ActionMeta = {
  name: string
  kind: string
  group: 'hub' | 'jobber'
  defaultOn: boolean
  consentLabel: string
}

type Connection = {
  id: string
  user: string
  client: string
  kind: string
  created_at: string
  last_used_at: string | null
}

const KIND_LABEL: Record<string, string> = {
  read: 'Looks things up',
  write: 'Makes internal changes',
  outward: 'Reaches customers',
  jobber_write: 'Changes the Jobber schedule',
}

const KIND_STYLE: Record<string, string> = {
  read: 'bg-gray-700/60 text-white/70',
  write: 'bg-blue-500/20 text-blue-200',
  outward: 'bg-amber-500/20 text-amber-200',
  jobber_write: 'bg-amber-500/20 text-amber-200',
}

const GROUP_LABEL: Record<string, string> = {
  hub: 'In the Hub',
  jobber: 'In Jobber',
}

const GROUP_BLURB: Record<string, string> = {
  hub: 'Customers, texts, calls, leads and task boards inside Lynxedo.',
  jobber: 'Reads come straight from Jobber. Changes move the real schedule your crews work from, so they start switched off.',
}

export default function AssistantPanel({
  sections = ['switches', 'actions', 'apps'],
}: {
  sections?: AssistantSection[]
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [snapshot, setSnapshot] = useState('')
  const [actions, setActions] = useState<ActionMeta[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/hub-assistant')
    if (!res.ok) throw new Error('Could not load assistant settings')
    const data = (await res.json()) as {
      settings: Settings
      actions: ActionMeta[]
      connections: Connection[]
    }
    setSettings(data.settings)
    setSnapshot(JSON.stringify(data.settings))
    setActions(data.actions)
    setConnections(data.connections)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await load()
      } catch {
        if (alive) setError('Could not load assistant settings.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [load])

  const dirty = settings ? JSON.stringify(settings) !== snapshot : false

  async function save() {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/hub-assistant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.enabled,
          mcp_enabled: settings.mcpEnabled,
          require_confirmation: settings.requireConfirmation,
          allow_outward_over_mcp: settings.allowOutwardOverMcp,
          require_jobber_confirmation: settings.requireJobberConfirmation,
          disabled_actions: settings.disabledActions,
          enabled_actions: settings.enabledActions,
          memory_mode: settings.memoryMode,
        }),
      })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { settings: Settings }
      setSettings(data.settings)
      setSnapshot(JSON.stringify(data.settings))
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function revoke(id: string) {
    if (!confirm('Disconnect this Claude app? It will stop working immediately.')) return
    try {
      const res = await fetch(`/api/admin/hub-assistant?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setConnections((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setError('Could not disconnect that app.')
    }
  }

  // Two arrays, because the two halves have opposite defaults: looking things up
  // is on unless an admin removes it, and anything consequential is off until an
  // admin adds it. So which list a tick writes to depends on the action.
  function toggleAction(meta: ActionMeta, on: boolean) {
    setSettings((prev) => {
      if (!prev) return prev
      if (meta.defaultOn) {
        const set = new Set(prev.disabledActions)
        if (on) set.delete(meta.name)
        else set.add(meta.name)
        return { ...prev, disabledActions: [...set] }
      }
      const set = new Set(prev.enabledActions)
      if (on) set.add(meta.name)
      else set.delete(meta.name)
      return { ...prev, enabledActions: [...set] }
    })
  }

  function isActionOn(meta: ActionMeta, s: Settings): boolean {
    return meta.defaultOn ? !s.disabledActions.includes(meta.name) : s.enabledActions.includes(meta.name)
  }

  if (loading) return <p className="text-sm text-white/50">Loading…</p>
  if (!settings) {
    return <p className="text-sm text-red-300">{error || 'Could not load assistant settings.'}</p>
  }

  return (
    <div className="space-y-6">
      {sections.includes('switches') && (
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h2 className="text-sm font-semibold text-[#fff]">Hub Assistant</h2>
        <p className="mt-1 text-sm text-white/60">
          Lets your team ask the assistant to look things up and take actions — find a customer, check
          the schedule, add a task, text a customer. Every action runs with that person&apos;s own
          permissions, so nobody gains access they don&apos;t already have.
        </p>

        <div className="mt-4 space-y-3">
          <Toggle
            label="Turn the assistant on"
            hint="Off by default. While off, the assistant answers questions but takes no actions."
            checked={settings.enabled}
            onChange={(v) => setSettings({ ...settings, enabled: v })}
          />
          <Toggle
            label="Allow outside Claude apps to connect"
            hint="Lets each person connect claude.ai, Claude Code, or the Claude desktop app to this Hub from Settings → Claude Connection."
            checked={settings.mcpEnabled}
            disabled={!settings.enabled}
            onChange={(v) => setSettings({ ...settings, mcpEnabled: v })}
          />
          <Toggle
            label="Require confirmation before customer-facing actions"
            hint="Strongly recommended. The assistant shows the exact recipient and message and sends nothing until a person approves it."
            checked={settings.requireConfirmation}
            onChange={(v) => setSettings({ ...settings, requireConfirmation: v })}
          />
          <Toggle
            label="Let connected Claude apps text customers and change Jobber visits"
            hint="Off by default, and only ever affects outside Claude apps — never the Hub itself. It covers four things: texting a customer, and rescheduling, reassigning or completing a visit. Everything else — lookups, the schedule, leads, tasks, Hub messages — works through a connected app either way."
            checked={settings.allowOutwardOverMcp}
            disabled={!settings.enabled || !settings.mcpEnabled}
            onChange={(v) => setSettings({ ...settings, allowOutwardOverMcp: v })}
          />
          {settings.allowOutwardOverMcp && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              With this on, a connected Claude app can text a customer or move a visit on your Jobber
              calendar. <strong className="text-amber-100">The Hub&apos;s own approval step
              doesn&apos;t apply there</strong> — inside the Hub nothing goes out until a person
              replies to approve it, but a connected app can&apos;t be held to that, so approval rests
              on that app asking you first. Two things to weigh: a customer text goes out as the
              person who asked for it, under their name and signature; and a wrong schedule change is
              quiet — no customer sees it, a crew just shows up on the wrong day.
            </p>
          )}
          <Toggle
            label="Require confirmation before Jobber schedule changes"
            hint="Recommended. Moving or reassigning a visit shows you the customer and both dates first. A wrong schedule change is quiet — a crew just shows up on the wrong day."
            checked={settings.requireJobberConfirmation}
            onChange={(v) => setSettings({ ...settings, requireJobberConfirmation: v })}
          />
          {!settings.requireConfirmation && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              With confirmation off, the assistant can text a customer as soon as someone asks it to,
              with no review step. Only do this if you fully trust everyone who can use it.
            </p>
          )}

          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-sm font-medium text-white">Memory between messages</p>
            <p className="text-xs text-white/60">
              How much of a conversation the assistant carries from one message to the next.
            </p>
            <div className="space-y-2">
              {MEMORY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer gap-3 rounded-lg border border-white/10 p-3 hover:bg-white/5"
                >
                  <input
                    type="radio"
                    name="memory-mode"
                    className="mt-1"
                    checked={settings.memoryMode === opt.value}
                    onChange={() => setSettings({ ...settings, memoryMode: opt.value })}
                  />
                  <span>
                    <span className="block text-sm text-white">{opt.label}</span>
                    <span className="block text-xs text-white/60">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {settings.memoryMode === 'full' && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <strong className="text-amber-100">Full memory costs more.</strong> Every message
                carries the recent conversation with it, so each one is bigger than it would be on
                Light — the longer the thread, the bigger. Worth it while you&apos;re working through
                something substantial in one conversation; switch back to Light for day-to-day use.
                Nothing is lost by switching either way — the assistant records both, so turning Full
                on part-way through a job still gives it the detail from earlier.
              </p>
            )}
          </div>
        </div>
      </section>
      )}

      {sections.includes('actions') && (
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-[#fff]">What it&apos;s allowed to do</h3>
        <p className="mt-1 text-sm text-white/60">
          Turn individual actions off for the whole company. A person still also needs their own
          permission for each one — and changing things (the Jobber schedule, notes) plus live web
          search are for managers and admins only, no matter what&apos;s ticked here.
        </p>
        {(['hub', 'jobber'] as const).map((group) => {
          const groupActions = actions.filter((a) => a.group === group && a.name !== 'confirm_action')
          if (groupActions.length === 0) return null
          return (
            <div key={group} className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                {GROUP_LABEL[group]}
              </h4>
              <p className="mt-0.5 text-xs text-white/40">{GROUP_BLURB[group]}</p>
              <ul className="mt-2 space-y-2">
                {groupActions.map((a) => {
                  const on = isActionOn(a, settings)
                  return (
                    <li key={a.name} className="flex items-start gap-3">
                      <input
                        id={`act-${a.name}`}
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggleAction(a, e.target.checked)}
                        className="mt-1 h-4 w-4"
                      />
                      <label htmlFor={`act-${a.name}`} className="flex-1 cursor-pointer">
                        <span className="text-sm text-white/90">{a.consentLabel}</span>
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${KIND_STYLE[a.kind] || KIND_STYLE.read}`}
                        >
                          {KIND_LABEL[a.kind] || a.kind}
                        </span>
                        {!a.defaultOn && (
                          <span className="ml-2 rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] text-white/50">
                            off by default
                          </span>
                        )}
                        <span className="ml-2 font-mono text-[10px] text-white/30">{a.name}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </section>
      )}

      {sections.includes('apps') && (
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-[#fff]">Connected Claude apps</h3>
        {connections.length === 0 ? (
          <p className="mt-1 text-sm text-white/50">Nobody has connected a Claude app yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-800">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/90">
                    {c.client} <span className="text-white/40">· {c.user}</span>
                  </p>
                  <p className="text-xs text-white/40">
                    {c.kind} · added {new Date(c.created_at).toLocaleDateString()} · last used{' '}
                    {c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : 'never'}
                  </p>
                </div>
                <button
                  onClick={() => revoke(c.id)}
                  className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-white/80 hover:bg-gray-800"
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      {/* Only editable sections get a Save button — 'apps' alone has nothing to save. */}
      {(sections.includes('switches') || sections.includes('actions')) && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#fff] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && !saving && <span className="text-xs text-amber-300">Unsaved changes</span>}
        </div>
      )}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="block text-sm text-white/90">{label}</span>
        <span className="block text-xs text-white/50">{hint}</span>
      </span>
    </label>
  )
}
