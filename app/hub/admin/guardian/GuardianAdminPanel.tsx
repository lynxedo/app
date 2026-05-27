'use client'

import { useEffect, useMemo, useState } from 'react'

type Doc = {
  id: string
  company_id: string
  slug: string
  title: string
  body: string
  always_include: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

type Version = {
  id: string
  doc_id: string
  body: string
  title: string
  saved_at: string
}

type Settings = {
  model: string
  web_search_daily_cap: number
}

type ModelOption = {
  id: string
  display_name: string
  family: 'opus' | 'sonnet' | 'haiku' | 'other'
  label: string
  flag: string | null
}

type Tab = 'knowledge' | 'settings'

const ROUTER_SLUG = 'router'
const TOKEN_AMBER = 2000
const TOKEN_RED = 4000
const DAILY_CALL_EST = 100 // hardcoded heuristic for cost warning
const COST_PER_TOKEN = 0.000003 // ~ Sonnet input price; display-only

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function isRouter(slug: string) {
  return slug === ROUTER_SLUG
}

export default function GuardianAdminPanel({
  initialDocs,
  initialSettings,
}: {
  initialDocs: Doc[]
  initialSettings: Settings
}) {
  const [tab, setTab] = useState<Tab>('knowledge')
  const [docs, setDocs] = useState<Doc[]>(initialDocs)
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [refreshingTools, setRefreshingTools] = useState(false)
  const [refreshToolsMsg, setRefreshToolsMsg] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSavedAt, setSettingsSavedAt] = useState<number | null>(null)

  // Fetch models when Settings tab opens.
  useEffect(() => {
    if (tab !== 'settings' || models.length || modelsLoading) return
    setModelsLoading(true)
    setModelsError(null)
    fetch('/api/admin/guardian/models')
      .then(r => r.json().then(b => ({ ok: r.ok, body: b })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body?.error ?? 'Failed to load models')
        setModels(body.models ?? [])
      })
      .catch(e => setModelsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setModelsLoading(false))
  }, [tab, models.length, modelsLoading])

  const selectedDoc = useMemo(
    () => docs.find(d => d.id === selectedId) ?? null,
    [docs, selectedId]
  )

  function openCreate() {
    setSelectedId(null)
    setCreating(true)
  }

  function openDoc(id: string) {
    setSelectedId(id)
    setCreating(false)
  }

  function closeEditor() {
    setSelectedId(null)
    setCreating(false)
  }

  async function handleSaveDoc(saved: Doc) {
    setDocs(prev => {
      const idx = prev.findIndex(d => d.id === saved.id)
      if (idx >= 0) {
        const next = prev.slice()
        next[idx] = saved
        return next
      }
      return [...prev, saved].sort((a, b) => a.slug.localeCompare(b.slug))
    })
    setSelectedId(saved.id)
    setCreating(false)
  }

  function handleDeleteDoc(id: string) {
    setDocs(prev => prev.filter(d => d.id !== id))
    closeEditor()
  }

  async function refreshTools() {
    setRefreshingTools(true)
    setRefreshToolsMsg(null)
    try {
      const res = await fetch('/api/admin/guardian/refresh-tools', { method: 'POST' })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Refresh failed (${res.status})`)
      }
      setRefreshToolsMsg('Tool list cache cleared ✓')
      setTimeout(() => setRefreshToolsMsg(null), 4000)
    } catch (e) {
      setRefreshToolsMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshingTools(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    try {
      const res = await fetch('/api/admin/guardian/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      const body = await res.json()
      setSettings({
        model: body.settings?.model ?? settings.model,
        web_search_daily_cap: body.settings?.web_search_daily_cap ?? settings.web_search_daily_cap,
      })
      setSettingsSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Guardian</h1>
        <p className="text-sm text-white/60 mt-1">
          Editable knowledge base + model settings. Changes take effect on Guardian's next reply.
        </p>
      </header>

      <div className="flex gap-1 border-b border-white/10">
        <TabButton active={tab === 'knowledge'} onClick={() => setTab('knowledge')}>
          Knowledge
        </TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          Settings
        </TabButton>
      </div>

      {error && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {tab === 'knowledge' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Knowledge docs</h2>
            <button
              onClick={openCreate}
              className="px-3 py-1.5 rounded bg-[#2E7EB8] hover:bg-[#3a8dc9] text-sm font-medium"
            >
              + New Doc
            </button>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5">
            {docs.length === 0 ? (
              <p className="px-4 py-6 text-sm text-white/50">
                No docs yet. Create the first one to give Guardian some context.
              </p>
            ) : (
              <ul className="divide-y divide-white/10">
                {docs.map(d => (
                  <li key={d.id}>
                    <button
                      onClick={() => openDoc(d.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-white/5 flex items-center gap-3 ${
                        selectedId === d.id ? 'bg-white/5' : ''
                      }`}
                    >
                      {d.always_include ? (
                        <span className="w-2 h-2 rounded-full bg-emerald-400" title="Always included" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-white/20" title="On-demand" />
                      )}
                      <span className="font-mono text-xs text-white/70 w-32 shrink-0 truncate">
                        {d.slug}
                      </span>
                      <span className="flex-1 text-sm truncate flex items-center gap-2">
                        {d.title}
                        {isRouter(d.slug) && (
                          <span title="Protected — cannot be deleted or renamed" className="text-amber-300">
                            🔒
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-white/40 hidden md:inline">
                        {formatTimestamp(d.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(creating || selectedDoc) && (
            <DocEditor
              key={creating ? 'new' : selectedDoc?.id}
              doc={creating ? null : selectedDoc}
              onSaved={handleSaveDoc}
              onDeleted={handleDeleteDoc}
              onClose={closeEditor}
            />
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
            <div>
              <h2 className="font-semibold">Guardian model</h2>
              <p className="text-xs text-white/50 mt-1">
                The Claude model Guardian uses for every reply. List is fetched live from Anthropic.
              </p>
            </div>

            {modelsLoading && <p className="text-sm text-white/50">Loading models…</p>}
            {modelsError && <p className="text-sm text-red-300">{modelsError}</p>}

            {!modelsLoading && !modelsError && (
              <div>
                <label className="block text-sm font-medium mb-1">Model</label>
                <select
                  value={settings.model}
                  onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}
                  className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm min-w-[20rem]"
                >
                  {/* If current model isn't in the list (e.g. retired or custom), still show it */}
                  {!models.some(m => m.id === settings.model) && (
                    <option value={settings.model}>{settings.model} (current)</option>
                  )}
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.display_name} — {m.label}
                      {m.flag ? ` · ⚠ ${m.flag}` : ''}
                    </option>
                  ))}
                </select>
                {(() => {
                  const current = models.find(m => m.id === settings.model)
                  if (current?.flag) {
                    return (
                      <p className="text-xs text-amber-300 mt-2">⚠ {current.flag}</p>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
            <div>
              <h2 className="font-semibold">Web search</h2>
              <p className="text-xs text-white/50 mt-1">
                Daily company-wide cap on web searches (used once Guardian Session 2 ships the full-tier web search tool). 0 disables web search entirely.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Daily web search cap</label>
              <input
                type="number"
                min={0}
                value={settings.web_search_daily_cap}
                onChange={e => {
                  const n = parseInt(e.target.value, 10)
                  setSettings(s => ({ ...s, web_search_daily_cap: Number.isFinite(n) && n >= 0 ? n : 0 }))
                }}
                className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-28"
              />
              <span className="ml-2 text-sm text-white/60">searches/day</span>
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <h2 className="font-semibold">Tool list cache</h2>
              <p className="text-xs text-white/50 mt-1">
                Guardian caches the MCP tool list in memory for 1 hour. If you change the MCP server's tools, click here so the next Guardian call picks them up.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshTools}
                disabled={refreshingTools}
                className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-sm"
              >
                {refreshingTools ? 'Refreshing…' : 'Refresh tool list'}
              </button>
              {refreshToolsMsg && (
                <span className="text-xs text-white/60">{refreshToolsMsg}</span>
              )}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="px-4 py-2 rounded bg-[#2E7EB8] hover:bg-[#3a8dc9] disabled:opacity-50 text-sm font-medium"
            >
              {savingSettings ? 'Saving…' : 'Save Settings'}
            </button>
            {settingsSavedAt && (
              <span className="text-xs text-emerald-300">Saved ✓</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-[#2E7EB8] text-white'
          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

function DocEditor({
  doc,
  onSaved,
  onDeleted,
  onClose,
}: {
  doc: Doc | null
  onSaved: (d: Doc) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const isExisting = doc != null
  const isProtected = doc != null && isRouter(doc.slug)

  const [slug, setSlug] = useState(doc?.slug ?? '')
  const [title, setTitle] = useState(doc?.title ?? '')
  const [body, setBody] = useState(doc?.body ?? '')
  const [alwaysInclude, setAlwaysInclude] = useState(doc?.always_include ?? false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versionsLoaded, setVersionsLoaded] = useState(false)

  const tokens = estimateTokens(body)
  const estDaily = (tokens * COST_PER_TOKEN * DAILY_CALL_EST).toFixed(2)
  const tokenColor =
    tokens > TOKEN_RED ? 'text-red-300' : tokens > TOKEN_AMBER ? 'text-amber-300' : 'text-white/60'

  async function loadVersions() {
    if (!doc || versionsLoaded) return
    try {
      const res = await fetch(`/api/admin/guardian/knowledge/${doc.id}`)
      if (!res.ok) return
      const body = await res.json()
      setVersions(body.versions ?? [])
      setVersionsLoaded(true)
    } catch {
      // non-fatal
    }
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        body,
        always_include: alwaysInclude,
      }
      // Only include slug if creating, OR if changed and not router.
      if (!isExisting) {
        payload.slug = slug.trim()
      } else if (!isProtected && slug.trim() !== doc!.slug) {
        payload.slug = slug.trim()
      }

      const url = isExisting
        ? `/api/admin/guardian/knowledge/${doc!.id}`
        : '/api/admin/guardian/knowledge'
      const res = await fetch(url, {
        method: isExisting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      const result = await res.json()
      onSaved(result.doc)
      // Reset version cache so the next open re-fetches.
      setVersionsLoaded(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function del() {
    if (!doc) return
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/guardian/knowledge/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Delete failed (${res.status})`)
      }
      onDeleted(doc.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  function restoreVersion(v: Version) {
    if (!confirm('Replace the current body with this version? You can still re-save to go back.')) return
    setBody(v.body)
    setTitle(v.title)
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{isExisting ? 'Edit doc' : 'New doc'}</h3>
        <button
          onClick={onClose}
          className="text-xs text-white/50 hover:text-white"
        >
          Close ✕
        </button>
      </div>

      {isProtected && (
        <div className="rounded-md border border-amber-700/50 bg-amber-900/20 text-amber-200 px-3 py-2 text-xs">
          🔒 This is the router doc — Guardian's navigation entry point. It cannot be deleted or
          renamed, but you can still edit the title, body, and always_include flag.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Slug</label>
          <input
            value={slug}
            onChange={e => setSlug(e.target.value)}
            disabled={isProtected}
            placeholder="e.g. pricing"
            className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full font-mono disabled:opacity-50"
          />
          <p className="text-xs text-white/40 mt-1">
            Lowercase letters, numbers, hyphens, underscores. Used by Guardian to load the doc.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Pricing Reference"
            className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Body</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={16}
          spellCheck={true}
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full font-mono leading-relaxed"
        />
        <p className={`text-xs mt-1 ${tokenColor}`}>
          ~{tokens.toLocaleString()} tokens
        </p>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3 space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alwaysInclude}
            onChange={e => setAlwaysInclude(e.target.checked)}
            className="accent-emerald-500"
          />
          <span>Always include in Guardian's system prompt</span>
        </label>
        {alwaysInclude && (
          <p className={`text-xs ${tokenColor}`}>
            ~{tokens.toLocaleString()} tokens included on every reply · ≈ ${estDaily}/day at 100
            replies/day.
            {tokens > TOKEN_RED
              ? ' This is large — consider splitting into sub-docs Guardian loads on demand.'
              : tokens > TOKEN_AMBER
              ? ' Watch the size — large always-included docs add up.'
              : ''}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={save}
          disabled={saving || !slug.trim() || !title.trim()}
          className="px-3 py-1.5 rounded bg-[#2E7EB8] hover:bg-[#3a8dc9] disabled:opacity-50 text-sm font-medium"
        >
          {saving ? 'Saving…' : isExisting ? 'Save' : 'Create'}
        </button>
        {isExisting && (
          <button
            onClick={del}
            disabled={deleting || isProtected}
            title={isProtected ? 'The router doc cannot be deleted' : 'Delete this doc'}
            className="px-3 py-1.5 rounded bg-red-900/40 hover:bg-red-900/60 disabled:opacity-30 text-sm"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>

      {isExisting && (
        <details
          className="rounded-md border border-white/10 bg-black/20"
          open={versionsOpen}
          onToggle={e => {
            const open = (e.target as HTMLDetailsElement).open
            setVersionsOpen(open)
            if (open) loadVersions()
          }}
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Version history (last 10)
          </summary>
          <div className="px-3 pb-3">
            {versions.length === 0 ? (
              <p className="text-xs text-white/50">No saved versions yet.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {versions.map(v => (
                  <li key={v.id} className="py-2 flex items-center gap-3">
                    <span className="text-xs text-white/60 flex-1">
                      {formatTimestamp(v.saved_at)} · {v.title}
                    </span>
                    <button
                      onClick={() => restoreVersion(v)}
                      className="text-xs px-2 py-0.5 rounded bg-white/10 hover:bg-white/15"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </section>
  )
}
