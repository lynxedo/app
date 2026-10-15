import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { requireCompany } from '@/lib/company-auth'
import { getR2Client } from '@/lib/r2'
import {
  reviewCheckPhoto, isCheckImage, MAX_CHECK_IMAGE_BYTES, type CheckSide,
} from '@/lib/check-deposit'

// POST /api/hub/checks/photo → store one side of a check + say whether a bank
// app would take it.
//
//   multipart/form-data { photo: File, side: 'front' | 'back' }
//   → { path, size, review: { ok, problems[], read } }
//
// Stored first, reviewed second: the tech can always "send anyway", so the
// photo must exist even when the review fails or times out (review = null).
// Nothing is written to check_deposits here — that happens on Send.

export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_hub' })
  if ('error' in auth) return auth.error

  if (!process.env.CF_R2_ACCESS_KEY_ID || !process.env.CF_R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'No photo received' }, { status: 400 })
  const side = String(form.get('side') || '') as CheckSide
  if (side !== 'front' && side !== 'back') {
    return NextResponse.json({ error: 'Unknown side' }, { status: 400 })
  }
  const photo = form.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: 'No photo received' }, { status: 400 })
  }
  if (photo.size > MAX_CHECK_IMAGE_BYTES) {
    return NextResponse.json({ error: 'That photo is too large' }, { status: 413 })
  }
  const mime = photo.type || 'image/jpeg'
  if (!isCheckImage(mime)) {
    return NextResponse.json({ error: 'That file isn’t a photo' }, { status: 400 })
  }

  const bytes = Buffer.from(await photo.arrayBuffer())
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  // Same bucket + key convention as /api/hub/upload so the room post serves the
  // photo through the existing file route unchanged.
  const path = `hub/${auth.companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  try {
    await getR2Client().send(new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME,
      Key: path,
      Body: bytes,
      ContentType: mime,
      ContentDisposition: `inline; filename="check-${side}.${ext}"`,
    }))
  } catch (e) {
    console.error('[checks/photo] store failed', e)
    return NextResponse.json({ error: 'Could not save that photo — try again.' }, { status: 502 })
  }

  try {
    const review = await reviewCheckPhoto(side, bytes, mime)
    return NextResponse.json({ path, size: bytes.length, review })
  } catch (e) {
    // The photo is saved; only the check failed. The screen says so and lets
    // the tech look at it themselves.
    console.warn('[checks/photo] review failed', e instanceof Error ? e.message : e)
    return NextResponse.json({ path, size: bytes.length, review: null })
  }
}
