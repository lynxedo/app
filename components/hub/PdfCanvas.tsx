'use client'

import { useEffect, useRef, useState } from 'react'

// In-app PDF renderer. Draws each page to a <canvas> with pdf.js instead of
// relying on the browser/webview's built-in PDF viewer — which iOS has but
// Android's WebView (Capacitor app) does NOT, hence the blank white screen
// there with an <iframe>. Canvas rendering works on every platform.
//
// pdf.js is vendored as a static UMD build under /public/pdfjs (no npm
// dependency, no bundler involvement). We load it lazily the first time a PDF
// is opened and cache the load promise on window.

declare global {
  interface Window {
    pdfjsLib?: PdfjsLib
    __pdfjsLoading?: Promise<PdfjsLib>
  }
}

// Minimal shape of the bits of pdf.js we touch (the vendored build is plain JS).
type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> }
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> }
type PdfViewport = { width: number; height: number }
type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> }
}

function loadPdfjs(): Promise<PdfjsLib> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  if (window.__pdfjsLoading) return window.__pdfjsLoading
  window.__pdfjsLoading = new Promise<PdfjsLib>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/pdfjs/pdf.min.js'
    script.async = true
    script.onload = () => {
      const lib = window.pdfjsLib
      if (!lib) { reject(new Error('pdf.js failed to initialize')); return }
      try { lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js' } catch { /* falls back to main-thread parsing */ }
      resolve(lib)
    }
    script.onerror = () => reject(new Error('pdf.js failed to load'))
    document.head.appendChild(script)
  })
  return window.__pdfjsLoading
}

type PageInfo = { width: number; height: number }

const ZOOMS = [1, 1.5, 2, 3]
const MIN_ZOOM = ZOOMS[0]
const MAX_ZOOM = ZOOMS[ZOOMS.length - 1]

export default function PdfCanvas({ src }: { src: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<PdfPage[]>([])
  const renderedRef = useRef<Set<number>>(new Set())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pageInfos, setPageInfos] = useState<PageInfo[]>([])
  const [baseWidth, setBaseWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  // Two-finger pinch zoom. The +/- buttons snap to ZOOMS; pinch sets any value
  // in between, so the buttons (below) find the nearest step rather than using
  // an exact index.
  const pinch = useRef<{ active: boolean; startDist: number; startZoom: number }>({
    active: false, startDist: 0, startZoom: 1,
  })

  // Load pdf.js + the document and collect each page's dimensions.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setPageInfos([])
    setZoom(1)
    renderedRef.current = new Set()
    pagesRef.current = []
    ;(async () => {
      try {
        const pdfjsLib = await loadPdfjs()
        const res = await fetch(src, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.arrayBuffer()
        if (cancelled) return
        const pdf = await pdfjsLib.getDocument({ data }).promise
        if (cancelled) return
        const infos: PageInfo[] = []
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const vp = page.getViewport({ scale: 1 })
          pagesRef.current[n - 1] = page
          infos.push({ width: vp.width, height: vp.height })
        }
        if (cancelled) return
        const w = (scrollRef.current?.clientWidth ?? 800) - 24
        setBaseWidth(Math.max(280, w))
        setPageInfos(infos)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [src])

  // Lazily rasterize each page to its canvas as it scrolls near the viewport.
  // Bitmaps are rendered once at the un-zoomed fit width × device pixels;
  // zooming only changes the CSS display width (the dpr oversample keeps it
  // crisp), so we never re-rasterize on zoom.
  useEffect(() => {
    if (status !== 'ready' || baseWidth === 0) return
    const scroller = scrollRef.current
    const inner = innerRef.current
    if (!scroller || !inner) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const renderPage = async (wrapper: HTMLElement) => {
      const n = Number(wrapper.dataset.page)
      if (!n || renderedRef.current.has(n)) return
      const page = pagesRef.current[n - 1]
      const canvas = wrapper.querySelector('canvas') as HTMLCanvasElement | null
      if (!page || !canvas) return
      renderedRef.current.add(n)
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: (baseWidth / base.width) * dpr })
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      try {
        await page.render({ canvasContext: ctx, viewport: vp }).promise
      } catch {
        renderedRef.current.delete(n) // let it retry if it re-enters view
      }
    }

    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) renderPage(e.target as HTMLElement) }),
      { root: scroller, rootMargin: '800px 0px' },
    )
    const wrappers = Array.from(inner.querySelectorAll('[data-page]')) as HTMLElement[]
    wrappers.forEach(w => io.observe(w))
    return () => io.disconnect()
  }, [status, pageInfos, baseWidth])

  function touchDist(t: React.TouchList): number {
    const dx = t[0].clientX - t[1].clientX
    const dy = t[0].clientY - t[1].clientY
    return Math.hypot(dx, dy)
  }
  // stopPropagation keeps the lightbox's swipe-to-next from firing while the
  // user scrolls/zooms the PDF.
  function onPdfTouchStart(e: React.TouchEvent) {
    e.stopPropagation()
    if (e.touches.length === 2) {
      pinch.current = { active: true, startDist: touchDist(e.touches), startZoom: zoom }
    }
  }
  function onPdfTouchMove(e: React.TouchEvent) {
    e.stopPropagation()
    if (pinch.current.active && e.touches.length === 2 && pinch.current.startDist > 0) {
      const ratio = touchDist(e.touches) / pinch.current.startDist
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.startZoom * ratio)))
    }
  }
  function onPdfTouchEnd(e: React.TouchEvent) {
    e.stopPropagation()
    if (e.touches.length < 2) pinch.current.active = false
  }

  if (status === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-gray-300" onClick={e => e.stopPropagation()}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="mb-3 text-gray-500">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        <p className="text-sm font-medium text-white">Couldn&apos;t show a preview here</p>
        <p className="text-xs text-gray-400 mt-1 max-w-xs">Tap the <span className="font-semibold">Download</span> button above to open this PDF on your device.</p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0 w-full" onClick={e => e.stopPropagation()}>
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto overscroll-contain bg-gray-600/30"
        // pan-x pan-y keeps one-finger scrolling but hands two-finger pinch to
        // our JS zoom instead of the browser zooming the whole overlay.
        style={{ touchAction: 'pan-x pan-y' }}
        onTouchStart={onPdfTouchStart}
        onTouchMove={onPdfTouchMove}
        onTouchEnd={onPdfTouchEnd}
      >
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading PDF…
          </div>
        )}
        <div
          ref={innerRef}
          className="mx-auto py-3 flex flex-col gap-3"
          style={{ width: baseWidth ? baseWidth * zoom : '100%' }}
        >
          {pageInfos.map((info, i) => (
            <div
              key={i}
              data-page={i + 1}
              className="bg-white shadow-lg rounded-sm overflow-hidden"
              style={{ width: '100%', aspectRatio: `${info.width} / ${info.height}` }}
            >
              <canvas className="block" style={{ width: '100%', height: '100%' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Zoom control */}
      {status === 'ready' && pageInfos.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur rounded-full px-1.5 py-1 text-[#fff]">
          <button
            onClick={e => { e.stopPropagation(); setZoom(z => [...ZOOMS].reverse().find(v => v < z - 0.001) ?? MIN_ZOOM) }}
            disabled={zoom <= MIN_ZOOM + 0.001}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-30 text-lg leading-none"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="text-xs tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={e => { e.stopPropagation(); setZoom(z => ZOOMS.find(v => v > z + 0.001) ?? MAX_ZOOM) }}
            disabled={zoom >= MAX_ZOOM - 0.001}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-30 text-lg leading-none"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}
