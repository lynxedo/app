'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// emoji-mart renders into a Web Component shadow DOM — needs to be
// client-only. The dynamic import keeps the picker code out of the initial
// route chunk; the ~250kb data bundle is loaded lazily (below) so it never
// lands in the initial page JS either.
const Picker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

// Lazy emoji data — module-scoped so it loads at most once across every picker
// mount in the app. emoji-mart's <Picker> reads `data` once at mount and
// ignores later prop changes, so callers must not mount it until data is ready.
let _emojiDataPromise: Promise<unknown> | null = null
let _emojiData: unknown = null
function loadEmojiData(): Promise<unknown> {
  if (!_emojiDataPromise) {
    _emojiDataPromise = import('@emoji-mart/data').then(m => { _emojiData = m.default; return _emojiData })
  }
  return _emojiDataPromise
}

export default function EmojiPicker({
  onSelect,
  onClose,
  align = 'right',
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  align?: 'left' | 'right'
}) {
  // Seed from the module cache (instant on every mount after the first); if the
  // data hasn't loaded yet, fetch it, then render. Never mount <Picker> with
  // null data — it would stay permanently empty.
  const [emojiData, setEmojiData] = useState<unknown>(() => _emojiData)
  useEffect(() => {
    if (!emojiData) loadEmojiData().then(setEmojiData)
  }, [emojiData])

  return (
    <div
      className={`absolute bottom-full mb-1 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {emojiData ? (
        <Picker
          data={emojiData}
          theme="dark"
          previewPosition="none"
          skinTonePosition="search"
          navPosition="bottom"
          perLine={8}
          maxFrequentRows={2}
          onEmojiSelect={(e: { native: string }) => {
            onSelect(e.native)
            onClose()
          }}
          onClickOutside={onClose}
        />
      ) : (
        <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-xs text-gray-400 shadow-2xl whitespace-nowrap">
          Loading emoji…
        </div>
      )}
    </div>
  )
}
