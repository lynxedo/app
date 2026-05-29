'use client'

import { useState, useEffect, useCallback } from 'react'

type SocialAccount = {
  id: string
  platform: 'facebook' | 'instagram' | 'google_business'
  account_name: string
  ig_user_id: string | null
}

type PhotoFile = {
  id: string
  filename: string
  signed_url: string
  social_used_at: string | null
}

type AccountEntry = { account_id: string; platforms: string[] }

const SERVICE_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'fertilization', label: 'Fertilization' },
  { value: 'irrigation', label: 'Irrigation' },
  { value: 'aeration', label: 'Aeration' },
  { value: 'overseeding', label: 'Overseeding' },
  { value: 'pest-control', label: 'Pest Control' },
  { value: 'doody-duty', label: 'Doody Duty' },
  { value: 'team', label: 'Team' },
]

const CONTENT_PILLARS = [
  { value: 'show-work', label: 'Show the Work' },
  { value: 'educate', label: 'Educate' },
  { value: 'engage', label: 'Engage' },
  { value: 'sell', label: 'Soft Sell' },
]

const FB_CHAR_LIMIT = 63206
const IG_CHAR_LIMIT = 2200

function toLocalDT(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultScheduledAt(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 2)
  return toLocalDT(d)
}

export default function PostComposer({
  accounts,
  editPost,
  onClose,
  onSaved,
}: {
  accounts: SocialAccount[]
  editPost?: {
    id: string
    caption: string
    scheduled_at: string
    hub_file_id: string | null
    platforms: string[]
    account_id: string
  } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [caption, setCaption] = useState(editPost?.caption ?? '')
  const [scheduledAt, setScheduledAt] = useState(
    editPost ? toLocalDT(new Date(editPost.scheduled_at)) : defaultScheduledAt()
  )
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoFile | null>(null)
  const [hubFileId, setHubFileId] = useState<string | null>(editPost?.hub_file_id ?? null)

  // Per-account selections: { account_id: { fb, ig, gbp } }
  const [accountSelections, setAccountSelections] = useState<Record<string, { fb: boolean; ig: boolean; gbp: boolean }>>(() => {
    const init: Record<string, { fb: boolean; ig: boolean; gbp: boolean }> = {}
    if (editPost) {
      const acc = accounts.find(a => a.id === editPost.account_id)
      if (acc) {
        init[acc.id] = {
          fb: editPost.platforms.includes('facebook'),
          ig: editPost.platforms.includes('instagram'),
          gbp: editPost.platforms.includes('google_business'),
        }
      }
    }
    return init
  })

  const [photos, setPhotos] = useState<PhotoFile[]>([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [queueOnly, setQueueOnly] = useState(true)

  const [serviceType, setServiceType] = useState('general')
  const [contentPillar, setContentPillar] = useState('show-work')
  const [generatingCaption, setGeneratingCaption] = useState(false)
  const [generateError, setGenerateError] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const hasIg = accounts.some(a => !!a.ig_user_id)
  const charLimit = hasIg ? IG_CHAR_LIMIT : FB_CHAR_LIMIT
  const captionLength = caption.length

  const selectedAccountEntries = useCallback((): AccountEntry[] => {
    return Object.entries(accountSelections)
      .filter(([, v]) => v.fb || v.ig || v.gbp)
      .map(([account_id, v]) => ({
        account_id,
        platforms: [
          ...(v.fb ? ['facebook'] : []),
          ...(v.ig ? ['instagram'] : []),
          ...(v.gbp ? ['google_business'] : []),
        ],
      }))
  }, [accountSelections])

  const gbpSelected = Object.values(accountSelections).some(v => v.gbp)

  const canSubmit =
    caption.trim().length > 0 &&
    selectedAccountEntries().length > 0 &&
    scheduledAt

  async function loadPhotos() {
    setPhotosLoading(true)
    try {
      const res = await fetch(`/api/hub/social/photo-picker?queue_only=${queueOnly}`)
      const data = await res.json() as { files?: PhotoFile[] }
      setPhotos(data.files ?? [])
    } catch { /* ignore */ }
    setPhotosLoading(false)
  }

  useEffect(() => {
    if (showPhotoPicker) loadPhotos()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPhotoPicker, queueOnly])

  async function generateCaption() {
    setGeneratingCaption(true)
    setGenerateError('')
    try {
      const res = await fetch('/api/hub/social/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hub_file_id: hubFileId,
          platform: accounts.some(a => accountSelections[a.id]?.ig) ? 'instagram' : 'facebook',
          service_type: serviceType,
          content_pillar: contentPillar,
          month: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        }),
      })
      const data = await res.json() as { caption?: string; error?: string }
      if (data.caption) setCaption(data.caption)
      else setGenerateError(data.error ?? 'Generation failed')
    } catch {
      setGenerateError('Network error')
    }
    setGeneratingCaption(false)
  }

  async function submit(action: 'draft' | 'schedule', overrideAt?: string) {
    if (!canSubmit) return
    setSaving(true)
    setSaveError('')

    const scheduledAtUtc = new Date(overrideAt ?? scheduledAt).toISOString()
    const entries = selectedAccountEntries()
    const body = {
      account_entries: editPost ? [{ account_id: editPost.account_id, platforms: entries[0]?.platforms ?? ['facebook'] }] : entries,
      hub_file_id: hubFileId,
      caption,
      scheduled_at: scheduledAtUtc,
      action,
    }

    try {
      let res: Response
      if (editPost) {
        res = await fetch(`/api/hub/social/posts/${editPost.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption, scheduled_at: scheduledAt, hub_file_id: hubFileId, status: action === 'schedule' ? 'scheduled' : 'draft' }),
        })
      } else {
        res = await fetch('/api/hub/social/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setSaveError(data.error ?? 'Save failed')
      } else {
        onSaved()
      }
    } catch {
      setSaveError('Network error')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">
            {editPost ? 'Edit Post' : 'New Post'}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Account selector */}
          {!editPost && (
            <div>
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Post to</label>
              {accounts.length === 0 ? (
                <p className="text-sm text-amber-400">No active accounts connected. Set them up in Admin → Marketing.</p>
              ) : (
                <div className="space-y-2">
                  {accounts.map(account => {
                    const sel = accountSelections[account.id] ?? { fb: false, ig: false, gbp: false }
                    const isGbp = account.platform === 'google_business'
                    return (
                      <div key={account.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800">
                        <div className="flex-1">
                          <span className="text-sm text-white font-medium">{account.account_name}</span>
                          {isGbp ? (
                            <span className="ml-2 text-xs text-emerald-400">Google Business</span>
                          ) : (
                            <>
                              <span className="ml-2 text-xs text-blue-400">Facebook</span>
                              {account.ig_user_id && <span className="ml-1 text-xs text-pink-400">· Instagram</span>}
                            </>
                          )}
                        </div>
                        {isGbp ? (
                          <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sel.gbp}
                              onChange={e => setAccountSelections(p => ({ ...p, [account.id]: { ...sel, gbp: e.target.checked } }))}
                              className="accent-emerald-500"
                            />
                            GBP
                          </label>
                        ) : (
                          <>
                            <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={sel.fb}
                                onChange={e => setAccountSelections(p => ({ ...p, [account.id]: { ...sel, fb: e.target.checked } }))}
                                className="accent-blue-500"
                              />
                              FB
                            </label>
                            {account.ig_user_id && (
                              <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sel.ig}
                                  onChange={e => setAccountSelections(p => ({ ...p, [account.id]: { ...sel, ig: e.target.checked } }))}
                                  className="accent-pink-500"
                                />
                                IG
                              </label>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                {gbpSelected && (
                  <p className="mt-2 text-xs text-amber-300/90">
                    ⚠ Google Business posts expire and disappear from your profile after 7 days.
                  </p>
                )}
              )}
            </div>
          )}

          {/* Photo */}
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Photo (optional)</label>
            {selectedPhoto || hubFileId ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
                {selectedPhoto?.signed_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedPhoto.signed_url} alt="" className="w-14 h-14 object-cover rounded-md flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{selectedPhoto?.filename ?? 'Selected photo'}</p>
                </div>
                <button
                  onClick={() => { setSelectedPhoto(null); setHubFileId(null) }}
                  className="text-xs text-white/40 hover:text-white transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowPhotoPicker(p => !p)}
                className="w-full px-4 py-3 rounded-lg border border-dashed border-gray-700 text-sm text-white/50 hover:text-white hover:border-gray-500 transition-colors"
              >
                {showPhotoPicker ? 'Hide photo picker' : '+ Choose photo from Hub Files'}
              </button>
            )}

            {showPhotoPicker && !selectedPhoto && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={queueOnly}
                      onChange={e => setQueueOnly(e.target.checked)}
                      className="accent-blue-500"
                    />
                    Social queue only
                  </label>
                  <button onClick={loadPhotos} className="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
                </div>
                {photosLoading ? (
                  <p className="text-xs text-white/40 py-4 text-center">Loading…</p>
                ) : photos.length === 0 ? (
                  <p className="text-xs text-white/40 py-4 text-center">No photos found. Upload to Hub Files and tag with &ldquo;Social Media&rdquo;.</p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                    {photos.map(photo => (
                      <button
                        key={photo.id}
                        onClick={() => {
                          setSelectedPhoto(photo)
                          setHubFileId(photo.id)
                          setShowPhotoPicker(false)
                        }}
                        className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-500 transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.signed_url} alt={photo.filename} className="w-full h-full object-cover" />
                        {photo.social_used_at && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="text-xs text-white/70">Used</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Caption */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Caption</label>
              <span className={`text-xs ${captionLength > charLimit ? 'text-red-400' : 'text-white/40'}`}>
                {captionLength.toLocaleString()} / {charLimit.toLocaleString()}
              </span>
            </div>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={5}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Write your caption…"
            />

            {/* AI caption generator */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={serviceType}
                onChange={e => setServiceType(e.target.value)}
                className="bg-gray-900 border border-gray-700 text-xs text-white/70 rounded-md px-2 py-1 focus:outline-none"
              >
                {SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select
                value={contentPillar}
                onChange={e => setContentPillar(e.target.value)}
                className="bg-gray-900 border border-gray-700 text-xs text-white/70 rounded-md px-2 py-1 focus:outline-none"
              >
                {CONTENT_PILLARS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <button
                onClick={generateCaption}
                disabled={generatingCaption}
                className="flex items-center gap-1.5 text-xs bg-violet-600/20 hover:bg-violet-600/30 border border-violet-600/30 text-violet-300 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                {generatingCaption ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>✦ Generate Caption</>
                )}
              </button>
            </div>
            {generateError && <p className="text-xs text-red-400 mt-1">{generateError}</p>}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Schedule</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-full sm:w-auto"
            />
          </div>

          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-white/60 hover:text-white px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => submit('draft')}
            disabled={!canSubmit || saving}
            className="text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Save Draft
          </button>
          {!editPost && (
            <button
              onClick={() => submit('schedule', new Date(Date.now() - 60000).toISOString())}
              disabled={!canSubmit || saving || captionLength > charLimit}
              className="text-sm bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Post Now'}
            </button>
          )}
          <button
            onClick={() => submit('schedule')}
            disabled={!canSubmit || saving || captionLength > charLimit}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : editPost ? 'Update' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
