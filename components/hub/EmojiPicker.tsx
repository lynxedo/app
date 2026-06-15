'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// emoji-mart renders into a Web Component shadow DOM — needs to be
// client-only. The dynamic import keeps the ~250kb data bundle out of
// the initial route chunk. The emoji data is also lazy-loaded so neither
// bundle touches the initial page JS.
const Picker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

let _emojiDataPromise: Promise<void> | null = null
let _emojiData: unknown = null
function loadEmojiData(): Promise<void> {
  if (!_emojiDataPromise) {
    _emojiDataPromise = import('@emoji-mart/data').then(m => { _emojiData = m.default })
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
  const [emojiData, setEmojiData] = useState<unknown>(() => _emojiData)

  useEffect(() => {
    loadEmojiData().then(() => setEmojiData(_emojiData))
  }, [])

  return (
    <div
      className={`absolute bottom-full mb-1 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <Picker
        data={emojiData ?? undefined}
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
    </div>
  )
}
