// POST /api/hub/radio/transmission/[id]/piece — one self-contained audio piece,
// uploaded while the sender is still talking. Stores it in R2, records the row, and
// broadcasts piece-ready so the receiver's play queue can pick it up ~2.5s after the
// press. Modelled on app/api/hub/marketing/drip/audio/route.ts.
//
// ⚠ The broadcast carries the piece id, never a URL — see lib/radio/broadcast.ts.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { r2Put, R2_BUCKET } from '@/lib/r2'
import { loadTransmissionForParticipant, touchSession } from '@/lib/radio/session'
import { radioBroadcast } from '@/lib/radio/broadcast'
import { RADIO_MAX_PIECE_BYTES, RADIO_PIECE_MIMES, radioTopic } from '@/lib/radio/types'

function extFor(mime: string) {
  if (mime.includes('wav') || mime.includes('wave')) return 'wav'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('ogg')) return 'ogg'
  return 'm4a'
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params
  if (!R2_BUCKET) return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'Empty piece' }, { status: 400 })
  if (file.size > RADIO_MAX_PIECE_BYTES) {
    return NextResponse.json({ error: 'Piece too large' }, { status: 413 })
  }
  const mime = (file.type || 'audio/wav').split(';')[0].trim()
  if (!RADIO_PIECE_MIMES.has(mime)) {
    return NextResponse.json({ error: `Unsupported audio type: ${mime}` }, { status: 415 })
  }
  const seq = Number(form.get('seq'))
  if (!Number.isInteger(seq) || seq < 1) return NextResponse.json({ error: 'seq must be 1 or more' }, { status: 400 })
  const rawDuration = Number(form.get('durationMs'))
  const durationMs = Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration) : null

  const gate = await loadTransmissionForParticipant(id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error
  const { admin, session, transmission } = gate
  if (transmission.sender_id !== auth.userId) {
    return NextResponse.json({ error: 'Not your transmission' }, { status: 403 })
  }

  const key = `radio/${auth.companyId}/${session.id}/${transmission.id}/${seq}.${extFor(mime)}`
  try {
    await r2Put(key, Buffer.from(await file.arrayBuffer()), mime)
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
  }

  // A retried piece must not become a duplicate: (transmission_id, seq) is unique,
  // and the retry re-uploads to the same deterministic key, so the object is simply
  // overwritten and the existing row is reused.
  const { data: inserted, error } = await admin
    .from('radio_pieces')
    .insert({ transmission_id: transmission.id, seq, r2_key: key, mime, duration_ms: durationMs, bytes: file.size })
    .select('id')
    .maybeSingle()

  let pieceId = (inserted as { id: string } | null)?.id
  if (error) {
    if (error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 })
    const { data: existing } = await admin
      .from('radio_pieces').select('id')
      .eq('transmission_id', transmission.id).eq('seq', seq).maybeSingle()
    pieceId = (existing as { id: string } | null)?.id
    if (!pieceId) return NextResponse.json({ error: 'Could not record the piece' }, { status: 500 })
  }

  await Promise.all([
    touchSession(admin, session.id),
    radioBroadcast(radioTopic(session.id), 'piece-ready', {
      transmissionId: transmission.id, senderId: auth.userId, seq, pieceId,
    }),
  ])
  return NextResponse.json({ pieceId, seq }, { status: 201 })
}
