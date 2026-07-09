'use client'

import { useRef, useState } from 'react'
import { useToast, useConfirm } from '@/components/ui'
import type { BetaFeature } from '@/lib/beta-flags'

// Admin → Beta. Manage the beta registry: create features, edit copy, upload a
// screenshot, flip availability (kill-switch) + default-on, and delete. When a
// feature is shipped to the Beta ring, its base row is seeded automatically
// (via the migration/seed) and refined here — this is where Ben tweaks the
// label/description and adds the screenshot users see in Settings → Beta.

type Draft = { key: string; label: string; description: string }

export default function BetaAdminPanel({ initialFeatures }: { initialFeatures: BetaFeature[] }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [features, setFeatures] = useState<BetaFeature[]>(initialFeatures)
  const [draft, setDraft] = useState<Draft>({ key: '', label: '', description: '' })
  const [creating, setCreating] = useState(false)

  function patchLocal(key: string, updates: Partial<BetaFeature>) {
    setFeatures((prev) => prev.map((f) => (f.key === key ? { ...f, ...updates } : f)))
  }

  async function savePatch(key: string, updates: Partial<BetaFeature>) {
    const res = await fetch(`/api/admin/beta-features/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Could not save.')
      return false
    }
    const { feature } = await res.json()
    patchLocal(key, feature)
    return true
  }

  async function createFeature() {
    if (!draft.key.trim() || !draft.label.trim()) {
      toast.error('Key and label are required.')
      return
    }
    setCreating(true)
    const res = await fetch('/api/admin/beta-features', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    setCreating(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Could not create.')
      return
    }
    const { feature } = await res.json()
    setFeatures((prev) => [...prev, feature])
    setDraft({ key: '', label: '', description: '' })
    toast.success('Beta feature created.')
  }

  async function deleteFeature(f: BetaFeature) {
    const ok = await confirm({
      title: `Delete “${f.label}”?`,
      message: 'This removes the beta feature and everyone’s opt-in for it. The code path stays until you remove it separately.',
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/beta-features/${encodeURIComponent(f.key)}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Could not delete.')
      return
    }
    setFeatures((prev) => prev.filter((x) => x.key !== f.key))
    toast.success('Deleted.')
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Beta Features</h1>
        <p className="mt-1 text-sm text-gray-400">
          Features shipped to production behind a flag. A user sees one only if you turn it
          <span className="text-gray-200"> available</span> here <span className="text-gray-200">and</span> they opt in
          from Settings → Beta Features (and have the “Beta Features” grant in People). Turn availability off to pull a
          beta from everyone instantly.
        </p>
      </div>

      {/* Create */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="text-sm font-semibold text-gray-200">New beta feature</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-400">
            Key (code slug)
            <input
              value={draft.key}
              onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
              placeholder="conversation_popout"
              className="mt-1 w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-600"
            />
          </label>
          <label className="text-xs text-gray-400">
            Label (what users see)
            <input
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="Pop-out conversations"
              className="mt-1 w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
          </label>
        </div>
        <label className="mt-3 block text-xs text-gray-400">
          Description
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            rows={2}
            placeholder="Float a text or chat thread in its own window while you work elsewhere."
            className="mt-1 w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-600"
          />
        </label>
        <button
          onClick={createFeature}
          disabled={creating}
          className="mt-3 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create beta feature'}
        </button>
      </div>

      {/* List */}
      {features.length === 0 ? (
        <p className="text-sm text-gray-500">No beta features yet.</p>
      ) : (
        <div className="space-y-4">
          {features.map((f) => (
            <BetaCard
              key={f.key}
              feature={f}
              onSave={savePatch}
              onDelete={() => deleteFeature(f)}
              toastError={(m) => toast.error(m)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BetaCard({
  feature,
  onSave,
  onDelete,
  toastError,
}: {
  feature: BetaFeature
  onSave: (key: string, updates: Partial<BetaFeature>) => Promise<boolean>
  onDelete: () => void
  toastError: (m: string) => void
}) {
  const [label, setLabel] = useState(feature.label)
  const [description, setDescription] = useState(feature.description)
  const [sortOrder, setSortOrder] = useState(String(feature.sort_order))
  const [savingText, setSavingText] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const dirty =
    label !== feature.label ||
    description !== feature.description ||
    String(feature.sort_order) !== sortOrder

  async function saveText() {
    setSavingText(true)
    await onSave(feature.key, {
      label: label.trim(),
      description: description.trim(),
      sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    })
    setSavingText(false)
  }

  async function uploadScreenshot(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch('/api/hub/upload', { method: 'POST', body: fd })
      if (!up.ok) {
        toastError('Upload failed.')
        return
      }
      const { storage_path } = await up.json()
      await onSave(feature.key, { screenshot_url: storage_path })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md bg-transparent text-base font-semibold text-white outline-none focus:bg-gray-900 focus:px-2 focus:py-1"
          />
          <code className="mt-0.5 block text-xs text-gray-500">{feature.key}</code>
        </div>
        <div className="flex items-center gap-4">
          <ToggleRow
            label="Available"
            checked={feature.is_available}
            onChange={(v) => onSave(feature.key, { is_available: v })}
          />
          <ToggleRow
            label="Default on"
            checked={feature.default_on}
            onChange={(v) => onSave(feature.key, { default_on: v })}
          />
        </div>
      </div>

      <label className="mt-3 block text-xs text-gray-400">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="text-xs text-gray-400">
          Sort order
          <input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            inputMode="numeric"
            className="mt-1 block w-20 rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white"
          />
        </label>

        <div className="text-xs text-gray-400">
          Screenshot
          <div className="mt-1 flex items-center gap-3">
            {feature.screenshot_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/hub/beta/screenshot/${feature.screenshot_url}`}
                alt=""
                className="h-14 w-24 rounded-md border border-white/10 object-cover"
              />
            ) : (
              <span className="flex h-14 w-24 items-center justify-center rounded-md border border-dashed border-white/15 text-[11px] text-gray-600">
                none
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadScreenshot(file)
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/[0.06] disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : feature.screenshot_url ? 'Replace' : 'Upload'}
            </button>
            {feature.screenshot_url && (
              <button
                onClick={() => onSave(feature.key, { screenshot_url: null })}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={saveText}
          disabled={!dirty || savingText}
          className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40"
        >
          {savingText ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onDelete} className="text-sm text-red-400/80 hover:text-red-300">
          Delete
        </button>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-sky-500' : 'bg-gray-600'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      {label}
    </label>
  )
}
