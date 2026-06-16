'use client'

import { useState } from 'react'

// Unified Inbox (Session 2) — inline call / voicemail markers for the Txt2
// thread. A text is a chat bubble (the visual spine); everything else is a
// quiet centered divider that expands on click. The whole point is to avoid
// clutter: transcripts/summaries stay collapsed until the user asks for them.
//
// iOS-safe: audio plays via an inline <audio> element, NEVER window.open
// (returns null in the Capacitor webview — see memory ios_capacitor_window_open_null).
// The <audio> is only rendered once a marker is expanded, so the signed-URL
// redirect routes are hit lazily, not on thread load.

export type TimelineCallEvent = {
  kind: 'call' | 'voicemail'
  ts: string
  id: string
  direction: string | null
  actor: string | null
  status: string | null // call: 'completed' | 'no-answer' | 'voicemail'
  duration_seconds: number | null
  recording_path: string | null
  transcript: string | null
  summary: string | null
  sentiment: string | null
  voicemail_id: string | null // non-null on a call row => combined missed-call+vm marker
  ai_reply_sent_at: string | null
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (d.toDateString() === new Date().toDateString()) return time
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time
}

function fmtDuration(sec: number | null): string | null {
  if (sec == null || sec < 0) return null
  const m = Math.floor(sec / 60)
  const s = String(Math.floor(sec % 60)).padStart(2, '0')
  return `${m}:${s}`
}

function sentimentTone(sentiment: string | null): { label: string; cls: string } | null {
  if (!sentiment) return null
  const s = sentiment.toLowerCase()
  if (s.includes('pos')) return { label: sentiment, cls: 'bg-emerald-500/15 text-emerald-300' }
  if (s.includes('neg')) return { label: sentiment, cls: 'bg-red-500/15 text-red-300' }
  return { label: sentiment, cls: 'bg-white/10 text-white/60' }
}

// The expandable detail pane shared by both marker types: lazy audio + AI
// summary + sentiment + a transcript that stays collapsed behind its own
// toggle ("transcripts collapsed until clicked").
function MarkerDetails({
  audioSrc,
  summary,
  sentiment,
  transcript,
  aiReplySentAt,
  onJumpToReply,
}: {
  audioSrc: string | null
  summary: string | null
  sentiment: string | null
  transcript: string | null
  aiReplySentAt: string | null
  onJumpToReply?: (ts: string) => void
}) {
  const [showTranscript, setShowTranscript] = useState(false)
  const tone = sentimentTone(sentiment)

  return (
    <div className="mt-1.5 w-full max-w-[85%] mx-auto rounded-lg bg-white/[0.04] border border-white/10 p-2.5 space-y-2 text-left">
      {audioSrc && (
        // preload="none" so opening a marker doesn't pull the signed URL until
        // the user actually presses play.
        <audio controls preload="none" src={audioSrc} className="w-full h-9">
          Your browser does not support audio playback.
        </audio>
      )}

      {aiReplySentAt && (
        <button
          type="button"
          onClick={() => onJumpToReply?.(aiReplySentAt)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-purple-500/15 text-purple-200 text-[10px] hover:bg-purple-500/25"
          title="Guardian auto-replied — tap to jump to that text"
        >
          <span aria-hidden>🛡</span>
          <span>Guardian auto-replied · {fmtTime(aiReplySentAt)}</span>
        </button>
      )}

      {summary && (
        <div className="text-xs text-white/80">
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-0.5">AI summary</div>
          <div className="whitespace-pre-wrap break-words">{summary}</div>
        </div>
      )}

      {tone && (
        <div>
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${tone.cls}`}>
            {tone.label}
          </span>
        </div>
      )}

      {transcript && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-[11px] text-sky-300 hover:text-sky-200"
          >
            {showTranscript ? '▾ Hide transcript' : '▸ Show transcript'}
          </button>
          {showTranscript && (
            <div className="mt-1 text-xs text-white/70 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
              {transcript}
            </div>
          )}
        </div>
      )}

      {!audioSrc && !summary && !transcript && (
        <div className="text-[11px] text-white/40">No recording or transcript.</div>
      )}
    </div>
  )
}

function directionArrow(direction: string | null): string {
  return direction === 'outbound' ? '↗' : '↙'
}

// CallMarker — handles a plain call AND the combined "missed call + voicemail"
// case (when voicemail_id is set). One physical interaction = one marker; we
// never render the call and its linked voicemail as two events.
export function CallMarker({
  event,
  actorName,
  onJumpToReply,
}: {
  event: TimelineCallEvent
  actorName?: string | null
  onJumpToReply?: (ts: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const hasVoicemail = !!event.voicemail_id
  const isOutbound = event.direction === 'outbound'
  const missed = !isOutbound && (event.status === 'no-answer' || event.status === 'voicemail')
  const dur = fmtDuration(event.duration_seconds)

  // Audio: a voicemail's recording (combined or orphan) lives on the voicemail
  // route; a recorded completed call lives on the call route.
  const audioSrc = hasVoicemail
    ? `/api/dialer/voicemails/${event.voicemail_id}/audio`
    : event.recording_path
      ? `/api/dialer/calls/${event.id}/recording`
      : null

  // Label
  let label: string
  if (hasVoicemail) {
    label = 'Missed call · voicemail'
  } else if (isOutbound) {
    label = 'Outgoing call'
  } else if (missed) {
    label = 'Missed call'
  } else {
    label = 'Incoming call'
  }

  const icon = hasVoicemail ? '🎙' : missed ? '📵' : '📞'
  const tinted = missed || hasVoicemail
  const preview = hasVoicemail ? (event.summary || event.transcript || '') : ''
  const hasDetail = !!(audioSrc || event.summary || event.transcript)

  return (
    <div className="flex flex-col items-center my-1">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] max-w-[90%] ${
          tinted
            ? 'bg-red-500/10 border-red-500/20 text-red-200/90 hover:bg-red-500/20'
            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
        } ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
        title={hasDetail ? 'Tap to expand' : undefined}
      >
        <span aria-hidden>{icon}</span>
        {!hasVoicemail && <span aria-hidden className="opacity-70">{directionArrow(event.direction)}</span>}
        <span className="flex-none font-medium">{label}</span>
        {hasVoicemail && dur && <span className="opacity-70">{dur}</span>}
        {!hasVoicemail && !missed && dur && <span className="opacity-70">· {dur}</span>}
        <span className="opacity-50">· {fmtTime(event.ts)}</span>
        {actorName && <span className="opacity-50 truncate">· {actorName}</span>}
        {preview && (
          <span className="text-red-100/60 truncate">— &ldquo;{preview}&rdquo;</span>
        )}
        {hasDetail && <span className="opacity-40">{expanded ? '▾' : '▸'}</span>}
      </button>
      {expanded && (
        <MarkerDetails
          audioSrc={audioSrc}
          summary={event.summary}
          sentiment={event.sentiment}
          transcript={event.transcript}
          aiReplySentAt={event.ai_reply_sent_at}
          onJumpToReply={onJumpToReply}
        />
      )}
    </div>
  )
}

// VoicemailMarker — orphan voicemails only (no parent call). Linked voicemails
// are folded into their CallMarker above.
export function VoicemailMarker({
  event,
  onJumpToReply,
}: {
  event: TimelineCallEvent
  onJumpToReply?: (ts: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const dur = fmtDuration(event.duration_seconds)
  const audioSrc = `/api/dialer/voicemails/${event.id}/audio`
  const preview = event.summary || event.transcript || ''

  return (
    <div className="flex flex-col items-center my-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-200/90 text-[10px] max-w-[90%] hover:bg-red-500/20"
        title="Voicemail — tap to expand"
      >
        <span aria-hidden>🎙</span>
        <span className="flex-none font-medium">Voicemail</span>
        {dur && <span className="opacity-70">{dur}</span>}
        <span className="opacity-50">· {fmtTime(event.ts)}</span>
        {preview && (
          <span className="text-red-100/60 truncate">— &ldquo;{preview}&rdquo;</span>
        )}
        <span className="opacity-40">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <MarkerDetails
          audioSrc={audioSrc}
          summary={event.summary}
          sentiment={event.sentiment}
          transcript={event.transcript}
          aiReplySentAt={event.ai_reply_sent_at}
          onJumpToReply={onJumpToReply}
        />
      )}
    </div>
  )
}
