'use client'

import { useMemo, useState } from 'react'
import { useConfirm } from '@/components/ui'

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

export default function KnowledgePanel({
  initialDocs,
}: {
  initialDocs: Doc[]
}) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Knowledge docs</h2>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 rounded bg-brand hover:bg-brand-light text-sm font-medium"
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
  )
}

// ---------------------------------------------------------------------------
// DocEditor — unchanged from Session 1 except for the Session 1 follow-up
// fix: refresh version history in-place after save when accordion is open.
// ---------------------------------------------------------------------------

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
  const confirmDialog = useConfirm()
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

  const tokens = estimateTokens(body)
  const estDaily = (tokens * COST_PER_TOKEN * DAILY_CALL_EST).toFixed(2)
  const tokenColor =
    tokens > TOKEN_RED ? 'text-red-300' : tokens > TOKEN_AMBER ? 'text-amber-300' : 'text-white/60'

  async function loadVersions() {
    if (!doc) return
    try {
      const res = await fetch(`/api/admin/guardian/knowledge/${doc.id}`)
      if (!res.ok) return
      const body = await res.json()
      setVersions(body.versions ?? [])
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
      // Session 1 follow-up: if the version-history accordion is already open
      // when the user saves, re-fetch versions in place so the new snapshot
      // appears without requiring a refresh or accordion toggle.
      if (versionsOpen) await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function del() {
    if (!doc) return
    if (!(await confirmDialog({ message: `Delete "${doc.title}"? This cannot be undone.`, danger: true }))) return
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

  async function restoreVersion(v: Version) {
    if (!(await confirmDialog('Replace the current body with this version? You can still re-save to go back.'))) return
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
          className="px-3 py-1.5 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
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
