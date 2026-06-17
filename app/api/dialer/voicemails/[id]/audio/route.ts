import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/dialer/voicemails/[id]/audio
// Auth-gated signed-URL redirect to the voicemail recording in R2. Unlike
// /api/txt/media/* (public for Twilio MMS fetches), voicemail audio is
// internal staff content only — always go through the auth check.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_dialer, can_access_unified_inbox, role')
    .eq('id', user.id)
    .single()
  // Playable by dialer users, admins, and the read-all Unified Inbox view (PRD §6).
  if (!profile?.can_access_dialer && profile?.role !== 'admin' && !profile?.can_access_unified_inbox) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // RLS scopes by company so the user-session client can read the path.
  const { data: vm, error } = await supabase
    .from('voicemails')
    .select('id, recording_storage_path, deleted_at')
    .eq('id', id)
    .maybeSingle()

  if (error || !vm) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (vm.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })

  const signedUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: vm.recording_storage_path,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.redirect(signedUrl, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
