import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

// Where a submitted bug/feature lands + who gets pinged. These are Heroes'
// "Development" board and Ben's Hub user id, but both are env-overridable so the
// same code can point elsewhere without a redeploy (multi-tenant friendly).
const FEEDBACK_BOARD_ID =
  process.env.HUB_FEEDBACK_BOARD_ID || 'e72a725b-3b1b-4741-b610-a6cd8763e399'
const FEEDBACK_NOTIFY_USER_ID =
  process.env.HUB_FEEDBACK_NOTIFY_USER_ID || '6939b706-5135-448d-a28a-7674ba17974e'

type Kind = 'bug' | 'feature'
type Urgency = 'low' | 'medium' | 'high' | 'urgent'

// board_items.priority tops out at 'high'; "Urgent" reuses high + a 🔴 flag on
// the task title so it still stands out on the board.
const URGENCY_TO_PRIORITY: Record<Urgency, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  urgent: 'high',
}
const URGENCY_LABEL: Record<Urgency, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: '🔴 Urgent',
}

type AttachmentInput = {
  storage_path: string
  filename: string
  mime_type?: string
  size_bytes?: number
  width_px?: number | null
  height_px?: number | null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id)
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const raw = (await request.json().catch(() => null)) as {
    kind?: string
    summary?: string
    urgency?: string
    details?: string
    attachment?: AttachmentInput | null
  } | null
  if (!raw) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const kind: Kind = raw.kind === 'feature' ? 'feature' : 'bug'
  const summary = (raw.summary ?? '').trim()
  const details = (raw.details ?? '').trim()
  const urgency: Urgency = (['low', 'medium', 'high', 'urgent'] as const).includes(
    raw.urgency as Urgency,
  )
    ? (raw.urgency as Urgency)
    : 'medium'
  const attachment =
    raw.attachment && raw.attachment.storage_path && raw.attachment.filename
      ? raw.attachment
      : null

  if (!summary)
    return NextResponse.json({ error: 'Please add a short summary.' }, { status: 400 })

  const admin = createAdminClient()
  const companyId = profile.company_id

  // Reporter's name for the note + the alert to Ben.
  const { data: reporter } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', user.id)
    .single()
  const reporterName = reporter?.display_name?.trim() || 'A teammate'

  const typeEmoji = kind === 'bug' ? '🐛' : '✨'
  const typeLabel = kind === 'bug' ? 'Bug Report' : 'Feature Request'
  const urgentPrefix = urgency === 'urgent' ? '🔴 ' : ''

  // 1) The task = just the one-line issue (what Ben scans on the board).
  const taskContent = `${urgentPrefix}${typeEmoji} ${summary}`.slice(0, 500)
  const { data: item, error: itemErr } = await admin
    .from('board_items')
    .insert({
      board_id: FEEDBACK_BOARD_ID,
      company_id: companyId,
      content: taskContent,
      priority: URGENCY_TO_PRIORITY[urgency],
      recurrence: 'none',
      created_by: user.id,
    })
    .select('id')
    .single<{ id: string }>()
  if (itemErr || !item) {
    console.error('[feedback] board_items insert failed:', itemErr)
    return NextResponse.json({ error: 'Could not submit — please try again.' }, { status: 500 })
  }

  // 2) The note = all the details (type, urgency, reporter, the write-up).
  const noteLines = [
    `Type: ${typeEmoji} ${typeLabel}`,
    `Urgency: ${URGENCY_LABEL[urgency]}`,
    `Reported by: ${reporterName}`,
    '',
    details || '(no additional details provided)',
  ]
  if (attachment) noteLines.push('', '📎 Screenshot attached — see the Files tab on this task.')
  await admin.from('board_item_comments').insert({
    board_item_id: item.id,
    company_id: companyId,
    content: noteLines.join('\n'),
    created_by: user.id,
  })

  // 3) The screenshot → attached to the task (shows in the task's Files tab,
  //    viewable via /api/hub/files/board/{id}). The file bytes were already
  //    uploaded to R2 by the client through /api/hub/upload.
  if (attachment) {
    const { error: attErr } = await admin.from('board_item_attachments').insert({
      board_item_id: item.id,
      company_id: companyId,
      uploaded_by: user.id,
      storage_path: attachment.storage_path,
      filename: attachment.filename,
      mime_type: attachment.mime_type || 'application/octet-stream',
      size_bytes: attachment.size_bytes ?? 0,
      width_px: attachment.width_px ?? null,
      height_px: attachment.height_px ?? null,
    })
    if (attErr) console.error('[feedback] attachment insert failed:', attErr)
  }

  // 4) Alert Ben: a Guardian DM (persistent, in-Hub) + a push. Best-effort —
  //    a notify failure must never fail the submit itself.
  try {
    const dmBody = [
      `${urgentPrefix}${typeEmoji} New ${typeLabel} · ${URGENCY_LABEL[urgency]}`,
      `From: ${reporterName}`,
      '',
      summary,
      ...(details ? ['', details] : []),
      ...(attachment ? ['', '📎 Screenshot attached'] : []),
      '',
      '→ Added to your Development board.',
    ].join('\n')
    await postGuardianToUserDm(companyId, FEEDBACK_NOTIFY_USER_ID, dmBody, { admin })
    await sendHubPush(
      [FEEDBACK_NOTIFY_USER_ID],
      {
        title: `${typeEmoji} New ${typeLabel}`,
        body: `${reporterName}: ${summary}`.slice(0, 120),
        url: `/hub/board/${FEEDBACK_BOARD_ID}`,
      },
      { isDm: true },
    )
  } catch (err) {
    console.error('[feedback] notify failed:', (err as Error).message)
  }

  return NextResponse.json({ ok: true, item_id: item.id }, { status: 201 })
}
