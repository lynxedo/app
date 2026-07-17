'use client'

import { useMemo, useState } from 'react'
import { useConfirm } from '@/components/ui'
import RichTextEditor from './RichTextEditor'

type Doc = {
  id: string
  company_id: string
  slug: string
  title: string
  body: string
  always_include: boolean
  audiences: string[]
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

// Reserved "core" docs whose reach is fixed by the brain, not by audiences:
// `identity` is injected for every AI; `customer_service` is used whenever an AI
// writes to a customer. Their "Used by" is shown as informational, not editable.
const CORE_SLUGS = ['identity', 'customer_service']
function isCore(slug: string) {
  return CORE_SLUGS.includes(slug)
}

// Derive an internal id from a human title so admins never see or type a "slug".
function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return s || 'doc'
}
const SURFACE_LABELS: { key: string; label: string; short: string }[] = [
  { key: 'guardian', label: 'Hub Bot', short: 'HB' },
  { key: 'responder', label: 'Auto Responder', short: 'R' },
  { key: 'receptionist', label: 'AI Receptionist', short: 'Rc' },
]

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
            No docs yet. Create the first one to give the Hub Bot some context.
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
                  <span
                    className="flex items-center gap-0.5 shrink-0"
                    title={
                      isCore(d.slug)
                        ? 'Core — always available to every AI'
                        : `Used by: ${
                            SURFACE_LABELS.filter(s => d.audiences?.includes(s.key))
                              .map(s => s.label)
                              .join(', ') || 'none (on-demand only)'
                          }`
                    }
                  >
                    {SURFACE_LABELS.map(s => (
                      <span
                        key={s.key}
                        className={`text-[9px] font-semibold leading-none px-1 py-0.5 rounded ${
                          isCore(d.slug) || d.audiences?.includes(s.key)
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-white/5 text-white/25'
                        }`}
                      >
                        {s.short}
                      </span>
                    ))}
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

  const [title, setTitle] = useState(doc?.title ?? '')
  const [body, setBody] = useState(doc?.body ?? '')
  const [audiences, setAudiences] = useState<string[]>(doc?.audiences ?? [])
  const [sourceMode, setSourceMode] = useState(false)
  const effectiveSlug = isExisting ? doc!.slug : slugify(title)
  const core = isCore(effectiveSlug)
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
      }
      // Core docs (identity, customer_service) have fixed reach — don't send
      // audiences; for every other doc, "Used by" is the control.
      if (!core) payload.audiences = audiences
      // New docs get an internal id auto-derived from the title; existing docs
      // keep their id (never renamed from the UI).
      if (!isExisting) {
        payload.slug = slugify(title)
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
        if (res.status === 409) {
          throw new Error('A doc with a similar title already exists — try a slightly different title.')
        }
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
          🔒 This is the router doc — the Hub Bot&apos;s navigation entry point. It cannot be deleted or
          renamed, but you can still edit its title, body, and Used-by settings.
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Title</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Pricing Reference"
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full max-w-md"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium">Body</label>
          <button
            type="button"
            onClick={() => setSourceMode(m => !m)}
            className="text-xs text-white/50 hover:text-white/80 underline"
            title={sourceMode ? 'Switch to the rich text editor' : 'Edit the raw Markdown source'}
          >
            {sourceMode ? 'Rich text' : 'Markdown source'}
          </button>
        </div>
        {sourceMode ? (
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={16}
            spellCheck={true}
            className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full font-mono leading-relaxed"
          />
        ) : (
          <RichTextEditor value={body} onChange={setBody} />
        )}
        <p className={`text-xs mt-1 ${tokenColor}`}>
          ~{tokens.toLocaleString()} tokens
        </p>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3 space-y-2">
        <div className="text-sm font-medium">Used by</div>
        {core ? (
          <p className="text-xs text-white/50">
            This is a core doc — it&apos;s always available to the AIs
            {effectiveSlug === 'identity'
              ? ' (the company identity is included for every AI).'
              : ' (the customer-service playbook is used whenever an AI writes to a customer).'}
          </p>
        ) : (
          <>
            <p className="text-xs text-white/50">
              Which AIs automatically include this doc in what they know. Leave all unchecked to keep
              it on-demand only (the Hub assistant can still pull it up by name).
            </p>
            <div className="flex flex-wrap gap-4">
              {SURFACE_LABELS.map(s => (
                <label key={s.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={audiences.includes(s.key)}
                    onChange={() =>
                      setAudiences(prev =>
                        prev.includes(s.key) ? prev.filter(x => x !== s.key) : [...prev, s.key]
                      )
                    }
                    className="accent-emerald-500"
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
            {audiences.length > 0 && (
              <p className={`text-xs ${tokenColor}`}>
                ~{tokens.toLocaleString()} tokens added to each selected AI&apos;s prompt on every reply · ≈ $
                {estDaily}/day at 100 replies/day.
                {tokens > TOKEN_RED
                  ? ' This is large — consider splitting into sub-docs the AI loads on demand.'
                  : tokens > TOKEN_AMBER
                  ? ' Watch the size — large always-included docs add up.'
                  : ''}
              </p>
            )}
          </>
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
          disabled={saving || !title.trim()}
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
