'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Button, EmptyState, useToast, useConfirm } from '@/components/ui'

type Tag = { id: string; label: string; color: string | null }
type Filter = {
  has_tag?: string[]
  missing_tag?: string[]
  has_line_item?: string[]
  missing_line_item?: string[]
}
type Segment = { id: string; name: string; filter: Filter; updated_at: string }
type SampleRow = { id: string; name: string; email: string }
type DeptOption = { value: string; label: string; uses: number }
type NameOption = { value: string; uses: number }
type LineItemOptions = { depts: DeptOption[]; names: NameOption[] }

const BASE = '/api/hub/marketing/email/segments'

// Tokens: "dept:WF" | "name:<exact line item name>".
const deptToken = (v: string) => `dept:${v}`
const nameToken = (v: string) => `name:${v}`

export default function SegmentsTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [segments, setSegments] = useState<Segment[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [lineItems, setLineItems] = useState<LineItemOptions>({ depts: [], names: [] })
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Segment | 'new' | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [segRes, tagRes, liRes] = await Promise.all([
        fetch(BASE),
        fetch('/api/hub/marketing/email/tags'),
        fetch('/api/hub/marketing/email/line-items'),
      ])
      const segData = await segRes.json().catch(() => ({}))
      const tagData = await tagRes.json().catch(() => ({}))
      const liData = await liRes.json().catch(() => ({}))
      if (segRes.ok) setSegments(segData.segments || [])
      else toast.error(segData.error || 'Could not load segments.')
      if (tagRes.ok) setTags(tagData.tags || [])
      if (liRes.ok) setLineItems({ depts: liData.depts || [], names: liData.names || [] })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tagLabel = (id: string) => tags.find((t) => t.id === id)?.label || '(deleted tag)'
  const tokenLabel = (token: string) => {
    if (token.startsWith('dept:')) {
      const v = token.slice(5)
      return lineItems.depts.find((d) => d.value === v)?.label || v
    }
    if (token.startsWith('name:')) return token.slice(5)
    return token
  }

  function describe(f: Filter): string {
    const parts: string[] = []
    const has = (f.has_tag || []).map(tagLabel)
    const missing = (f.missing_tag || []).map(tagLabel)
    const hasLi = (f.has_line_item || []).map(tokenLabel)
    const missLi = (f.missing_line_item || []).map(tokenLabel)
    if (has.length) parts.push(`has ${has.join(' + ')}`)
    if (hasLi.length) parts.push(`buys ${hasLi.join(' + ')}`)
    if (missing.length) parts.push(`not ${missing.join(', ')}`)
    if (missLi.length) parts.push(`no ${missLi.join(', ')}`)
    if (!parts.length) return 'Everyone (all subscribed contacts)'
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
          lineItems={lineItems}
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
  segment, tags, lineItems, onClose, onSaved,
}: { segment: Segment | null; tags: Tag[]; lineItems: LineItemOptions; onClose: () => void; onSaved: (s: Segment) => void }) {
  const toast = useToast()
  const [name, setName] = useState(segment?.name || '')
  const [hasTags, setHasTags] = useState<string[]>(segment?.filter?.has_tag || [])
  const [missingTags, setMissingTags] = useState<string[]>(segment?.filter?.missing_tag || [])
  const [hasLi, setHasLi] = useState<string[]>(segment?.filter?.has_line_item || [])
  const [missingLi, setMissingLi] = useState<string[]>(segment?.filter?.missing_line_item || [])
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ count: number; sample: SampleRow[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filter: Filter = {}
  if (hasTags.length) filter.has_tag = hasTags
  if (missingTags.length) filter.missing_tag = missingTags
  if (hasLi.length) filter.has_line_item = hasLi
  if (missingLi.length) filter.missing_line_item = missingLi

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
  }, [hasTags, missingTags, hasLi, missingLi]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const hasAnyFilter = !!(hasTags.length || missingTags.length || hasLi.length || missingLi.length)
  const hasLineItemOptions = lineItems.depts.length > 0 || lineItems.names.length > 0

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

        {/* Tags */}
        {tags.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-900 p-3">
            No tags exist yet. Tag filters light up automatically once Jobber/Mailchimp tags are synced.
          </p>
        ) : (
          <>
            <TagPicker label="Must have ALL of these tags" emptyHint="Any tag" tags={tags} selected={hasTags} onToggle={(id) => toggle(hasTags, setHasTags, id)} accent="green" />
            <TagPicker label="Must NOT have these tags" emptyHint="No exclusions" tags={tags} selected={missingTags} onToggle={(id) => toggle(missingTags, setMissingTags, id)} accent="red" />
          </>
        )}

        {/* Line items (Jobber services — job line items only) */}
        {hasLineItemOptions && (
          <div className="pt-1 border-t border-gray-800 space-y-3">
            <p className="text-xs text-gray-500 pt-2">Filter by the Jobber <strong className="text-gray-400">services</strong> a customer&apos;s account has purchased (from their jobs). Pick a whole department or a specific line item.</p>
            <LineItemPicker label="Account must have these services" emptyHint="Any service" accent="green" options={lineItems} selected={hasLi} onToggle={(tok) => toggle(hasLi, setHasLi, tok)} />
            <LineItemPicker label="Account must NOT have these services" emptyHint="No exclusions" accent="red" options={lineItems} selected={missingLi} onToggle={(tok) => toggle(missingLi, setMissingLi, tok)} />
          </div>
        )}

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm">
          <span className="text-gray-400">This segment targets </span>
          <span className="text-gray-200">
            {hasAnyFilter ? 'subscribed contacts who match the rules above' : 'everyone subscribed'}
          </span>
          <span className="text-gray-400">, excluding anyone unsubscribed or suppressed.</span>
          {(hasLi.length > 0 || missingLi.length > 0) && (
            <span className="text-gray-500"> Service rules only apply to contacts linked to a Jobber account.</span>
          )}
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

function LineItemPicker({
  label, emptyHint, accent, options, selected, onToggle,
}: {
  label: string; emptyHint: string; accent: 'green' | 'red'
  options: LineItemOptions; selected: string[]; onToggle: (token: string) => void
}) {
  const [query, setQuery] = useState('')
  const onCls = accent === 'green'
    ? 'bg-green-500/15 border-green-500/40 text-green-300'
    : 'bg-red-500/15 border-red-500/40 text-red-300'

  const matchingNames = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? options.names.filter((n) => n.value.toLowerCase().includes(q)) : options.names
    return list.slice(0, 40)
  }, [query, options.names])

  // Selected name tokens not currently shown in the filtered list — keep them
  // visible/removable as chips regardless of the search query.
  const selectedNameChips = selected
    .filter((t) => t.startsWith('name:'))
    .filter((t) => !matchingNames.some((n) => nameToken(n.value) === t))

  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label} <span className="text-gray-600">· {selected.length ? `${selected.length} selected` : emptyHint}</span></label>

      {/* Departments — quick whole-program chips */}
      {options.depts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {options.depts.map((d) => {
            const tok = deptToken(d.value)
            const on = selected.includes(tok)
            return (
              <button
                key={tok} onClick={() => onToggle(tok)} title={`All ${d.label} services`}
                className={'text-xs rounded-full border px-2.5 py-1 ' + (on ? onCls : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200')}
              >{d.label} <span className="opacity-60">(all)</span></button>
            )
          })}
        </div>
      )}

      {/* Selected specific names that are filtered out — keep removable */}
      {selectedNameChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedNameChips.map((tok) => (
            <button key={tok} onClick={() => onToggle(tok)} className={'text-xs rounded-full border px-2.5 py-1 ' + onCls}>
              {tok.slice(5)} ✕
            </button>
          ))}
        </div>
      )}

      {/* Specific line items — searchable */}
      {options.names.length > 0 && (
        <>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a specific line item…"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white mb-1.5"
          />
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
            {matchingNames.map((n) => {
              const tok = nameToken(n.value)
              const on = selected.includes(tok)
              return (
                <button
                  key={tok} onClick={() => onToggle(tok)} title={`${n.uses} job line item${n.uses === 1 ? '' : 's'}`}
                  className={'text-xs rounded-full border px-2.5 py-1 text-left ' + (on ? onCls : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200')}
                >{n.value}</button>
              )
            })}
            {matchingNames.length === 0 && <span className="text-xs text-gray-600 py-1">No line items match “{query}”.</span>}
          </div>
        </>
      )}
    </div>
  )
}
