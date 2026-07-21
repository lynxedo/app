import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { hydrateThreadMessages } from '@/lib/inbox/sync'

export const dynamic = 'force-dynamic'

// Map user ids → display names. auth.users has no PostgREST FK to hub_users, so
// resolve names in a separate admin lookup (names aren't sensitive).
async function displayNamesFor(
  admin: ReturnType<typeof createAdminClient>,
  ids: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  if (uniq.length === 0) return {}
  const [{ data: hus }, { data: profs }] = await Promise.all([
    admin.from('hub_users').select('id, display_name').in('id', uniq),
    admin.from('user_profiles').select('id, full_name').in('id', uniq),
  ])
  const map: Record<string, string> = {}
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) map[p.id] = p.full_name
  }
  for (const h of (hus ?? []) as { id: string; display_name: string | null }[]) {
    if (h.display_name) map[h.id] = h.display_name
  }
  return map
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Reads use the cookie client so the thread-scoped RLS boundary applies — a
  // technician not on this thread gets nothing (404 below).
  const { data: thread } = await supabase
    .from('inbox_threads')
    .select(
      'id, company_id, account_id, provider_thread_id, subject, snippet, last_message_at, last_message_direction, from_name, from_email, participants, assigned_to_user_id, status, is_shared, owner_user_id, unread, folder, provider_folder_ids, has_attachments, contact_id, created_at, updated_at'
    )
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const permissions = await getInboxThreadPermissions(supabase, id, user.id)
  if (!permissions.canView) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The members list is read with the admin client: the inbox_thread_members RLS policy is
  // own-row-only (to avoid mutual recursion with the inbox_threads policy), so the cookie
  // client would return only the caller's own row. Access is already gated above (canView),
  // so returning the full member list for this thread is safe.
  const admin = createAdminClient()

  const [messagesRes, membersRes, notesRes, eventsRes] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select(
        'id, provider_message_id, direction, from_name, from_email, to_recipients, cc_recipients, bcc_recipients, subject, snippet, body_html, body_text, message_date, unread, has_attachments, attachments, sent_by_user_id, provider_folder_ids, created_at'
      )
      .eq('thread_id', id)
      .order('message_date', { ascending: true }),
    admin
      .from('inbox_thread_members')
      .select('user_id, role, added_by, added_at')
      .eq('thread_id', id),
    // RLS restricts notes to full-access users + the author.
    supabase
      .from('inbox_notes')
      .select('id, body, created_by, created_at')
      .eq('thread_id', id)
      .order('created_at', { ascending: true }),
    // RLS restricts events to full-access users + your own actions.
    supabase
      .from('inbox_thread_events')
      .select('id, event_type, actor_user_id, target_user_id, detail, created_at')
      .eq('thread_id', id)
      .order('created_at', { ascending: true }),
  ])

  const members = (membersRes.data ?? []) as Array<{ user_id: string; role: string; added_by: string | null; added_at: string }>
  const notes = (notesRes.data ?? []) as Array<{ created_by: string | null; [k: string]: unknown }>
  const events = (eventsRes.data ?? []) as Array<{ actor_user_id: string | null; target_user_id: string | null; [k: string]: unknown }>

  // Lazy body hydration: a 12-month backfill mirrors thread HEADERS only, so an
  // older thread opened for the first time has no message rows yet. Fetch + mirror
  // its bodies on demand (once), then re-read. Best-effort — a provider hiccup just
  // yields an empty thread the next open can retry.
  let messages = messagesRes.data ?? []
  if (messages.length === 0 && thread.provider_thread_id) {
    try {
      const written = await hydrateThreadMessages(admin, thread.id, thread.account_id, thread.provider_thread_id)
      if (written > 0) {
        const reread = await supabase
          .from('inbox_messages')
          .select(
            'id, provider_message_id, direction, from_name, from_email, to_recipients, cc_recipients, bcc_recipients, subject, snippet, body_html, body_text, message_date, unread, has_attachments, attachments, sent_by_user_id, provider_folder_ids, created_at'
          )
          .eq('thread_id', id)
          .order('message_date', { ascending: true })
        messages = reread.data ?? messages
      }
    } catch (e) {
      console.warn('[inbox] lazy hydrate failed:', e instanceof Error ? e.message : e)
    }
  }

  const names = await displayNamesFor(admin, [
    thread.assigned_to_user_id,
    ...members.map((m) => m.user_id),
    ...notes.map((n) => n.created_by),
    ...events.map((e) => e.actor_user_id),
    ...events.map((e) => e.target_user_id),
  ])

  return NextResponse.json({
    thread: { ...thread, assignee_name: thread.assigned_to_user_id ? names[thread.assigned_to_user_id] || null : null },
    messages,
    members: members.map((m) => ({ ...m, display_name: names[m.user_id] || null })),
    notes: notes.map((n) => ({ ...n, created_by_name: n.created_by ? names[n.created_by] || null : null })),
    events: events.map((e) => ({
      ...e,
      actor_name: e.actor_user_id ? names[e.actor_user_id] || null : null,
      target_name: e.target_user_id ? names[e.target_user_id] || null : null,
    })),
    permissions,
  })
}
