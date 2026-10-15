import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { getR2Client } from '@/lib/r2'
import { getGaryBot, getGarySettings } from '@/lib/gary'

// Gary's picture. Gary is NOT part of the shared assistant persona (lib/ai-persona.ts —
// that's Amber's one face across Hub + phone), so his avatar is set here, on his
// own bot row only. Mirrors the persona avatar upload: a fresh key per upload so
// no cache can keep showing the old face. Served by /api/profile/avatar/[userId].

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const admin = createAdminClient()
  const settings = await getGarySettings(admin, auth.company_id)
  const bot = await getGaryBot(admin, auth.company_id, settings.botUserId)
  if (!bot) return NextResponse.json({ error: 'This company has no Gary user yet' }, { status: 409 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPG, PNG, WebP, and GIF are allowed' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })

  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
  const key = `avatars/${bot.id}-${Date.now()}.${ext}`
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
    }),
  )

  const { error } = await admin
    .from('hub_users')
    .update({ avatar_url: key })
    .eq('id', bot.id)
    .eq('company_id', auth.company_id)
    .eq('is_bot', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, serve_url: `/api/profile/avatar/${bot.id}` })
}
