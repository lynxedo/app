import { NextResponse } from 'next/server'
import { r2Put, R2_BUCKET } from '@/lib/r2'
import { requireEmailAccess } from '@/lib/email-auth'

// POST /api/hub/marketing/email/upload — image upload for the block composer
// (logos, pictures). Stored in R2 under email/{company_id}/... and served via the
// DURABLE public media route (no expiry) so images keep loading in inboxes long
// after a campaign is sent. Returns an app-relative URL; the renderer absolutizes
// it with the site origin at send time.
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const access = await requireEmailAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  if (!R2_BUCKET || !process.env.CF_R2_ACCESS_KEY_ID) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Image exceeds 5 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` }, { status: 400 })
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, GIF, and WebP images are supported' }, { status: 400 })
  }

  const ext = (file.name.includes('.') ? file.name.split('.').pop()! : 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10).toLowerCase() || 'bin'
  const key = `email/${access.companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  await r2Put(key, buffer, file.type || 'application/octet-stream')

  // App-relative path (absolutized at send time). [...key] drops the "email/" prefix
  // since the route requires it, so include the full key in the path.
  return NextResponse.json({ url: `/api/hub/marketing/email/media/${key}`, key })
}
