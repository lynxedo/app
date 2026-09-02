// Per-device notification sounds for Hub.
//
// Played by WebChimeNotifier when something arrives while the Hub tab is OPEN
// but not focused (the user is on another tab or another app). Every sound is a
// short synthesized note pattern via the Web Audio API — there are no audio
// asset files to ship.
//
// Each KIND of event (Hub message, customer text, shared-inbox email, Daily Log
// update) gets its own sound so you can tell what arrived without looking. The
// mapping is per-device and user-changeable in Settings → Notifications.
//
// The on/off preference and the sound choices are intentionally PER-DEVICE
// (localStorage), not per-account: you may want sound on your office desktop but
// off on a shared machine, and the speakers differ from room to room. Defaults
// are on, with Hub messages keeping the long-standing two-note chime.

const STORAGE_KEY = 'hub-chime-enabled'
const SOUNDS_KEY = 'hub-chime-sounds'

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

// ── Sound library ──────────────────────────────────────────────────────────
// A sound is a list of notes: `freq` in Hz, `at` = seconds from the start, and
// `decay` = how fast that note falls away (bigger = shorter). Both the Web Audio
// synth and the WAV fallback below render from this same definition, so a sound
// is identical however it ends up being played.

type Note = { freq: number; at: number; decay: number }

export type ChimeSoundId =
  | 'chime'
  | 'ding'
  | 'double'
  | 'descend'
  | 'marimba'
  | 'soft'
  | 'alert'

export const CHIME_SOUNDS: { id: ChimeSoundId; label: string; notes: Note[] }[] = [
  // The original Hub sound — a clean rising fourth (A5 → D6).
  { id: 'chime',   label: 'Chime',      notes: [{ freq: 880.00, at: 0, decay: 8 }, { freq: 1174.66, at: 0.11, decay: 8 }] },
  { id: 'ding',    label: 'Ding',       notes: [{ freq: 1046.50, at: 0, decay: 6 }] },
  { id: 'double',  label: 'Double tap', notes: [{ freq: 1318.51, at: 0, decay: 14 }, { freq: 1318.51, at: 0.09, decay: 12 }] },
  // The chime inverted — a falling fourth reads as "incoming", not "done".
  { id: 'descend', label: 'Descending', notes: [{ freq: 1174.66, at: 0, decay: 8 }, { freq: 880.00, at: 0.11, decay: 8 }] },
  { id: 'marimba', label: 'Marimba',    notes: [{ freq: 1046.50, at: 0, decay: 13 }, { freq: 1318.51, at: 0.07, decay: 13 }, { freq: 1567.98, at: 0.14, decay: 10 }] },
  // Lower and gentler — for a steady trickle you don't want to jump at.
  { id: 'soft',    label: 'Soft',       notes: [{ freq: 440.00, at: 0, decay: 5 }, { freq: 523.25, at: 0.13, decay: 5 }] },
  { id: 'alert',   label: 'Alert',      notes: [{ freq: 1567.98, at: 0, decay: 18 }, { freq: 1567.98, at: 0.08, decay: 18 }, { freq: 1567.98, at: 0.16, decay: 14 }] },
]

const SOUND_BY_ID: Record<string, Note[]> = Object.fromEntries(
  CHIME_SOUNDS.map((s) => [s.id, s.notes])
)

// The kinds of event that can ring. Each maps to a sound below.
export type ChimeKind = 'message' | 'txt' | 'email' | 'daily-log'

export const CHIME_KINDS: { kind: ChimeKind; label: string; hint: string }[] = [
  { kind: 'message',   label: 'Hub messages',   hint: 'Rooms and DMs you belong to' },
  { kind: 'txt',       label: 'Customer texts', hint: 'New inbound text in Txt' },
  { kind: 'email',     label: 'Inbox email',    hint: 'New mail in the shared Inbox, or a reply on a thread assigned to you' },
  { kind: 'daily-log', label: 'Daily Log',      hint: 'New Daily Log updates' },
]

// Hub messages keep the sound this app has always played; the other kinds get
// distinct defaults so they're distinguishable out of the box.
const DEFAULT_SOUNDS: Record<ChimeKind, ChimeSoundId> = {
  message: 'chime',
  txt: 'marimba',
  email: 'soft',
  'daily-log': 'double',
}

function readSoundMap(): Partial<Record<ChimeKind, ChimeSoundId>> {
  try {
    const raw = localStorage.getItem(SOUNDS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<Record<ChimeKind, ChimeSoundId>> = {}
    for (const { kind } of CHIME_KINDS) {
      const v = parsed[kind]
      // Ignore anything that isn't a sound we still ship — a stale id from an
      // older build must fall back to the default, never play silence.
      if (typeof v === 'string' && v in SOUND_BY_ID) out[kind] = v as ChimeSoundId
    }
    return out
  } catch {
    return {}
  }
}

export function getChimeSound(kind: ChimeKind): ChimeSoundId {
  return readSoundMap()[kind] ?? DEFAULT_SOUNDS[kind]
}

export function setChimeSound(kind: ChimeKind, sound: ChimeSoundId): void {
  try {
    const next = { ...readSoundMap(), [kind]: sound }
    localStorage.setItem(SOUNDS_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked — non-critical */
  }
  // Unlock this sound's fallback element now, while we're still inside the click
  // that chose it, so a later background ring isn't silent in a PWA.
  primeChimeAudio()
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
// gesture) — so the Web Audio synth below goes silent there even though it
// works fine in a normal browser tab. An <audio> element, once unlocked during
// a gesture, keeps playing in the background. We render each sound to a WAV data
// URI (no asset to ship) and use it only when the AudioContext can't play.
// iOS PWAs suspend background audio at the OS level — nothing client-side can
// fix that; mobile relies on the native push sound.
//
// One element PER SOUND, because unlocking is per-element: swapping `src` on an
// unlocked element is not reliably still unlocked. Only the sounds actually in
// use (plus whatever's being previewed) ever get built.

const dataUriCache = new Map<string, string>()

function buildDataUri(soundId: string): string {
  const cached = dataUriCache.get(soundId)
  if (cached) return cached
  const notes = SOUND_BY_ID[soundId] ?? SOUND_BY_ID.chime
  const sampleRate = 44100
  const lastAt = notes.reduce((m, n) => Math.max(m, n.at), 0)
  const length = Math.floor(sampleRate * (lastAt + 0.45))
  const samples = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let s = 0
    for (const n of notes) {
      if (t < n.at) continue
      const tt = t - n.at
      s += Math.sin(2 * Math.PI * n.freq * tt) * Math.exp(-tt * n.decay)
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
  const uri = 'data:audio/wav;base64,' + btoa(binary)
  dataUriCache.set(soundId, uri)
  return uri
}

const fallbackAudio = new Map<string, HTMLAudioElement>()

function getFallbackAudio(soundId: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  const existing = fallbackAudio.get(soundId)
  if (existing) return existing
  try {
    const a = new Audio(buildDataUri(soundId))
    a.preload = 'auto'
    fallbackAudio.set(soundId, a)
    return a
  } catch {
    return null
  }
}

function playFallback(soundId: string): void {
  const a = getFallbackAudio(soundId)
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

// The sounds whose fallback elements need unlocking: everything currently mapped
// to a kind, plus anything previewed this session (already in the map).
function soundsToPrime(): string[] {
  const ids = new Set<string>(fallbackAudio.keys())
  for (const { kind } of CHIME_KINDS) ids.add(getChimeSound(kind))
  return Array.from(ids)
}

// Browsers create an AudioContext in the "suspended" state until a user gesture
// resumes it. Call this from inside a real click/keydown handler (Hub receives
// one almost immediately), AND on visibility/focus to keep the context warm, so
// that later background chimes are allowed to play. Also unlocks the HTMLAudio
// fallbacks within the gesture so they can play later in a backgrounded PWA.
export function primeChimeAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') {
    c.resume().catch(() => { /* will retry on the next gesture */ })
  }
  for (const id of soundsToPrime()) {
    const a = getFallbackAudio(id)
    if (!a) continue
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

function playTones(c: AudioContext, soundId: string): void {
  const notes = SOUND_BY_ID[soundId] ?? SOUND_BY_ID.chime
  const now = c.currentTime
  for (const n of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = n.freq
    const start = now + n.at
    // Quick attack, smooth exponential decay. Peak ~0.16 = audible but gentle.
    // `decay` sets the tail length: 4/decay seconds lands ~1% of peak.
    const tail = Math.min(0.9, 4 / n.decay)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tail)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(start)
    osc.stop(start + tail + 0.04)
  }
}

// Play the sound for one kind of event — a short, pleasant note pattern. Safe to
// call often: it no-ops if Web Audio is unavailable. If the context is still
// suspended — e.g. this is the very first user gesture — it resumes first and
// plays once that resolves, so the first tap isn't silent.
//
// `kind` defaults to 'message' so any older call site keeps its original sound.
export function playChime(kind: ChimeKind = 'message'): void {
  playSoundId(getChimeSound(kind))
}

// Play one specific sound regardless of the kind mapping — used by the Settings
// picker so you can hear a sound before choosing it.
export function previewChimeSound(soundId: ChimeSoundId): void {
  playSoundId(soundId)
}

function playSoundId(soundId: string): void {
  const c = getCtx()
  if (!c) { playFallback(soundId); return }
  // Running (a normal focused tab after the first gesture): play the synth.
  if (c.state === 'running') {
    playTones(c, soundId)
    return
  }
  // Suspended — a BACKGROUNDED browser tab (Chrome suspends the context) OR an
  // installed PWA. Resume then play the synth: this is the path that works in a
  // normal backgrounded tab. Only if the context refuses to resume (the PWA
  // case, where Chrome blocks a background resume) do we use the pre-unlocked
  // <audio> fallback.
  c.resume()
    .then(() => {
      if (c.state === 'running') playTones(c, soundId)
      else playFallback(soundId)
    })
    .catch(() => playFallback(soundId))
}
