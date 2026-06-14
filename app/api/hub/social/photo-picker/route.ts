import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'


// GET /api/hub/social/photo-picker?queue_only=true
// Returns image files with signed R2 URLs for inline display in the post composer.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_marketing')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_marketing || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const queueOnly = url.searchParams.get('queue_only') === 'true'

  const admin = createAdminClient()

  let query = admin
    .from('hub_files')
    .select('id, filename, mime_type, storage_path, uploaded_at, tags, description, social_used_at')
    .eq('company_id', profile.company_id)
    .like('mime_type', 'image/%')
    .order('uploaded_at', { ascending: false })
    .limit(100)

  if (queueOnly) {
    // Only files tagged with a social-queue type tag
    const { data: tags } = await admin
      .from('hub_file_tags')
      .select('name')
      .eq('company_id', profile.company_id)
      .eq('tag_type', 'social-queue')

    const queueTagNames = (tags ?? []).map(t => t.name)
    if (queueTagNames.length > 0) {
      query = query.overlaps('tags', queueTagNames)
    }
  }

  const { data: files, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ files: [] })
  }

  const r2 = getR2Client()
  const filesWithUrls = await Promise.all((files ?? []).map(async f => {
    const signedUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: f.storage_path,
        ResponseContentType: f.mime_type,
      }),
      { expiresIn: 3600 }
    )
    return {
      id: f.id,
      filename: f.filename,
      mime_type: f.mime_type,
      tags: f.tags ?? [],
      description: f.description,
      uploaded_at: f.uploaded_at,
      social_used_at: f.social_used_at,
      signed_url: signedUrl,
    }
  }))

  return NextResponse.json({ files: filesWithUrls })
}
