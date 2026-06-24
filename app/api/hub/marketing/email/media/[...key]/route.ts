import { NextResponse } from 'next/server'
import { r2GetBuffer } from '@/lib/r2'

// GET /api/hub/marketing/email/media/[...key]
//
// DURABLE public-read endpoint for email images (logos, pictures embedded in
// campaigns). Unlike the SMS media route — which redirects to a 1-hour signed
// URL — this STREAMS the bytes with a long immutable cache. Email images must
// stay fetchable indefinitely: a recipient may open a campaign weeks or months
// after it was sent, and a short-lived signed URL would render as a broken image.
//
// Security model: deliberately public, same as the MMS media route. Keys carry a
// random slug after the timestamp, so URLs are unguessable; marketing email
// images are non-sensitive by nature. Restricted to the email/ prefix so this
// route can't expose other content in the shared bucket.
export const dynamic = 'force-dynamic'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keyParts } = await params
  const key = keyParts.join('/')
  if (!key.startsWith('email/')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const buf = await r2GetBuffer(key)
    const ext = key.split('.').pop()?.toLowerCase() || ''
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
