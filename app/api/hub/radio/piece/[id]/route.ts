// GET /api/hub/radio/piece/[id] — the audio for one piece, for the person it was
// sent to. Redirects to a short-lived signed R2 URL rather than proxying the bytes:
// the phone fetches straight from R2, which matters on a truck's signal.
//
// ?bytes=1 serves the audio itself instead. The receiving phone downloads each piece
// the moment it arrives, while the one before it is still playing, so the next is
// ready the instant the current one ends — a page may only read bytes from its own
// site, and R2 is another site. Without this the phone fetched each piece only when
// its turn came, and that wait was the break Ben heard mid-word ("se… ven", Oct 15
// 2026). A few hundred KB a transmission through our server; the redirect stays as
// the fallback.
//
// ⚠ This route is the only way audio leaves the server, which is why the
// participant gate lives here and not in a broadcast payload. The signed URL is
// deliberately short-lived — long enough to play a 5-second clip, not to be shared.
import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { r2GetBuffer, r2SignedUrl } from '@/lib/r2'
import { loadTransmissionForParticipant } from '@/lib/radio/session'
import type { RadioPieceRow } from '@/lib/radio/types'

const SIGNED_URL_TTL_SECONDS = 300

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  if (new URL(request.url).searchParams.get('bytes') === '1') {
    try {
      const buf = await r2GetBuffer(piece.r2_key)
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'content-type': piece.mime || 'audio/wav',
          'content-length': String(buf.length),
          // Somebody's voice — never kept by a browser or a proxy.
          'cache-control': 'private, no-store',
        },
      })
    } catch {
      return NextResponse.json({ error: 'Audio unavailable' }, { status: 410 })
    }
  }

  try {
    const url = await r2SignedUrl(piece.r2_key, SIGNED_URL_TTL_SECONDS)
    return NextResponse.redirect(url, 302)
  } catch {
    // The 30-day lifecycle rule deletes old audio; the row outlives it on purpose so
    // a future replay UI can say "audio expired" instead of breaking.
    return NextResponse.json({ error: 'Audio unavailable' }, { status: 410 })
  }
}
