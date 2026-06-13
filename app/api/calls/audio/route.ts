import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

const RECORDINGS_DIR = '/data/call-recordings'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Permission gate: recordings are customer-sensitive. Require the Call Log
  // grant (or admin) — mirrors /api/calls/list and the call-log UI gating.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_call_log, role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_call_log && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const filename = searchParams.get('filename')
  if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 })

  // Prevent path traversal — only allow bare filenames
  const safe = path.basename(filename)
  if (safe !== filename || !safe.endsWith('.mp3')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  // Company scoping: only stream a recording that belongs to a call_logs row in
  // the requester's company (a tech can't pull another company's recording by
  // guessing a filename).
  const { data: callRow } = await supabase
    .from('call_logs')
    .select('id')
    .eq('filename', safe)
    .eq('company_id', profile.company_id || '')
    .maybeSingle()
  if (!callRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const filePath = path.join(RECORDINGS_DIR, safe)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const fileSize = fs.statSync(filePath).size
  const rangeHeader = request.headers.get('range')

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1
    const chunkSize = end - start + 1

    const nodeStream = fs.createReadStream(filePath, { start, end })
    const webStream = Readable.toWeb(nodeStream) as ReadableStream
    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  }

  const nodeStream = fs.createReadStream(filePath)
  const webStream = Readable.toWeb(nodeStream) as ReadableStream
  return new Response(webStream, {
    headers: {
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  })
}
