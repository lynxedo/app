'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import data from '@emoji-mart/data'

const EmojiMartPicker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

const QUICK_EMOJIS = ['✅', '👍', '👀']

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
  onAddReaction,
  onForward,
  onSaveToFiles,
  onAddToBoard,
  onOpenThread,
  onEdit,
  onDelete,
}: {
  hasText: boolean
  hasImages: boolean
  isOwn: boolean
  isAdmin: boolean
  hasOnOpenThread: boolean
  onClose: () => void
  onCopy: () => void
  onAddReaction: (emoji: string) => void
  onForward: () => void
  onSaveToFiles: () => void
  onAddToBoard: () => void
  onOpenThread: () => void
  onEdit: () => void
  onDelete: () => void
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
    ...(hasText ? [{ icon: '📋', label: 'Copy text', onClick: () => { onCopy(); dismiss() } }] : []),
    { icon: '↗', label: 'Forward', onClick: () => { onForward(); dismiss() } },
    ...(hasImages ? [{ icon: '📁', label: 'Save to Files', onClick: () => { onSaveToFiles(); dismiss() } }] : []),
    { icon: '☑', label: 'Add to Board', onClick: () => { onAddToBoard(); dismiss() } },
    ...(hasOnOpenThread ? [{ icon: '💬', label: 'Reply in thread', onClick: () => { onOpenThread(); dismiss() } }] : []),
    ...(isOwn ? [{ icon: '✏️', label: 'Edit', onClick: () => { onEdit(); dismiss() } }] : []),
    ...((isOwn || isAdmin) ? [{ icon: '🗑️', label: 'Delete', onClick: () => { onDelete(); dismiss() }, destructive: true }] : []),
  ]

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
