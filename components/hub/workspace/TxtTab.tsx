'use client'

/**
 * Workspace-tab twin for a single Txt (SMS) conversation, keyed by conversation
 * id. Renders the REAL full `TxtConversationView` (templates, notes, assignment,
 * MMS, AI helpers) — NOT the stripped pop-out. That view seeds from props (no
 * loading state of its own), so this wrapper prefetches the one endpoint that
 * returns everything it needs, then mounts it. Once mounted it self-refreshes
 * via its own `txt:${companyId}` realtime channel, so a backgrounded Txt tab
 * stays live.
 *
 * ⚠ v1: `companyName` (used only for the On-My-Way template) passed null;
 * `hasGuardian` false (hides the AI Suggest-Reply button — the composer works
 * fully otherwise). Both threadable later if wanted.
 */

import { useEffect, useState, type ComponentProps } from 'react'
import TxtConversationView from '@/components/hub/txt/TxtConversationView'

type TxtProps = ComponentProps<typeof TxtConversationView>

type TxtThreadData = {
  conversation: TxtProps['initialConversation']
  messages: TxtProps['initialMessages']
  notes: TxtProps['initialNotes']
  members: TxtProps['initialMembers']
  group_contacts: TxtProps['initialGroupContacts']
  assistant_name?: string | null
}

export default function TxtTab({
  conversationId,
  currentUserId,
  companyId,
  hubUsers,
  currentUserName,
  canAssign,
  canAccessDialer,
  canAccessUnifiedInbox,
}: {
  conversationId: string
  currentUserId: string
  companyId: string
  hubUsers: TxtProps['hubUsers']
  currentUserName: string | null
  canAssign: boolean
  canAccessDialer: boolean
  canAccessUnifiedInbox: boolean
}) {
  const [data, setData] = useState<TxtThreadData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    fetch(`/api/txt/conversations/${conversationId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: TxtThreadData | null) => {
        if (!alive) return
        if (d && d.conversation) { setData(d); setState('ready') } else setState('error')
      })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [conversationId])

  if (state === 'loading') return <div className="flex-1 min-h-0 p-6 text-sm text-white/50">Loading conversation…</div>
  if (state === 'error' || !data) return <div className="flex-1 min-h-0 p-6 text-sm text-white/60">This conversation isn’t available.</div>

  return (
    <TxtConversationView
      initialConversation={data.conversation}
      initialMessages={data.messages ?? []}
      initialNotes={data.notes ?? []}
      initialMembers={data.members ?? []}
      initialGroupContacts={data.group_contacts ?? []}
      hubUsers={hubUsers}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      companyName={null}
      companyId={companyId}
      canAssign={canAssign}
      canAccessDialer={canAccessDialer}
      canAccessUnifiedInbox={canAccessUnifiedInbox}
      hasGuardian={false}
      assistantName={data.assistant_name ?? null}
    />
  )
}
