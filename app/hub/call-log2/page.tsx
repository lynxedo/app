'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CoachingPanel, coachingGradeColor, type CoachingData, type CoachingReview } from '@/components/hub/CoachingPanel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiResult = {
  engine: string
  transcript_text: string | null
  summary: string | null
  sentiment: string | null
  sentiment_json: unknown
  topics: string[] | null
  intents: unknown
  action_items: string[] | null
  call_type: string | null
  latency_ms: number | null
  error_message: string | null
}

type Voicemail = {
  id: string
  call_id: string
  recording_storage_path: string | null
  recording_duration_sec: number | null
  transcript: string | null
  created_at: string
}

type Call = {
  id: string
  direction: string
  from_number: string
  to_number: string
  status: string
  duration_seconds: number | null
  recording_duration_seconds: number | null
  created_at: string
  answered_at: string | null
  ended_at: string | null
  recording_storage_path: string | null
  transcription_status: string | null
  transcript: string | null
  ai_summary: string | null
  sentiment: string | null
  call_type: string | null
  action_items: string[] | null
  coaching_grade: string | null
  coaching_must_listen: boolean | null
  coaching_json: CoachingData | null
  review: CoachingReview | null
  contact: { id: string; name: string; phone: string } | null
  ai_results: AiResult[]
  voicemail: Voicemail | null
}

// ---------------------------------------------------------------------------
// Helpers (mirrors the original Call Log style)
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Chicago',
  })
}

function formatPhone(phone: string | null | undefined) {
  if (!phone) return '—'
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

function directionLabel(dir: string) {
  if (dir === 'inbound')  return { label: 'In',  color: 'text-blue-400 bg-blue-900/30' }
  if (dir === 'outbound') return { label: 'Out', color: 'text-orange-400 bg-orange-900/30' }
  return { label: dir || '?', color: 'text-gray-400 bg-gray-800' }
}

function statusLabel(call: Call) {
  const s = call.status?.toLowerCase() || ''
  if (call.voicemail) return { label: '📬 Voicemail', color: 'text-blue-300 bg-blue-900/30' }
  if (s === 'no-answer' || s === 'missed') return { label: '↩ Missed', color: 'text-red-400 bg-red-900/30' }
  if (s === 'busy') return { label: 'Busy', color: 'text-amber-400 bg-amber-900/30' }
  if (s === 'failed' || s === 'canceled') return { label: s, color: 'text-gray-400 bg-gray-800' }
  if (call.recording_storage_path) return { label: '● Recorded', color: 'text-green-400 bg-green-900/30' }
  return null
}

function sentimentChip(sentiment: string | null | undefined) {
  if (!sentiment) return null
  const s = sentiment.toLowerCase()
  if (s === 'positive') return { label: '🙂 Positive', color: 'text-green-400 bg-green-900/30' }
  if (s === 'negative') return { label: '🙁 Negative', color: 'text-red-400 bg-red-900/30' }
  if (s === 'neutral')  return { label: '😐 Neutral',  color: 'text-gray-300 bg-gray-800' }
  return { label: sentiment, color: 'text-gray-300 bg-gray-800' }
}

// ---------------------------------------------------------------------------
// Left-panel row (mirrors CallRow in the original Call Log)
// ---------------------------------------------------------------------------

function CallRow({ call, selected, onClick, canViewCoaching }: { call: Call; selected: boolean; onClick: () => void; canViewCoaching: boolean }) {
  const dir = directionLabel(call.direction)
  const status = statusLabel(call)
  const displayNumber = call.direction === 'inbound' ? call.from_number : call.to_number
  const displayName = call.contact?.name || null
  const winnerSentiment = call.ai_results.find(r => r.engine === 'deepgram_claude')?.sentiment ?? call.sentiment
  const sent = sentimentChip(winnerSentiment)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors ${selected ? 'bg-gray-800 border-l-2 border-l-purple-500' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-sm font-medium text-white truncate">
          {displayName || formatPhone(displayNumber)}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
        {displayName && <span className="truncate">{formatPhone(displayNumber)}</span>}
        <span>·</span>
        <span>{formatDuration(call.recording_duration_seconds || call.duration_seconds)}</span>
        {status && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${status.color}`}>{status.label}</span>}
        {sent && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${sent.color}`}>{sent.label}</span>}
        {canViewCoaching && call.coaching_grade && <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${coachingGradeColor(call.coaching_grade)}`}>{call.coaching_grade}</span>}
      </div>
      <div className="text-xs text-gray-600 mt-0.5">{formatDateTime(call.created_at)}</div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Right-panel detail (mirrors CallDetail in the original Call Log)
// ---------------------------------------------------------------------------

function CallDetail({ call, canViewCoaching }: { call: Call; canViewCoaching: boolean }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [showEngines, setShowEngines] = useState(false)
  const dir = directionLabel(call.direction)
  const status = statusLabel(call)
  const displayNumber = call.direction === 'inbound' ? call.from_number : call.to_number
  const displayName = call.contact?.name || null
  const winner = call.ai_results.find(r => r.engine === 'deepgram_claude')
  const summary = winner?.summary || call.ai_summary
  const actionItems: string[] = winner?.action_items || (call.action_items as string[]) || []
  const callType = winner?.call_type || call.call_type
  const topics: string[] = winner?.topics || []
  const winnerSentiment = winner?.sentiment ?? call.sentiment
  const sent = sentimentChip(winnerSentiment)
  const transcript = winner?.transcript_text || call.transcript
  const WINNING_ENGINE = 'deepgram_claude'

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-bold text-white">
              {displayName || formatPhone(displayNumber)}
            </h2>
            {displayName && <div className="text-sm text-gray-400">{formatPhone(displayNumber)}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
          {status && <span className={`px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>{status.label}</span>}
          <span>{formatDateTime(call.created_at)}</span>
          <span>·</span>
          <span>{formatDuration(call.recording_duration_seconds || call.duration_seconds)}</span>
          {sent && <span className={`px-2 py-0.5 rounded text-xs font-medium ${sent.color}`}>{sent.label}</span>}
          {callType && <span className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-300">{callType}</span>}
        </div>
      </div>

      {/* Call recording audio */}
      {call.recording_storage_path && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recording</div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            controls
            preload="none"
            src={`/api/dialer/calls/${call.id}/recording`}
            className="w-full"
            style={{ colorScheme: 'dark' }}
          />
        </div>
      )}

      {/* Voicemail audio */}
      {call.voicemail?.recording_storage_path && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Voicemail · {formatDuration(call.voicemail.recording_duration_sec)}
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            controls
            preload="none"
            src={`/api/dialer/voicemails/${call.voicemail.id}/audio`}
            className="w-full"
            style={{ colorScheme: 'dark' }}
          />
          {call.voicemail.transcript && (
            <p className="mt-3 text-sm text-gray-300 leading-relaxed">{call.voicemail.transcript}</p>
          )}
        </div>
      )}

      {/* Missed / no-answer — no audio to show */}
      {!call.recording_storage_path && !call.voicemail && (
        ['no-answer', 'busy', 'missed', 'failed', 'canceled'].includes(call.status?.toLowerCase() || '') && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-500">
            {call.status === 'no-answer' || call.status === 'missed'
              ? 'Call was not answered.'
              : call.status === 'busy'
              ? 'Caller received a busy signal.'
              : `Call ${call.status}.`}
          </div>
        )
      )}

      {/* AI Summary */}
      {(summary || actionItems.length > 0 || topics.length > 0) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Summary</div>
          {summary && <p className="text-sm text-gray-300 leading-relaxed">{summary}</p>}
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {topics.map((t, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-300">{t}</span>
              ))}
            </div>
          )}
          {actionItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1.5">Action Items</div>
              <ul className="space-y-1">
                {actionItems.map((item, i) => (
                  <li key={i} className="text-sm text-gray-300 flex gap-2">
                    <span className="text-purple-400 shrink-0">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Coaching */}
      {canViewCoaching && call.coaching_json && (
        <CoachingPanel coaching={call.coaching_json} callId={call.id} source="dialer" review={call.review} />
      )}

      {/* Transcript */}
      {transcript && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <button
            onClick={() => setShowTranscript(v => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
          >
            <span>Transcript</span>
            <span>{showTranscript ? '▲' : '▼'}</span>
          </button>
          {showTranscript && (
            <pre className="mt-3 text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans max-h-96 overflow-y-auto">
              {transcript}
            </pre>
          )}
        </div>
      )}

      {/* Engine compare — collapsed by default, available when multiple engines ran */}
      {call.ai_results.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <button
            onClick={() => setShowEngines(v => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
          >
            <span>Engine Compare · {call.ai_results.length} engine{call.ai_results.length !== 1 ? 's' : ''}</span>
            <span>{showEngines ? '▲' : '▼'}</span>
          </button>
          {showEngines && (
            <div className={`mt-3 grid gap-3 ${call.ai_results.length >= 2 ? 'md:grid-cols-2' : ''}`}>
              {call.ai_results.map(r => (
                <EngineCard key={r.engine} result={r} isWinner={r.engine === WINNING_ENGINE} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transcription pending notice */}
      {call.recording_storage_path && (call.transcription_status === 'pending' || call.transcription_status === 'processing') && !summary && !transcript && (
        <p className="text-xs text-gray-500 italic">Transcription in progress — check back in a minute.</p>
      )}
    </div>
  )
}

function EngineCard({ result, isWinner }: { result: AiResult; isWinner: boolean }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const engineLabel = result.engine === 'deepgram_claude' ? '🔵 Deepgram + Claude' :
    result.engine === 'twilio_vi' ? '🟣 Twilio VI' : result.engine
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isWinner ? 'border-blue-500/40 bg-blue-950/20' : 'border-gray-700 bg-gray-800/30'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-white">{engineLabel}</span>
        {isWinner && <span className="px-1.5 py-0.5 rounded text-xs font-medium text-blue-300 bg-blue-900/50">Winner</span>}
        {result.latency_ms && <span className="text-xs text-gray-500 ml-auto">{(result.latency_ms / 1000).toFixed(1)}s</span>}
      </div>
      {result.summary && <p className="text-xs text-gray-300 leading-relaxed">{result.summary}</p>}
      {result.transcript_text && (
        <button onClick={() => setShowTranscript(v => !v)} className="text-xs text-blue-400 hover:text-blue-300">
          {showTranscript ? 'Hide' : 'Show'} transcript
        </button>
      )}
      {showTranscript && result.transcript_text && (
        <pre className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">{result.transcript_text}</pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CallLog2Page() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Call | null>(null)
  const [showDetail, setShowDetail] = useState(false) // mobile: true = detail visible
  const [canViewCoaching, setCanViewCoaching] = useState(false)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [phone, setPhone] = useState('')

  // companyId (from the API response) keys the realtime channel; filtersRef
  // lets a background refetch reuse whatever filters are currently applied.
  const [companyId, setCompanyId] = useState('')
  const filtersRef = useRef({ dateFrom: '', dateTo: '', phone: '' })

  // silent = background refresh from the realtime broadcast: no loading
  // flash, and the open detail panel stays open (swapped to the fresh row so
  // a just-finished transcript appears in place).
  const fetchCalls = useCallback(async (
    params: { dateFrom: string; dateTo: string; phone: string },
    opts: { silent?: boolean } = {}
  ) => {
    filtersRef.current = params
    if (!opts.silent) {
      setLoading(true)
      setError('')
    }
    try {
      const qs = new URLSearchParams({ limit: '100' })
      if (params.dateFrom) qs.set('date_from', params.dateFrom)
      if (params.dateTo) qs.set('date_to', params.dateTo)
      if (params.phone) qs.set('phone', params.phone)

      const res = await fetch(`/api/dialer/calls/call-log2?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      const list: Call[] = data.calls ?? []
      setCalls(list)
      setCanViewCoaching(!!data.can_view_coaching)
      if (data.company_id) setCompanyId(data.company_id)
      if (opts.silent) {
        setSelected(prev => (prev ? list.find(c => c.id === prev.id) ?? prev : null))
      } else {
        setSelected(null)
      }
    } catch (e: unknown) {
      if (!opts.silent) setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCalls({ dateFrom: '', dateTo: '', phone: '' })
  }, [fetchCalls])

  // Live updates: the transcription pipeline broadcasts `call-updated` on
  // `call-log2:{companyId}` when a transcript finishes — refresh the list in
  // the background instead of waiting for a manual Search. Debounced so a
  // burst of completions triggers one refetch.
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel(`call-log2:${companyId}`)
      .on('broadcast', { event: 'call-updated' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          fetchCalls(filtersRef.current, { silent: true })
        }, 800)
      })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [companyId, fetchCalls])

  function handleSearch() { fetchCalls({ dateFrom, dateTo, phone }) }
  function handleClear() {
    setDateFrom(''); setDateTo(''); setPhone('')
    fetchCalls({ dateFrom: '', dateTo: '', phone: '' })
  }

  const hasFilters = dateFrom || dateTo || phone

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-4 md:px-6 pt-4 pb-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Call Log 2
            <span className="text-xs font-normal text-gray-500 ml-2">Twilio · AI</span>
          </h1>
        </div>
        {/* Mobile back button */}
        {showDetail && (
          <button
            onClick={() => setShowDetail(false)}
            className="md:hidden flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}
      </header>

      {/* Filter bar */}
      <div className="shrink-0 border-b border-gray-800 px-4 py-3 bg-gray-900/50 max-md:pl-14">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Phone</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="e.g. 832…"
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 w-36" />
          </div>
          <button onClick={handleSearch} disabled={loading}
            className="px-4 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-medium rounded-lg text-sm transition-colors">
            {loading ? 'Loading…' : 'Search'}
          </button>
          {hasFilters && (
            <button onClick={handleClear} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm">Clear</button>
          )}
        </div>
      </div>

      {/* Body — two-panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: call list */}
        <div className={`${showDetail ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 border-r border-gray-800 flex-col overflow-hidden`}>
          <div className="shrink-0 px-4 py-2 border-b border-gray-800 text-xs text-gray-500">
            {loading ? 'Loading…' : `${calls.length} call${calls.length !== 1 ? 's' : ''}`}
          </div>
          <div className="flex-1 overflow-y-auto">
            {error && <div className="px-4 py-3 text-sm text-red-400">{error}</div>}
            {!loading && !error && calls.length === 0 && (
              <div className="px-4 py-8 text-sm text-gray-500 text-center">No calls found</div>
            )}
            {calls.map(call => (
              <CallRow
                key={call.id}
                call={call}
                selected={selected?.id === call.id}
                onClick={() => { setSelected(call); setShowDetail(true) }}
                canViewCoaching={canViewCoaching}
              />
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className={`${showDetail ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto`}>
          {selected ? (
            <CallDetail call={selected} canViewCoaching={canViewCoaching} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Select a call to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
