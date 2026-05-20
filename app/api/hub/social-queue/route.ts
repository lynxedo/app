import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyHubApiKey } from '@/lib/hub-api-key'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

// GET /api/hub/social-queue?page=<page-tag-name>
// Hub API key authenticated. Returns unused photos tagged with any social-queue tag.
// Optional `page` query filter narrows to photos that also carry a specific social-page tag.
export async function GET(request: Request) {
  const auth = await verifyHubApiKey(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const admin = createAdminClient()
  const url = new URL(request.url)
  const pageTagName = url.searchParams.get('page')?.trim() || null

  // Discover the social-queue tag names for this company
  const { data: companyTags, error: tagsErr } = await admin
    .from('hub_file_tags')
    .select('name, tag_type')
    .eq('company_id', auth.context.companyId)

  if (tagsErr) return NextResponse.json({ error: tagsErr.message }, { status: 500 })

  const queueTagNames = (companyTags ?? []).filter(t => t.tag_type === 'social-queue').map(t => t.name)
  const pageTagNames = (companyTags ?? []).filter(t => t.tag_type === 'social-page').map(t => t.name)

  if (queueTagNames.length === 0) {
    return NextResponse.json({ files: [], note: 'No social-queue tags configured for this company.' })
  }

  if (pageTagName && !pageTagNames.includes(pageTagName)) {
    return NextResponse.json({ error: `Unknown social-page tag: ${pageTagName}` }, { status: 400 })
  }

  // Build query: image files, in company, with at least one social-queue tag, not yet used
  let query = admin
    .from('hub_files')
    .select('id, filename, mime_type, size_bytes, storage_path, description, uploaded_at, tags')
    .eq('company_id', auth.context.companyId)
    .is('social_used_at', null)
    .like('mime_type', 'image/%')
    .overlaps('tags', queueTagNames)
    .order('uploaded_at', { ascending: true })
    .limit(50)

  if (pageTagName) {
    query = query.contains('tags', [pageTagName])
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const r2 = getR2Client()
  const files = await Promise.all((data ?? []).map(async f => {
    const signedUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: process.env.CF_R2_BUCKET_NAME!,
        Key: f.storage_path,
      }),
      { expiresIn: 3600 }
    )
    return {
      id: f.id,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      tags: f.tags ?? [],
      description: f.description,
      uploaded_at: f.uploaded_at,
      signed_url: signedUrl,
    }
  }))

  return NextResponse.json({ files })
}
