'use client'

import { useRef, useState } from 'react'
import { Modal, Button, useToast } from '@/components/ui'
import {
  type EmailDesign, type EmailBlock, type BlockType, type Align,
  BLOCK_LABELS, emptyDesign, makeBlock, normalizeDesign, renderDesignToHtml,
} from '@/lib/email-blocks'
import { MERGE_FIELDS } from '@/lib/email-markdown'

export type Template = {
  id: string
  name: string
  subject: string
  design: EmailDesign
  updated_at: string
}

const BASE = '/api/hub/marketing/email/templates'
const SAMPLE = { first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.com' }
const ADD_ORDER: BlockType[] = ['text', 'image', 'button', 'header', 'divider', 'spacer']

function uid() {
  try { return crypto.randomUUID() } catch { return 'b' + Math.random().toString(36).slice(2) }
}

export default function BlockComposer({
  template, onClose, onSaved,
}: { template: Template | null; onClose: () => void; onSaved: (t: Template) => void }) {
  const toast = useToast()
  const [name, setName] = useState(template?.name || '')
  const [subject, setSubject] = useState(template?.subject || '')
  const [design, setDesign] = useState<EmailDesign>(
    template?.design && (template.design.blocks?.length || template.design.settings)
      ? normalizeDesign(template.design)
      : emptyDesign()
  )
  const [mode, setMode] = useState<'build' | 'preview'>('build')
  const [showSettings, setShowSettings] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const blocks = design.blocks
  const setBlocks = (next: EmailBlock[]) => setDesign((d) => ({ ...d, blocks: next }))
  const updateBlock = (id: string, patch: Partial<EmailBlock>) =>
    setBlocks(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)))
  const addBlock = (type: BlockType) => { setBlocks([...blocks, makeBlock(type, uid())]); setAddOpen(false) }
  const removeBlock = (id: string) => setBlocks(blocks.filter((b) => b.id !== id))
  const duplicate = (b: EmailBlock) => {
    const i = blocks.findIndex((x) => x.id === b.id)
    const copy = { ...b, id: uid() } as EmailBlock
    const next = [...blocks]; next.splice(i + 1, 0, copy); setBlocks(next)
  }
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id)
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const next = [...blocks];[next[i], next[j]] = [next[j], next[i]]; setBlocks(next)
  }

  const previewHtml = renderDesignToHtml(design, { merge: SAMPLE })

  async function save() {
    if (!name.trim()) { toast.error('Give the template a name.'); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), subject: subject.trim(), design }
      const res = template
        ? await fetch(`${BASE}/${template.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(template ? 'Template updated.' : 'Template created.')
      onSaved(data.template)
    } finally { setSaving(false) }
  }

  async function sendTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/hub/marketing/email/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, design }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not send the test.')
      else toast.success(`Test sent to ${data.sent_to}.`)
    } finally { setTesting(false) }
  }

  return (
    <Modal
      open onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      maxWidth="max-w-4xl"
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <Button variant="ghost" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test to myself'}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Template name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring promo"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject line</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{first_name}}, spring is here"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 border-y border-gray-800 py-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setMode('build')} className={'text-sm px-2.5 py-1 rounded ' + (mode === 'build' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white')}>Build</button>
            <button onClick={() => setMode('preview')} className={'text-sm px-2.5 py-1 rounded ' + (mode === 'preview' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white')}>Preview</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSettings((v) => !v)} className="text-sm text-gray-400 hover:text-white px-2 py-1">⚙ Page</button>
            <div className="relative">
              <Button size="sm" onClick={() => setAddOpen((v) => !v)}>+ Add block ▾</Button>
              {addOpen && (
                <div className="absolute right-0 mt-1 z-10 w-44 rounded-lg border border-gray-700 bg-gray-800 shadow-xl py-1">
                  {ADD_ORDER.map((t) => (
                    <button key={t} onClick={() => addBlock(t)} className="block w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">{BLOCK_LABELS[t]}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {showSettings && (
          <PageSettings design={design} onChange={(settings) => setDesign((d) => ({ ...d, settings }))} />
        )}

        {mode === 'preview' ? (
          <div className="rounded-lg overflow-hidden border border-gray-700">
            <div className="max-h-[55vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        ) : blocks.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-10 border border-dashed border-gray-700 rounded-lg">
            Empty template. Use <strong className="text-gray-300">+ Add block</strong> to start — try a Header (your logo), Text, then a Button.
          </div>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {blocks.map((b, i) => (
              <BlockCard
                key={b.id} block={b} index={i} total={blocks.length}
                onChange={(patch) => updateBlock(b.id, patch)}
                onMove={(dir) => move(b.id, dir)}
                onDuplicate={() => duplicate(b)}
                onRemove={() => removeBlock(b.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function PageSettings({ design, onChange }: { design: EmailDesign; onChange: (s: EmailDesign['settings']) => void }) {
  const s = design.settings
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
      <ColorField label="Page background" value={s.backgroundColor} onChange={(v) => onChange({ ...s, backgroundColor: v })} />
      <ColorField label="Email background" value={s.contentBackgroundColor} onChange={(v) => onChange({ ...s, contentBackgroundColor: v })} />
      <div>
        <label className="block text-[11px] text-gray-400 mb-1">Width (px)</label>
        <input type="number" value={s.contentWidth} onChange={(e) => onChange({ ...s, contentWidth: Math.max(320, Math.min(800, Number(e.target.value) || 600)) })}
          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-white" />
      </div>
    </div>
  )
}

function BlockCard({
  block, index, total, onChange, onMove, onDuplicate, onRemove,
}: {
  block: EmailBlock; index: number; total: number
  onChange: (patch: Partial<EmailBlock>) => void
  onMove: (dir: -1 | 1) => void; onDuplicate: () => void; onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{BLOCK_LABELS[block.type]}</span>
        <div className="flex items-center gap-1 text-gray-400">
          <button disabled={index === 0} onClick={() => onMove(-1)} className="px-1.5 hover:text-white disabled:opacity-30" title="Move up">↑</button>
          <button disabled={index === total - 1} onClick={() => onMove(1)} className="px-1.5 hover:text-white disabled:opacity-30" title="Move down">↓</button>
          <button onClick={onDuplicate} className="px-1.5 hover:text-white" title="Duplicate">⧉</button>
          <button onClick={onRemove} className="px-1.5 text-red-400/80 hover:text-red-400" title="Delete">✕</button>
        </div>
      </div>
      <div className="p-3"><BlockFields block={block} onChange={onChange} /></div>
    </div>
  )
}

function BlockFields({ block, onChange }: { block: EmailBlock; onChange: (patch: Partial<EmailBlock>) => void }) {
  switch (block.type) {
    case 'header':
      return (
        <div className="space-y-3">
          <ImageField label="Logo" url={block.logoUrl} onChange={(url) => onChange({ logoUrl: url })} />
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Logo width" value={block.logoWidth} onChange={(v) => onChange({ logoWidth: v })} />
            <ColorField label="Background" value={block.bg} onChange={(v) => onChange({ bg: v })} />
            <AlignField value={block.align} onChange={(v) => onChange({ align: v })} />
          </div>
        </div>
      )
    case 'text':
      return (
        <div className="space-y-3">
          <MergeTextarea value={block.content} onChange={(v) => onChange({ content: v })} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ColorField label="Text" value={block.color} onChange={(v) => onChange({ color: v })} />
            <ColorField label="Background" value={block.bg} onChange={(v) => onChange({ bg: v })} />
            <NumField label="Font size" value={block.fontSize} onChange={(v) => onChange({ fontSize: v })} />
            <AlignField value={block.align} onChange={(v) => onChange({ align: v })} />
          </div>
        </div>
      )
    case 'image':
      return (
        <div className="space-y-3">
          <ImageField label="Image" url={block.url} onChange={(url) => onChange({ url })} />
          <TextField label="Link URL (optional)" value={block.linkUrl} onChange={(v) => onChange({ linkUrl: v })} placeholder="https://" />
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Width %" value={block.width} onChange={(v) => onChange({ width: Math.max(10, Math.min(100, v)) })} />
            <TextField label="Alt text" value={block.alt} onChange={(v) => onChange({ alt: v })} />
            <AlignField value={block.align} onChange={(v) => onChange({ align: v })} />
          </div>
        </div>
      )
    case 'button':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Label" value={block.label} onChange={(v) => onChange({ label: v })} />
            <TextField label="Link URL" value={block.linkUrl} onChange={(v) => onChange({ linkUrl: v })} placeholder="https://" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ColorField label="Button" value={block.bg} onChange={(v) => onChange({ bg: v })} />
            <ColorField label="Text" value={block.color} onChange={(v) => onChange({ color: v })} />
            <NumField label="Radius" value={block.radius} onChange={(v) => onChange({ radius: v })} />
            <AlignField value={block.align} onChange={(v) => onChange({ align: v })} />
          </div>
        </div>
      )
    case 'divider':
      return (
        <div className="grid grid-cols-3 gap-3">
          <ColorField label="Color" value={block.color} onChange={(v) => onChange({ color: v })} />
          <NumField label="Thickness" value={block.thickness} onChange={(v) => onChange({ thickness: v })} />
          <NumField label="Padding" value={block.padding} onChange={(v) => onChange({ padding: v })} />
        </div>
      )
    case 'spacer':
      return <NumField label="Height (px)" value={block.height} onChange={(v) => onChange({ height: v })} />
  }
}

// ── small field primitives ──────────────────────────────────────────────────

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-white" />
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-white" />
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
      <div className="flex items-center gap-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 rounded border border-gray-700 bg-gray-800 p-0.5 cursor-pointer" />
        <input value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white font-mono" />
      </div>
    </div>
  )
}

function AlignField({ value, onChange }: { value: Align; onChange: (v: Align) => void }) {
  const opts: Align[] = ['left', 'center', 'right']
  return (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">Align</label>
      <div className="flex rounded border border-gray-700 overflow-hidden">
        {opts.map((o) => (
          <button key={o} onClick={() => onChange(o)} title={o}
            className={'flex-1 text-xs py-1 ' + (value === o ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white')}>
            {o === 'left' ? '⬅' : o === 'center' ? '↔' : '➡'}
          </button>
        ))}
      </div>
    </div>
  )
}

function MergeTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  function insert(field: string) {
    const token = `{{${field}}}`
    const el = ref.current
    if (!el) { onChange(value + token); return }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    onChange(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length })
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] text-gray-400">Content (Markdown: **bold**, *italic*, [link](url))</label>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-500">Insert:</span>
          {MERGE_FIELDS.map((f) => (
            <button key={f} onClick={() => insert(f)} className="text-[11px] rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-gray-300 hover:bg-gray-700">{`{{${f}}}`}</button>
          ))}
        </div>
      </div>
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={5}
        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-white font-mono leading-relaxed" />
    </div>
  )
}

function ImageField({ label, url, onChange }: { label: string; url: string; onChange: (url: string) => void }) {
  const toast = useToast()
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/hub/marketing/email/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Upload failed.'); return }
      onChange(data.url)
    } finally { setUploading(false) }
  }

  return (
    <div>
      <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
      <div className="flex items-center gap-3">
        {url ? (
          <img src={url} alt="" className="h-14 w-14 object-contain rounded border border-gray-700 bg-white" />
        ) : (
          <div className="h-14 w-14 rounded border border-dashed border-gray-700 flex items-center justify-center text-gray-600 text-xs">none</div>
        )}
        <div className="flex flex-col gap-1.5">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="text-xs rounded bg-gray-800 border border-gray-700 px-2.5 py-1 text-gray-200 hover:bg-gray-700 disabled:opacity-50">
            {uploading ? 'Uploading…' : url ? 'Replace image' : 'Upload image'}
          </button>
          {url && <button onClick={() => onChange('')} className="text-xs text-red-400/80 hover:text-red-400 text-left">Remove</button>}
        </div>
      </div>
    </div>
  )
}
