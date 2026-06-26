'use client'

import { useState } from 'react'
import TxtContactMultiPicker from './TxtContactMultiPicker'
import { useConfirm } from '@/components/ui'

// Broadcast composer modal. POSTs to /api/txt/broadcasts which inserts the
// broadcast + queued recipient rows; the actual sending is drained by the
// /api/txt/broadcasts/process cron endpoint at the broadcast's throttle MPS
// (default 8/sec, under the 10DLC vetted cap). do-not-text contacts are
// pre-marked 'skipped' server-side and counted in skipped_count.
export default function TxtBroadcastComposer({ onClose }: { onClose: () => void }) {
  const confirmDialog = useConfirm()
  const [selected, setSelected] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [applySignature, setApplySignature] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (selected.length === 0 || !body.trim() || submitting) return
    if (!(await confirmDialog(`Send this broadcast to ${selected.length} contact${selected.length === 1 ? '' : 's'}?`))) {
      return
    }
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/txt/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: body.trim(),
        contact_ids: selected,
        apply_signature: applySignature,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok || !data.broadcast_id) {
      setError(data.error || 'Broadcast create failed')
      return
    }
    window.location.href = `/hub/txt/broadcasts/${data.broadcast_id}`
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-stretch sm:items-center justify-center sm:px-4">
      <div className="bg-[var(--t-panel)] border border-white/10 sm:rounded-lg w-full h-full sm:h-[90vh] sm:max-w-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">New broadcast</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3 flex-1 flex flex-col min-h-0">
          <div>
            <label className="text-xs text-white/50 block mb-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Each recipient gets this as a separate 1:1 text…"
              rows={4}
              className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm resize-y"
              style={{ fontSize: 16 }}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-white/40">
                {body.length} char{body.length === 1 ? '' : 's'}
                {body.length > 160 && ' · multi-segment'}
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applySignature}
                  onChange={(e) => setApplySignature(e.target.checked)}
                  className="accent-emerald-500"
                />
                Append my signature
              </label>
            </div>
          </div>
          <div className="text-xs text-white/50">
            Pick recipients. do-not-text contacts are excluded automatically.
          </div>
          <div className="flex-1 min-h-0">
            <TxtContactMultiPicker
              selectedIds={selected}
              onChange={setSelected}
              emptyHint="No contacts. Add one from the sidebar first."
            />
          </div>
          {error && <div className="text-xs text-[var(--t-tint-danger)]">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/40">
            {selected.length === 0
              ? 'No recipients'
              : `${selected.length} recipient${selected.length === 1 ? '' : 's'}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={selected.length === 0 || !body.trim() || submitting}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
            >
              {submitting ? '…' : `Send to ${selected.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
