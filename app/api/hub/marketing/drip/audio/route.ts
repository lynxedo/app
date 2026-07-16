import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDripAccess } from '@/lib/drip-auth'
import { r2Put } from '@/lib/r2'
import { uploadVoiceDropAudio } from '@/lib/voicedrop'

export const dynamic = 'force-dynamic'

// Drip RVM audio assets. An admin uploads a short MP3/WAV; it's stored in R2
// under drip/<company_id>/rvm/<uuid>.<ext>, registered with VoiceDrop, and a
// drip_audio_assets row records both the R2 key and the provider voicemail id.
// Gated to drip managers (requireDripAccess); dark until the builder/engine wire
// the RVM channel.

const ALLOWED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
])
const MAX_BYTES = 2 * 1024 * 1024 // ~2 MB — RVM audio is short

// GET — list this company's drip RVM audio assets (newest first).
export async function GET() {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const admin = createAdminClient()
  // TODO regen types — drip_audio_assets not yet in database.types.ts.
  const { data, error } = await (admin as any)
    .from('drip_audio_assets')
    .select('id, label, mime, duration_sec, provider, provider_voicemail_id, caller_id_number, created_at')
    .eq('company_id', access.companyId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assets: data ?? [] })
}

// POST — upload (multipart/form-data, field "file"; optional "label",
// "caller_id_number"). Stores in R2, registers with VoiceDrop, persists the row.
export async function POST(request: Request) {
  const access = await requireDripAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds 2 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 400 },
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'Only MP3 and WAV audio are supported' }, { status: 400 })
  }

  const label = ((formData.get('label') as string | null) ?? '').trim() || null
  const callerId = ((formData.get('caller_id_number') as string | null) ?? '').trim() || null

  const ext = file.type.includes('wav') ? 'wav' : 'mp3'
  const r2Key = `drip/${access.companyId}/rvm/${crypto.randomUUID()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    await r2Put(r2Key, buffer, file.type)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not store the audio file' },
      { status: 502 },
    )
  }

  // Register the audio with VoiceDrop so it can be dropped later. In dark mode
  // (no key connected yet) this returns ok:false — we still persist the R2 asset
  // so it's ready, and provider_voicemail_id is backfilled once VoiceDrop is
  // connected and the file re-uploaded.
  const upload = await uploadVoiceDropAudio(access.companyId, {
    buffer,
    filename: `${label ?? 'drip-rvm'}.${ext}`,
    contentType: file.type,
  })

  const admin = createAdminClient()
  // TODO regen types — drip_audio_assets not yet in database.types.ts.
  const { data, error } = await (admin as any)
    .from('drip_audio_assets')
    .insert({
      company_id: access.companyId,
      label,
      r2_key: r2Key,
      mime: file.type,
      provider: 'voicedrop',
      provider_voicemail_id: upload.ok ? upload.voicemailId ?? null : null,
      caller_id_number: callerId,
      created_by: access.userId,
    })
    .select('id, label, mime, provider, provider_voicemail_id, caller_id_number, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    { asset: data, providerUploaded: upload.ok, providerError: upload.ok ? undefined : upload.error },
    { status: 201 },
  )
}
