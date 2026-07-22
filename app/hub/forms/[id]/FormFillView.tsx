'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { Form, FormField } from '@/lib/forms'

type JClient = { id: string; name: string; phone: string | null; address: string | null }

// ── Signature canvas ──────────────────────────────────────────────────────────

function SignatureCanvas({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<[number, number] | null>(null)

  function getXY(clientX: number, clientY: number): [number, number] {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY]
  }

  function startDraw(clientX: number, clientY: number) {
    drawing.current = true
    last.current = getXY(clientX, clientY)
  }

  function moveDraw(clientX: number, clientY: number) {
    if (!drawing.current || !last.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const [x, y] = getXY(clientX, clientY)
    ctx.beginPath()
    ctx.moveTo(last.current[0], last.current[1])
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    last.current = [x, y]
  }

  function endDraw() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clearCanvas() {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    onChange('')
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={160}
        className="border-2 border-gray-600 rounded-lg bg-white w-full"
        style={{ touchAction: 'none', cursor: 'crosshair', maxHeight: '160px' }}
        onMouseDown={e => startDraw(e.clientX, e.clientY)}
        onMouseMove={e => moveDraw(e.clientX, e.clientY)}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={e => { e.preventDefault(); const t = e.touches[0]; startDraw(t.clientX, t.clientY) }}
        onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; moveDraw(t.clientX, t.clientY) }}
        onTouchEnd={endDraw}
      />
      <div className="flex items-center justify-between mt-1">
        {value
          ? <span className="text-xs text-emerald-400">✓ Signature captured</span>
          : <span className="text-xs text-gray-500">Draw your signature above</span>
        }
        {value && (
          <button type="button" onClick={clearCanvas} className="text-xs text-red-400 hover:text-red-300">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ── Field renderer ────────────────────────────────────────────────────────────

function FieldRenderer({
  field,
  value,
  onChange,
  error,
}: {
  field: FormField
  value: string | boolean | undefined
  onChange: (v: string | boolean) => void
  error?: string
}) {
  if (field.type === 'section_title') {
    return (
      <div className="pt-4">
        <h3 className="text-base font-semibold text-sky-300 border-b border-white/10 pb-2">
          {field.label}
        </h3>
      </div>
    )
  }

  const labelEl = (
    <label className="block text-sm font-medium text-gray-200 mb-1.5">
      {field.label}
      {field.required && <span className="text-red-400 ml-1">*</span>}
    </label>
  )

  const inputClass =
    'w-full bg-gray-800 border rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand text-base md:text-sm ' +
    (error ? 'border-red-500' : 'border-white/20')

  if (field.type === 'checkbox') {
    return (
      <div>
        <label className="flex items-center gap-3 cursor-pointer group select-none">
          <input
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            className="w-5 h-5 rounded accent-brand flex-shrink-0"
          />
          <span className="text-sm text-gray-200 group-hover:text-white">{field.label}</span>
        </label>
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  if (field.type === 'date') {
    return (
      <div>
        {labelEl}
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  if (field.type === 'dropdown') {
    return (
      <div>
        {labelEl}
        <select
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          className={inputClass + ' bg-gray-800'}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  if (field.type === 'short_answer') {
    return (
      <div>
        {labelEl}
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          className={inputClass}
          style={{ fontSize: '16px' }}
        />
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  if (field.type === 'long_answer') {
    return (
      <div>
        {labelEl}
        <textarea
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          rows={3}
          className={inputClass + ' resize-y'}
          style={{ fontSize: '16px' }}
        />
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  if (field.type === 'signature') {
    return (
      <div>
        {labelEl}
        <SignatureCanvas value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  return null
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({
  form,
  smsPreview,
  smsSent,
  smsError,
  jobberNoteId,
  jobberError,
}: {
  form: Form
  smsPreview: string | null
  smsSent: boolean
  smsError: string | null
  jobberNoteId: string | null
  jobberError: string | null
}) {
  const [copied, setCopied] = useState(false)

  function copySms() {
    if (!smsPreview) return
    navigator.clipboard.writeText(smsPreview).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // MSC-FormsSend: friendly label for why an auto-send didn't happen.
  const smsErrorLabel =
    smsError === 'do_not_text' ? 'Customer has opted out of texts (STOP).'
    : smsError === 'invalid_phone' ? "Couldn't read the customer's phone number."
    : smsError === 'twilio_not_configured' ? 'Texting isn’t set up yet.'
    : smsError ? 'Couldn’t send the text automatically.'
    : null

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-12 text-center space-y-6">
        <div className="text-5xl">✅</div>
        <div>
          <h2 className="text-2xl font-bold text-emerald-400">Form Submitted</h2>
          <p className="text-gray-400 mt-1">{form.name}</p>
        </div>

        {jobberNoteId && (
          <div className="px-4 py-3 bg-blue-900/30 border border-blue-700 rounded text-blue-300 text-sm">
            ✓ Note added to Jobber client
          </div>
        )}
        {jobberError && (
          <div className="px-4 py-3 bg-amber-900/30 border border-amber-700 rounded text-amber-300 text-sm text-left">
            ⚠ Jobber sync failed: {jobberError}
          </div>
        )}

        {smsSent && (
          <div className="px-4 py-3 bg-emerald-900/30 border border-emerald-700 rounded text-emerald-300 text-sm">
            ✓ Text sent to customer
          </div>
        )}
        {!smsSent && smsError === 'do_not_text' && (
          <div className="px-4 py-3 bg-amber-900/30 border border-amber-700 rounded text-amber-300 text-sm">
            ⚠ {smsErrorLabel} No text was sent.
          </div>
        )}
        {smsPreview && !smsSent && smsError !== 'do_not_text' && (
          <div className="text-left bg-gray-900 border border-white/10 rounded-lg p-4 space-y-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">SMS to customer</p>
            {smsErrorLabel && (
              <p className="text-xs text-amber-300">⚠ {smsErrorLabel} You can copy it and send manually.</p>
            )}
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{smsPreview}</p>
            <button
              onClick={copySms}
              className="text-xs px-3 py-1.5 bg-brand hover:bg-brand-hover text-[#fff] rounded"
            >
              {copied ? '✓ Copied' : 'Copy message'}
            </button>
          </div>
        )}

        <div className="flex gap-3 justify-center pt-2">
          <Link
            href={`/hub/forms/${form.id}`}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm"
          >
            Fill again
          </Link>
          <Link
            href="/hub/forms"
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-[#fff] rounded text-sm"
          >
            Back to Forms
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FormFillView({
  form,
  techName,
}: {
  form: Form
  userId: string
  techName: string
}) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({})
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [jobberClientId, setJobberClientId] = useState('')
  const [jobberClientName, setJobberClientName] = useState('')
  const [jobberSearch, setJobberSearch] = useState('')
  const [jobberResults, setJobberResults] = useState<JClient[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    smsPreview: string | null
    smsSent: boolean
    smsError: string | null
    jobberNoteId: string | null
    jobberError: string | null
  } | null>(null)

  const setAnswer = useCallback((fieldId: string, value: string | boolean) => {
    setAnswers(prev => ({ ...prev, [fieldId]: value }))
    setErrors(prev => { const n = { ...prev }; delete n[fieldId]; return n })
  }, [])

  async function searchJobber() {
    if (jobberSearch.trim().length < 2) return
    setSearching(true)
    setJobberResults([])
    try {
      const res = await fetch(`/api/hub/forms/jobber-clients?q=${encodeURIComponent(jobberSearch)}`)
      const data = await res.json()
      setJobberResults(data.clients ?? [])
    } finally {
      setSearching(false)
    }
  }

  function selectClient(c: JClient) {
    setJobberClientId(c.id)
    setJobberClientName(c.name)
    setJobberResults([])
    setJobberSearch('')
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    for (const field of form.fields) {
      if (!field.required || field.type === 'section_title') continue
      const val = answers[field.id]
      if (field.type === 'checkbox') {
        // required checkboxes must be checked
        if (!val) errs[field.id] = 'This field is required'
      } else if (field.type === 'signature') {
        if (!val || typeof val !== 'string' || !val.startsWith('data:image')) {
          errs[field.id] = 'Signature is required'
        }
      } else {
        if (!val || (typeof val === 'string' && !val.trim())) {
          errs[field.id] = 'This field is required'
        }
      }
    }
    setErrors(errs)
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Use validate()'s return value, not the `errors` state — setErrors() hasn't
    // applied yet in this tick, so reading `errors` here is stale and the very first
    // failed submit would scroll to nothing (MSC-FormScroll).
    const errs = validate()
    const firstErrorId = Object.keys(errs)[0]
    if (firstErrorId) {
      document.getElementById(`field-${firstErrorId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch(`/api/hub/forms/${form.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          customer_name: customerName.trim() || undefined,
          customer_phone: customerPhone.trim() || undefined,
          jobber_client_id: jobberClientId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // MSC-FormsSend: the server now renders + sends the customer SMS via Twilio.
      setResult({
        smsPreview: data.sms_body ?? null,
        smsSent: !!data.sms_sent,
        smsError: data.sms_error ?? null,
        jobberNoteId: data.jobber_note_id ?? null,
        jobberError: data.jobber_error ?? null,
      })
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <SuccessScreen
        form={form}
        smsPreview={result.smsPreview}
        smsSent={result.smsSent}
        smsError={result.smsError}
        jobberNoteId={result.jobberNoteId}
        jobberError={result.jobberError}
      />
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-3 border-b border-white/10 flex items-center gap-3">
        <Link href="/hub/forms" className="text-gray-400 hover:text-white text-sm">← Forms</Link>
        <h1 className="text-xl font-bold flex-1 truncate">{form.name}</h1>
      </header>

      <form onSubmit={handleSubmit} noValidate>
        <div className="max-w-lg mx-auto px-4 md:px-6 py-6 space-y-5">
          {form.description && (
            <p className="text-sm text-gray-400">{form.description}</p>
          )}

          {submitError && (
            <div className="px-4 py-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
              {submitError}
            </div>
          )}

          {/* Form fields */}
          {form.fields.map(field => (
            <div key={field.id} id={`field-${field.id}`}>
              <FieldRenderer
                field={field}
                value={answers[field.id]}
                onChange={v => setAnswer(field.id, v)}
                error={errors[field.id]}
              />
            </div>
          ))}

          {/* Customer info */}
          <div className="border-t border-white/10 pt-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Customer Info (optional)</h3>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full bg-gray-800 border border-white/20 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-brand focus:outline-none"
                style={{ fontSize: '16px' }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Customer Phone</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                placeholder="e.g. (555) 123-4567"
                className="w-full bg-gray-800 border border-white/20 rounded px-3 py-2 text-white placeholder-gray-500 focus:border-brand focus:outline-none"
                style={{ fontSize: '16px' }}
              />
            </div>
            {form.notification_sms_template && (
              <p className="text-xs text-gray-500">
                If a customer name is entered, you&apos;ll see an SMS template to copy after submitting.
              </p>
            )}
          </div>

          {/* Jobber sync */}
          <details className="border border-blue-900/30 rounded-lg">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-blue-300 list-none flex items-center gap-2">
              <span>🔗</span> Link to Jobber Client (optional)
            </summary>
            <div className="px-4 pb-4 space-y-3 border-t border-blue-900/20 pt-3">
              {jobberClientId ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-emerald-300 flex-1">✓ {jobberClientName}</span>
                  <button
                    type="button"
                    onClick={() => { setJobberClientId(''); setJobberClientName('') }}
                    className="text-xs text-gray-400 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={jobberSearch}
                      onChange={e => setJobberSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), searchJobber())}
                      placeholder="Search client name…"
                      className="flex-1 bg-gray-800 border border-white/20 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={searchJobber}
                      disabled={searching}
                      className="px-3 py-2 bg-blue-800 hover:bg-blue-700 text-[#fff] text-sm rounded disabled:opacity-50"
                    >
                      {searching ? '…' : 'Search'}
                    </button>
                  </div>
                  {jobberResults.length > 0 && (
                    <ul className="bg-gray-800 border border-white/10 rounded divide-y divide-white/10">
                      {jobberResults.map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 hover:bg-white/10"
                          >
                            <p className="text-sm text-white">{c.name}</p>
                            {(c.phone || c.address) && (
                              <p className="text-xs text-gray-400">{[c.phone, c.address].filter(Boolean).join(' · ')}</p>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p className="text-xs text-gray-500">
                A note will be added to the Jobber client record when submitted.
              </p>
            </div>
          </details>

          {/* Submit */}
          <div className="pt-4 pb-8">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-[#fff] font-semibold rounded-lg text-base"
            >
              {submitting ? 'Submitting…' : 'Submit Form'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
