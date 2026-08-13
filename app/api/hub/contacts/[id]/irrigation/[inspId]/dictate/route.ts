import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveIrrigationAccess, contactInCompany } from '@/lib/irrigation-server'
import {
  transcribeDictation, extractZones, MAX_AUDIO_BYTES, MAX_NOTE_CHARS,
} from '@/lib/irrigation-dictate'

// POST … /irrigation/:inspId/dictate → zone rows from a recording or typed notes.
//
//   multipart/form-data  { audio: File }  → transcribe, then extract
//   application/json     { text: string } → extract directly
//
// Pure compute: this route reads nothing and writes nothing. The client merges
// the returned rows into the draft and the existing autosave persists them, so a
// failed or nonsense dictation can never corrupt an inspection in progress.
//
// The audio is transcribed in memory and discarded — we never store a recording
// of someone's property.

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

  // Only an editable draft of THIS contact accepts dictation — a finalized
  // snapshot is immutable, so filling one would be a dead end for the tech.
  const { data: insp } = await admin
    .from('irrigation_inspections')
    .select('id')
    .eq('id', inspId)
    .eq('company_id', access.companyId)
    .eq('contact_id', contactId)
    .eq('status', 'draft')
    .maybeSingle()
  if (!insp) return NextResponse.json({ error: 'No editable draft found' }, { status: 404 })

  let transcript = ''
  try {
    const ct = request.headers.get('content-type') || ''
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData()
      const audio = form.get('audio')
      if (!(audio instanceof File) || audio.size === 0) {
        return NextResponse.json({ error: 'No recording received' }, { status: 400 })
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: 'That recording is too long — try one section at a time' }, { status: 413 })
      }
      const bytes = Buffer.from(await audio.arrayBuffer())
      transcript = await transcribeDictation(bytes, audio.type || 'audio/webm')
    } else {
      const body = await request.json().catch(() => ({}))
      transcript = typeof body.text === 'string' ? body.text.slice(0, MAX_NOTE_CHARS).trim() : ''
      if (!transcript) return NextResponse.json({ error: 'No notes received' }, { status: 400 })
    }

    if (!transcript) {
      return NextResponse.json({ transcript: '', zones: [], note: "Couldn't make out any speech" })
    }

    const zones = await extractZones(transcript)
    return NextResponse.json({ transcript, zones })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not read those notes'
    console.warn('[irrigation-dictate]', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
