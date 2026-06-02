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

// Browsers create an AudioContext in the "suspended" state until a user gesture
// resumes it. Call this from inside a real click/keydown handler (Hub receives
// one almost immediately) so that later background chimes are allowed to play.
export function primeChimeAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') {
    c.resume().catch(() => { /* will retry on the next gesture */ })
  }
}

// Play a short, pleasant rising two-note "ding". Safe to call often: it no-ops
// if Web Audio is unavailable, and stays quiet until the context has been
// unlocked by a user gesture (see primeChimeAudio).
export function playChime(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') {
    c.resume().catch(() => {})
    return
  }
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
