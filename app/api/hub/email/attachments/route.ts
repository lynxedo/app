import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxUserFlags } from '@/lib/inbox/permissions'
import { getPersonalAccount } from '@/lib/inbox/accounts'
import { getR2Client, PutObjectCommand, R2_BUCKET } from '@/lib/r2'

export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB per file (send path additionally caps 20 MB total)

// Keep the original name recognizable but strip anything path-ish / control-ish.
function sanitizeFilename(name: string): string {
  const cleaned = (name || '')
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\w.\-()\[\] ]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
  return (cleaned || 'attachment').slice(0, 150)
}

// POST /api/hub/email/attachments — stage an outbound attachment for a later send.
// multipart/form-data with field "file". Auth: anyone who can use the inbox —
// shared-inbox access OR the compose grant OR a connected personal mailbox
// (mirrors the compose route's gating).
//
// Returns { id, filename, contentType, size }. `id` is the R2 outbox key
// (inbox/{company_id}/outbox/{uuid}/{filename}); the send paths re-validate the
// company prefix before fetching, so a token from another tenant is useless.
// Staged objects are best-effort deleted after a successful send.
export async function POST(request: Request) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { userId, companyId, supabase } = auth

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  // Gate: shared-inbox access OR compose grant OR a connected personal mailbox.
  const admin = createAdminClient()
  const flags = await getInboxUserFlags(supabase, userId)
  let allowed = flags.isFullAccess || flags.canCompose
  if (!allowed) {
    const personal = await getPersonalAccount(admin, companyId, userId)
    allowed = !!personal
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 15 MB per-file limit' }, { status: 413 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  }

  const filename = sanitizeFilename(file.name)
  const contentType = file.type || 'application/octet-stream'
  const key = `inbox/${companyId}/outbox/${randomUUID()}/${filename}`

  const buffer = Buffer.from(await file.arrayBuffer())
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  return NextResponse.json({
    id: key,
    filename,
    contentType,
    size: file.size,
  })
}
