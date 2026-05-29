import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { publishFacebookPost, publishInstagramPost } from '@/lib/meta-graph'

// Called by VPS cron every minute via:
// curl -s -X POST https://lynxedo.com/api/hub/social/deliver \
//   -H "x-cron-secret: $CRON_SECRET"

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

type PostRow = {
  id: string
  company_id: string
  account_id: string
  hub_file_id: string | null
  caption: string
  platforms: string[]
  account: {
    external_id: string
    access_token: string
    ig_user_id: string | null
    platform: string
  } | null
  file: { storage_path: string; mime_type: string } | null
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Atomically claim due rows by flipping status to 'delivering'.
  // Because Postgres serializes the UPDATE at the row level, only one concurrent
  // cron invocation can claim any given row — the WHERE status='scheduled' guard
  // prevents a second process from seeing the same row after the first has claimed it.
  const { data: claimed, error: claimErr } = await admin
    .from('social_posts')
    .update({ status: 'delivering' })
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .select(`
      id, company_id, account_id, hub_file_id, caption, platforms,
      account:social_accounts!account_id (external_id, access_token, ig_user_id, platform),
      file:hub_files!hub_file_id (storage_path, mime_type)
    `)
    .limit(50)

  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })
  if (!claimed || claimed.length === 0) return NextResponse.json({ delivered: 0 })

  const due = claimed

  const r2 = getR2Client()
  let delivered = 0

  for (const raw of due) {
    const post = raw as unknown as PostRow
    const account = Array.isArray(post.account) ? post.account[0] : post.account
    const file = Array.isArray(post.file) ? post.file[0] : post.file

    if (!account) {
      await admin.from('social_posts').update({ status: 'failed', error_message: 'Account not found' }).eq('id', post.id)
      continue
    }

    // Get signed URL for the photo if this post has one
    let imageUrl: string | undefined
    if (post.hub_file_id && file && process.env.CF_R2_BUCKET_NAME) {
      try {
        imageUrl = await getSignedUrl(
          r2,
          new GetObjectCommand({
            Bucket: process.env.CF_R2_BUCKET_NAME,
            Key: file.storage_path,
            ResponseContentType: file.mime_type,
          }),
          { expiresIn: 3600 }
        )
      } catch {
        await admin.from('social_posts').update({ status: 'failed', error_message: 'Failed to get photo URL' }).eq('id', post.id)
        continue
      }
    }

    const platforms = post.platforms ?? ['facebook']
    const errors: string[] = []
    let fbPostId: string | null = null

    // Publish to Facebook
    if (platforms.includes('facebook')) {
      const result = await publishFacebookPost({
        pageId: account.external_id,
        accessToken: account.access_token,
        caption: post.caption,
        imageUrl,
      })
      if ('error' in result) {
        errors.push(`FB: ${result.error}`)
      } else {
        fbPostId = result.postId
      }
    }

    // Publish to Instagram (requires photo)
    if (platforms.includes('instagram') && account.ig_user_id) {
      if (!imageUrl) {
        errors.push('IG: photo required for Instagram posts')
      } else {
        const result = await publishInstagramPost({
          igUserId: account.ig_user_id,
          accessToken: account.access_token,
          caption: post.caption,
          imageUrl,
        })
        if ('error' in result) {
          errors.push(`IG: ${result.error}`)
        }
      }
    }

    if (errors.length > 0) {
      await admin.from('social_posts').update({
        status: 'failed',
        error_message: errors.join('; '),
      }).eq('id', post.id)
    } else {
      await admin.from('social_posts').update({
        status: 'published',
        published_at: now,
        fb_post_id: fbPostId,
        error_message: null,
      }).eq('id', post.id)

      // Mark the source photo as used
      if (post.hub_file_id) {
        await admin.from('hub_files').update({ social_used_at: now }).eq('id', post.hub_file_id)
      }
      delivered++
    }
  }

  return NextResponse.json({ delivered })
}
