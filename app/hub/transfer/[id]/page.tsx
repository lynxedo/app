import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhone } from '@/lib/format'
import TransferAcceptView from './TransferAcceptView'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Take the call' }

// AI Voice Receptionist — Hub-DM transfer accept page. Opened from the push /
// Hub message when a caller is on hold and wants a live person. Shows a "Take
// the call" button; tapping it (first wins) rings the tapper's Dialer softphone
// and bridges them to the caller.
export default async function TransferAcceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=/hub/transfer/${id}`)

  const admin = createAdminClient()
  const { data: a } = await admin
    .from('voice_transfer_attempts')
    .select('id, status, caller_from')
    .eq('id', id)
    .maybeSingle()

  const caller = a?.caller_from ? formatPhone(a.caller_from) || a.caller_from : 'A caller'
  const status = a?.status ?? 'gone'
  return <TransferAcceptView attemptId={id} initialStatus={status} caller={caller} />
}
