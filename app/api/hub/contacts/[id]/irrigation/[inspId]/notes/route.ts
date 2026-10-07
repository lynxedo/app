import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import {
  transcribeDictation, polishNotes, MAX_AUDIO_BYTES, MAX_NOTE_CHARS,
} from '@/lib/irrigation-dictate'

// POST … /irrigation/:inspId/notes → the Final notes section's two AI buttons.
//
//   multipart/form-data  { audio: File }  → { transcript }  (talk to type)
//   application/json     { text: string } → { polished }    (✨ Polish)
//
// Pure compute, like /dictate: reads nothing, writes nothing. The client puts the
// result into the notes box and the normal autosave persists it, so a failed
// transcription or polish can never lose what the tech already has. The audio
// is transcribed in memory and discarded.

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
    const ct = request.headers.get('content-type') || ''
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData()
      const audio = form.get('audio')
      if (!(audio instanceof File) || audio.size === 0) {
        return NextResponse.json({ error: 'No recording received' }, { status: 400 })
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: 'That recording is too long — try a shorter one' }, { status: 413 })
      }
      const bytes = Buffer.from(await audio.arrayBuffer())
      const transcript = await transcribeDictation(bytes, audio.type || 'audio/webm')
      return NextResponse.json({ transcript })
    }

    const body = await request.json().catch(() => ({}))
    const text = typeof body.text === 'string' ? body.text.slice(0, MAX_NOTE_CHARS).trim() : ''
    if (!text) return NextResponse.json({ error: 'Nothing to polish yet' }, { status: 400 })
    const polished = await polishNotes(text)
    if (!polished) return NextResponse.json({ error: 'Could not polish the notes — try again' }, { status: 502 })
    return NextResponse.json({ polished })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not process the notes'
    console.warn('[irrigation-notes]', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
