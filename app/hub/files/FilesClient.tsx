'use client'

import { useState, useRef } from 'react'

type HubFile = {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  description: string | null
  uploaded_at: string
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

export default function FilesClient({
  initialFiles,
  isAdmin,
}: {
  initialFiles: HubFile[]
  isAdmin: boolean
}) {
  const [files, setFiles] = useState<HubFile[]>(initialFiles)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    const res = await fetch('/api/hub/hub-files', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)

    if (!res.ok) {
      setUploadError(data.error ?? 'Upload failed')
      return
    }

    // Reload full list (new file may not have uploader joined)
    const listRes = await fetch('/api/hub/hub-files')
    const listData = await listRes.json()
    setFiles(listData.files ?? [])
    setDescription('')
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

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex-none px-6 py-4 border-b border-gray-800">
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

        {/* File list */}
        <div className="max-w-2xl">
          {files.length === 0 && (
            <p className="text-gray-500 text-sm">No files uploaded yet.</p>
          )}
          <div className="space-y-2">
            {files.map(f => (
              <div
                key={f.id}
                className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-700 transition-colors"
              >
                <span className="text-2xl flex-none">{fileIcon(f.mime_type)}</span>

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
                  confirmDeleteId === f.id ? (
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
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
