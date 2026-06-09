'use client'

function formatPhone(raw: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

export default function IncomingCall({
  from,
  contactName,
  onAccept,
  onReject,
}: {
  from: string | null
  contactName?: string | null
  onAccept: () => void
  onReject: () => void
}) {
  const caller = contactName || formatPhone(from) || 'Unknown'

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
          <div className="text-sm font-semibold truncate leading-tight">
            {caller}
            {contactName && from && <span className="font-normal text-white/70"> · {formatPhone(from)}</span>}
          </div>
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
