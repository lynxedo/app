'use client'

import dynamic from 'next/dynamic'
import data from '@emoji-mart/data'

// emoji-mart renders into a Web Component shadow DOM — needs to be
// client-only. The dynamic import keeps the ~250kb data bundle out of
// the initial route chunk.
const Picker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

export default function EmojiPicker({
  onSelect,
  onClose,
  align = 'right',
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`absolute bottom-full mb-1 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <Picker
        data={data}
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
