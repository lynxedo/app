'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDurationSec, formatPhone } from '@/lib/format'
import { CoachingPanel, coachingGradeColor, COACHING_CATEGORIES, type CoachingData, type CoachingReview } from '@/components/hub/CoachingPanel'
import AddToTrackerModal from '@/components/hub/tracker/AddToTrackerModal'
import { useBetaFlag } from '@/components/hub/BetaFlagsContext'

// ---------------------------------------------------------------------------
// Unified Call Log — merges TWO data sources into one interleaved, source-tagged
// list:
//   • 'dialer' — live Twilio dialer calls (calls + call_ai_results), via
//     GET /api/dialer/calls/call-log2. This is the live set.
//   • 'unitel' — the frozen legacy Unitel recordings (call_logs), via
//     GET /api/calls/list. No new rows after ~late June 2026.
// The two sources' detail views are brought in verbatim (only renamed) rather
// than rewritten, so nothing regresses. The list sorts by parsed timestamp
// descending: calls.created_at (real UTC) for dialer, call_logs.call_datetime
// (naive Central mislabeled +00 — a known legacy hack, NOT corrected here) for
// unitel. Each source keeps its ORIGINAL date-display formatter.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Source row types
// ---------------------------------------------------------------------------

interface UnitelCall {
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
  avg_confidence: number | null
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

type DialerCall = {
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
  agent_name: string | null
  coaching_grade: string | null
  coaching_must_listen: boolean | null
  coaching_json: CoachingData | null
  review: CoachingReview | null
  contact: { id: string; name: string; phone: string } | null
  ai_results: AiResult[]
  voicemail: Voicemail | null
}

// Normalized list row. Carries the fields the unified row + filters need, plus
// the ORIGINAL source object under `raw` so the detail view renders every
// source-specific field with no data loss.
type MergedCall = {
  source: 'dialer' | 'unitel'
  id: string
  sortTs: number
  dateDisplay: string
  direction: string
  phone: string | null
  displayName: string | null
  repName: string | null
  durationSec: number | null
  sentiment: string | null
  status: { label: string; color: string } | null
  coachingGrade: string | null
  coachingMustListen: boolean | null
  coachingJson: CoachingData | null
  review: CoachingReview | null
  raw: UnitelCall | DialerCall
}

// ---------------------------------------------------------------------------
// Helpers (each source keeps its own date formatter — they intentionally differ)
// ---------------------------------------------------------------------------

// Unitel: call_datetime is stored in Supabase as Texas local time labeled with
// +00:00. Parse the naive parts and format directly — don't TZ-convert.
function formatDateTimeUnitel(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return iso
  const [, year, month, day, hour, minute] = m
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const h = parseInt(hour, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year} ${h12}:${minute} ${period}`
}

// Dialer: created_at is real UTC — render in Central.
function formatDateTimeDialer(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Chicago',
  })
}

function parseTs(iso: string | null | undefined) {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

// Superset direction labels (unitel adds 'forwarded'; dialer only ever sends
// inbound/outbound, so this one covers both).
function directionLabel(dir: string) {
  if (dir === 'inbound') return { label: 'In', color: 'text-blue-400 bg-blue-900/30' }
  if (dir === 'outbound') return { label: 'Out', color: 'text-orange-400 bg-orange-900/30' }
  if (dir === 'forwarded') return { label: 'Fwd', color: 'text-purple-400 bg-purple-900/30' }
  return { label: dir || '?', color: 'text-gray-400 bg-gray-800' }
}

// Dialer-only status chip (voicemail / missed / recorded …).
function statusLabel(call: DialerCall) {
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
  if (s === 'neutral') return { label: '😐 Neutral', color: 'text-gray-300 bg-gray-800' }
  return { label: sentiment, color: 'text-gray-300 bg-gray-800' }
}

// Unitel: left-border accent color for a sentiment segment.
function sentimentBorder(sentiment: string | undefined) {
  const s = (sentiment || '').toLowerCase()
  if (s === 'positive') return 'border-green-500'
  if (s === 'negative') return 'border-red-500'
  return 'border-gray-600'
}

// Unitel: merge consecutive same-speaker segments into one paragraph.
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

// Dialer: renders a [Speaker N]-labeled transcript as alternating rows.
function TranscriptView({ text }: { text: string }) {
  const parsed = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const m = /^\[Speaker (\d+)\]\s*(.*)$/.exec(line)
      return m ? { speaker: parseInt(m[1], 10), text: m[2] } : { speaker: null as number | null, text: line }
    })
  const hasSpeakers = parsed.some(p => p.speaker != null)
  if (!hasSpeakers) {
    return (
      <pre className="mt-3 text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans max-h-96 overflow-y-auto">{text}</pre>
    )
  }
  const accent = (sp: number | null) =>
    sp == null ? 'border-gray-700' : sp % 2 === 1 ? 'border-purple-500/50' : 'border-blue-500/50'
  return (
    <div className="mt-3 space-y-2 max-h-96 overflow-y-auto pr-1">
      {parsed.map((p, i) => (
        <div key={i} className={`border-l-2 pl-3 ${accent(p.speaker)}`}>
          {p.speaker != null && (
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Speaker {p.speaker}</div>
          )}
          <div className="text-xs text-gray-300 leading-relaxed">{p.text}</div>
        </div>
      ))}
    </div>
  )
}

// Small source tag shown on every list row.
function SourcePill({ source }: { source: 'dialer' | 'unitel' }) {
  return source === 'dialer' ? (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-sky-300 bg-sky-900/30 border border-sky-800/40">Dialer</span>
  ) : (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-400 bg-gray-800 border border-gray-700">Unitel</span>
  )
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeUnitel(c: UnitelCall): MergedCall {
  return {
    source: 'unitel',
    id: c.id,
    sortTs: parseTs(c.call_datetime),
    dateDisplay: formatDateTimeUnitel(c.call_datetime),
    direction: c.direction,
    phone: c.phone ?? null,
    displayName: c.customer_name || null,
    repName: c.rep_name || null,
    durationSec: c.duration_seconds ?? null,
    sentiment: c.sentiment ?? null,
    status: null,
    coachingGrade: c.coaching_grade ?? null,
    coachingMustListen: c.coaching_must_listen ?? null,
    coachingJson: c.coaching_json ?? null,
    review: c.review ?? null,
    raw: c,
  }
}

function normalizeDialer(c: DialerCall): MergedCall {
  const winnerSentiment = c.ai_results.find(r => r.engine === 'deepgram_claude')?.sentiment ?? c.sentiment
  const displayNumber = c.direction === 'inbound' ? c.from_number : c.to_number
  return {
    source: 'dialer',
    id: c.id,
    sortTs: parseTs(c.created_at),
    dateDisplay: formatDateTimeDialer(c.created_at),
    direction: c.direction,
    phone: displayNumber ?? null,
    displayName: c.contact?.name || null,
    repName: c.agent_name || null,
    durationSec: c.recording_duration_seconds || c.duration_seconds || null,
    sentiment: winnerSentiment ?? null,
    status: statusLabel(c),
    coachingGrade: c.coaching_grade ?? null,
    coachingMustListen: c.coaching_must_listen ?? null,
    coachingJson: c.coaching_json ?? null,
    review: c.review ?? null,
    raw: c,
  }
}

// ---------------------------------------------------------------------------
// Unified list row
// ---------------------------------------------------------------------------

function CallRow({ call, selected, onClick, canViewCoaching }: { call: MergedCall; selected: boolean; onClick: () => void; canViewCoaching: boolean }) {
  const dir = directionLabel(call.direction)
  const sent = sentimentChip(call.sentiment)
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors ${selected ? 'bg-gray-800 border-l-2 border-l-purple-500' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-sm font-medium text-white truncate">
          {call.displayName || formatPhone(call.phone) || '—'}
        </span>
        <SourcePill source={call.source} />
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
        {call.displayName && <span className="truncate">{formatPhone(call.phone) || '—'}</span>}
        <span>·</span>
        <span>{call.durationSec && call.durationSec > 0 ? formatDurationSec(call.durationSec) : '—'}</span>
        {call.status && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${call.status.color}`}>{call.status.label}</span>}
        {sent && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${sent.color}`}>{sent.label}</span>}
        {canViewCoaching && call.coachingGrade && (
          <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${coachingGradeColor(call.coachingGrade)}`}>{call.coachingGrade}</span>
        )}
        {call.repName && <span className="text-gray-600">· {call.repName}</span>}
      </div>
      <div className="text-xs text-gray-600 mt-0.5">{call.dateDisplay}</div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Unitel detail (verbatim from the old Call Log page's CallDetail)
// ---------------------------------------------------------------------------

function UnitelCallDetail({ call, canViewCoaching }: { call: UnitelCall; canViewCoaching: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const dir = directionLabel(call.direction)
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [trackerLeadId, setTrackerLeadId] = useState<string | null>(null)
  const canAddToTracker = useBetaFlag('add_to_lead_tracker')
  const dirWord = call.direction === 'inbound' ? 'Inbound' : call.direction === 'outbound' ? 'Outbound' : 'Phone'
  const leadNote = [
    `${dirWord} phone call · ${formatDateTimeUnitel(call.call_datetime)}.`,
    call.customer_summary ? `\n\n${call.customer_summary}` : '',
    call.action_items?.length ? `\n\nAction items:\n${call.action_items.map((a) => `- ${a}`).join('\n')}` : '',
  ].join('')

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-bold text-white">
              {call.customer_name || formatPhone(call.phone) || '—'}
            </h2>
            {call.customer_name && (
              <div className="text-sm text-gray-400">{formatPhone(call.phone) || '—'}</div>
            )}
          </div>
          {canAddToTracker && (trackerLeadId ? (
            <a href="/hub/tracker" title="View in the Lead Tracker" className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 whitespace-nowrap">✓ In tracker</a>
          ) : (
            <button onClick={() => setTrackerOpen(true)} title="Add this caller to the Lead Tracker" className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-white/10 text-gray-200 hover:bg-white/20 whitespace-nowrap">+ Add to Lead Tracker</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
          <span>{formatDateTimeUnitel(call.call_datetime)}</span>
          <span>·</span>
          <span>{call.duration_seconds && call.duration_seconds > 0 ? formatDurationSec(call.duration_seconds) : '—'}</span>
          {call.rep_name && <><span>·</span><span>{call.rep_name}</span></>}
          {sentimentChip(call.sentiment) && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${sentimentChip(call.sentiment)!.color}`}>
              {sentimentChip(call.sentiment)!.label}
            </span>
          )}
        </div>
      </div>

      {trackerOpen && (
        <AddToTrackerModal
          sourceType="call"
          sourceId={call.id}
          prefill={{ name: call.customer_name || undefined, phone: call.phone, note: leadNote }}
          onClose={() => setTrackerOpen(false)}
          onLinked={(id) => { setTrackerLeadId(id); setTrackerOpen(false) }}
        />
      )}

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

      {/* Sentiment by section */}
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

// ---------------------------------------------------------------------------
// Dialer detail (verbatim from the old Call Log 2 page's CallDetail)
// ---------------------------------------------------------------------------

function DialerCallDetail({ call, canViewCoaching }: { call: DialerCall; canViewCoaching: boolean }) {
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
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [trackerLeadId, setTrackerLeadId] = useState<string | null>(null)
  const canAddToTracker = useBetaFlag('add_to_lead_tracker')
  const dirWord = call.direction === 'inbound' ? 'Inbound' : call.direction === 'outbound' ? 'Outbound' : 'Phone'
  const leadNote = [
    `${dirWord} phone call · ${formatDateTimeDialer(call.created_at)}.`,
    summary ? `\n\n${summary}` : '',
    actionItems.length ? `\n\nAction items:\n${actionItems.map((a) => `- ${a}`).join('\n')}` : '',
  ].join('')

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-bold text-white">
              {displayName || formatPhone(displayNumber) || '—'}
            </h2>
            {displayName && <div className="text-sm text-gray-400">{formatPhone(displayNumber) || '—'}</div>}
          </div>
          {canAddToTracker && (trackerLeadId ? (
            <a href="/hub/tracker" title="View in the Lead Tracker" className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 whitespace-nowrap">✓ In tracker</a>
          ) : (
            <button onClick={() => setTrackerOpen(true)} title="Add this caller to the Lead Tracker" className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-white/10 text-gray-200 hover:bg-white/20 whitespace-nowrap">+ Add to Lead Tracker</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${dir.color}`}>{dir.label}</span>
          {status && <span className={`px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>{status.label}</span>}
          <span>{formatDateTimeDialer(call.created_at)}</span>
          <span>·</span>
          <span>{(() => { const d = call.recording_duration_seconds || call.duration_seconds; return d && d > 0 ? formatDurationSec(d) : '—' })()}</span>
          {sent && <span className={`px-2 py-0.5 rounded text-xs font-medium ${sent.color}`}>{sent.label}</span>}
          {callType && <span className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-300">{callType}</span>}
          {call.agent_name && <span className="text-gray-400">· {call.agent_name}</span>}
        </div>
      </div>

      {trackerOpen && (
        <AddToTrackerModal
          sourceType="call"
          sourceId={call.id}
          prefill={{ name: displayName || undefined, phone: displayNumber, note: leadNote }}
          onClose={() => setTrackerOpen(false)}
          onLinked={(id) => { setTrackerLeadId(id); setTrackerOpen(false) }}
        />
      )}

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
            Voicemail · {call.voicemail.recording_duration_sec && call.voicemail.recording_duration_sec > 0 ? formatDurationSec(call.voicemail.recording_duration_sec) : '—'}
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
          {showTranscript && <TranscriptView text={transcript} />}
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

      {winner?.avg_confidence != null && (
        <div className="text-xs text-gray-600 text-right">Transcript confidence: {Math.round(winner.avg_confidence * 100)}%</div>
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
        <TranscriptView text={result.transcript_text} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fetch helper — per-source so a 403 on one source doesn't kill the other.
// ---------------------------------------------------------------------------

type ListResponse = {
  calls?: unknown[]
  can_view_coaching?: boolean
  company_id?: string
  error?: string
}

async function fetchSource(url: string): Promise<{ data: ListResponse | null; forbidden: boolean; error: string | null }> {
  try {
    const res = await fetch(url)
    if (res.status === 403) return { data: null, forbidden: true, error: null }
    const data = (await res.json()) as ListResponse
    if (!res.ok) return { data: null, forbidden: false, error: data.error || 'Failed to load' }
    return { data, forbidden: false, error: null }
  } catch (e) {
    return { data: null, forbidden: false, error: e instanceof Error ? e.message : 'Failed to load' }
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CallLogPage() {
  const [calls, setCalls] = useState<MergedCall[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [noAccess, setNoAccess] = useState(false)
  const [selected, setSelected] = useState<MergedCall | null>(null)
  const [showDetail, setShowDetail] = useState(false) // mobile: true = detail visible
  const [canViewCoaching, setCanViewCoaching] = useState(false)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [phone, setPhone] = useState('')
  const [keyword, setKeyword] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [reviewFilter, setReviewFilter] = useState('') // '' | 'unreviewed' | 'reviewed'

  // companyId (from the dialer response) keys the realtime channel; filtersRef
  // lets a background refetch reuse whatever filters are currently applied.
  const [companyId, setCompanyId] = useState('')
  const filtersRef = useRef({ dateFrom: '', dateTo: '', phone: '', keyword: '' })

  // silent = background refresh from the realtime broadcast: no loading flash,
  // and the open detail panel stays open (swapped to the fresh row so a
  // just-finished transcript appears in place).
  const fetchCalls = useCallback(async (
    params: { dateFrom: string; dateTo: string; phone: string; keyword: string },
    opts: { silent?: boolean } = {}
  ) => {
    filtersRef.current = params
    if (!opts.silent) {
      setLoading(true)
      setError('')
    }
    try {
      const uQs = new URLSearchParams({ limit: '200' })
      const dQs = new URLSearchParams({ limit: '200' })
      for (const qs of [uQs, dQs]) {
        if (params.dateFrom) qs.set('date_from', params.dateFrom)
        if (params.dateTo) qs.set('date_to', params.dateTo)
        if (params.phone) qs.set('phone', params.phone)
        if (params.keyword) qs.set('keyword', params.keyword)
      }

      const [uResult, dResult] = await Promise.all([
        fetchSource(`/api/calls/list?${uQs}`),
        fetchSource(`/api/dialer/calls/call-log2?${dQs}`),
      ])

      const unitelRows = (uResult.data?.calls ?? []) as UnitelCall[]
      const dialerRows = (dResult.data?.calls ?? []) as DialerCall[]
      const merged: MergedCall[] = [
        ...unitelRows.map(normalizeUnitel),
        ...dialerRows.map(normalizeDialer),
      ].sort((a, b) => b.sortTs - a.sortTs)

      setCalls(merged)
      setCanViewCoaching(!!uResult.data?.can_view_coaching || !!dResult.data?.can_view_coaching)
      if (dResult.data?.company_id) setCompanyId(dResult.data.company_id)
      setNoAccess(uResult.forbidden && dResult.forbidden)

      if (opts.silent) {
        setSelected(prev => (prev ? merged.find(c => c.source === prev.source && c.id === prev.id) ?? prev : null))
      } else {
        setSelected(null)
      }

      // Only surface an error if BOTH sources failed for a non-permission reason.
      if (!opts.silent && uResult.error && dResult.error) {
        setError(uResult.error || dResult.error || 'Failed to load')
      }
    } catch (e: unknown) {
      if (!opts.silent) setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCalls({ dateFrom: '', dateTo: '', phone: '', keyword: '' })
  }, [fetchCalls])

  // Live updates: the dialer transcription pipeline broadcasts `call-updated` on
  // `call-log2:{companyId}` when a transcript finishes — refresh the list in the
  // background instead of waiting for a manual Search. Debounced. (Unitel is
  // frozen, so no realtime is needed for it.)
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

  function handleSearch() { fetchCalls({ dateFrom, dateTo, phone, keyword }) }
  function handleClear() {
    setDateFrom(''); setDateTo(''); setPhone(''); setKeyword('')
    setGradeFilter(''); setRepFilter(''); setCatFilter(''); setReviewFilter('')
    fetchCalls({ dateFrom: '', dateTo: '', phone: '', keyword: '' })
  }

  const hasFilters = dateFrom || dateTo || phone || keyword || gradeFilter || repFilter || catFilter || reviewFilter

  // Client-side narrowing on the loaded list (grade + rep + weak category +
  // not-reviewed); keyword/date/phone are server-side.
  const repOptions = Array.from(new Set(calls.map(c => c.repName).filter((v): v is string => !!v))).sort()
  const filteredCalls = calls.filter(c => {
    if (gradeFilter && (c.coachingGrade || '') !== gradeFilter) return false
    if (repFilter && (c.repName || '') !== repFilter) return false
    if (catFilter && (c.coachingJson?.categories?.[catFilter]?.score || '').toLowerCase() !== 'needs work') return false
    // Review filter — reviews are private per viewer, so "reviewed" = I marked it reviewed.
    if (reviewFilter === 'unreviewed' && c.review?.acknowledged === true) return false
    if (reviewFilter === 'reviewed' && c.review?.acknowledged !== true) return false
    return true
  })

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-4 md:px-6 pt-4 pb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Call Log</h1>
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Keyword</label>
            <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="in transcript…"
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 w-36" />
          </div>
          {canViewCoaching && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Score</label>
              <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500">
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
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500">
                <option value="">All</option>
                {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          {canViewCoaching && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Weak in</label>
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500">
                <option value="">Any category</option>
                {COACHING_CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
          )}
          {canViewCoaching && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Review</label>
              <select value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500">
                <option value="">All</option>
                <option value="unreviewed">Not reviewed</option>
                <option value="reviewed">Reviewed</option>
              </select>
            </div>
          )}
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
            {loading ? 'Loading…' : `${filteredCalls.length} call${filteredCalls.length !== 1 ? 's' : ''}`}
          </div>
          <div className="flex-1 overflow-y-auto">
            {error && <div className="px-4 py-3 text-sm text-red-400">{error}</div>}
            {!loading && !error && noAccess && (
              <div className="px-4 py-8 text-sm text-gray-500 text-center">You don&apos;t have access to the call log.</div>
            )}
            {!loading && !error && !noAccess && filteredCalls.length === 0 && (
              <div className="px-4 py-8 text-sm text-gray-500 text-center">No calls found</div>
            )}
            {filteredCalls.map(call => (
              <CallRow
                key={`${call.source}:${call.id}`}
                call={call}
                selected={selected?.source === call.source && selected?.id === call.id}
                onClick={() => { setSelected(call); setShowDetail(true) }}
                canViewCoaching={canViewCoaching}
              />
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className={`${showDetail ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto`}>
          {selected ? (
            // key={`${source}:${id}`} forces a remount when the selected call
            // changes, so CoachingPanel re-seeds its Notes / override-grade /
            // reviewed state from the new call's props instead of leaking the
            // previous call's review (its state is useState-initialized once).
            selected.source === 'dialer' ? (
              <DialerCallDetail key={`dialer:${selected.id}`} call={selected.raw as DialerCall} canViewCoaching={canViewCoaching} />
            ) : (
              <UnitelCallDetail key={`unitel:${selected.id}`} call={selected.raw as UnitelCall} canViewCoaching={canViewCoaching} />
            )
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
