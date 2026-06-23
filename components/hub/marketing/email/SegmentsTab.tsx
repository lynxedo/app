'use client'

import { useEffect, useRef, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'

type Tag = { id: string; label: string; color: string | null }
type Filter = { has_tag?: string[]; missing_tag?: string[] }
type Segment = { id: string; name: string; filter: Filter; updated_at: string }
type SampleRow = { id: string; name: string; email: string }

const BASE = '/api/hub/marketing/email/segments'

export default function SegmentsTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [segments, setSegments] = useState<Segment[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Segment | 'new' | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [segRes, tagRes] = await Promise.all([
        fetch(BASE),
        fetch('/api/hub/marketing/email/tags'),
      ])
      const segData = await segRes.json().catch(() => ({}))
      const tagData = await tagRes.json().catch(() => ({}))
      if (segRes.ok) setSegments(segData.segments || [])
      else toast.error(segData.error || 'Could not load segments.')
      if (tagRes.ok) setTags(tagData.tags || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tagLabel = (id: string) => tags.find((t) => t.id === id)?.label || '(deleted tag)'

  function describe(f: Filter): string {
    const has = (f.has_tag || []).map(tagLabel)
    const missing = (f.missing_tag || []).map(tagLabel)
    if (!has.length && !missing.length) return 'Everyone (all subscribed contacts)'
    const parts: string[] = []
    if (has.length) parts.push(`has ${has.join(' + ')}`)
    if (missing.length) parts.push(`not ${missing.join(', ')}`)
    return parts.join(', ')
  }

  async function remove(s: Segment) {
    if (!(await confirm({ message: `Delete the segment “${s.name}”?`, confirmText: 'Delete', danger: true }))) return
    const res = await fetch(`${BASE}/${s.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Segment deleted.'); setSegments((p) => p.filter((x) => x.id !== s.id)) }
    else toast.error('Could not delete the segment.')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Saved audiences. A campaign sends to everyone in a segment.</p>
        <Button onClick={() => setEditing('new')}>+ New segment</Button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : segments.length === 0 ? (
        <EmptyState title="No segments yet — create a filter to target a group of customers, or one for “everyone.”" />
      ) : (
        <ul className="space-y-2">
          {segments.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex items-start justify-between gap-3">
              <button className="text-left min-w-0 flex-1" onClick={() => setEditing(s)}>
                <div className="font-medium text-gray-100 truncate">{s.name}</div>
                <div className="text-sm text-gray-400 truncate">{describe(s.filter)}</div>
              </button>
              <div className="flex-none flex gap-2">
                <button onClick={() => setEditing(s)} className="text-sm text-gray-400 hover:text-white">Edit</button>
                <button onClick={() => remove(s)} className="text-sm text-red-400/80 hover:text-red-400">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SegmentEditor
          segment={editing === 'new' ? null : editing}
          tags={tags}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setSegments((prev) => {
              const i = prev.findIndex((x) => x.id === saved.id)
              if (i === -1) return [saved, ...prev]
              const copy = [...prev]; copy[i] = saved; return copy
            })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function SegmentEditor({
  segment, tags, onClose, onSaved,
}: { segment: Segment | null; tags: Tag[]; onClose: () => void; onSaved: (s: Segment) => void }) {
  const toast = useToast()
  const [name, setName] = useState(segment?.name || '')
  const [hasTags, setHasTags] = useState<string[]>(segment?.filter?.has_tag || [])
  const [missingTags, setMissingTags] = useState<string[]>(segment?.filter?.missing_tag || [])
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ count: number; sample: SampleRow[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filter: Filter = {}
  if (hasTags.length) filter.has_tag = hasTags
  if (missingTags.length) filter.missing_tag = missingTags

  // Live recipient count, debounced as the filter changes.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    setPreviewing(true)
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/hub/marketing/email/segments/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) setPreview({ count: data.count ?? 0, sample: data.sample || [] })
      } finally {
        setPreviewing(false)
      }
    }, 400)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [hasTags, missingTags]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  async function save() {
    if (!name.trim()) { toast.error('Give the segment a name.'); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), filter }
      const res = segment
        ? await fetch(`${BASE}/${segment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(segment ? 'Segment updated.' : 'Segment created.')
      onSaved(data.segment)
    } finally {
      setSaving(false)
    }
  }

  const isEveryone = !hasTags.length && !missingTags.length

  return (
    <Modal
      open
      onClose={onClose}
      title={segment ? 'Edit segment' : 'New segment'}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-sm text-gray-400">
            {previewing ? 'Counting…' : preview ? <><strong className="text-white">≈ {preview.count}</strong> recipient{preview.count === 1 ? '' : 's'}</> : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Segment name</label>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weed & Fert, no PHC"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
          />
        </div>

        {tags.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
            No tags exist yet. This segment targets <strong className="text-gray-300">everyone subscribed</strong>. Tag filters
            light up automatically once Jobber/Mailchimp tags are synced.
          </p>
        ) : (
          <>
            <TagPicker label="Must have ALL of these tags" emptyHint="Any tag" tags={tags} selected={hasTags} onToggle={(id) => toggle(hasTags, setHasTags, id)} accent="green" />
            <TagPicker label="Must NOT have these tags" emptyHint="No exclusions" tags={tags} selected={missingTags} onToggle={(id) => toggle(missingTags, setMissingTags, id)} accent="red" />
          </>
        )}

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm">
          <span className="text-gray-400">This segment targets </span>
          <span className="text-gray-200">
            {isEveryone ? 'everyone subscribed' : 'subscribed contacts who match the tag rules above'}
          </span>
          <span className="text-gray-400">, excluding anyone unsubscribed or suppressed.</span>
          {preview && preview.sample.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              e.g. {preview.sample.map((r) => r.name || r.email).slice(0, 3).join(', ')}
              {preview.count > 3 ? ` and ${preview.count - 3} more` : ''}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function TagPicker({
  label, emptyHint, tags, selected, onToggle, accent,
}: {
  label: string; emptyHint: string; tags: Tag[]; selected: string[]
  onToggle: (id: string) => void; accent: 'green' | 'red'
}) {
  const onCls = accent === 'green'
    ? 'bg-green-500/15 border-green-500/40 text-green-300'
    : 'bg-red-500/15 border-red-500/40 text-red-300'
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label} <span className="text-gray-600">· {selected.length ? `${selected.length} selected` : emptyHint}</span></label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => {
          const on = selected.includes(t.id)
          return (
            <button
              key={t.id} onClick={() => onToggle(t.id)}
              className={'text-xs rounded-full border px-2.5 py-1 ' + (on ? onCls : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200')}
            >{t.label}</button>
          )
        })}
      </div>
    </div>
  )
}
