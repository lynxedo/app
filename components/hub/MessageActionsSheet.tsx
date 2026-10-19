'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import data from '@emoji-mart/data'

const EmojiMartPicker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

const QUICK_EMOJIS = ['✅', '👍', '👀']

/** Where a desktop right-click opened the menu, plus any text highlighted inside
 *  that message at the time (Copy copies the highlight, else the whole message). */
export type MenuAnchor = { x: number; y: number; selection: string }

/**
 * A message row's onContextMenu. Phones: block the OS menu (long-press opens the
 * sheet instead). Desktop: right-click on a link / image / text box keeps the
 * browser's own menu; anywhere else returns an anchor for our menu.
 */
export function messageContextMenu(e: React.MouseEvent<HTMLElement>): MenuAnchor | null {
  const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  if (!desktop) { e.preventDefault(); return null }
  const target = e.target as HTMLElement
  if (target.closest('a[href], img, video, input, textarea, [contenteditable="true"]')) return null
  e.preventDefault()
  const sel = window.getSelection()
  const selection = sel && !sel.isCollapsed && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)
    ? sel.toString()
    : ''
  return { x: e.clientX, y: e.clientY, selection }
}

type Action = {
  icon: string
  label: string
  onClick: () => void
  destructive?: boolean
}

export default function MessageActionsSheet({
  hasText,
  hasImages,
  isOwn,
  isAdmin,
  hasOnOpenThread,
  onClose,
  onCopy,
  onCopyLink,
  onAddReaction,
  onForward,
  onSaveToFiles,
  onAddToBoard,
  onOpenThread,
  onEdit,
  onDelete,
  anchor,
}: {
  hasText: boolean
  hasImages: boolean
  isOwn: boolean
  isAdmin: boolean
  hasOnOpenThread: boolean
  onClose: () => void
  onCopy: () => void
  onCopyLink?: () => void
  onAddReaction: (emoji: string) => void
  onForward: () => void
  onSaveToFiles: () => void
  onAddToBoard: () => void
  onOpenThread: () => void
  onEdit: () => void
  onDelete: () => void
  /** Set = desktop right-click: a small menu at the pointer instead of the bottom sheet. */
  anchor?: MenuAnchor
}) {
  const [visible, setVisible] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function dismiss() {
    setVisible(false)
    setTimeout(onClose, 180)
  }

  const actions: Action[] = [
    ...(anchor?.selection ? [{ icon: '📋', label: 'Copy', onClick: () => { navigator.clipboard?.writeText(anchor.selection).catch(() => {}); dismiss() } }] : []),
    ...(hasText ? [{ icon: '📋', label: anchor?.selection ? 'Copy whole message' : 'Copy text', onClick: () => { onCopy(); dismiss() } }] : []),
    ...(onCopyLink ? [{ icon: '🔗', label: 'Copy link', onClick: () => { onCopyLink(); dismiss() } }] : []),
    { icon: '↗', label: 'Forward', onClick: () => { onForward(); dismiss() } },
    ...(hasImages ? [{ icon: '📁', label: 'Save to Files', onClick: () => { onSaveToFiles(); dismiss() } }] : []),
    { icon: '☑', label: 'Add to Board', onClick: () => { onAddToBoard(); dismiss() } },
    ...(hasOnOpenThread ? [{ icon: '💬', label: 'Reply in thread', onClick: () => { onOpenThread(); dismiss() } }] : []),
    ...(isOwn ? [{ icon: '✏️', label: 'Edit', onClick: () => { onEdit(); dismiss() } }] : []),
    ...((isOwn || isAdmin) ? [{ icon: '🗑️', label: 'Delete', onClick: () => { onDelete(); dismiss() }, destructive: true }] : []),
  ]

  if (anchor) {
    return (
      <DesktopMenu
        anchor={anchor}
        actions={actions}
        onClose={onClose}
        onAddReaction={emoji => { onAddReaction(emoji); onClose() }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden" onClick={dismiss} role="dialog" aria-modal="true">
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      />

      <div
        className={`absolute left-0 right-0 bottom-0 bg-gray-900 border-t border-gray-800 rounded-t-2xl shadow-2xl transform transition-transform duration-200 ease-out ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-700" />
        </div>

        <div className="px-3 pt-1 pb-3 flex items-center justify-around gap-1 border-b border-gray-800">
          {QUICK_EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={() => { onAddReaction(emoji); dismiss() }}
              className="w-12 h-12 flex items-center justify-center text-2xl rounded-full hover:bg-gray-800 active:bg-gray-700 transition-colors"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            onClick={() => setShowPicker(true)}
            className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-gray-800 active:bg-gray-700 transition-colors text-gray-400"
            aria-label="More reactions"
            title="More reactions"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <div className="py-1">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              className={`w-full flex items-center gap-4 px-5 py-3.5 text-base text-left active:bg-gray-800 transition-colors ${action.destructive ? 'text-red-400' : 'text-gray-100'}`}
            >
              <span className="text-xl w-6 text-center">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>

        <div className="border-t border-gray-800 px-4 py-1">
          <button
            onClick={dismiss}
            className="w-full py-3 text-base text-gray-400 active:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Full emoji picker overlay — opened by the + button above the
          quick-reaction row. Centered with backdrop; tap outside to
          dismiss back to the sheet. */}
      {showPicker && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center px-3"
          onClick={e => { e.stopPropagation(); setShowPicker(false) }}
        >
          <div onClick={e => e.stopPropagation()}>
            <EmojiMartPicker
              data={data}
              theme="dark"
              previewPosition="none"
              skinTonePosition="search"
              navPosition="bottom"
              perLine={8}
              maxFrequentRows={2}
              onEmojiSelect={(e: { native: string }) => {
                onAddReaction(e.native)
                dismiss()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Desktop right-click menu: positioned at the pointer, kept on-screen, closes on
// outside click / right-click / Esc / scroll.
function DesktopMenu({
  anchor,
  actions,
  onClose,
  onAddReaction,
}: {
  anchor: MenuAnchor
  actions: Action[]
  onClose: () => void
  onAddReaction: (emoji: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(anchor.y, window.innerHeight - height - 8)),
    })
  }, [anchor.x, anchor.y])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 hidden md:block"
      onClick={onClose}
      onContextMenu={e => { e.preventDefault(); onClose() }}
    >
      <div
        ref={ref}
        role="menu"
        className="absolute min-w-[200px] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1 text-sm"
        style={{ left: pos.left, top: pos.top }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 px-2 pb-1 mb-1 border-b border-gray-800">
          {QUICK_EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={() => onAddReaction(emoji)}
              className="w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-gray-800"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        {actions.map((action, i) => (
          <button
            key={i}
            role="menuitem"
            onClick={action.onClick}
            className={`w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-gray-800 ${action.destructive ? 'text-red-400' : 'text-gray-100'}`}
          >
            <span className="w-5 text-center">{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
