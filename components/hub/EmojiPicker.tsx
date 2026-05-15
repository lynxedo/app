'use client'

import { useEffect, useRef } from 'react'

const EMOJIS = ['👍', '👎', '❤️', '😂', '🎉', '😮', '😢', '🙏', '🔥', '✅', '👀', '🚀']

export default function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full right-0 mb-1 z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-2 flex flex-wrap gap-0.5"
      style={{ width: 208 }}
    >
      {EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose() }}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-700 text-xl transition-colors"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
