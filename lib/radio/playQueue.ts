'use client'

// The receiving half: plays pieces in order as they land, so you hear someone about
// 2.5 seconds after they press rather than after they finish.
//
// One continuous Web Audio stream. Each piece is decoded and SCHEDULED to start on
// the exact sample the one before it ends, so the joins are seamless. Until Oct 15
// 2026 each piece played through its own <audio> element, one after another; Ben,
// counting to 30 on a live channel, heard a small break wherever a word straddled
// two pieces ("se… ven") — the time it takes a phone to start a fresh player. The
// capture side was already seamless; this makes playback match it.
//
// The <audio>-per-piece player is still here as the FALLBACK, per piece: a phone
// with no Web Audio, a stream that won't start, or a piece that won't decode plays
// the old way rather than not at all.
//
// The rules that make a live-feeling queue out of files arriving out of order:
//  - Strictly in seq order. A piece that arrives early waits its turn.
//  - A missing piece is waited for, but only briefly — a dropped syllable beats a
//    stalled channel, so after GAP_TOLERANCE_MS we skip it and carry on. The clock
//    starts when the audio already lined up RUNS OUT, not when we start waiting:
//    pieces are scheduled ahead, so we're usually waiting while one is still playing.
//  - "He stopped talking" is the end marker's piece count, never silence. Without it
//    a receiver cannot tell a finished sentence from a slow piece.

const GAP_TOLERANCE_MS = 3000
/** How long a piece's turn waits on its download before falling back to the
 *  direct link. Normally it finished long ago — it started when the piece arrived. */
const PREFETCH_WAIT_MS = 4000
/** How far ahead of "now" the first piece after a silence is scheduled — enough for
 *  the audio thread to pick it up cleanly. Later pieces butt up against the last. */
const SCHEDULE_LEAD_S = 0.08

let audioUnlocked = false
let sharedContext: AudioContext | null = null

/** One AudioContext for the page, made on first need. Null where there's no Web Audio. */
function radioAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try { sharedContext = new Ctor() } catch { sharedContext = null }
  return sharedContext
}

/** 'interrupted' is iOS's own state (a call took the audio), missing from the DOM types. */
function isRunning(c: AudioContext): boolean {
  return (c.state as string) === 'running'
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** iOS won't play audio that isn't rooted in a user gesture. Call this from a tap —
 *  Accept, opening the channel, a press of the talk button, or any tap on the page
 *  while a channel is open (the Hub-wide radio listens for them) — and WebKit lets
 *  the page play from then on, so the first arriving piece just plays. Page-wide on
 *  purpose: the player that needs it may be built after the tap that unlocks it. */
export function unlockRadioAudio(): void {
  // The stream: WebKit only lets an AudioContext run if it is started or resumed
  // inside a gesture, and iOS stops it after an interruption — so every tap tries
  // again while it isn't running. Cheap when it is.
  const c = radioAudioContext()
  if (c && !isRunning(c)) {
    void c.resume().catch(() => { /* the next tap tries again */ })
    try {
      // A one-sample silent buffer started inside the gesture is what WebKit wants.
      const src = c.createBufferSource()
      src.buffer = c.createBuffer(1, 1, 22050)
      src.connect(c.destination)
      src.start(0)
    } catch { /* not fatal */ }
  }

  // The fallback <audio> player.
  if (audioUnlocked) return
  audioUnlocked = true
  try {
    const a = new Audio()
    // 0.05s of silence — enough to satisfy the gesture requirement, inaudible.
    a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQQAAAAAAAAA'
    a.volume = 0
    // Refused (the event didn't count as a gesture) — let the next tap try again.
    void a.play().catch(() => { audioUnlocked = false })
  } catch { audioUnlocked = false }
}

type Incoming = { transmissionId: string; seq: number; pieceId: string }

export type PlayQueueEvents = {
  /** A transmission started playing (their name goes on screen, button locks). */
  onStart?: (transmissionId: string) => void
  /** Everything playable for that transmission has played. */
  onFinish?: (transmissionId: string) => void
  /** A piece was given up on. Worth counting; not worth interrupting anyone for. */
  onGap?: (transmissionId: string, seq: number) => void
}

export class RadioPlayQueue {
  private pieces = new Map<string, Map<number, string>>()   // transmissionId -> seq -> pieceId
  private totals = new Map<string, number>()                // transmissionId -> piece count (end marker)
  private order: string[] = []                              // transmissions awaiting playback, in arrival order
  private playing = false
  private current: HTMLAudioElement | null = null
  /** pieceId → the downloaded audio (null = download failed, use the direct link). */
  private prefetched = new Map<string, Promise<Blob | null>>()
  /** Pieces handed to the stream and not yet finished. */
  private sources = new Set<AudioBufferSourceNode>()
  /** Stream time at which the audio lined up so far runs out — where the next piece starts. */
  private playhead = 0
  /** Moves the queue past the current piece — kept so a resume that fails can't stall it. */
  private currentFinish: (() => void) | null = null
  private stopped = false
  private paused = false

  constructor(private events: PlayQueueEvents = {}) {}

  /** See unlockRadioAudio — kept so existing callers read naturally. */
  unlock(): void { unlockRadioAudio() }

  add(p: Incoming): void {
    let m = this.pieces.get(p.transmissionId)
    if (!m) { m = new Map(); this.pieces.set(p.transmissionId, m); this.order.push(p.transmissionId) }
    m.set(p.seq, p.pieceId)
    this.prefetch(p.pieceId)
    void this.pump()
  }

  /** The end marker: this transmission has exactly `pieceCount` pieces. */
  end(transmissionId: string, pieceCount: number | null): void {
    if (!this.pieces.has(transmissionId)) {
      // The end marker beat every piece — a hold that produced nothing, or one whose
      // uploads all failed. Register it so pump() can retire it rather than hang.
      this.pieces.set(transmissionId, new Map())
      this.order.push(transmissionId)
    }
    this.totals.set(transmissionId, pieceCount ?? 0)
    void this.pump()
  }

  /** Hold playback without losing anything — a phone call has the speaker. What
   *  arrives meanwhile waits in order and plays once the call is over; a piece cut
   *  off mid-word picks up where it stopped. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    // The stream freezes in place — its clock stops, so what's lined up plays from
    // exactly where it stopped once the call ends.
    const c = sharedContext
    if (paused) {
      if (c && isRunning(c)) void c.suspend().catch(() => {})
      this.current?.pause()
      return
    }
    if (c) void c.resume().catch(() => { /* the next tap resumes it (unlockRadioAudio) */ })
    // A piece that won't resume is skipped, never waited on forever.
    if (this.current) void this.current.play().catch(() => this.currentFinish?.())
    void this.pump()
  }

  /** Start downloading a piece the moment we hear it exists. Pieces arrive while the
   *  ones before them are still playing, so by its turn it's already here — the
   *  join between two pieces no longer waits on the network. */
  private prefetch(pieceId: string): void {
    if (this.prefetched.has(pieceId)) return
    this.prefetched.set(pieceId, fetch(`/api/hub/radio/piece/${pieceId}?bytes=1`, { cache: 'no-store' })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b && b.size > 0 && !this.stopped ? b : null))
      .catch(() => null))
  }

  private release(pieceId: string): void {
    this.prefetched.delete(pieceId)
  }

  /** The piece's audio — normally downloaded long ago. A slow download gets a little
   *  longer; after that, null (the caller plays the direct link). */
  private async blobFor(pieceId: string): Promise<Blob | null> {
    const pending = this.prefetched.get(pieceId) ?? Promise.resolve(null)
    return Promise.race([pending, sleep(PREFETCH_WAIT_MS).then(() => null)])
  }

  /** Stop everything — the channel closed, or the screen is going away. */
  stop(): void {
    this.stopped = true
    for (const id of [...this.prefetched.keys()]) this.release(id)
    for (const src of this.sources) { try { src.stop() } catch { /* already ended */ } }
    this.sources.clear()
    this.playhead = 0
    if (this.current) { this.current.pause(); this.current.src = ''; this.current = null }
    this.pieces.clear(); this.totals.clear(); this.order = []
    this.playing = false
  }

  private async pump(): Promise<void> {
    if (this.playing || this.stopped) return
    this.playing = true
    try {
      while (!this.stopped && this.order.length) {
        const id = this.order[0]
        await this.playTransmission(id)
        this.order.shift()
        this.pieces.delete(id)
        this.totals.delete(id)
        if (!this.stopped) this.events.onFinish?.(id)
      }
    } finally {
      this.playing = false
    }
  }

  private async playTransmission(id: string): Promise<void> {
    this.events.onStart?.(id)
    const c = await this.readyStream()
    let seq = 1
    let waitedSince = 0
    for (;;) {
      if (this.stopped) return
      if (this.paused) {
        // Time spent on a call is not time a piece was missing — don't let it
        // count toward the gap tolerance and skip words that are already here.
        waitedSince = 0
        await sleep(200)
        continue
      }
      const total = this.totals.get(id)
      if (total !== undefined && seq > total) break           // the end marker says that was all

      const pieceId = this.pieces.get(id)?.get(seq)
      if (pieceId) {
        waitedSince = 0
        if (!c || !(await this.schedule(c, pieceId))) {
          // The old way, for this piece: after whatever is already lined up.
          await this.drain(c)
          await this.playOne(pieceId)
          if (c) this.playhead = 0
        }
        seq++
        continue
      }

      // Nothing for this seq yet. While earlier audio is still playing it isn't a
      // gap — they're still talking. Count only once the lined-up audio runs out.
      if (c && this.playhead - c.currentTime > 0.05) { waitedSince = 0; await sleep(120); continue }
      if (total !== undefined && seq > total) break
      if (!waitedSince) waitedSince = Date.now()
      if (Date.now() - waitedSince > GAP_TOLERANCE_MS) {
        this.events.onGap?.(id, seq)
        waitedSince = 0
        seq++
        // A gap past the end marker's count means the tail never landed — stop.
        if (total !== undefined && seq > total) break
        continue
      }
      await sleep(120)
    }
    // Let the last of it play out before the "over" beep — the beep means the
    // channel is yours, and it isn't while their words are still coming out.
    await this.drain(c)
  }

  /** The stream, running — or null to use the old player for this transmission. */
  private async readyStream(): Promise<AudioContext | null> {
    const c = radioAudioContext()
    if (!c) return null
    if (this.paused || isRunning(c)) return c
    await Promise.race([c.resume().catch(() => {}), sleep(500)])
    return isRunning(c) ? c : null
  }

  /** Decode one piece and line it up to start the instant the audio before it ends.
   *  False when it can't go in the stream — the caller plays it the old way. */
  private async schedule(c: AudioContext, pieceId: string): Promise<boolean> {
    const blob = await this.blobFor(pieceId)
    if (!blob || this.stopped) return false
    let buf: AudioBuffer
    try { buf = await c.decodeAudioData(await blob.arrayBuffer()) } catch { return false }
    if (this.stopped) return true
    if (!this.paused && !isRunning(c)) {
      // iOS stopped the stream (an interruption, the app going to the back). Try to
      // start it again; if it won't, this piece goes the old way.
      await Promise.race([c.resume().catch(() => {}), sleep(500)])
      if (!isRunning(c)) return false
    }
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    const when = Math.max(c.currentTime + SCHEDULE_LEAD_S, this.playhead)
    src.start(when)
    this.playhead = when + buf.duration
    this.sources.add(src)
    src.onended = () => { this.sources.delete(src) }
    this.release(pieceId)
    return true
  }

  /** Wait for everything lined up in the stream to finish playing. */
  private async drain(c: AudioContext | null): Promise<void> {
    if (!c) return
    let stalled = 0
    while (!this.stopped && c.currentTime < this.playhead - 0.01) {
      if (!this.paused && !isRunning(c)) {
        // Frozen and not by us — nudge it, but never hang the channel on it: after
        // ~3 s give up on what's lined up rather than lock their button for good.
        void c.resume().catch(() => {})
        if (++stalled > 30) {
          for (const src of this.sources) { try { src.stop() } catch { /* ended */ } }
          this.sources.clear()
          this.playhead = 0
          return
        }
      } else stalled = 0
      await sleep(100)
    }
  }

  /** The old player, for one piece: its own <audio>, start to finish. */
  private async playOne(pieceId: string): Promise<void> {
    const blob = await this.blobFor(pieceId)
    if (this.stopped) { this.release(pieceId); return }
    const blobUrl = blob ? URL.createObjectURL(blob) : null
    try {
      await this.playSrc(blobUrl ?? `/api/hub/radio/piece/${pieceId}`)
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      this.release(pieceId)
    }
  }

  private playSrc(src: string): Promise<void> {
    return new Promise(resolve => {
      const a = new Audio(src)
      this.current = a
      let done = false
      const finish = () => { if (done) return; done = true; this.current = null; this.currentFinish = null; resolve() }
      this.currentFinish = finish
      a.onended = finish
      // A piece that won't play must not stall the queue — the next one is already here.
      a.onerror = finish
      // …except when a pause (a call starting) is what interrupted the play() — that
      // piece is resumed by setPaused(false), not skipped.
      a.play().catch(() => { if (!this.paused) finish() })
    })
  }
}
