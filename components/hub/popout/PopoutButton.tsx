'use client'

// The "pop out" affordance placed in a thread header (txt / DM / room). Reads the
// shell-level ConversationPopoutProvider and toggles this thread's floating
// window. Renders nothing when Document Picture-in-Picture is unsupported
// (Safari / native / old browsers) or when no provider is mounted — so headers
// stay clean everywhere the feature can't run, exactly like the dialer's button.

import { useConversationPopout, type PopoutTarget } from './ConversationPopoutProvider'

export default function PopoutButton({
  target,
  className,
}: {
  target: PopoutTarget
  className?: string
}) {
  const popout = useConversationPopout()
  if (!popout?.supported) return null

  const active = popout.isActive(target)

  return (
    <button
      type="button"
      onClick={() => (active ? popout.close() : popout.popout(target))}
      className={
        className ??
        `flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          active ? 'bg-white/90 text-gray-900' : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`
      }
      aria-label={active ? 'Close pop-out' : 'Pop out conversation'}
      title={active ? 'Close pop-out' : 'Pop out conversation'}
    >
      {/* Same glyph as the dialer pop-out button (GlobalCallBar). */}
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6m0 0v6m0-6L10 14M19 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h4" />
      </svg>
    </button>
  )
}
