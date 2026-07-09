import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { r2GetBuffer } from '@/lib/r2'

// Streams a beta feature's screenshot. The image is uploaded via /api/hub/upload
// (which stores it under a hub/ key) and its storage_path is saved in
// beta_features.screenshot_url. Auth-gated to any logged-in user — beta previews
// aren't public — and restricted to the hub/ prefix so it can't serve other
// bucket content. Short private cache (screenshots can be replaced by an admin).
export const dynamic = 'force-dynamic'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key: keyParts } = await params
  const key = keyParts.join('/')
  if (!key.startsWith('hub/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const buf = await r2GetBuffer(key)
    const ext = key.split('.').pop()?.toLowerCase() || ''
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
