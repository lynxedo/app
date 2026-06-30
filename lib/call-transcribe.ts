// Twilio call transcription pipeline (Phase 3).
//
// Takes a recorded Twilio Dialer call whose audio we already copied to R2
// (recording webhook sets calls.recording_storage_path + transcription_status
// 'pending') and runs BOTH AI engines, writing one row per engine to
// call_ai_results so /hub/call-log2 can compare them side by side:
//
//   Engine A — deepgram_claude: Deepgram Audio Intelligence (multichannel +
//     sentiment/summarize/topics/intents) for the transcript + sentiment, then
//     Claude Sonnet with the Heroes coaching rubric for the narrative summary,
//     call_type, action_items, and coaching.
//
//   Engine B — twilio_vi: Twilio Voice Intelligence. Gated behind
//     TWILIO_VI_SERVICE_SID — a VI Service must be created + have Language
//     Operators attached in the Twilio console first. If the env var is absent
//     Engine B is skipped entirely (the pipeline still ships fully working on
//     Engine A; flip Engine B on later by adding the env var, no code change).
//
// The "winning" engine (WINNING_ENGINE) is mirrored onto the calls row so the
// existing call surfaces have a single source of truth. Until a winner is
// chosen from real staging calls this is Engine A.
//
// Everything is best-effort + additive: failures are recorded in
// call_ai_results.error_message / calls.transcription_status='error' and never
// throw out to the webhook or cron.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { CALL_COACHING_RUBRIC } from '@/lib/call-rubric'


// The engine whose results are mirrored onto the calls row + used by the
// existing dialer surfaces. Both engines still write call_ai_results for the
// compare page; this only controls what populates calls.transcript etc.
export const WINNING_ENGINE = 'deepgram_claude'

export type EngineName = 'deepgram_claude' | 'twilio_vi'

export type EngineResult = {
  engine: EngineName
  transcript_text: string | null
  transcript_json: unknown
  summary: string | null
  sentiment: string | null
  sentiment_json: unknown
  topics: unknown
  intents: unknown
  action_items: unknown
  call_type: string | null
  latency_ms: number
  error_message: string | null
}

export type ProcessResult = {
  callId: string
  status: 'complete' | 'error' | 'skipped'
  engines: EngineName[]
  error?: string
}

type CallRow = {
  id: string
  company_id: string | null
  direction: string | null
  from_number: string | null
  to_number: string | null
  recording_storage_path: string | null
  recording_duration_seconds: number | null
  duration_seconds: number | null
  created_at: string | null
  transcription_status: string | null
}

// ---------------------------------------------------------------------------
// R2 download
// ---------------------------------------------------------------------------

function r2Client(): S3Client | null {
  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) return null
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

async function downloadFromR2(
  key: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const r2 = r2Client()
  if (!r2) return null
  try {
    const out = await r2.send(
      new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME!, Key: key })
    )
    if (!out.Body) return null
    const arr = await out.Body.transformToByteArray()
    return {
      bytes: Buffer.from(arr),
      contentType: out.ContentType || 'audio/mpeg',
    }
  } catch (err) {
    console.warn('[call-transcribe] R2 GetObject failed', key, err)
    return null
  }
}

// The RecordingSid is the basename of the R2 key:
//   dialer/{company_id}/recordings/{RecordingSid}.mp3
export function recordingSidFromStoragePath(path: string | null | undefined): string | null {
  if (!path) return null
  const m = /([^/]+)\.(?:mp3|wav)$/i.exec(path)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Sentiment normalization
// ---------------------------------------------------------------------------

function normalizeSentiment(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null
  if (score > 0.33) return 'positive'
  if (score < -0.33) return 'negative'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// Engine A — Deepgram Audio Intelligence + Claude
// ---------------------------------------------------------------------------

const DG_QUERY = [
  'model=nova-2',
  'smart_format=true',
  'punctuate=true',
  'utterances=true',
  'multichannel=true',
  'sentiment=true',
  'summarize=v2',
  'topics=true',
  'intents=true',
].join('&')

type DgWord = { punctuated_word?: string; word?: string }
type DgUtterance = {
  channel?: number
  speaker?: number
  transcript?: string
  start?: number
}
type DgResponse = {
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>
    utterances?: DgUtterance[]
    summary?: { short?: string; result?: string }
    sentiments?: {
      average?: { sentiment?: string; sentiment_score?: number }
      segments?: unknown[]
    }
    topics?: { segments?: Array<{ topics?: Array<{ topic?: string }> }> }
    intents?: { segments?: Array<{ intents?: Array<{ intent?: string }> }> }
  }
  metadata?: { duration?: number }
}

async function deepgramAnalyze(
  bytes: Buffer,
  contentType: string
): Promise<DgResponse> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error('DEEPGRAM_API_KEY not set')
  const res = await fetch(`https://api.deepgram.com/v1/listen?${DG_QUERY}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': contentType || 'audio/mpeg',
    },
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Deepgram HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as DgResponse
}

// Build a speaker-labeled plaintext transcript from a (possibly multichannel)
// Deepgram response. Prefers utterances (each carries a channel/speaker index
// for dual-channel separation); falls back to per-channel transcripts.
function buildDeepgramTranscript(dg: DgResponse): string {
  const utts = dg.results?.utterances || []
  if (utts.length > 0) {
    const labelOf = (u: DgUtterance) => {
      const idx = u.channel ?? u.speaker ?? 0
      return idx === 0 ? 'Speaker 1' : `Speaker ${idx + 1}`
    }
    // utterances are already roughly time-ordered; sort defensively by start.
    const sorted = [...utts].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    const lines: string[] = []
    let last = ''
    for (const u of sorted) {
      const text = (u.transcript || '').trim()
      if (!text) continue
      const label = labelOf(u)
      if (label === last) {
        lines[lines.length - 1] += ' ' + text
      } else {
        lines.push(`[${label}] ${text}`)
        last = label
      }
    }
    if (lines.length > 0) return lines.join('\n')
  }
  // Fallback: concatenate each channel's full transcript.
  const channels = dg.results?.channels || []
  if (channels.length > 1) {
    return channels
      .map((c, i) => `[Speaker ${i + 1}] ${(c.alternatives?.[0]?.transcript || '').trim()}`)
      .filter((s) => s.replace(/^\[Speaker \d+\]\s*/, '').length > 0)
      .join('\n')
  }
  return (channels[0]?.alternatives?.[0]?.transcript || '').trim()
}

function flattenDeepgramTopics(dg: DgResponse): string[] {
  const segs = dg.results?.topics?.segments || []
  const set = new Set<string>()
  for (const s of segs) for (const t of s.topics || []) if (t.topic) set.add(t.topic)
  return [...set]
}

function flattenDeepgramIntents(dg: DgResponse): string[] {
  const segs = dg.results?.intents?.segments || []
  const set = new Set<string>()
  for (const s of segs) for (const i of s.intents || []) if (i.intent) set.add(i.intent)
  return [...set]
}

// Claude narrative summary + coaching, reusing the Heroes rubric. Returns the
// parsed JSON object, or null on failure (the engine still succeeds with the
// Deepgram transcript + sentiment).
export async function claudeAnalyze(
  transcript: string,
  meta: { direction: string; phone: string; durationSec: number; createdAt: string | null }
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !transcript.trim()) return null

  const mins = Math.floor(meta.durationSec / 60)
  const secs = Math.round(meta.durationSec % 60)
  const durationStr = meta.durationSec ? `${mins}m ${secs}s` : 'unknown'
  const when = meta.createdAt ? new Date(meta.createdAt).toISOString() : 'unknown'

  const userMessage = [
    '## Call metadata',
    `- Date/time: ${when}`,
    `- Direction: ${meta.direction || 'unknown'}`,
    `- Phone: ${meta.phone || 'unknown'}`,
    `- Duration: ${durationStr}`,
    '',
    '## Transcript',
    transcript,
  ].join('\n')

  const truncated =
    userMessage.length > 12000
      ? userMessage.slice(0, 12000) + '\n[transcript truncated]'
      : userMessage

  try {
    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: CALL_COACHING_RUBRIC,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: truncated }],
    })
    const block = resp.content.find((b) => b.type === 'text')
    const raw = block && block.type === 'text' ? block.text : ''
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch (err) {
    console.warn('[call-transcribe] Claude analysis failed', err)
    return null
  }
}

async function runDeepgramClaudeEngine(
  bytes: Buffer,
  contentType: string,
  call: CallRow
): Promise<EngineResult> {
  const start = Date.now()
  try {
    const dg = await deepgramAnalyze(bytes, contentType)
    const transcript = buildDeepgramTranscript(dg)
    const dgSentiment = dg.results?.sentiments?.average
    const sentiment =
      dgSentiment?.sentiment ?? normalizeSentiment(dgSentiment?.sentiment_score)
    const topics = flattenDeepgramTopics(dg)
    const intents = flattenDeepgramIntents(dg)
    const dgSummary = dg.results?.summary?.short || null
    const durationSec =
      call.recording_duration_seconds ||
      call.duration_seconds ||
      Math.round(dg.metadata?.duration || 0)

    const analysis = await claudeAnalyze(transcript, {
      direction: call.direction || '',
      phone: call.direction === 'inbound' ? call.from_number || '' : call.to_number || '',
      durationSec,
      createdAt: call.created_at,
    })

    const summary =
      (analysis?.customer_summary as string | undefined) || dgSummary || null
    const callType = (analysis?.call_type as string | undefined) || null
    const actionItems = (analysis?.action_items as unknown) ?? null

    return {
      engine: 'deepgram_claude',
      transcript_text: transcript || null,
      transcript_json: {
        deepgram: {
          summary: dg.results?.summary ?? null,
          sentiments: dg.results?.sentiments ?? null,
          topics: dg.results?.topics ?? null,
          intents: dg.results?.intents ?? null,
          utterances: dg.results?.utterances ?? null,
          metadata: dg.metadata ?? null,
        },
        analysis: analysis ?? null,
      },
      summary,
      sentiment: sentiment || null,
      sentiment_json: dg.results?.sentiments ?? null,
      topics: topics.length ? topics : null,
      intents: intents.length ? intents : null,
      action_items: actionItems,
      call_type: callType,
      latency_ms: Date.now() - start,
      error_message: null,
    }
  } catch (err) {
    return {
      engine: 'deepgram_claude',
      transcript_text: null,
      transcript_json: null,
      summary: null,
      sentiment: null,
      sentiment_json: null,
      topics: null,
      intents: null,
      action_items: null,
      call_type: null,
      latency_ms: Date.now() - start,
      error_message: err instanceof Error ? err.message : 'deepgram_claude failed',
    }
  }
}

// ---------------------------------------------------------------------------
// Engine B — Twilio Voice Intelligence (gated behind TWILIO_VI_SERVICE_SID)
// ---------------------------------------------------------------------------

export function twilioViConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_VI_SERVICE_SID &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN
  )
}

function twilioBasicAuth(): string {
  return Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString('base64')
}

async function runTwilioViEngine(call: CallRow): Promise<EngineResult | null> {
  if (!twilioViConfigured()) return null
  const recordingSid = recordingSidFromStoragePath(call.recording_storage_path)
  if (!recordingSid) {
    return {
      engine: 'twilio_vi',
      transcript_text: null,
      transcript_json: null,
      summary: null,
      sentiment: null,
      sentiment_json: null,
      topics: null,
      intents: null,
      action_items: null,
      call_type: null,
      latency_ms: 0,
      error_message: 'No RecordingSid resolvable from storage path',
    }
  }

  const start = Date.now()
  const auth = twilioBasicAuth()
  const serviceSid = process.env.TWILIO_VI_SERVICE_SID!

  try {
    // 1. Create the VI transcript from the recording.
    const createBody = new URLSearchParams({
      ServiceSid: serviceSid,
      Channel: JSON.stringify({
        media_properties: { source_sid: recordingSid },
      }),
    })
    const createRes = await fetch('https://intelligence.twilio.com/v2/Transcripts', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: createBody.toString(),
    })
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '')
      throw new Error(`VI create HTTP ${createRes.status}: ${t.slice(0, 200)}`)
    }
    const created = (await createRes.json()) as { sid?: string; status?: string }
    const transcriptSid = created.sid
    if (!transcriptSid) throw new Error('VI create returned no sid')

    // 2. Poll for completion (VI is usually fast; cap ~60s).
    let status = created.status || 'queued'
    const deadline = Date.now() + 60_000
    while (status !== 'completed' && status !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      const poll = await fetch(
        `https://intelligence.twilio.com/v2/Transcripts/${transcriptSid}`,
        { headers: { Authorization: `Basic ${auth}` } }
      )
      if (!poll.ok) break
      const pj = (await poll.json()) as { status?: string }
      status = pj.status || status
    }
    if (status !== 'completed') {
      throw new Error(`VI transcript not completed (status=${status})`)
    }

    // 3. Pull sentences (transcript) + operator results (summary/sentiment/etc).
    const [sentencesRes, opsRes] = await Promise.all([
      fetch(
        `https://intelligence.twilio.com/v2/Transcripts/${transcriptSid}/Sentences`,
        { headers: { Authorization: `Basic ${auth}` } }
      ),
      fetch(
        `https://intelligence.twilio.com/v2/Transcripts/${transcriptSid}/OperatorResults`,
        { headers: { Authorization: `Basic ${auth}` } }
      ),
    ])

    let transcriptText: string | null = null
    if (sentencesRes.ok) {
      const sj = (await sentencesRes.json()) as {
        sentences?: Array<{ media_channel?: number; transcript?: string }>
      }
      const lines = (sj.sentences || [])
        .map((s) => {
          const ch = s.media_channel ?? 0
          return `[Speaker ${ch + 1}] ${(s.transcript || '').trim()}`
        })
        .filter((l) => l.replace(/^\[Speaker \d+\]\s*/, '').length > 0)
      transcriptText = lines.join('\n') || null
    }

    let operatorResults: unknown = null
    let summary: string | null = null
    let sentiment: string | null = null
    if (opsRes.ok) {
      const oj = (await opsRes.json()) as {
        operator_results?: Array<Record<string, unknown>>
      }
      operatorResults = oj.operator_results ?? null
      for (const op of oj.operator_results || []) {
        const name = String(op.name || op.operator_type || '').toLowerCase()
        if (!summary && name.includes('summar')) {
          summary = (op.text_result as string) || (op.transcript as string) || null
        }
        if (!sentiment && name.includes('sentiment')) {
          const label = (op.predicted_label as string) || (op.label_probabilities ? '' : '')
          if (label) sentiment = label.toLowerCase()
        }
      }
    }

    return {
      engine: 'twilio_vi',
      transcript_text: transcriptText,
      transcript_json: { transcript_sid: transcriptSid, operator_results: operatorResults },
      summary,
      sentiment,
      sentiment_json: null,
      topics: null,
      intents: null,
      action_items: null,
      call_type: null,
      latency_ms: Date.now() - start,
      error_message: null,
    }
  } catch (err) {
    return {
      engine: 'twilio_vi',
      transcript_text: null,
      transcript_json: null,
      summary: null,
      sentiment: null,
      sentiment_json: null,
      topics: null,
      intents: null,
      action_items: null,
      call_type: null,
      latency_ms: Date.now() - start,
      error_message: err instanceof Error ? err.message : 'twilio_vi failed',
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function writeEngineResult(
  admin: SupabaseClient,
  callId: string,
  companyId: string | null,
  r: EngineResult
): Promise<void> {
  await admin
    .from('call_ai_results')
    .upsert(
      {
        call_id: callId,
        company_id: companyId,
        engine: r.engine,
        transcript_text: r.transcript_text,
        transcript_json: r.transcript_json,
        summary: r.summary,
        sentiment: r.sentiment,
        sentiment_json: r.sentiment_json,
        topics: r.topics,
        intents: r.intents,
        action_items: r.action_items,
        call_type: r.call_type,
        latency_ms: r.latency_ms,
        error_message: r.error_message,
      },
      { onConflict: 'call_id,engine' }
    )
}

// ---------------------------------------------------------------------------
// Realtime broadcast
// ---------------------------------------------------------------------------

// Tell any open /hub/call-log2 page that a call's transcription finished (or
// errored) so it refreshes live instead of waiting for a manual Search. Same
// server-side broadcast pattern as broadcastDailyLogUpdate — `calls` is not in
// the Realtime publication, so postgres_changes won't deliver this.
// Fire-and-forget; never throws.
async function broadcastCallTranscribed(
  companyId: string | null,
  callId: string,
  status: 'complete' | 'error'
): Promise<void> {
  if (!companyId) return
  const admin = createAdminClient()
  const channel = admin.channel(`call-log2:${companyId}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 5000)
      channel.subscribe((s) => {
        const st = String(s)
        if (st === 'SUBSCRIBED') { clearTimeout(timeout); resolve() }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { clearTimeout(timeout); reject(new Error(st)) }
      })
    })
    await channel.send({
      type: 'broadcast',
      event: 'call-updated',
      payload: { call_id: callId, transcription_status: status },
    })
  } catch (err) {
    console.warn('[call-transcribe] broadcast failed:', (err as Error).message)
  } finally {
    await admin.removeChannel(channel)
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

// Claim + process one call. Returns a small result summary. Never throws.
//
//  - claim: flips transcription_status 'pending' -> 'processing' atomically so
//    the fire-and-forget kickoff + the 1-min cron backstop can't double-run.
//    Pass force:true (manual admin re-run) to bypass the pending guard.
export async function processPendingCall(
  callId: string,
  opts: { force?: boolean } = {}
): Promise<ProcessResult> {
  const admin = createAdminClient()

  // Atomic claim (unless forced).
  if (!opts.force) {
    const { data: claimed } = await admin
      .from('calls')
      .update({ transcription_status: 'processing' })
      .eq('id', callId)
      .eq('transcription_status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claimed) {
      return { callId, status: 'skipped', engines: [], error: 'not pending (already claimed/processed)' }
    }
  } else {
    await admin
      .from('calls')
      .update({ transcription_status: 'processing' })
      .eq('id', callId)
  }

  const { data: call } = await admin
    .from('calls')
    .select(
      'id, company_id, direction, from_number, to_number, recording_storage_path, recording_duration_seconds, duration_seconds, created_at, transcription_status'
    )
    .eq('id', callId)
    .maybeSingle<CallRow>()

  if (!call) {
    return { callId, status: 'error', engines: [], error: 'call not found' }
  }

  if (!call.recording_storage_path) {
    await admin
      .from('calls')
      .update({ transcription_status: 'error', error_message: 'No recording in storage' })
      .eq('id', callId)
    return { callId, status: 'error', engines: [], error: 'no recording_storage_path' }
  }

  const audio = await downloadFromR2(call.recording_storage_path)
  if (!audio) {
    await admin
      .from('calls')
      .update({ transcription_status: 'error', error_message: 'R2 download failed' })
      .eq('id', callId)
    return { callId, status: 'error', engines: [], error: 'R2 download failed' }
  }

  // Run both engines. Engine B is null when VI isn't configured (skipped).
  const [engineA, engineB] = await Promise.all([
    runDeepgramClaudeEngine(audio.bytes, audio.contentType, call),
    runTwilioViEngine(call),
  ])

  const results: EngineResult[] = [engineA]
  if (engineB) results.push(engineB)

  for (const r of results) {
    await writeEngineResult(admin, callId, call.company_id, r)
  }

  // Mirror the winning engine onto the calls row (single source of truth for
  // the existing dialer surfaces). If the winner errored, fall back to any
  // engine that produced a transcript.
  const winner =
    results.find((r) => r.engine === WINNING_ENGINE && !r.error_message && r.transcript_text) ||
    results.find((r) => !r.error_message && r.transcript_text) ||
    null

  const engines = results.map((r) => r.engine)

  if (!winner) {
    const firstErr = results.find((r) => r.error_message)?.error_message || 'all engines failed'
    await admin
      .from('calls')
      .update({ transcription_status: 'error', error_message: firstErr.slice(0, 300) })
      .eq('id', callId)
    broadcastCallTranscribed(call.company_id, callId, 'error').catch(() => {})
    return { callId, status: 'error', engines, error: firstErr }
  }

  // Lift the coaching object (computed by Engine A / deepgram_claude) onto the
  // calls row as queryable columns for the coaching panel + scoreboard. Null
  // when the winning engine produced no coaching (e.g. the Twilio VI fallback).
  const coaching =
    (winner.transcript_json as unknown as {
      analysis?: {
        coaching?: {
          overall_grade?: string
          headline?: string
          must_listen?: boolean
          must_listen_reason?: string
          red_flags?: unknown
          never_dos_triggered?: unknown
          wins?: unknown
          improvements?: unknown
        }
      }
    } | null)?.analysis?.coaching ?? null

  await admin
    .from('calls')
    .update({
      transcript: winner.transcript_text,
      transcript_json: winner.transcript_json,
      ai_summary: winner.summary,
      sentiment: winner.sentiment,
      call_type: winner.call_type,
      topics: winner.topics,
      intents: winner.intents,
      action_items: winner.action_items,
      coaching_json: coaching,
      coaching_grade: coaching?.overall_grade ?? null,
      coaching_headline: coaching?.headline ?? null,
      coaching_must_listen:
        coaching && typeof coaching.must_listen === 'boolean' ? coaching.must_listen : null,
      coaching_must_listen_reason: coaching?.must_listen_reason ?? null,
      coaching_red_flags: coaching?.red_flags ?? null,
      coaching_never_dos: coaching?.never_dos_triggered ?? null,
      coaching_wins: coaching?.wins ?? null,
      coaching_improvements: coaching?.improvements ?? null,
      transcription_status: 'complete',
      error_message: null,
    })
    .eq('id', callId)

  broadcastCallTranscribed(call.company_id, callId, 'complete').catch(() => {})

  return { callId, status: 'complete', engines }
}
