import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/txt/timeline?contact_id=<uuid>
//
// Unified Inbox read layer (Session 1). Returns one chronological event list
// for a contact — texts, calls, voicemails, and notes — with the call↔voicemail
// dedup already applied by the RPC (a missed call that left a voicemail is ONE
// event carrying voicemail_id, never two markers).
//
// Access: gated on can_access_unified_inbox (or admin). This is a READ-ALL view;
// the actual send/call buttons in the UI gate separately on can_access_txt /
// can_access_dialer, exactly as the existing Txt2 + Dialer routes do (PRD §6).
// The RPC is SECURITY DEFINER and re-implements company scoping internally, so
// we pass the caller's own company_id — never a client-supplied one.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TimelineEvent = {
  kind: 'text' | 'call' | 'voicemail' | 'note'
  ts: string
  id: string
  direction: string | null
  body: string | null
  media_urls: string[] | null
  actor: string | null
  status: string | null
  duration_seconds: number | null
  recording_path: string | null
  transcript: string | null
  summary: string | null
  sentiment: string | null
  voicemail_id: string | null
  ai_reply_sent_at: string | null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contactId = new URL(request.url).searchParams.get('contact_id')?.trim() ?? ''
  if (!UUID_RE.test(contactId)) {
    return NextResponse.json({ error: 'Valid contact_id required' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_access_unified_inbox, can_access_txt')
    .eq('id', user.id)
    .single()

  // Anyone who can open a Txt2 thread can see that contact's call + voicemail
  // history alongside the texts they already see (Ben's call, June 19) — the
  // richer Unified Inbox surfaces (its own page, Catch-me-up) stay gated on
  // can_access_unified_inbox in the UI.
  const canRead =
    profile?.role === 'admin' ||
    profile?.can_access_unified_inbox === true ||
    profile?.can_access_txt === true
  if (!canRead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 403 })
  }

  const { data, error } = await supabase.rpc('get_contact_timeline', {
    p_contact_id: contactId,
    p_company_id: profile.company_id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ events: (data ?? []) as TimelineEvent[] })
}
