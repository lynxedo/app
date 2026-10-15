'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Full-screen live camera with an orange check-shaped frame.
//
// The frame always runs along the screen's long side, so the result is
// landscape however the phone is held:
//   • screen landscape (phone turned, rotation unlocked) → a wide frame; the
//     photo is taken as-is;
//   • screen portrait (phone upright, or turned with rotation LOCKED — common,
//     and a web page can't override it) → a tall frame; the crop is turned a
//     quarter-turn to landscape. If that turn was the wrong way the photo check
//     reports it upside down and the page turns it over.
//
// What's saved is the frame plus a margin of the dark background around it — a
// bank app finds the check by its edges against the background, so a tight
// crop would hurt, not help.
//
// No live camera (Android app without the CAMERA permission, an old phone,
// permission refused) → the parent's plain phone-camera input takes over.

/** A personal check is 6" × 2¾"; business checks run wider. */
const CHECK_ASPECT = 2.2
/** Background kept around the frame, as a share of the frame's size. */
const MARGIN = 0.08
const MAX_EDGE = 2400

type Props = {
  side: 'front' | 'back'
  onShot: (photo: { blob: Blob; width: number; height: number }) => void
  onClose: () => void
  /** Open the phone's own camera instead — called from a tap, so iOS allows it. */
  onFallback: () => void
  /** A line shown at the top, e.g. "Front done — flip the check over". */
  notice?: string
}

function useViewport() {
  const [vp, setVp] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])
  return vp
}

/** The frame, in screen pixels, for a viewport. */
function guideRect(w: number, h: number) {
  const landscape = w >= h
  let gw: number, gh: number
  if (landscape) {
    gw = Math.min(w * 0.74, h * 0.74 * CHECK_ASPECT)
    gh = gw / CHECK_ASPECT
  } else {
    gh = Math.min(h * 0.66, w * 0.8 * CHECK_ASPECT)
    gw = gh / CHECK_ASPECT
  }
  return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh, landscape }
}

export default function CheckCamera({ side, onShot, onClose, onFallback, notice }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<'starting' | 'live' | 'unavailable'>('starting')
  const [flash, setFlash] = useState(false)
  const { w, h } = useViewport()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no getUserMedia')
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
        setStatus('live')
      } catch (e) {
        console.warn('[checks] live camera unavailable', e)
        if (!cancelled) setStatus('unavailable')
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const shoot = useCallback(async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth || !w || !h) return
    const vw = v.videoWidth, vh = v.videoHeight
    const g = guideRect(w, h)

    // The video is drawn object-fit: cover — map the frame back into video pixels.
    const scale = Math.max(w / vw, h / vh)
    const offX = (vw * scale - w) / 2
    const offY = (vh * scale - h) / 2
    const mx = g.w * MARGIN, my = g.h * MARGIN
    const sx = Math.max(0, (g.x - mx + offX) / scale)
    const sy = Math.max(0, (g.y - my + offY) / scale)
    const sw = Math.min(vw - sx, (g.w + 2 * mx) / scale)
    const sh = Math.min(vh - sy, (g.h + 2 * my) / scale)

    const turn = sh > sw // tall crop → a quarter-turn to landscape
    const longEdge = Math.max(sw, sh)
    const k = Math.min(1, MAX_EDGE / longEdge)
    const dw = Math.round(sw * k), dh = Math.round(sh * k)
    const canvas = document.createElement('canvas')
    canvas.width = turn ? dh : dw
    canvas.height = turn ? dw : dh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (turn) {
      // Counter-clockwise: the usual way to turn a phone to landscape (top to
      // the left) shows the check rotated clockwise on an upright screen.
      ctx.translate(0, canvas.height)
      ctx.rotate(-Math.PI / 2)
    }
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh)

    setFlash(true)
    setTimeout(() => setFlash(false), 180)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.92))
    if (blob && blob.size > 0) onShot({ blob, width: canvas.width, height: canvas.height })
  }, [w, h, onShot])

  const g = w && h ? guideRect(w, h) : null
  const sideLabel = side === 'front' ? 'FRONT' : 'BACK'

  return (
    <div className="fixed inset-0 z-[200] bg-black text-[#fff] select-none" role="dialog" aria-label={`Photograph the ${side} of the check`}>
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

      {status === 'live' && g && (
        <>
          {/* The frame. The huge shadow dims everything outside it. */}
          <div
            className="absolute rounded-xl border-[3px] border-[#f97316] pointer-events-none"
            style={{ left: g.x, top: g.y, width: g.w, height: g.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}
          >
            {/* Corner ticks make the frame read as a target, not a box. */}
            {(['top-0 left-0 border-t-[6px] border-l-[6px]', 'top-0 right-0 border-t-[6px] border-r-[6px]',
              'bottom-0 left-0 border-b-[6px] border-l-[6px]', 'bottom-0 right-0 border-b-[6px] border-r-[6px]'] as const).map(c => (
              <span key={c} className={`absolute w-7 h-7 border-[#f97316] rounded-sm -m-[5px] ${c}`} />
            ))}
            <div className={`absolute inset-0 flex items-center justify-center ${g.landscape ? '' : 'rotate-90'}`}>
              <span className="px-3 py-1 rounded-full bg-black/55 text-[#fff] text-sm font-semibold tracking-wide whitespace-nowrap">
                Line up the {sideLabel} of the check
              </span>
            </div>
          </div>

          <div className="absolute top-0 inset-x-0 pt-[max(env(safe-area-inset-top),12px)] px-14 text-center pointer-events-none flex flex-col items-center gap-1.5">
            {notice && (
              <div className="mt-1 px-3 py-1.5 rounded-full bg-emerald-600/90 text-[#fff] text-sm font-medium">{notice}</div>
            )}
            {!g.landscape && (
              <div className="inline-flex items-center gap-2 mt-1 px-3 py-1.5 rounded-full bg-black/60 text-[#fff] text-sm">
                <span className="text-lg leading-none">↺</span> Turn your phone sideways
              </div>
            )}
            <div className="px-3 py-1 rounded-full bg-black/50 text-[#fff]/80 text-xs">Dark background · flat · no glare</div>
          </div>

          <button
            type="button"
            onClick={shoot}
            aria-label={`Take photo of the ${side}`}
            className={`absolute w-[74px] h-[74px] rounded-full border-4 border-white bg-white/25 active:bg-white/60 transition-colors ${
              g.landscape
                ? 'right-[max(env(safe-area-inset-right),16px)] top-1/2 -translate-y-1/2'
                : 'bottom-[max(env(safe-area-inset-bottom),20px)] left-1/2 -translate-x-1/2'
            }`}
          >
            <span className="block w-full h-full rounded-full border-2 border-black/30" />
          </button>
        </>
      )}

      {status === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center text-[#fff]/70 text-sm">Starting the camera…</div>
      )}

      {status === 'unavailable' && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm w-full rounded-2xl bg-gray-900 border border-white/10 p-5 text-center">
            <div className="text-3xl">📷</div>
            <h2 className="text-lg font-bold mt-2">Use the phone’s camera</h2>
            <p className="text-sm text-white/60 mt-1.5 leading-relaxed">
              The framed camera isn’t available here. Use the phone’s own camera instead —
              turn the phone <b className="text-white">sideways</b> and fill the picture with the check.
            </p>
            <button type="button" onClick={onFallback}
              className="mt-4 w-full px-4 py-3 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] font-semibold">
              Open the camera
            </button>
          </div>
        </div>
      )}

      {flash && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close camera"
        className="absolute top-[max(env(safe-area-inset-top),12px)] left-3 w-10 h-10 rounded-full bg-black/60 text-[#fff] text-2xl flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}
