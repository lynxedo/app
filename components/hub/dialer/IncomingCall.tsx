'use client'

import type { DialerLookupMatch, DialerContactStatus } from '@/lib/dialer-lookup'
import { formatPhone } from '@/lib/format'


const STATUS_LABEL: Record<DialerContactStatus, string> = {
  lead: 'Lead',
  customer: 'Customer',
  archived: 'Archived',
}
const STATUS_CLASS: Record<DialerContactStatus, string> = {
  lead: 'bg-amber-400/20 text-amber-100',
  customer: 'bg-emerald-400/20 text-emerald-100',
  archived: 'bg-white/15 text-white/70',
}

export function StatusPill({ status }: { status: DialerContactStatus }) {
  return (
    <span className={`px-1.5 py-px rounded text-[10px] font-medium uppercase tracking-wide ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export default function IncomingCall({
  from,
  contact,
  onAccept,
  onReject,
}: {
  from: string | null
  // Session 4 screen-pop: the matched customer identity, if known.
  contact?: DialerLookupMatch | null
  onAccept: () => void
  onReject: () => void
}) {
  const name = contact?.name || null
  const caller = name || formatPhone(from) || 'Unknown'
  const subtitle = [
    contact?.address || null,
  ].filter(Boolean).join(' · ')

  // Slim top bar (not a full-screen takeover) so an incoming call is prominent
  // but doesn't hijack the whole window — the user can still see what they were
  // doing. Fixed to the top of the viewport, above the global call bar.
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[70]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
    >
      <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-700 text-white shadow-xl border-b border-sky-900/50">
        <svg className="w-5 h-5 flex-none animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h3l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-white/70 animate-pulse leading-tight">
            Incoming call
          </div>
          <div className="text-sm font-semibold truncate leading-tight flex items-center gap-1.5">
            <span className="truncate">{caller}</span>
            {name && from && <span className="font-normal text-white/70 flex-none">· {formatPhone(from)}</span>}
            {contact?.status && <StatusPill status={contact.status} />}
          </div>
          {subtitle && (
            <div className="text-[11px] text-white/60 truncate leading-tight">{subtitle}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onReject}
          className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center flex-none shadow"
          aria-label="Decline"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 transition-all flex items-center justify-center flex-none shadow animate-pulse"
          aria-label="Answer"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
