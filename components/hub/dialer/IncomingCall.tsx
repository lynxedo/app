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
  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 backdrop-blur-md flex flex-col items-center justify-center px-6">
      <div className="text-white/50 text-sm uppercase tracking-widest mb-3 animate-pulse">
        Incoming call
      </div>
      <div className="text-3xl font-light text-white mb-2">
        {contactName || formatPhone(from) || 'Unknown'}
      </div>
      {contactName && from && (
        <div className="text-white/50 mb-12">{formatPhone(from)}</div>
      )}
      {!contactName && <div className="mb-12" />}

      <div className="flex items-center justify-center gap-12">
        <button
          type="button"
          onClick={onReject}
          className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center shadow-lg"
          aria-label="Reject"
        >
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all flex items-center justify-center shadow-lg animate-pulse"
          aria-label="Accept"
        >
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
