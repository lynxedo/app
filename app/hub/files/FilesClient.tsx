'use client'

import { useState, useRef, useMemo } from 'react'

type FileTag = {
  id: string
  name: string
  color: string
  tag_type: 'general' | 'social-page' | 'social-queue'
  description: string | null
}

type HubFile = {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  description: string | null
  uploaded_at: string
  tags: string[]
  uploader: { display_name: string } | null
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝'
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
  return '📁'
}

function TagChip({ tag, onRemove, prominent }: { tag: FileTag; onRemove?: () => void; prominent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white ${
        prominent ? 'ring-1 ring-white/40' : ''
      }`}
      style={{ backgroundColor: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-white/80 hover:text-white"
          aria-label={`Remove ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

function TagPicker({
  selectedTags,
  onChange,
  availableTags,
}: {
  selectedTags: string[]
  onChange: (next: string[]) => void
  availableTags: FileTag[]
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const tagByName = useMemo(() => {
    const m = new Map<string, FileTag>()
    availableTags.forEach(t => m.set(t.name, t))
    return m
  }, [availableTags])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return availableTags
      .filter(t => !selectedTags.includes(t.name))
      .filter(t => !q || t.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [availableTags, selectedTags, query])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap min-h-[1.75rem]">
        {selectedTags.map(name => {
          const t = tagByName.get(name)
          if (!t) {
            return (
              <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-700 text-gray-300">
                {name}
                <button type="button" onClick={() => onChange(selectedTags.filter(s => s !== name))} className="text-gray-400 hover:text-white">×</button>
              </span>
            )
          }
          return (
            <TagChip
              key={name}
              tag={t}
              prominent={t.tag_type === 'social-queue'}
              onRemove={() => onChange(selectedTags.filter(s => s !== name))}
            />
          )
        })}
      </div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={selectedTags.length === 0 ? 'Add tags…' : 'Add another tag…'}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
        />
        {open && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
            {suggestions.map(t => (
              <button
                key={t.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange([...selectedTags, t.name]); setQuery('') }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-700"
              >
                <span className="w-3 h-3 rounded-full flex-none" style={{ backgroundColor: t.color }} />
                <span className="text-white">{t.name}</span>
                <span className="text-xs text-gray-500 ml-auto">
                  {t.tag_type === 'social-queue' ? 'Social Queue' : t.tag_type === 'social-page' ? 'Social Page' : 'General'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-600">
        Only admins can create new tags. Manage tags in <a href="/admin/hub" className="text-[#60B3E8] hover:underline">Hub Admin → File Tags</a>.
      </p>
    </div>
  )
}

export default function FilesClient({
  initialFiles,
  initialTags,
  isAdmin,
}: {
  initialFiles: HubFile[]
  initialTags: FileTag[]
  isAdmin: boolean
}) {
  const [files, setFiles] = useState<HubFile[]>(initialFiles)
  const [availableTags] = useState<FileTag[]>(initialTags)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [uploadTags, setUploadTags] = useState<string[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ description: string; tags: string[] }>({ description: '', tags: [] })
  const [savingEdit, setSavingEdit] = useState(false)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tagByName = useMemo(() => {
    const m = new Map<string, FileTag>()
    availableTags.forEach(t => m.set(t.name, t))
    return m
  }, [availableTags])

  const tagsInUse = useMemo(() => {
    const used = new Set<string>()
    files.forEach(f => f.tags.forEach(t => used.add(t)))
    return Array.from(used).sort()
  }, [files])

  const visibleFiles = useMemo(() => {
    if (filterTags.length === 0) return files
    return files.filter(f => filterTags.every(t => f.tags.includes(t)))
  }, [files, filterTags])

  function toggleFilter(name: string) {
    setFilterTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = fileInputRef.current
    if (!input?.files?.length) return

    const file = input.files[0]
    setUploading(true)
    setUploadError(null)

    const fd = new FormData()
    fd.append('file', file)
    if (description.trim()) fd.append('description', description.trim())
    if (uploadTags.length > 0) fd.append('tags', uploadTags.join(','))

    const res = await fetch('/api/hub/hub-files', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)

    if (!res.ok) {
      setUploadError(data.error ?? 'Upload failed')
      return
    }

    const listRes = await fetch('/api/hub/hub-files')
    const listData = await listRes.json()
    setFiles(listData.files ?? [])
    setDescription('')
    setUploadTags([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    const res = await fetch(`/api/hub/hub-files/${id}`, { method: 'DELETE' })
    setDeleting(false)
    setConfirmDeleteId(null)
    if (res.ok) {
      setFiles(prev => prev.filter(f => f.id !== id))
    }
  }

  function startEdit(file: HubFile) {
    setEditingId(file.id)
    setEditDraft({ description: file.description ?? '', tags: [...file.tags] })
  }

  async function saveEdit(id: string) {
    setSavingEdit(true)
    const res = await fetch(`/api/hub/hub-files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: editDraft.description.trim() || null,
        tags: editDraft.tags,
      }),
    })
    setSavingEdit(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Failed to save')
      return
    }
    const data = await res.json()
    setFiles(prev => prev.map(f => f.id === id ? {
      ...f,
      description: data.file.description ?? null,
      tags: data.file.tags ?? [],
    } : f))
    setEditingId(null)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex-none px-6 py-4 border-b border-gray-800 max-md:pl-14">
        <div className="flex items-center gap-2">
          <span className="text-lg">📁</span>
          <h1 className="text-lg font-semibold text-white">Files</h1>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Company file library — click any file to download</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Admin upload section */}
        {isAdmin && (
          <div className="max-w-2xl bg-gray-900 border border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Upload a file</h2>
            <form onSubmit={handleUpload} className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                className="block w-full text-sm text-gray-400
                  file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                  file:text-sm file:font-medium file:bg-[#2E7EB8] file:text-white
                  hover:file:bg-[#2470a8] file:cursor-pointer cursor-pointer"
                required
              />
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Tags (optional)</label>
                <TagPicker
                  selectedTags={uploadTags}
                  onChange={setUploadTags}
                  availableTags={availableTags}
                />
              </div>
              {uploadError && <p className="text-red-400 text-xs">{uploadError}</p>}
              <button
                type="submit"
                disabled={uploading}
                className="px-4 py-2 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>
          </div>
        )}

        {/* Filter bar */}
        {tagsInUse.length > 0 && (
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 mr-1">Filter:</span>
              {tagsInUse.map(name => {
                const t = tagByName.get(name)
                const active = filterTags.includes(name)
                const bg = t?.color ?? '#374151'
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleFilter(name)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity ${
                      active ? '' : 'opacity-50 hover:opacity-80'
                    }`}
                    style={{ backgroundColor: bg, color: 'white' }}
                  >
                    {name}
                  </button>
                )
              })}
              {filterTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTags([])}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1 underline ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* File list */}
        <div className="max-w-2xl">
          {visibleFiles.length === 0 && (
            <p className="text-gray-500 text-sm">
              {files.length === 0 ? 'No files uploaded yet.' : 'No files match the selected tag filter.'}
            </p>
          )}
          <div className="space-y-2">
            {visibleFiles.map(f => (
              <div
                key={f.id}
                className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-700 transition-colors"
              >
                {editingId === f.id ? (
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-white">{f.filename}</div>
                    <input
                      type="text"
                      value={editDraft.description}
                      onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                      placeholder="Description"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                    />
                    <TagPicker
                      selectedTags={editDraft.tags}
                      onChange={tags => setEditDraft(d => ({ ...d, tags }))}
                      availableTags={availableTags}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(f.id)}
                        disabled={savingEdit}
                        className="px-4 py-1.5 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white"
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-4 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {f.mime_type.startsWith('image/') ? (
                      <a
                        href={`/api/hub/hub-files/${f.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-none w-12 h-12 rounded-lg overflow-hidden bg-gray-800 border border-gray-700 hover:border-gray-500 transition-colors"
                        title="Open image"
                      >
                        <img
                          src={`/api/hub/hub-files/${f.id}`}
                          alt={f.filename}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ) : (
                      <span className="text-2xl flex-none">{fileIcon(f.mime_type)}</span>
                    )}

                    <div className="flex-1 min-w-0">
                      <a
                        href={`/api/hub/hub-files/${f.id}`}
                        className="text-sm font-medium text-white hover:text-[#60B3E8] transition-colors truncate block"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {f.filename}
                      </a>
                      {f.description && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{f.description}</p>
                      )}
                      {f.tags.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-1.5">
                          {f.tags.map(name => {
                            const t = tagByName.get(name)
                            return t ? (
                              <TagChip key={name} tag={t} prominent={t.tag_type === 'social-queue'} />
                            ) : (
                              <span key={name} className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">{name}</span>
                            )
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                        <span>{formatBytes(f.size_bytes)}</span>
                        <span>{f.uploader?.display_name ?? 'Unknown'}</span>
                        <span>{formatDate(f.uploaded_at)}</span>
                      </div>
                    </div>

                    <a
                      href={`/api/hub/hub-files/${f.id}`}
                      className="flex-none text-gray-500 hover:text-white transition-colors p-1"
                      title="Download"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                      </svg>
                    </a>

                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(f)}
                          className="flex-none text-gray-600 hover:text-white transition-colors p-1"
                          title="Edit tags and description"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {confirmDeleteId === f.id ? (
                          <div className="flex items-center gap-2 flex-none">
                            <span className="text-xs text-gray-400">Delete?</span>
                            <button
                              onClick={() => handleDelete(f.id)}
                              disabled={deleting}
                              className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-40"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(f.id)}
                            className="flex-none text-gray-600 hover:text-red-400 transition-colors p-1"
                            title="Delete file"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
