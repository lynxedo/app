'use client'

import { useEffect, useMemo, useState } from 'react'

type FileTag = {
  id: string
  name: string
  color: string
  tag_type: 'general' | 'social-page' | 'social-queue'
  description: string | null
}

export type AttachmentForSave = {
  id: string
  filename: string
  mime_type: string
  storage_path: string
}

export default function SaveToFilesModal({
  attachments,
  onClose,
}: {
  attachments: AttachmentForSave[]
  onClose: () => void
}) {
  const images = useMemo(() => attachments.filter(a => a.mime_type.startsWith('image/')), [attachments])
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string>(images[0]?.id ?? '')
  const [availableTags, setAvailableTags] = useState<FileTag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/file-tags')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const tags: FileTag[] = data.tags ?? []
        setAvailableTags(tags)
        // Preselect the first social-queue tag (typically "Social Media")
        const socialQueue = tags.find(t => t.tag_type === 'social-queue')
        if (socialQueue) setSelectedTags([socialQueue.name])
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const tagByName = useMemo(() => {
    const m = new Map<string, FileTag>()
    availableTags.forEach(t => m.set(t.name, t))
    return m
  }, [availableTags])

  function toggleTag(name: string) {
    setSelectedTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
  }

  async function handleSave() {
    if (!selectedAttachmentId || saving) return
    setSaving(true)
    setError(null)
    const res = await fetch('/api/hub/hub-files/from-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: selectedAttachmentId,
        tags: selectedTags,
        description: description.trim() || null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to save')
      return
    }
    setSaved(true)
    setTimeout(onClose, 900)
  }

  if (images.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-gray-300">No image attachments on this message.</p>
          <button onClick={onClose} className="mt-4 px-4 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm text-gray-300">Close</button>
        </div>
      </div>
    )
  }

  const grouped = {
    queue: availableTags.filter(t => t.tag_type === 'social-queue'),
    page: availableTags.filter(t => t.tag_type === 'social-page'),
    general: availableTags.filter(t => t.tag_type === 'general'),
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <span>📁</span> Save to Files
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Image picker — only shown when multiple images */}
          {images.length > 1 && (
            <div>
              <label className="text-xs text-gray-400 block mb-2">Which image?</label>
              <div className="grid grid-cols-3 gap-2">
                {images.map(img => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedAttachmentId(img.id)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedAttachmentId === img.id ? 'border-brand' : 'border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <img src={`/api/hub/files/${img.id}`} alt={img.filename} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {images.length === 1 && (
            <div className="aspect-video w-full rounded-lg overflow-hidden border border-gray-700 bg-gray-800">
              <img src={`/api/hub/files/${images[0].id}`} alt={images[0].filename} className="w-full h-full object-contain" />
            </div>
          )}

          {/* Description */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Note about this photo"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-brand"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs text-gray-400 block mb-2">Tags</label>
            {loading ? (
              <p className="text-xs text-gray-500">Loading tags…</p>
            ) : (
              <div className="space-y-3">
                {grouped.queue.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Social Queue</div>
                    <div className="flex flex-wrap gap-1.5">
                      {grouped.queue.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.name)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium text-white transition-opacity ${
                            selectedTags.includes(t.name) ? 'ring-1 ring-white/60' : 'opacity-50 hover:opacity-80'
                          }`}
                          style={{ backgroundColor: t.color }}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {grouped.page.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Social Page</div>
                    <div className="flex flex-wrap gap-1.5">
                      {grouped.page.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.name)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium text-white transition-opacity ${
                            selectedTags.includes(t.name) ? 'ring-1 ring-white/60' : 'opacity-50 hover:opacity-80'
                          }`}
                          style={{ backgroundColor: t.color }}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {grouped.general.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">General</div>
                    <div className="flex flex-wrap gap-1.5">
                      {grouped.general.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.name)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium text-white transition-opacity ${
                            selectedTags.includes(t.name) ? 'ring-1 ring-white/60' : 'opacity-50 hover:opacity-80'
                          }`}
                          style={{ backgroundColor: t.color }}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {availableTags.length === 0 && (
                  <p className="text-xs text-gray-500">
                    No tags configured. Add tags in <a href="/admin/hub" className="text-[#60B3E8] hover:underline">Hub Admin → File Tags</a>.
                  </p>
                )}
              </div>
            )}

            {selectedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[10px] text-gray-500 mr-1">Selected:</span>
                {selectedTags.map(name => {
                  const t = tagByName.get(name)
                  return (
                    <span key={name} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: t?.color ?? '#374151' }}>
                      {name}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || saved || !selectedAttachmentId}
              className="flex-1 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-40 text-sm text-white font-medium transition-colors"
            >
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save to Files'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
