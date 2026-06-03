'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
  transcription_status: string | null
  transcript: string | null
  ai_summary: string | null
  sentiment: string | null
  call_type: string | null
  action_items: unknown
  contact: { id: string; name: string; phone: string } | null
  ai_results: AiResult[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null) {
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

function formatPhone(phone: string) {
  if (!phone) return '—'
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

function directionChip(dir: string) {
  if (dir === 'inbound') return <span className="px-1.5 py-0.5 rounded text-xs font-medium text-blue-300 bg-blue-900/40">↙ In</span>
  if (dir === 'outbound') return <span className="px-1.5 py-0.5 rounded text-xs font-medium text-orange-300 bg-orange-900/40">↗ Out</span>
  return <span className="px-1.5 py-0.5 rounded text-xs text-gray-400 bg-gray-800">{dir}</span>
}

function transcriptionChip(status: string | null) {
  if (!status || status === 'none') return null
  if (status === 'complete') return <span className="px-1.5 py-0.5 rounded text-xs font-medium text-green-300 bg-green-900/40">✓ Transcribed</span>
  if (status === 'pending') return <span className="px-1.5 py-0.5 rounded text-xs text-yellow-300 bg-yellow-900/30">⏳ Pending</span>
  if (status === 'processing') return <span className="px-1.5 py-0.5 rounded text-xs text-blue-300 bg-blue-900/30">⚙ Processing</span>
  if (status === 'error') return <span className="px-1.5 py-0.5 rounded text-xs text-red-300 bg-red-900/30">✗ Error</span>
  return <span className="px-1.5 py-0.5 rounded text-xs text-gray-300 bg-gray-800">{status}</span>
}

function sentimentChip(sentiment: string | null) {
  if (!sentiment) return null
  const s = sentiment.toLowerCase()
  if (s === 'positive') return <span className="px-1.5 py-0.5 rounded text-xs font-medium text-green-300 bg-green-900/30">🙂 Positive</span>
  if (s === 'negative') return <span className="px-1.5 py-0.5 rounded text-xs font-medium text-red-300 bg-red-900/30">🙁 Negative</span>
  if (s === 'neutral') return <span className="px-1.5 py-0.5 rounded text-xs text-gray-300 bg-gray-800">😐 Neutral</span>
  return <span className="px-1.5 py-0.5 rounded text-xs text-gray-300 bg-gray-800">{sentiment}</span>
}

function jsonDisplay(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val || '—'
  try { return JSON.stringify(val, null, 2) } catch { return String(val) }
}

// ---------------------------------------------------------------------------
// Audio player
// ---------------------------------------------------------------------------

function AudioPlayer({ callId }: { callId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const load = useCallback(async () => {
    if (src) { audioRef.current?.play(); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dialer/calls/${callId}/recording`, { redirect: 'follow' })
      if (!res.ok) { setError('Recording unavailable'); return }
      const blob = await res.blob()
      setSrc(URL.createObjectURL(blob))
    } catch {
      setError('Failed to load recording')
    } finally {
      setLoading(false)
    }
  }, [callId, src])

  useEffect(() => {
    if (src && audioRef.current) {
      audioRef.current.play().catch(() => {})
    }
  }, [src])

  if (error) return <p className="text-xs text-red-400">{error}</p>

  if (!src) {
    return (
      <button
        onClick={load}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-sm text-white disabled:opacity-50"
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
        ) : (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        )}
        {loading ? 'Loading…' : 'Play Recording'}
      </button>
    )
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} src={src} controls className="w-full h-10 rounded" />
  )
}

// ---------------------------------------------------------------------------
// Engine result panel
// ---------------------------------------------------------------------------

function EnginePanel({ result, isWinner }: { result: AiResult; isWinner: boolean }) {
  const [showTranscript, setShowTranscript] = useState(false)

  const engineLabel = result.engine === 'deepgram_claude'
    ? '🔵 Deepgram + Claude'
    : result.engine === 'twilio_vi'
    ? '🟣 Twilio Voice Intelligence'
    : result.engine

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${isWinner ? 'border-blue-500/50 bg-blue-950/30' : 'border-gray-700 bg-gray-800/30'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-white">{engineLabel}</span>
        <div className="flex items-center gap-2">
          {isWinner && <span className="px-1.5 py-0.5 rounded text-xs font-medium text-blue-300 bg-blue-900/50">Winner</span>}
          {result.latency_ms && <span className="text-xs text-gray-400">{(result.latency_ms / 1000).toFixed(1)}s</span>}
          {result.error_message && <span className="px-1.5 py-0.5 rounded text-xs text-red-300 bg-red-900/30">Error</span>}
        </div>
      </div>

      {result.error_message && (
        <p className="text-xs text-red-400 font-mono bg-red-950/30 rounded p-2">{result.error_message}</p>
      )}

      {/* Summary */}
      {result.summary && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Summary</p>
          <p className="text-sm text-gray-200 leading-relaxed">{result.summary}</p>
        </div>
      )}

      {/* Sentiment + Call Type */}
      <div className="flex flex-wrap gap-2 items-center">
        {sentimentChip(result.sentiment)}
        {result.call_type && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/40 text-purple-300">{result.call_type}</span>
        )}
      </div>

      {/* Action Items */}
      {result.action_items && result.action_items.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Action Items</p>
          <ul className="space-y-0.5">
            {result.action_items.map((item, i) => (
              <li key={i} className="text-sm text-gray-300 flex gap-2">
                <span className="text-amber-400 flex-shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Topics */}
      {result.topics && result.topics.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Topics</p>
          <div className="flex flex-wrap gap-1">
            {result.topics.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Transcript toggle */}
      {result.transcript_text && (
        <div>
          <button
            onClick={() => setShowTranscript(p => !p)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <svg className={`w-3 h-3 transition-transform ${showTranscript ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {showTranscript ? 'Hide' : 'Show'} transcript
          </button>
          {showTranscript && (
            <pre className="mt-2 text-xs text-gray-300 bg-gray-900/60 rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
              {result.transcript_text}
            </pre>
          )}
        </div>
      )}

      {/* Raw extras for debugging */}
      {!result.summary && !result.transcript_text && !result.error_message && (
        <p className="text-xs text-gray-500 italic">No data yet</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Call row (collapsed + expanded)
// ---------------------------------------------------------------------------

function CallRow({ call }: { call: Call }) {
  const [expanded, setExpanded] = useState(false)

  const from = call.direction === 'inbound' ? call.from_number : call.to_number
  const contactName = call.contact?.name || null
  const WINNING_ENGINE = 'deepgram_claude'
  const winnerResult = call.ai_results.find(r => r.engine === WINNING_ENGINE)

  return (
    <div className="border-b border-gray-800 last:border-0">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full text-left px-4 py-3 hover:bg-white/[0.02] flex items-center gap-3 flex-wrap"
      >
        <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(call.created_at)}</span>
          {directionChip(call.direction)}
          <span className="text-sm text-white font-medium">
            {contactName ? `${contactName} (${formatPhone(from)})` : formatPhone(from)}
          </span>
          <span className="text-xs text-gray-500">{formatDuration(call.recording_duration_seconds || call.duration_seconds)}</span>
          {transcriptionChip(call.transcription_status)}
          {sentimentChip(winnerResult?.sentiment ?? call.sentiment)}
          {winnerResult?.call_type && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-purple-900/40 text-purple-300">{winnerResult.call_type}</span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Audio player */}
          {call.recording_duration_seconds && call.recording_duration_seconds > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recording</p>
              <AudioPlayer callId={call.id} />
            </div>
          )}

          {/* Engine compare */}
          {call.ai_results.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Engine Compare ({call.ai_results.length} engine{call.ai_results.length !== 1 ? 's' : ''})
              </p>
              <div className={`grid gap-3 ${call.ai_results.length >= 2 ? 'md:grid-cols-2' : ''}`}>
                {call.ai_results.map(r => (
                  <EnginePanel key={r.engine} result={r} isWinner={r.engine === WINNING_ENGINE} />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic py-2">
              {call.transcription_status === 'pending' || call.transcription_status === 'processing'
                ? 'Transcription in progress — refresh to check.'
                : 'No AI results yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CallLog2Page() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const LIMIT = 50

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dialer/calls/call-log2?limit=${LIMIT}&offset=${p * LIMIT}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error || 'Failed to load calls')
        return
      }
      const data = await res.json()
      const fetched: Call[] = data.calls ?? []
      setCalls(prev => p === 0 ? fetched : [...prev, ...fetched])
      setHasMore(fetched.length === LIMIT)
    } catch {
      setError('Failed to load calls')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(0) }, [load])

  const loadMore = () => {
    const next = page + 1
    setPage(next)
    load(next)
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-950 text-white">
      <header className="flex-shrink-0 px-4 md:px-6 pt-4 pb-3 border-b border-gray-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Call Log 2 <span className="text-xs font-normal text-gray-500 ml-1">Twilio · AI Compare</span></h1>
            <p className="text-xs text-gray-500 mt-0.5">Twilio Dialer calls with AI transcription and engine comparison. Only calls with recordings are shown.</p>
          </div>
          <button
            onClick={() => { setPage(0); load(0) }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-sm text-white disabled:opacity-50 flex-shrink-0"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="m-4 p-3 rounded bg-red-950/50 border border-red-800 text-red-300 text-sm">{error}</div>
        )}

        {!loading && calls.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-500">
            <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
            </svg>
            <p>No recorded calls yet.</p>
            <p className="text-sm mt-1">Enable recording in Admin → Dialer and make a call.</p>
          </div>
        )}

        {calls.length > 0 && (
          <div className="bg-gray-900/40 rounded-lg mx-4 mt-4 mb-2 overflow-hidden divide-y divide-gray-800/0">
            {calls.map(call => (
              <CallRow key={call.id} call={call} />
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-500 gap-2 text-sm">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            Loading…
          </div>
        )}

        {!loading && hasMore && calls.length > 0 && (
          <div className="flex justify-center pb-4">
            <button
              onClick={loadMore}
              className="px-4 py-2 rounded bg-white/10 hover:bg-white/15 text-sm text-white"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
