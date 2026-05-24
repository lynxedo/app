'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type LightboxItem = {
  type: 'image' | 'pdf'
  src: string
  filename: string
}

export default function MediaLightbox({
  items,
  startIndex,
  onClose,
}: {
  items: LightboxItem[]
  startIndex: number
  onClose: () => void
}) {
  const [idx, setIdx] = useState(startIndex)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const next = useCallback(() => {
    setIdx(i => (i + 1) % items.length)
  }, [items.length])

  const prev = useCallback(() => {
    setIdx(i => (i - 1 + items.length) % items.length)
  }, [items.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  // Lock body scroll while open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  const current = items[idx]
  if (!current) return null

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || touchStartY.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    // Only treat as swipe if mostly horizontal and >50px
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && items.length > 1) {
      if (dx < 0) next()
      else prev()
    }
    touchStartX.current = null
    touchStartY.current = null
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center px-3 py-2 text-white border-b border-white/10"
        onClick={e => e.stopPropagation()}
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <div className="min-w-0 flex-1 mr-2">
          <div className="truncate text-sm font-medium">{current.filename}</div>
          {items.length > 1 && (
            <div className="text-xs text-gray-400">{idx + 1} of {items.length}</div>
          )}
        </div>
        <a
          href={current.src}
          download={current.filename}
          className="p-2 hover:bg-white/10 active:bg-white/20 rounded text-white"
          title="Download"
          aria-label="Download"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </a>
        <button
          onClick={onClose}
          className="ml-1 p-2 hover:bg-white/10 active:bg-white/20 rounded text-white"
          title="Close (Esc)"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content area */}
      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {current.type === 'image' ? (
          <img
            src={current.src}
            alt={current.filename}
            className="max-w-full max-h-full object-contain select-none"
            style={{ touchAction: 'pinch-zoom' }}
            onClick={e => e.stopPropagation()}
            draggable={false}
          />
        ) : (
          <iframe
            src={current.src}
            className="w-full h-full bg-white"
            title={current.filename}
            onClick={e => e.stopPropagation()}
          />
        )}

        {items.length > 1 && (
          <>
            <button
              onClick={e => { e.stopPropagation(); prev() }}
              className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 items-center justify-center w-12 h-12 bg-black/40 hover:bg-black/70 text-white rounded-full text-3xl leading-none"
              title="Previous (←)"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              onClick={e => { e.stopPropagation(); next() }}
              className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center w-12 h-12 bg-black/40 hover:bg-black/70 text-white rounded-full text-3xl leading-none"
              title="Next (→)"
              aria-label="Next"
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  )
}
