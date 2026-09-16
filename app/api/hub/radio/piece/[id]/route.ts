// GET /api/hub/radio/piece/[id] — the audio for one piece, for the person it was
// sent to. Redirects to a short-lived signed R2 URL rather than proxying the bytes:
// the phone fetches straight from R2, which matters on a truck's signal.
//
// ⚠ This route is the only way audio leaves the server, which is why the
// participant gate lives here and not in a broadcast payload. The signed URL is
// deliberately short-lived — long enough to play a 5-second clip, not to be shared.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2SignedUrl } from '@/lib/r2'
import { loadTransmissionForParticipant } from '@/lib/radio/session'
import type { RadioPieceRow } from '@/lib/radio/types'

const SIGNED_URL_TTL_SECONDS = 300

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { id } = await params

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('radio_pieces')
    .select('id, transmission_id, r2_key, mime')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const piece = data as Pick<RadioPieceRow, 'id' | 'transmission_id' | 'r2_key' | 'mime'> | null
  if (!piece) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Proves the caller is one of the two people on the session this piece belongs to.
  const gate = await loadTransmissionForParticipant(piece.transmission_id, auth.userId, auth.companyId)
  if ('error' in gate) return gate.error

  try {
    const url = await r2SignedUrl(piece.r2_key, SIGNED_URL_TTL_SECONDS)
    return NextResponse.redirect(url, 302)
  } catch {
    // The 30-day lifecycle rule deletes old audio; the row outlives it on purpose so
    // a future replay UI can say "audio expired" instead of breaking.
    return NextResponse.json({ error: 'Audio unavailable' }, { status: 410 })
  }
}
