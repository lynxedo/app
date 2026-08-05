'use client'

// Admin → AI → Assistant.
//
// Self-fetching panel (the SchedulingPanel pattern): takes no props, loads on
// mount, tracks a snapshot for dirty detection, saves with an explicit button —
// consistent with the rest of the AI admin area.

import { useCallback, useEffect, useState } from 'react'

type Settings = {
  enabled: boolean
  mcpEnabled: boolean
  requireConfirmation: boolean
  allowOutwardOverMcp: boolean
  disabledActions: string[]
}

type ActionMeta = { name: string; kind: string; consentLabel: string }

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
}

const KIND_STYLE: Record<string, string> = {
  read: 'bg-gray-700/60 text-white/70',
  write: 'bg-blue-500/20 text-blue-200',
  outward: 'bg-amber-500/20 text-amber-200',
}

export default function AssistantPanel() {
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
          disabled_actions: settings.disabledActions,
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

  function toggleAction(name: string, on: boolean) {
    setSettings((prev) => {
      if (!prev) return prev
      const set = new Set(prev.disabledActions)
      if (on) set.delete(name)
      else set.add(name)
      return { ...prev, disabledActions: [...set] }
    })
  }

  if (loading) return <p className="text-sm text-white/50">Loading…</p>
  if (!settings) {
    return <p className="text-sm text-red-300">{error || 'Could not load assistant settings.'}</p>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h2 className="text-sm font-semibold text-[#fff]">Hub Assistant</h2>
        <p className="mt-1 text-sm text-white/60">
          Lets your team ask the Hub Bot to look things up and take actions — find a customer, check
          the schedule, add a task, text a customer. Every action runs with that person&apos;s own
          permissions, so nobody gains access they don&apos;t already have.
        </p>

        <div className="mt-4 space-y-3">
          <Toggle
            label="Turn the assistant on"
            hint="Off by default. While off, the Hub Bot answers questions but takes no actions."
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
            label="Let connected Claude apps text customers"
            hint="Off by default. In the Hub, a customer text always waits for a person to approve it. Over a connected Claude app we can't guarantee that step, so approval depends on that app asking you first."
            checked={settings.allowOutwardOverMcp}
            disabled={!settings.enabled || !settings.mcpEnabled}
            onChange={(v) => setSettings({ ...settings, allowOutwardOverMcp: v })}
          />
          {settings.allowOutwardOverMcp && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              With this on, a connected Claude app can send a customer text once you approve it in
              that app. The Hub&apos;s own approval step no longer applies there.
            </p>
          )}
          {!settings.requireConfirmation && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              With confirmation off, the assistant can text a customer as soon as someone asks it to,
              with no review step. Only do this if you fully trust everyone who can use it.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-[#fff]">What it&apos;s allowed to do</h3>
        <p className="mt-1 text-sm text-white/60">
          Turn individual actions off for the whole company. A person still also needs their own
          permission for each one.
        </p>
        <ul className="mt-3 space-y-2">
          {actions
            .filter((a) => a.name !== 'confirm_action')
            .map((a) => {
              const on = !settings.disabledActions.includes(a.name)
              return (
                <li key={a.name} className="flex items-start gap-3">
                  <input
                    id={`act-${a.name}`}
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggleAction(a.name, e.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <label htmlFor={`act-${a.name}`} className="flex-1 cursor-pointer">
                    <span className="text-sm text-white/90">{a.consentLabel}</span>
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${KIND_STYLE[a.kind] || KIND_STYLE.read}`}
                    >
                      {KIND_LABEL[a.kind] || a.kind}
                    </span>
                    <span className="ml-2 font-mono text-[10px] text-white/30">{a.name}</span>
                  </label>
                </li>
              )
            })}
        </ul>
      </section>

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

      {error && <p className="text-sm text-red-300">{error}</p>}

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
