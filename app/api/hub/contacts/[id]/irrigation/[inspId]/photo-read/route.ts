import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createAdminClient } from '@/lib/supabase/admin'
import { getR2Client } from '@/lib/r2'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import { readFieldsFromPhoto, isReadableImage, MAX_IMAGE_BYTES } from '@/lib/irrigation-photo'
import { PHOTO_SECTIONS, type PhotoSectionKey } from '@/lib/irrigation-fields'

// POST … /irrigation/:inspId/photo-read → field values read off one photo.
//
//   multipart/form-data { photo: File, section: 'controller'|'backflow'|'supply' }
//
// Stores the photo and returns its key alongside the values, so a single tap
// both files the evidence and fills the fields. The client merges the values
// into the draft (the existing autosave persists them) — this route never
// writes the inspection itself, so a misread can't corrupt work in progress.

export const maxDuration = 60

type Ctx = { params: Promise<{ id: string; inspId: string }> }

export async function POST(request: Request, ctx: Ctx) {
  const { id: contactId, inspId } = await ctx.params

  const access = await resolveIrrigationAccess()
  if ('error' in access) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  if (!(await contactInCompany(admin, contactId, access.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: insp } = await admin
    .from('irrigation_inspections')
    .select('id')
    .eq('id', inspId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft')
    .maybeSingle()
  if (!insp) return NextResponse.json({ error: 'No editable draft found' }, { status: 404 })

  try {
    const form = await request.formData()
    const section = String(form.get('section') || '') as PhotoSectionKey
    if (!PHOTO_SECTIONS[section]) {
      return NextResponse.json({ error: 'Unknown section' }, { status: 400 })
    }
    const photo = form.get('photo')
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: 'No photo received' }, { status: 400 })
    }
    if (photo.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'That photo is too large' }, { status: 413 })
    }
    const mime = photo.type || 'image/jpeg'
    if (!isReadableImage(mime)) {
      return NextResponse.json({ error: 'That file isn’t a photo' }, { status: 400 })
    }

    const bytes = Buffer.from(await photo.arrayBuffer())

    // Keep the photo on the inspection. Same bucket + key convention as
    // /api/hub/upload so it serves through the existing file route unchanged.
    let photoKey: string | null = null
    if (process.env.CF_R2_ACCESS_KEY_ID && process.env.CF_R2_BUCKET_NAME) {
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
      const key = `hub/${access.companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      try {
        await getR2Client().send(new PutObjectCommand({
          Bucket: process.env.CF_R2_BUCKET_NAME,
          Key: key,
          Body: bytes,
          ContentType: mime,
          ContentDisposition: `inline; filename="${section}.${ext}"`,
        }))
        photoKey = key
      } catch (e) {
        // Storing is a bonus; failing to store must not cost the tech the read.
        console.warn('[irrigation-photo] store failed', e)
      }
    }

    const { patch, fields } = await readFieldsFromPhoto(section, bytes, mime)
    return NextResponse.json({ patch, fields, photoKey, section })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not read that photo'
    console.warn('[irrigation-photo]', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
