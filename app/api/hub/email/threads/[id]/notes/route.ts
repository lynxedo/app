import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInboxThreadPermissions } from '@/lib/inbox/permissions'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

export const dynamic = 'force-dynamic'

// POST /api/hub/email/threads/[id]/notes — body { body, mentioned_user_ids? }
// Leave an internal team note (never sent to the customer). Full-access only (canNote).
// Any teammates named in mentioned_user_ids get a best-effort Guardian DM + push.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const text: string = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Empty note' }, { status: 400 })

  // Optional @mentions. Keep only non-empty strings; dedupe and drop the author's own id
  // (no self-ping). Company membership is validated below before any notification goes out.
  const mentionedIds = Array.isArray(body.mentioned_user_ids)
    ? [
        ...new Set(
          (body.mentioned_user_ids as unknown[])
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
            .filter((v) => v !== user.id)
        ),
      ]
    : []

  const perms = await getInboxThreadPermissions(supabase, id, user.id)
  if (!perms.canNote) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: thread } = await admin
    .from('inbox_threads')
    .select('id, company_id, subject')
    .eq('id', id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: note, error } = await admin
    .from('inbox_notes')
    .insert({
      company_id: thread.company_id,
      thread_id: id,
      body: text,
      created_by: user.id,
    })
    .select('id, body, created_by, created_at')
    .single()
  if (error || !note) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  await admin.from('inbox_thread_events').insert({
    company_id: thread.company_id,
    thread_id: id,
    event_type: 'note',
    actor_user_id: user.id,
  })

  // Resolve the author's display name so the just-added note renders it immediately
  // (the list reads created_by_name; without this it shows "Someone" until reload).
  const [{ data: hu }, { data: up }] = await Promise.all([
    admin.from('hub_users').select('display_name').eq('id', user.id).maybeSingle(),
    admin.from('user_profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ])
  const createdByName = hu?.display_name || up?.full_name || null

  // Notify @mentioned teammates after the response is sent (best-effort — the note already
  // saved, so a failed DM/push must never turn into a request failure). Runs only when the
  // client passed mentions, matching the after() pattern used by the sibling inbox routes.
  if (mentionedIds.length > 0) {
    after(async () => {
      // Only ping users who actually share this thread's company — RLS would hide the note
      // from anyone else, and this also stops a cross-company push or name disclosure.
      const { data: mentioned } = await admin
        .from('user_profiles')
        .select('id, company_id')
        .in('id', mentionedIds)
      const validIds = (mentioned ?? [])
        .filter((m) => m.company_id === thread.company_id)
        .map((m) => m.id)
      if (validIds.length === 0) return

      // Author name comes from hub_users first (falling back to user_profiles, then a generic
      // label) — reuses the lookups already done above for the note's created_by_name.
      const authorName = createdByName || 'A teammate'
      const subjectLabel = thread.subject || '(no subject)'
      const snippet = text.length > 140 ? `${text.slice(0, 140)}…` : text
      const message = `${authorName} mentioned you in a note on "${subjectLabel}": ${snippet}`

      for (const uid of validIds) {
        // Per-user try/catch so one failed notification can't skip the rest.
        try {
          await postGuardianToUserDm(thread.company_id, uid, message, { admin })
          await sendHubPush(
            [uid],
            {
              title: '📧 Mentioned in a note',
              body: message,
              url: '/hub/email',
              type: 'inbox_mention',
            },
            { isDm: true }
          )
        } catch (err) {
          console.warn('[inbox:notes] mention notify failed for', uid, err)
        }
      }
    })
  }

  return NextResponse.json({ ok: true, note: { ...note, created_by_name: createdByName } })
}
