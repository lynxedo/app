import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

interface FromRouteV1Request {
  log_date: string               // YYYY-MM-DD
  tech_jobber_user_id?: string   // for audit only — name match is the actual bridge
  tech_jobber_user_name: string  // matched against hub_users.display_name (first-token)
  route_html: string             // full self-contained HTML of the route sheet
  route_name: string             // filename label, e.g. "Ben Simpson - 2026-05-28.html"
}

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

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const body = (await request.json()) as FromRouteV1Request
  if (!body.log_date || typeof body.log_date !== 'string') {
    return NextResponse.json({ error: 'log_date required' }, { status: 400 })
  }
  if (!body.tech_jobber_user_name || typeof body.tech_jobber_user_name !== 'string') {
    return NextResponse.json({ error: 'tech_jobber_user_name required' }, { status: 400 })
  }
  if (!body.route_html || typeof body.route_html !== 'string') {
    return NextResponse.json({ error: 'route_html required' }, { status: 400 })
  }
  if (!body.route_name || typeof body.route_name !== 'string') {
    return NextResponse.json({ error: 'route_name required' }, { status: 400 })
  }

  if (
    !process.env.CF_R2_ACCESS_KEY_ID ||
    !process.env.CF_R2_BUCKET_NAME ||
    !process.env.CF_R2_ACCOUNT_ID ||
    !process.env.CF_R2_SECRET_ACCESS_KEY
  ) {
    return NextResponse.json({ error: 'R2 storage not configured' }, { status: 503 })
  }

  // Resolve Jobber tech name → hub_users.id by first-token match.
  // Heroes convention: hub_users.display_name is first name only ("Ben",
  // "Kathryn"), Jobber uses full names ("Ben Simpson"). Same convention used
  // by the Chat Synx bridge for @mentions.
  const firstToken = body.tech_jobber_user_name.trim().split(/\s+/)[0]
  if (!firstToken) {
    return NextResponse.json({ error: 'Invalid tech name' }, { status: 400 })
  }

  const { data: matches } = await supabase
    .from('hub_users')
    .select('id, display_name')
    .eq('company_id', profile.company_id)
    .eq('is_bot', false)
    .ilike('display_name', `${firstToken}%`)

  const exactMatches = (matches ?? []).filter(
    m => m.display_name.split(/\s+/)[0].toLowerCase() === firstToken.toLowerCase(),
  )

  if (exactMatches.length === 0) {
    return NextResponse.json(
      { error: `No Hub user matches Jobber tech "${body.tech_jobber_user_name}". Add them in Hub or fix the display name.` },
      { status: 422 },
    )
  }
  if (exactMatches.length > 1) {
    const names = exactMatches.map(m => m.display_name).join(', ')
    return NextResponse.json(
      { error: `Multiple Hub users match "${firstToken}" (${names}). Make display names unique by first token.` },
      { status: 422 },
    )
  }
  const techUserId = exactMatches[0].id

  const admin = createAdminClient()

  // Find existing daily log entry for this {company, date, tech}, or create one.
  const { data: existingEntry } = await admin
    .from('daily_log_entries')
    .select('id')
    .eq('company_id', profile.company_id)
    .eq('log_date', body.log_date)
    .eq('tech_user_id', techUserId)
    .maybeSingle()

  let entryId: string
  let action: 'created' | 'updated'

  if (existingEntry) {
    entryId = existingEntry.id
    action = 'updated'
  } else {
    const { data: newEntry, error: createErr } = await admin
      .from('daily_log_entries')
      .insert({
        company_id: profile.company_id,
        log_date: body.log_date,
        tech_user_id: techUserId,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (createErr || !newEntry) {
      return NextResponse.json({ error: createErr?.message ?? 'Failed to create entry' }, { status: 500 })
    }
    entryId = newEntry.id
    action = 'created'

    // Auto-subscribe creator, mirroring POST /api/hub/daily-log behavior.
    await admin
      .from('daily_log_subscribers')
      .insert({ entry_id: entryId, user_id: user.id })
  }

  // Upload route sheet HTML to R2
  const r2Key = `daily-log/${profile.company_id}/${entryId}/${Date.now()}.html`
  try {
    const r2 = getR2Client()
    await r2.send(new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET_NAME!,
      Key: r2Key,
      Body: Buffer.from(body.route_html, 'utf-8'),
      ContentType: 'text/html; charset=utf-8',
      ContentDisposition: `inline; filename="${encodeURIComponent(body.route_name)}"`,
    }))
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to upload route sheet: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  // Stamp the route sheet reference on the entry
  const { error: updateErr } = await admin
    .from('daily_log_entries')
    .update({ route_sheet_url: r2Key, route_sheet_name: body.route_name })
    .eq('id', entryId)
  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to save route sheet link: ${updateErr.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ entry_id: entryId, tech_user_id: techUserId, action })
}
