'use client'

import { useRef, useState } from 'react'
import { useToast } from '@/components/ui'
import { fileSize, type OutgoingAttachment } from './emailFormat'

const MAX_BYTES = 15 * 1024 * 1024 // 15 MB — matches the attachments API cap

type UploadingEntry = { key: string; filename: string; size: number }

/**
 * Attach button + staged-attachment chips for the email composers. Uploads each
 * picked file to POST /api/hub/email/attachments (multipart, field "file") and
 * reports the returned { id, filename, contentType, size } up via onAdd — the
 * composer includes those objects in the send payload's `attachments` array.
 */
export default function EmailAttachments({
  attachments,
  onAdd,
  onRemove,
  disabled = false,
}: {
  attachments: OutgoingAttachment[]
  onAdd: (a: OutgoingAttachment) => void
  onRemove: (id: string) => void
  disabled?: boolean
}) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<UploadingEntry[]>([])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(`"${file.name}" is over 15 MB — attach a smaller file.`)
        continue
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setUploading((prev) => [...prev, { key, filename: file.name, size: file.size }])
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/hub/email/attachments', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.id) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Upload failed')
        }
        onAdd({
          id: data.id,
          filename: data.filename || file.name,
          contentType: data.contentType || file.type || 'application/octet-stream',
          size: typeof data.size === 'number' ? data.size : file.size,
        })
      } catch {
        toast.error(`Couldn't upload "${file.name}" — try again.`)
      } finally {
        setUploading((prev) => prev.filter((u) => u.key !== key))
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="Attach files (up to 15 MB each)"
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
      >
        <span aria-hidden>📎</span>
        <span className="hidden sm:inline">Attach</span>
      </button>

      {attachments.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-gray-100 border border-gray-200 text-[11px] text-gray-700"
          title={`${a.filename} · ${a.contentType}`}
        >
          <span aria-hidden>📎</span>
          <span className="max-w-[140px] truncate">{a.filename}</span>
          <span className="text-gray-400">{fileSize(a.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            disabled={disabled}
            className="ml-0.5 w-4 h-4 inline-flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 disabled:opacity-50"
            aria-label={`Remove ${a.filename}`}
          >
            ✕
          </button>
        </span>
      ))}

      {uploading.map((u) => (
        <span
          key={u.key}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 border border-gray-200 text-[11px] text-gray-500"
        >
          <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="max-w-[140px] truncate">{u.filename}</span>
          <span className="text-gray-400">{fileSize(u.size)}</span>
        </span>
      ))}
    </div>
  )
}
