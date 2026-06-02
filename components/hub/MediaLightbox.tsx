'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PdfCanvas from './PdfCanvas'

export type LightboxItem = {
  type: 'image' | 'pdf' | 'html'
  src: string
  filename: string
  // Optional separate URL for the Download button. Defaults to `src`. Used when
  // the in-app preview reads bytes from one endpoint but downloading should hit
  // another (e.g. a redirect-to-signed-URL endpoint).
  downloadSrc?: string
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
          href={current.downloadSrc ?? current.src}
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
        className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {current.type === 'image' ? (
          // keyed by src so scale/pan reset when navigating to another image
          <ZoomableImage key={current.src} src={current.src} alt={current.filename} />
        ) : current.type === 'pdf' ? (
          // pdf.js canvas renderer — works in every webview, including Android's
          // (which can't render PDFs in an <iframe> — shows a blank white screen).
          <PdfCanvas key={current.src} src={current.src} />
        ) : (
          // HTML (e.g. a generated route sheet) renders fine in an iframe everywhere.
          <iframe
            src={current.src}
            className="w-full flex-1 bg-white"
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

// Pinch-to-zoom + pan image for the lightbox. Works in the iOS/Android app
// webviews (where browser page-zoom is disabled) because the zoom is applied as
// a CSS transform driven by our own touch handlers. Double-tap (or double-click
// on desktop) toggles a 2.5× zoom. At rest (scale 1) single-finger touches are
// left to bubble so the lightbox's swipe-to-next still works; once zoomed, the
// gesture is consumed for panning instead.
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const g = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch',
    startDist: 0,
    startScale: 1,
    startOffset: { x: 0, y: 0 },
    panStart: { x: 0, y: 0 },
  })

  const dist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.stopPropagation()
      g.current.mode = 'pinch'
      g.current.startDist = dist(e.touches)
      g.current.startScale = scale
      g.current.startOffset = offset
    } else if (e.touches.length === 1 && scale > 1) {
      e.stopPropagation()
      g.current.mode = 'pan'
      g.current.panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      g.current.startOffset = offset
    } else {
      g.current.mode = 'none' // let the lightbox handle swipe-to-next
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (g.current.mode === 'pinch' && e.touches.length === 2 && g.current.startDist > 0) {
      e.stopPropagation()
      setScale(Math.min(5, Math.max(1, g.current.startScale * (dist(e.touches) / g.current.startDist))))
    } else if (g.current.mode === 'pan' && e.touches.length === 1) {
      e.stopPropagation()
      setOffset({
        x: g.current.startOffset.x + (e.touches[0].clientX - g.current.panStart.x),
        y: g.current.startOffset.y + (e.touches[0].clientY - g.current.panStart.y),
      })
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (g.current.mode !== 'none') e.stopPropagation()
    g.current.mode = 'none'
    if (scale <= 1.02) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (scale > 1) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
    } else {
      setScale(2.5)
    }
  }

  return (
    <div
      className="flex-1 min-h-0 flex items-center justify-center overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={onDoubleClick}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain select-none"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: g.current.mode === 'none' ? 'transform 0.15s ease-out' : 'none',
          touchAction: 'none',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
        onClick={e => e.stopPropagation()}
        draggable={false}
      />
    </div>
  )
}
