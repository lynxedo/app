// Per-device "new message" sound for Hub.
//
// Played by WebChimeNotifier when a message arrives while the Hub tab is OPEN
// but not focused (the user is on another tab or another app). The sound is a
// short synthesized two-note chime via the Web Audio API — there is no audio
// asset file to ship.
//
// The on/off preference is intentionally PER-DEVICE (localStorage), not
// per-account: you may want the sound on your office desktop but off on a shared
// machine. Default is on.

const STORAGE_KEY = 'hub-chime-enabled'

export function isChimeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true // storage blocked (private mode) → default on
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* storage blocked — non-critical */
  }
}

// Cross-tab de-dupe. Returns true only for the FIRST open Hub tab to claim a
// given message id within a short window, so several open tabs in the same
// browser don't all ding for the same message. localStorage is shared across
// same-origin tabs.
const LAST_DING_KEY = 'hub-chime-last'
export function claimChimeForMessage(id: string): boolean {
  try {
    const now = Date.now()
    const raw = localStorage.getItem(LAST_DING_KEY)
    if (raw) {
      const prev = JSON.parse(raw) as { id?: string; t?: number }
      if (prev.id === id && typeof prev.t === 'number' && now - prev.t < 4000) {
        return false
      }
    }
    localStorage.setItem(LAST_DING_KEY, JSON.stringify({ id, t: now }))
    return true
  } catch {
    return true // storage blocked → don't suppress the ding
  }
}

type AudioCtor = typeof AudioContext

function getAudioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = getAudioCtor()
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

// ── HTMLAudio fallback ─────────────────────────────────────────────────────
// In an INSTALLED PWA the AudioContext is suspended whenever the window isn't
// focused and Chrome won't let us resume it from a background timer (no user
// gesture) — so the Web Audio synth above goes silent there even though it
// works fine in a normal browser tab. An <audio> element, once unlocked during
// a gesture, keeps playing in the background. We generate the same two-note
// chime as a WAV data URI (no asset to ship) and use it only when the
// AudioContext can't play. iOS PWAs suspend background audio at the OS level —
// nothing client-side can fix that; mobile relies on the native push sound.

let chimeDataUri: string | null = null
function buildChimeDataUri(): string {
  if (chimeDataUri) return chimeDataUri
  const sampleRate = 44100
  const length = Math.floor(sampleRate * 0.45)
  const samples = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let s = Math.sin(2 * Math.PI * 880.0 * t) * Math.exp(-t * 8) // A5
    if (t >= 0.11) {
      const tt = t - 0.11
      s += Math.sin(2 * Math.PI * 1174.66 * t) * Math.exp(-tt * 8) // D6, rising fourth
    }
    s *= 0.28
    samples[i] = Math.max(-1, Math.min(1, s)) * 32767
  }
  const dataSize = samples.length * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true)
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)))
  }
  chimeDataUri = 'data:audio/wav;base64,' + btoa(binary)
  return chimeDataUri
}

let fallbackAudio: HTMLAudioElement | null = null
function getFallbackAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (fallbackAudio) return fallbackAudio
  try {
    fallbackAudio = new Audio(buildChimeDataUri())
    fallbackAudio.preload = 'auto'
  } catch {
    return null
  }
  return fallbackAudio
}

function playFallback(): void {
  const a = getFallbackAudio()
  if (!a) return
  try {
    a.muted = false
    a.currentTime = 0
    const p = a.play()
    if (p && typeof p.then === 'function') p.catch(() => {})
  } catch {
    /* blocked — nothing more we can do without a gesture */
  }
}

// Browsers create an AudioContext in the "suspended" state until a user gesture
// resumes it. Call this from inside a real click/keydown handler (Hub receives
// one almost immediately), AND on visibility/focus to keep the context warm, so
// that later background chimes are allowed to play. Also unlocks the HTMLAudio
// fallback within the gesture so it can play later in a backgrounded PWA.
export function primeChimeAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') {
    c.resume().catch(() => { /* will retry on the next gesture */ })
  }
  const a = getFallbackAudio()
  if (a) {
    try {
      a.muted = true
      const p = a.play()
      const reset = () => { a.pause(); a.currentTime = 0; a.muted = false }
      if (p && typeof p.then === 'function') p.then(reset).catch(() => { a.muted = false })
      else reset()
    } catch {
      /* ignore — will try again on the next gesture */
    }
  }
}

function playTones(c: AudioContext): void {
  const now = c.currentTime
  const notes: { freq: number; at: number }[] = [
    { freq: 880.0, at: 0 },      // A5
    { freq: 1174.66, at: 0.11 }, // D6 — a clean rising fourth
  ]
  for (const n of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = n.freq
    const start = now + n.at
    // Quick attack, smooth exponential decay. Peak ~0.16 = audible but gentle.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(start)
    osc.stop(start + 0.36)
  }
}

// Play a short, pleasant rising two-note "ding". Safe to call often: it no-ops
// if Web Audio is unavailable. If the context is still suspended — e.g. this is
// the very first user gesture — it resumes first and plays once that resolves,
// so the first tap isn't silent.
export function playChime(): void {
  const c = getCtx()
  // Running context (a normal browser tab after the first gesture): use the
  // crisp Web Audio synth — this is the path that already works.
  if (c && c.state === 'running') {
    playTones(c)
    return
  }
  // Suspended or unavailable — typical in a backgrounded installed PWA, where
  // Chrome won't resume the AudioContext from a background timer. Nudge it for
  // next time, but play NOW via the pre-unlocked HTMLAudio fallback.
  if (c && c.state === 'suspended') {
    c.resume().catch(() => {})
  }
  playFallback()
}
