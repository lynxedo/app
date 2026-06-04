// Voicemail transcription pipeline (Phase 6).
//
// Downloads a voicemail recording from R2, runs Deepgram Audio Intelligence
// (single-channel — voicemail is one speaker, the caller), then Claude for a
// concise one-sentence summary. Writes transcript + summary back to the
// voicemails row so the Dialer sidebar and call-log2 can display them.
//
// Called fire-and-forget from the voicemail/complete webhook (so the push
// notification fires immediately while transcription runs in the background),
// and as a 1-min cron backstop for any rows still pending.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

export type VoicemailTranscribeResult = {
  voicemailId: string
  transcript: string | null
  summary: string | null
  sentiment: string | null
  latency_ms: number
  error: string | null
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
    console.warn('[voicemail-transcribe] R2 GetObject failed', key, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Deepgram — single-channel voicemail transcription
// ---------------------------------------------------------------------------

// Voicemail is a single-speaker mono recording (the caller). No multichannel.
const DG_VM_QUERY = [
  'model=nova-2',
  'smart_format=true',
  'punctuate=true',
  'utterances=true',
  'sentiment=true',
  'summarize=v2',
].join('&')

type DgUtterance = { transcript?: string; start?: number }
type DgResponse = {
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>
    utterances?: DgUtterance[]
    summary?: { short?: string }
    sentiments?: { average?: { sentiment?: string; sentiment_score?: number } }
  }
}

async function deepgramAnalyze(bytes: Buffer, contentType: string): Promise<DgResponse> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error('DEEPGRAM_API_KEY not set')
  const res = await fetch(`https://api.deepgram.com/v1/listen?${DG_VM_QUERY}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': contentType || 'audio/mpeg' },
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Deepgram HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as DgResponse
}

function buildTranscript(dg: DgResponse): string {
  const utts = dg.results?.utterances || []
  if (utts.length > 0) {
    const sorted = [...utts].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    return sorted
      .map((u) => (u.transcript || '').trim())
      .filter(Boolean)
      .join(' ')
  }
  return (dg.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim()
}

function normalizeSentiment(dg: DgResponse): string | null {
  const avg = dg.results?.sentiments?.average
  if (!avg) return null
  if (avg.sentiment) return avg.sentiment
  const score = avg.sentiment_score
  if (typeof score !== 'number' || Number.isNaN(score)) return null
  if (score > 0.33) return 'positive'
  if (score < -0.33) return 'negative'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// Claude — one-sentence voicemail summary
// ---------------------------------------------------------------------------

const VM_SUMMARY_SYSTEM = `You are a voicemail assistant for a lawn care company.
Given a voicemail transcript, write a single concise sentence (max 25 words) summarizing:
who called (if they said their name), why they called, and any callback number mentioned.
Return ONLY the summary sentence — no JSON, no labels, no extra text.`

async function claudeSummarize(transcript: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !transcript.trim()) return null
  try {
    const anthropic = new Anthropic({ apiKey })
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 128,
      system: VM_SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: transcript.slice(0, 2000) }],
    })
    const block = resp.content.find((b) => b.type === 'text')
    return block && block.type === 'text' ? block.text.trim() : null
  } catch (err) {
    console.warn('[voicemail-transcribe] Claude summarize failed', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

// Process one voicemail: download from R2, transcribe via Deepgram, summarize
// via Claude, write back to the voicemails row. Never throws — errors are
// returned in the result and also written to voicemails.error_message if that
// column exists (best-effort; ignored if missing).
export async function processVoicemail(
  voicemailId: string
): Promise<VoicemailTranscribeResult> {
  const start = Date.now()
  const admin = createAdminClient()

  const { data: vm } = await admin
    .from('voicemails')
    .select('id, recording_storage_path, transcript')
    .eq('id', voicemailId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vm) {
    return { voicemailId, transcript: null, summary: null, sentiment: null, latency_ms: 0, error: 'voicemail not found' }
  }

  // Skip if already transcribed (idempotent).
  if (vm.transcript) {
    return { voicemailId, transcript: vm.transcript as string, summary: null, sentiment: null, latency_ms: 0, error: null }
  }

  if (!vm.recording_storage_path) {
    return { voicemailId, transcript: null, summary: null, sentiment: null, latency_ms: 0, error: 'no recording_storage_path' }
  }

  try {
    const audio = await downloadFromR2(vm.recording_storage_path as string)
    if (!audio) {
      return { voicemailId, transcript: null, summary: null, sentiment: null, latency_ms: Date.now() - start, error: 'R2 download failed' }
    }

    const dg = await deepgramAnalyze(audio.bytes, audio.contentType)
    const transcript = buildTranscript(dg)
    const dgSummary = dg.results?.summary?.short || null
    const sentiment = normalizeSentiment(dg)

    const summary = transcript
      ? ((await claudeSummarize(transcript)) ?? dgSummary)
      : dgSummary

    // Write back to the voicemails row.
    await admin
      .from('voicemails')
      .update({ transcript: transcript || null, summary: summary || null })
      .eq('id', voicemailId)

    console.log(
      `[voicemail-transcribe] ${voicemailId} done in ${Date.now() - start}ms — ${transcript.length} chars`
    )

    return {
      voicemailId,
      transcript: transcript || null,
      summary: summary || null,
      sentiment,
      latency_ms: Date.now() - start,
      error: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    console.warn('[voicemail-transcribe] failed', voicemailId, msg)
    return { voicemailId, transcript: null, summary: null, sentiment: null, latency_ms: Date.now() - start, error: msg }
  }
}
