'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { CoachingPanel, coachingGradeColor, type CoachingData, type CoachingReview } from '@/components/hub/CoachingPanel'

interface CallLog {
  id: string
  recording_id: string
  filename: string
  call_datetime: string
  date: string
  direction: string
  phone: string
  duration_seconds: number | null
  rep_name: string | null
  customer_name: string | null
  call_type: string | null
  call_subject: string | null
  customer_summary: string | null
  action_items: string[] | null
  avg_confidence: number | null
  transcript_text: string | null
  sentiment: string | null
  sentiment_json: {
    average?: { sentiment: string; sentiment_score: number }
    segments?: { text: string; sentiment: string; sentiment_score: number }[]
  } | null
  transcript_speakers: { speaker: string; text: string }[] | null
  coaching_grade?: string | null
  coaching_must_listen?: boolean | null
  coaching_json?: CoachingData | null
  review?: CoachingReview | null
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// call_datetime is stored in Supabase as Texas local time labeled with +00:00.
// Parse the naive parts and format directly — don't let the browser TZ-convert.
function formatDateTime(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return iso
  const [, year, month, day, hour, minute] = m
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const h = parseInt(hour, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year} ${h12}:${minute} ${period}`
}

function formatPhone(phone: string) {
  if (!phone || phone === 'PRIVATE') return phone || '—'
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

function directionLabel(dir: string) {
  if (dir === 'inbound') return { label: 'In', color: 'text-blue-400 bg-blue-900/30' }
  if (dir === 'outbound') return { label: 'Out', color: 'text-orange-400 bg-orange-900/30' }
  if (dir === 'forwarded') return { label: 'Fwd', color: 'text-purple-400 bg-purple-900/30' }
  return { label: dir || '?', color: 'text-gray-400 bg-gray-800' }
}

// Deepgram sentiment → label + chip color. Null until a call is transcribed
// with the Audio Intelligence flags (new calls going forward).
function sentimentChip(sentiment: string | null) {
  if (!sentiment) return null
  const s = sentiment.toLowerCase()
  if (s === 'positive') return { label: '🙂 Positive', color: 'text-green-400 bg-green-900/30' }
  if (s === 'negative') return { label: '🙁 Negative', color: 'text-red-400 bg-red-900/30' }
  if (s === 'neutral') return { label: '😐 Neutral', color: 'text-gray-300 bg-gray-800' }
  return { label: sentiment, color: 'text-gray-300 bg-gray-800' }
}

// Left-border accent color for a sentiment segment.
function sentimentBorder(sentiment: string | undefined) {
  const s = (sentiment || '').toLowerCase()
  if (s === 'positive') return 'border-green-500'
  if (s === 'negative') return 'border-red-500'
  return 'border-gray-600'
}

// Merge consecutive same-speaker segments into one paragraph. Deepgram stores
// one utterance per pause, so a single speaking turn arrives as many segments —
// this collapses runs of the same speaker for display. Applied at render so it
// also fixes older calls whose stored segments predate the script-side merge.
function mergeSpeakers(
  segments: { speaker: string; text: string }[]
): { speaker: string; text: string }[] {
  const out: { speaker: string; text: string }[] = []
  for (const s of segments) {
    const last = out[out.length - 1]
    if (last && last.speaker === s.speaker) {
      last.text = `${last.text} ${s.text}`.trim()
    } else {
      out.push({ speaker: s.speaker, text: s.text })
    }
  }
  return out
}


function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function CallRow({ call, selected, onClick, canViewCoaching }: { call: CallLog; selected: boolean; onClick: () => void; canViewCoaching: boolean }) {
  const dir = directionLabel(call.direction)
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors ${selected ? 'bg-gray-800 border-l-2 border-l-purple-500' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-sm font-medium text-white truncate">
          {call.customer_name || formatPhone(call.phone)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
        <span>{formatPhone(call.phone)}</span>
        <span>·</span>
        <span>{formatDuration(call.duration_seconds)}</span>
        {sentimentChip(call.sentiment) && (
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${sentimentChip(call.sentiment)!.color}`}>
            {sentimentChip(call.sentiment)!.label}
          </span>
        )}
        {canViewCoaching && call.coaching_grade && (
          <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${coachingGradeColor(call.coaching_grade)}`}>{call.coaching_grade}</span>
        )}
      </div>
      <div className="text-xs text-gray-600 mt-0.5">
        {formatDateTime(call.call_datetime)}
      </div>
    </button>
  )
}

function CallDetail({ call, canViewCoaching }: { call: CallLog; canViewCoaching: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const dir = directionLabel(call.direction)

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-bold text-white">
              {call.customer_name || formatPhone(call.phone)}
            </h2>
            {call.customer_name && (
              <div className="text-sm text-gray-400">{formatPhone(call.phone)}</div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
          <span>{formatDateTime(call.call_datetime)}</span>
          <span>·</span>
          <span>{formatDuration(call.duration_seconds)}</span>
          {call.rep_name && <><span>·</span><span>{call.rep_name}</span></>}
          {sentimentChip(call.sentiment) && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${sentimentChip(call.sentiment)!.color}`}>
              {sentimentChip(call.sentiment)!.label}
            </span>
          )}
        </div>
      </div>

      {/* Audio player */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recording</div>
        <audio
          ref={audioRef}
          controls
          preload="none"
          src={`/api/calls/audio?filename=${encodeURIComponent(call.filename)}`}
          className="w-full"
          style={{ colorScheme: 'dark' }}
        />
      </div>

      {/* AI Summary */}
      {(call.customer_summary || call.call_type) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Summary</div>

          <div className="flex flex-wrap gap-2">
            {call.call_type && (
              <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-300">{call.call_type}</span>
            )}
            {call.call_subject && (
              <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-300">{call.call_subject}</span>
            )}
          </div>

          {call.customer_summary && (
            <p className="text-sm text-gray-300 leading-relaxed">{call.customer_summary}</p>
          )}

          {call.action_items && call.action_items.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1.5">Action Items</div>
              <ul className="space-y-1">
                {call.action_items.map((item, i) => (
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
        <CoachingPanel coaching={call.coaching_json} callId={call.id} source="unitel" review={call.review} />
      )}

      {/* Transcript — speaker-sectioned when diarization is available,
          otherwise the raw single block (older calls / no speaker data). */}
      {((call.transcript_speakers && call.transcript_speakers.length > 0) || call.transcript_text) && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <button
            onClick={() => setShowTranscript(v => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
          >
            <span>Transcript</span>
            <span>{showTranscript ? '▲' : '▼'}</span>
          </button>
          {showTranscript && (
            call.transcript_speakers && call.transcript_speakers.length > 0 ? (
              <div className="mt-3 space-y-3">
                {mergeSpeakers(call.transcript_speakers).map((seg, i) => (
                  <div key={i}>
                    <div className="text-xs font-semibold text-purple-300 mb-0.5">{seg.speaker}</div>
                    <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{seg.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="mt-3 text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                {call.transcript_text}
              </pre>
            )
          )}
        </div>
      )}

      {/* Sentiment by section — Deepgram scores the call in parts (its own word
          ranges, independent of speaker turns), so you can see where the tone
          shifts. New calls only (older calls predate the sentiment flags). */}
      {call.sentiment_json?.segments && call.sentiment_json.segments.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sentiment by section</div>
            {sentimentChip(call.sentiment) && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${sentimentChip(call.sentiment)!.color}`}>
                Overall: {sentimentChip(call.sentiment)!.label}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {call.sentiment_json.segments.map((seg, i) => (
              <div key={i} className={`border-l-2 pl-3 ${sentimentBorder(seg.sentiment)}`}>
                <p className="text-sm text-gray-300 leading-relaxed">{seg.text}</p>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">{seg.sentiment}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confidence */}
      {call.avg_confidence != null && (
        <div className="text-xs text-gray-600 text-right">
          Transcript confidence: {Math.round(call.avg_confidence * 100)}%
        </div>
      )}
    </div>
  )
}

export default function CallLogPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<CallLog | null>(null)
  const [canViewCoaching, setCanViewCoaching] = useState(false)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')

  const fetchCalls = useCallback(async (params: {
    dateFrom: string; dateTo: string; phone: string; name: string; keyword: string
  }) => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (params.dateFrom) qs.set('date_from', params.dateFrom)
      if (params.dateTo) qs.set('date_to', params.dateTo)
      if (params.phone) qs.set('phone', params.phone)
      if (params.name) qs.set('name', params.name)
      if (params.keyword) qs.set('keyword', params.keyword)
      qs.set('limit', '100')

      const res = await fetch(`/api/calls/list?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setCalls(data.calls ?? [])
      setCanViewCoaching(!!data.can_view_coaching)
      setSelected(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load recent calls on mount
  useEffect(() => {
    fetchCalls({ dateFrom: '', dateTo: '', phone: '', name: '', keyword: '' })
  }, [fetchCalls])

  function handleSearch() {
    fetchCalls({ dateFrom, dateTo, phone, name, keyword })
  }

  function handleClear() {
    setDateFrom('')
    setDateTo('')
    setPhone('')
    setName('')
    setKeyword('')
    setGradeFilter('')
    setRepFilter('')
    fetchCalls({ dateFrom: '', dateTo: '', phone: '', name: '', keyword: '' })
  }

  const hasFilters = dateFrom || dateTo || phone || name || keyword || gradeFilter || repFilter

  // Client-side narrowing on the loaded list (grade + rep); the rest is server-side.
  const repOptions = Array.from(new Set(calls.map(c => c.rep_name).filter((v): v is string => !!v))).sort()
  const filteredCalls = calls.filter(c => {
    if (gradeFilter && (c.coaching_grade || '') !== gradeFilter) return false
    if (repFilter && (c.rep_name || '') !== repFilter) return false
    return true
  })

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-4 md:px-6 pt-4 pb-2">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Call Log</h1>
      </header>

      {/* Filter bar */}
      <div className="shrink-0 border-b border-gray-800 px-4 py-3 bg-gray-900/50 max-md:pl-14">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. 8323..."
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors w-36"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Customer or rep"
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. aeration"
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors w-36"
            />
          </div>
          {canViewCoaching && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Score</label>
              <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors">
                <option value="">All</option>
                <option value="A">A</option><option value="B">B</option><option value="C">C</option>
                <option value="D">D</option><option value="F">F</option><option value="N/A">N/A</option>
              </select>
            </div>
          )}
          {repOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Rep</label>
              <select value={repFilter} onChange={e => setRepFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors">
                <option value="">All</option>
                {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {loading ? 'Loading…' : 'Search'}
          </button>
          {hasFilters && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-gray-400 hover:text-white text-sm transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Call list */}
        <div className="w-80 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 py-2 border-b border-gray-800 text-xs text-gray-500">
            {loading ? 'Loading…' : `${filteredCalls.length} call${filteredCalls.length !== 1 ? 's' : ''}`}
          </div>

          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="px-4 py-3 text-sm text-red-400">{error}</div>
            )}
            {!loading && !error && filteredCalls.length === 0 && (
              <div className="px-4 py-8 text-sm text-gray-500 text-center">No calls found</div>
            )}
            {filteredCalls.map(call => (
              <CallRow
                key={call.id}
                call={call}
                selected={selected?.id === call.id}
                onClick={() => setSelected(call)}
                canViewCoaching={canViewCoaching}
              />
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto">
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
