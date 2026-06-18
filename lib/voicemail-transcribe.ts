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
import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAndSendResponderReply } from '@/lib/responder-ai'
import { twilioFromNumber } from '@/lib/twilio'
import { isInBusinessHours, sendResponderText } from '@/lib/responder'
import { enrichTxtContactName } from '@/lib/dialer-lookup'


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
    const anthropic = getAnthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
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
    .select('id, recording_storage_path, transcript, from_number, company_id, ai_reply_sent_at')
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

    // Write back to the voicemails row. Persist '' (not null) for a silent /
    // empty transcript: the cron backstop selects rows where transcript IS NULL,
    // so writing null here left silent voicemails (hang-ups, etc.) eligible
    // forever and the sweep re-downloaded + re-transcribed them on every run.
    // Storing '' marks them done so they're never re-swept.
    await admin
      .from('voicemails')
      .update({ transcript, summary: summary || null })
      .eq('id', voicemailId)

    console.log(
      `[voicemail-transcribe] ${voicemailId} done in ${Date.now() - start}ms — ${transcript.length} chars`
    )

    // AI auto-reply: if responder_settings.ai_reply_enabled, send a personalized
    // SMS back to the caller based on what they actually said in the voicemail.
    // When AI reply is on, the reconciler suppresses its generic template for
    // voicemail calls, so this is the ONLY message the caller gets — which is
    // why it runs even with an empty transcript (it falls back to the standard
    // "left a message" template so a caller is never left in silence).
    // Fire-and-forget — never blocks the transcription result.
    if (vm.from_number && vm.company_id && !vm.ai_reply_sent_at) {
      triggerAutoReply({
        voicemailId,
        transcript: transcript || '',
        summary: summary || null,
        callerPhone: vm.from_number as string,
        companyId: vm.company_id as string,
      }).catch((err) => {
        console.warn('[voicemail-transcribe] auto-reply failed', voicemailId, err)
      })
    }

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

// ---------------------------------------------------------------------------
// Auto-reply helper — runs async after transcription
// ---------------------------------------------------------------------------

async function triggerAutoReply(opts: {
  voicemailId: string
  transcript: string
  summary: string | null
  callerPhone: string
  companyId: string
}): Promise<void> {
  const admin = createAdminClient()

  // Load the responder config: the on/off flag, the admin-editable AI prompt,
  // and the templates + business hours (needed for the empty-transcript
  // fallback). When AI reply is on, the reconciler suppresses its generic
  // template for voicemail calls, so this function owns the only message.
  const { data: responder } = await admin
    .from('responder_settings')
    .select(
      'ai_reply_enabled, ai_reply_prompt, business_days, business_hours_start, business_hours_end, business_hours_template, business_hours_no_message_template, afterhours_template, afterhours_no_message_template'
    )
    .eq('company_id', opts.companyId)
    .maybeSingle()

  if (!responder?.ai_reply_enabled) return

  // ATOMIC CLAIM — guarantees exactly ONE auto-reply per voicemail.
  //
  // processVoicemail() can run concurrently (the voicemail/complete webhook
  // fires it, and the 1-min transcribe cron backstop also sweeps any row whose
  // transcript hasn't been written back yet). Each run independently passed the
  // `ai_reply_sent_at IS NULL` read and reached here, so all of them used to
  // send — that's how one caller got three texts (each a separate Claude
  // generation, hence the slightly different wording). Stamp ai_reply_sent_at
  // NOW with a conditional `.is(null)` update: Postgres serializes the racing
  // UPDATEs and only one matches the null row, so only one run proceeds. The
  // losers get no row back and bail. On a hard send failure below we reset it to
  // null so a later run can retry. (Compliance bonus: at most one text even if
  // the send path itself partially fails.)
  const claimedAt = new Date().toISOString()
  const { data: claimed } = await admin
    .from('voicemails')
    .update({ ai_reply_sent_at: claimedAt })
    .eq('id', opts.voicemailId)
    .is('ai_reply_sent_at', null)
    .select('id')
    .maybeSingle()
  if (!claimed) {
    console.log('[responder-ai] skipping — auto-reply already claimed/sent', opts.voicemailId)
    return
  }

  // Respect do_not_text — same check the inbound webhook does.
  const { data: contact } = await admin
    .from('txt_contacts')
    .select('do_not_text, name')
    .eq('company_id', opts.companyId)
    .eq('phone', opts.callerPhone)
    .maybeSingle()

  if (contact?.do_not_text) {
    console.log('[responder-ai] skipping — do_not_text', opts.callerPhone)
    return
  }

  // Pull first name: from txt_contacts.name if it looks like a real name
  // (not just the phone number placeholder the inbound webhook auto-creates).
  // When it IS the placeholder, fall through to the Jobber clients/contacts
  // mirror — enrichTxtContactName also persists the resolved name onto the
  // contact row so the Txt2 sidebar shows the real name.
  let firstName: string | null = null
  if (contact?.name && contact.name !== opts.callerPhone) {
    firstName = contact.name.trim().split(/\s+/)[0] || null
  }
  if (!firstName) {
    const enriched = await enrichTxtContactName(opts.companyId, opts.callerPhone)
    firstName = enriched ? enriched.trim().split(/\s+/)[0] || null : null
  }

  // Use the company's default outbound number (env var; txt_phone_numbers is
  // per-conversation — for this auto-reply the env default is fine).
  const fromNumber = twilioFromNumber() || undefined

  // No usable transcript (rare — a silent/garbled voicemail). Since the
  // reconciler suppressed its template for this call, fall back to the standard
  // "left a message" template so the caller still gets a reply. sendResponderText
  // also logs it into the Txt thread.
  if (!opts.transcript.trim()) {
    const fallback = await sendResponderText(admin, {
      companyId: opts.companyId,
      fromNumber: opts.callerPhone,
      ourNumber: fromNumber ?? null,
      inBusinessHours: isInBusinessHours(responder),
      hadVoicemail: true,
      templates: {
        business_hours_template: responder.business_hours_template,
        business_hours_no_message_template: responder.business_hours_no_message_template,
        afterhours_template: responder.afterhours_template,
        afterhours_no_message_template: responder.afterhours_no_message_template,
      },
    })
    // ai_reply_sent_at is already stamped (claimed above). If the fallback send
    // failed, release the claim so a later cron sweep can retry.
    if (!fallback.textSent) {
      await admin
        .from('voicemails')
        .update({ ai_reply_sent_at: null })
        .eq('id', opts.voicemailId)
    }
    console.log(
      `[responder-ai] ${opts.voicemailId} — no transcript, template fallback sent=${fallback.textSent} ${fallback.error ?? ''}`
    )
    return
  }

  const result = await generateAndSendResponderReply({
    transcript: opts.transcript,
    summary: opts.summary,
    callerPhone: opts.callerPhone,
    callerFirstName: firstName,
    fromNumber: fromNumber ?? '',
    companyId: opts.companyId,
    systemPrompt: (responder.ai_reply_prompt as string | null) ?? null,
  })

  // ai_reply_sent_at is already stamped (claimed above). On success, record the
  // body so it's visible in call-log2. On failure, release the claim so a later
  // cron sweep can retry the reply.
  if (result.smsSent && result.smsBody) {
    await admin
      .from('voicemails')
      .update({ ai_reply_body: result.smsBody })
      .eq('id', opts.voicemailId)
  } else {
    await admin
      .from('voicemails')
      .update({ ai_reply_sent_at: null })
      .eq('id', opts.voicemailId)
  }

  console.log(
    `[responder-ai] ${opts.voicemailId} — sent=${result.smsSent} ${result.error ?? ''} ${result.latency_ms}ms`
  )
}
