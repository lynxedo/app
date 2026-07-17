import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'
import { GUARDIAN_HUB_USER_ID } from '@/lib/guardian-post'

// Persists the Hub Bot's identity — its display name (JSON POST) and its avatar
// (multipart POST). Both target the bot's hub_users row via the service-role
// client (a normal session can't UPDATE the bot row) and are gated to AI admins.
// Mirrors app/api/profile/avatar/route.ts for the avatar half.

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

async function requireAiAdmin() {
  const check = await requireAdminArea('ai')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

export async function POST(request: Request) {
  const ctx = await requireAiAdmin()
  if ('error' in ctx) return ctx.error
  const admin = createAdminClient()
  const contentType = request.headers.get('content-type') ?? ''

  // ── Avatar upload (multipart/form-data) ────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
      return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP, and GIF are allowed' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })
    }

    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
    const key = `avatars/${GUARDIAN_HUB_USER_ID}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    await getR2Client().send(new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    }))

    // Store the R2 key — served via /api/profile/avatar/[userId]. Scope by
    // company so an admin can only edit their own company's bot row.
    const { error } = await admin
      .from('hub_users')
      .update({ avatar_url: key })
      .eq('id', GUARDIAN_HUB_USER_ID)
      .eq('company_id', ctx.companyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      avatar_url: key,
      serve_url: `/api/profile/avatar/${GUARDIAN_HUB_USER_ID}`,
    })
  }

  // ── Name update (JSON) ─────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name must be a non-empty string' }, { status: 400 })
  if (name.length > 40) return NextResponse.json({ error: 'Name too long (40 max)' }, { status: 400 })

  const { error } = await admin
    .from('hub_users')
    .update({ display_name: name })
    .eq('id', GUARDIAN_HUB_USER_ID)
    .eq('company_id', ctx.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, display_name: name })
}
