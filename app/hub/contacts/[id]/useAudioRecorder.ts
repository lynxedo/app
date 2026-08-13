'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Push-to-talk recorder for field dictation.
//
// The mic is opened when recording starts and every track is stopped the moment
// it ends — including on unmount and on error. A page that quietly holds the mic
// open shows a recording indicator on the tech's phone all afternoon and looks
// like the app is listening to them, which is the fastest way to lose trust in a
// feature like this.
//
// Browser speech recognition is deliberately not used: it doesn't exist in the
// iOS WKWebView the Capacitor app runs in. Recording and transcribing
// server-side is the one path that behaves the same in the app, mobile Chrome,
// mobile Safari and on the desktop.

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find(t => {
    try { return MediaRecorder.isTypeSupported(t) } catch { return false }
  })
}

export type RecorderState = 'idle' | 'recording' | 'error'

export function useAudioRecorder(onClip: (blob: Blob) => void) {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onClipRef = useRef(onClip); onClipRef.current = onClip

  const supported = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'

  /** Stop every track and clear timers. Safe to call repeatedly. */
  const teardown = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!supported) {
      setState('error')
      setError('This device can’t record here — type your notes instead')
      return
    }
    setError(''); setSeconds(0); chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = rec

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        teardown()
        setState('idle'); setSeconds(0)
        if (blob.size > 0) onClipRef.current(blob)
      }
      rec.onerror = () => {
        teardown(); setState('error'); setError('Recording stopped unexpectedly')
      }

      rec.start()
      setState('recording')
      tickRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } catch (e) {
      teardown()
      setState('error')
      const name = e instanceof DOMException ? e.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Microphone blocked — allow it in settings, or type your notes'
          : 'Could not start the microphone — type your notes instead',
      )
    }
  }, [supported, teardown])

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') { rec.stop(); return }
    teardown(); setState('idle'); setSeconds(0)
  }, [teardown])

  const cancel = useCallback(() => {
    const rec = recorderRef.current
    chunksRef.current = []
    if (rec && rec.state !== 'inactive') {
      rec.onstop = () => { teardown(); setState('idle'); setSeconds(0) }
      rec.stop()
      return
    }
    teardown(); setState('idle'); setSeconds(0)
  }, [teardown])

  // Never leave the mic open behind a closed form.
  useEffect(() => () => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop() } catch { /* already gone */ } }
    teardown()
  }, [teardown])

  return { state, error, seconds, supported, start, stop, cancel, setError }
}
