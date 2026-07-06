import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatPhone } from '@/lib/format'

function formatTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default async function TxtBroadcastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Txt2 (new Twilio texting) is gated per-user.
  const { data: gate } = await supabase
    .from('user_profiles')
    .select('can_access_txt')
    .eq('id', user.id)
    .single()
  if (!gate?.can_access_txt) redirect('/hub')

  const { id } = await params

  const [bResult, rResult] = await Promise.all([
    supabase
      .from('txt_broadcasts')
      .select(
        `id, body, status, recipient_count, sent_count, failed_count, skipped_count,
         created_at, started_at, completed_at, last_error, apply_signature,
         creator:hub_users!created_by ( id, display_name )`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('txt_broadcast_recipients')
      .select(
        `id, status, error_message, processed_at, conversation_id,
         contact:txt_contacts!txt_broadcast_recipients_contact_id_fkey ( id, name, phone )`
      )
      .eq('broadcast_id', id)
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(2000),
  ])

  if (bResult.error || !bResult.data) notFound()
  const b = bResult.data
  const recipients = rResult.data ?? []
  const creator = Array.isArray(b.creator) ? b.creator[0] : b.creator

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Broadcast detail</h1>
        <Link href="/hub/txt/broadcasts" className="text-sm text-white/60 hover:text-white">
          ← All broadcasts
        </Link>
      </div>

      <div className="rounded-md bg-white/5 border border-white/10 p-4 mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-md uppercase bg-white/10 text-white/80">
            {b.status}
          </span>
          <span className="text-[11px] text-white/40">
            By {creator?.display_name || 'someone'} · created {formatTime(b.created_at)}
          </span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words py-2 px-3 bg-black/20 rounded-md">
          {b.body}
        </div>
        <div className="text-[11px] text-white/50 flex flex-wrap gap-3">
          <span>{b.recipient_count} recipients</span>
          <span className="text-[var(--t-tint-success)]">{b.sent_count} sent</span>
          {b.failed_count > 0 && <span className="text-[var(--t-tint-danger)]">{b.failed_count} failed</span>}
          {b.skipped_count > 0 && <span className="text-white/40">{b.skipped_count} skipped</span>}
          {b.apply_signature && <span>· signature appended</span>}
        </div>
        {b.last_error && (
          <div className="text-xs text-[var(--t-tint-danger)]">Last error: {b.last_error}</div>
        )}
      </div>

      <h2 className="text-sm font-medium text-white/70 mb-2">Recipients</h2>
      <div className="rounded-md border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/50 text-[11px] uppercase">
            <tr>
              <th className="text-left px-3 py-2">Contact</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Processed</th>
              <th className="text-left px-3 py-2">Thread</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-white/40">
                  No recipients (shouldn&apos;t happen).
                </td>
              </tr>
            )}
            {recipients.map((r) => {
              const contact = Array.isArray(r.contact) ? r.contact[0] : r.contact
              const statusColor =
                r.status === 'sent'
                  ? 'text-[var(--t-tint-success)]'
                  : r.status === 'failed'
                  ? 'text-[var(--t-tint-danger)]'
                  : r.status === 'skipped'
                  ? 'text-white/40'
                  : 'text-white/60'
              return (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2">
                    <div className="text-sm">{contact?.name || 'Unknown'}</div>
                    <div className="text-[11px] text-white/40">
                      {contact?.phone ? formatPhone(contact.phone) : ''}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-xs ${statusColor}`}>
                    {r.status}
                    {r.error_message && (
                      <div className="text-[11px] text-white/40 mt-0.5">{r.error_message}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-white/50">
                    {formatTime(r.processed_at)}
                  </td>
                  <td className="px-3 py-2">
                    {r.conversation_id ? (
                      <Link
                        href={`/hub/txt/${r.conversation_id}`}
                        className="text-[11px] text-[var(--t-tint-success)] hover:text-[var(--t-tint-success)]"
                      >
                        Open
                      </Link>
                    ) : (
                      <span className="text-[11px] text-white/30">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
