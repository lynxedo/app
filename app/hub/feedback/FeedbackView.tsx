'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Kind = 'bug' | 'feature'
type Urgency = 'low' | 'medium' | 'high' | 'urgent'

// Full, static class strings per urgency so Tailwind keeps them (interpolated
// class names get purged).
const URGENCY_OPTS: { value: Urgency; label: string; on: string; dot: string }[] = [
  { value: 'low', label: 'Low', on: 'bg-emerald-500/15 border-emerald-500/70 text-emerald-200 ring-1 ring-emerald-500/40', dot: 'bg-emerald-400' },
  { value: 'medium', label: 'Medium', on: 'bg-sky-500/15 border-sky-500/70 text-sky-200 ring-1 ring-sky-500/40', dot: 'bg-sky-400' },
  { value: 'high', label: 'High', on: 'bg-amber-500/15 border-amber-500/70 text-amber-200 ring-1 ring-amber-500/40', dot: 'bg-amber-400' },
  { value: 'urgent', label: 'Urgent', on: 'bg-red-500/15 border-red-500/70 text-red-200 ring-1 ring-red-500/40', dot: 'bg-red-400' },
]

const SUMMARY_PLACEHOLDER: Record<Kind, string> = {
  bug: "Briefly, what's broken? (e.g. “Dialer drops the call when I put someone on hold”)",
  feature: 'Briefly, what would you like? (e.g. “Let me filter the Tracker by rep”)',
}
const DETAILS_PLACEHOLDER: Record<Kind, string> = {
  bug: 'What happened? What did you expect instead? Where in the app were you (page/button)? Steps to reproduce, if you know them.',
  feature: 'What would you like to be able to do? What problem would it solve, and who would use it?',
}

// 16px inputs avoid iOS auto-zoom; generous padding keeps tap targets big.
const FIELD =
  'w-full bg-gray-900 border border-white/10 rounded-lg px-3.5 py-2.5 text-base text-white placeholder:text-white/35 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/40 transition-colors'

export default function FeedbackView() {
  const [kind, setKind] = useState<Kind>('bug')
  const [summary, setSummary] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('medium')
  const [details, setDetails] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Clean up the preview object URL whenever it changes / on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function pickFile(f: File | null) {
    setError(null)
    if (!f) {
      setFile(null)
      setPreviewUrl(null)
      return
    }
    if (!f.type.startsWith('image/')) {
      setError('Please choose an image (photo or screenshot).')
      return
    }
    if (f.size > 30 * 1024 * 1024) {
      setError('That image is over 30 MB — try a smaller screenshot.')
      return
    }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  function reset() {
    setKind('bug')
    setSummary('')
    setUrgency('medium')
    setDetails('')
    setFile(null)
    setPreviewUrl(null)
    setError(null)
    setDone(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!summary.trim()) {
      setError('Please add a short summary of the issue.')
      return
    }
    setSubmitting(true)
    try {
      // Upload the screenshot first (reuses the proven Hub upload → R2 route),
      // then submit the report with the returned file metadata.
      let attachment: unknown = null
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        const up = await fetch('/api/hub/upload', { method: 'POST', body: fd })
        const upData = await up.json().catch(() => ({}))
        if (!up.ok) {
          setError(upData.error || 'Could not upload the screenshot. Try again or submit without it.')
          return
        }
        attachment = upData
      }

      const res = await fetch('/api/hub/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          summary: summary.trim(),
          urgency,
          details: details.trim(),
          attachment,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Network error — please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
        <main className="max-w-md mx-auto px-4 md:px-6 py-16 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mt-5">Report sent — thank you!</h1>
          <p className="text-white/60 mt-2 text-sm leading-relaxed">
            It&apos;s been added to the Development board and Ben has been notified. If it needs a
            follow-up, he&apos;ll reach out.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={reset}
              className="px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] font-medium transition-colors"
            >
              Send another report
            </button>
            <Link
              href="/hub"
              className="px-4 py-2.5 rounded-lg border border-white/15 text-white/80 hover:text-white hover:border-white/30 font-medium transition-colors"
            >
              Back to Hub
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-3 border-b border-white/10 max-md:pl-14">
        <h1 className="text-xl font-bold">Report an Issue</h1>
        <p className="text-sm text-white/50 mt-0.5">
          Found a bug or have an idea? Tell us below.
        </p>
      </header>

      <main className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { value: 'bug', emoji: '🐛', label: 'Bug Report', sub: 'Something is broken' },
                { value: 'feature', emoji: '✨', label: 'Feature Request', sub: 'An idea or improvement' },
              ] as { value: Kind; emoji: string; label: string; sub: string }[]
            ).map(opt => {
              const active = kind === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKind(opt.value)}
                  className={`rounded-xl border p-3.5 text-left transition-colors ${
                    active
                      ? 'bg-brand/10 border-brand/70 ring-1 ring-brand/40'
                      : 'bg-gray-900 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">{opt.emoji}</span>
                    <span className={`font-semibold ${active ? 'text-white' : 'text-white/80'}`}>{opt.label}</span>
                  </div>
                  <div className="text-xs text-white/45 mt-1">{opt.sub}</div>
                </button>
              )
            })}
          </div>

          {/* Summary → the task title */}
          <div>
            <label htmlFor="fb-summary" className="block text-sm font-medium text-white/80 mb-1.5">
              Summary <span className="text-red-400">*</span>
            </label>
            <input
              id="fb-summary"
              type="text"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder={SUMMARY_PLACEHOLDER[kind]}
              maxLength={160}
              className={FIELD}
            />
            <p className="text-xs text-white/35 mt-1">This becomes the task title on the board.</p>
          </div>

          {/* Urgency */}
          <div>
            <span className="block text-sm font-medium text-white/80 mb-1.5">Urgency</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {URGENCY_OPTS.map(opt => {
                const active = urgency === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUrgency(opt.value)}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      active ? opt.on : 'bg-gray-900 border-white/10 text-white/55 hover:border-white/25 hover:text-white/80'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Details → the note */}
          <div>
            <label htmlFor="fb-details" className="block text-sm font-medium text-white/80 mb-1.5">
              Details
            </label>
            <textarea
              id="fb-details"
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder={DETAILS_PLACEHOLDER[kind]}
              rows={6}
              className={`${FIELD} resize-y min-h-[9rem] leading-relaxed`}
            />
            <p className="text-xs text-white/35 mt-1">The more detail, the faster it can be fixed or built.</p>
          </div>

          {/* Screenshot / photo */}
          <div>
            <span className="block text-sm font-medium text-white/80 mb-1.5">
              Screenshot / photo <span className="text-white/35 font-normal">(optional)</span>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => pickFile(e.target.files?.[0] ?? null)}
            />
            {previewUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Selected screenshot preview"
                  className="max-h-56 rounded-lg border border-white/10 object-contain bg-black/30"
                />
                <button
                  type="button"
                  onClick={() => pickFile(null)}
                  aria-label="Remove image"
                  className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-800 border border-white/20 text-white/80 hover:text-white hover:bg-gray-700 flex items-center justify-center shadow"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-gray-900/60 px-4 py-6 text-white/55 hover:border-brand/50 hover:text-white/80 transition-colors"
              >
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5V18a2 2 0 002 2h14a2 2 0 002-2v-1.5M7.5 9L12 4.5 16.5 9M12 4.5V16" />
                </svg>
                <span className="text-sm font-medium">Tap to add a screenshot or photo</span>
                <span className="text-xs text-white/35">Camera or photo library on mobile</span>
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting || !summary.trim()}
              className="flex-1 sm:flex-none sm:min-w-40 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {submitting ? 'Sending…' : kind === 'bug' ? 'Send bug report' : 'Send feature request'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
