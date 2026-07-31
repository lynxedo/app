'use client'

import type { DialerLookupMatch } from '@/lib/dialer-lookup'
import { formatPhone } from '@/lib/format'
import { StatusPill, CallerIdPill } from './IncomingCall'

// The "call waiting" notice — shown when a SECOND call comes in while the user
// is already on a call (web/desktop). It stays SILENT (no ringtone, muted in the
// device hook) so it reads as an FYI rather than a call demanding attention, but
// now offers the same choices a cell phone does:
//   • Hold & answer — put the current caller on hold, pick up the new one
//     (both stay live; a Swap control appears in the call bar). Only when the
//     current call supports hold (canHoldAndAnswer).
//   • End & answer  — hang up the current caller, pick up the new one.
//   • Dismiss       — send the new caller to voicemail / the next person.
export default function CallWaiting({
  from,
  contact,
  canHoldAndAnswer,
  onHoldAnswer,
  onEndAnswer,
  onDismiss,
}: {
  from: string | null
  contact?: DialerLookupMatch | null
  canHoldAndAnswer: boolean
  onHoldAnswer: () => void
  onEndAnswer: () => void
  onDismiss: () => void
}) {
  const name = contact?.name || null
  const caller = name || formatPhone(from) || 'Unknown'

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[69]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
    >
      <div className="bg-amber-600 text-[#fff] shadow-lg border-b border-amber-800/50">
        <div className="flex items-center gap-3 px-4 pt-2">
          <svg className="w-4 h-4 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h3l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-white/80 leading-tight">
              Another call waiting
            </div>
            <div className="text-sm font-semibold truncate leading-tight flex items-center gap-1.5">
              <span className="truncate">{caller}</span>
              {name && from && <span className="font-normal text-white/70 flex-none">· {formatPhone(from)}</span>}
              {contact?.status && <StatusPill status={contact.status} />}
              {contact?.nameIsCallerId && <CallerIdPill />}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
          {canHoldAndAnswer && (
            <button
              type="button"
              onClick={onHoldAnswer}
              className="px-3 h-8 rounded-full bg-white text-amber-800 hover:bg-white/90 active:scale-95 transition-all flex items-center gap-1.5 flex-none text-xs font-semibold"
              aria-label="Hold current call and answer the waiting call"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6M12 3a9 9 0 100 18 9 9 0 000-18z" />
              </svg>
              Hold &amp; answer
            </button>
          )}
          <button
            type="button"
            onClick={onEndAnswer}
            className="px-3 h-8 rounded-full bg-white/20 hover:bg-white/30 active:scale-95 transition-all flex items-center gap-1.5 flex-none text-xs font-semibold"
            aria-label="End current call and answer the waiting call"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5c5-4 13-4 18 0M7 13l-1.5 2M17 13l1.5 2" />
            </svg>
            End &amp; answer
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="px-3 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center gap-1.5 flex-none text-xs font-medium ml-auto"
            aria-label="Dismiss waiting call"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
