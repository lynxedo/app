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
/** True while a queue has the stream suspended for a phone call. A tap during the
 *  call (mute, the keypad) must NOT resume it — that would play radio over the customer. */
let streamHeld = false
/** The stream has run at least once (a gesture started it). Until then, lining audio
 *  up in it is a bet that it will start without a tap — not one we take. */
let streamHasRun = false

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
  const running = (c.state as string) === 'running'
  if (running) streamHasRun = true
  return running
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** A decode that hasn't answered in this long is treated as failed (old player). */
const DECODE_WAIT_MS = 3000
/** With no end marker, this many missing pieces in a row means the sender is gone —
 *  retire the transmission instead of skipping a seq every few seconds forever. */
const MAX_GAPS_WITHOUT_END = 3
/** How long a stream frozen by the OS (not by us) is nudged before we stop waiting on it. */
const STALL_LIMIT_MS = 3000
/** The longest one piece may take on the old player before it's given up on. */
const PLAY_LIMIT_MS = 12_000

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
  if (c && !isRunning(c) && !streamHeld) {
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

/** A piece lined up in the stream, kept until it has played so that, if the OS
 *  freezes the stream under it, it can still be played the old way. */
type Scheduled = { src: AudioBufferSourceNode; blob: Blob; start: number; end: number }

export class RadioPlayQueue {
  private pieces = new Map<string, Map<number, string>>()   // transmissionId -> seq -> pieceId
  private totals = new Map<string, number>()                // transmissionId -> piece count (end marker)
  private order: string[] = []                              // transmissions awaiting playback, in arrival order
  /** Transmissions already played out. A late piece or a repeated end marker for one
   *  of these must not start it again (lock their button, chirp, then skip forever). */
  private finished = new Set<string>()
  /** transmissionId → the next seq to play; anything below it arrived too late. */
  private cursor = new Map<string, number>()
  private playing = false
  private current: HTMLAudioElement | null = null
  /** pieceId → the downloaded audio (null = download failed, use the direct link). */
  private prefetched = new Map<string, Promise<Blob | null>>()
  /** Pieces handed to the stream and not yet finished. */
  private scheduled: Scheduled[] = []
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
    if (this.stopped || this.finished.has(p.transmissionId)) return
    if (p.seq < (this.cursor.get(p.transmissionId) ?? 1)) return   // its turn has passed (skipped as a gap)
    let m = this.pieces.get(p.transmissionId)
    if (!m) { m = new Map(); this.pieces.set(p.transmissionId, m); this.order.push(p.transmissionId) }
    m.set(p.seq, p.pieceId)
    this.prefetch(p.pieceId)
    void this.pump()
  }

  /** The end marker: this transmission has exactly `pieceCount` pieces. */
  end(transmissionId: string, pieceCount: number | null): void {
    if (this.stopped || this.finished.has(transmissionId)) return
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
    streamHeld = paused
    // The stream freezes in place — its clock stops, so what's lined up plays from
    // exactly where it stopped once the call ends.
    const c = sharedContext
    if (paused) {
      // Always, even if it reads suspended — a resume may be in flight (a tap, the
      // queue before this one) and would otherwise land mid-call.
      if (c) void c.suspend().catch(() => {})
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
    this.prefetched.clear()
    this.stopScheduled()
    if (this.current) { this.current.pause(); this.current.src = '' }
    this.currentFinish?.()                  // settle the old player's promise so nothing waits on it
    this.current = null
    this.pieces.clear(); this.totals.clear(); this.order = []; this.cursor.clear()
    // A queue stopped mid-call hands the hold on: the stream stays suspended (the
    // next queue's setPaused / readyStream / a tap resumes it when there's no call),
    // but this queue's claim on it is let go. Resuming here could land mid-call.
    if (this.paused) {
      this.paused = false
      streamHeld = false
    }
  }

  private stopScheduled(): void {
    for (const s of this.scheduled) { try { s.src.stop() } catch { /* already ended */ } }
    this.scheduled = []
    this.playhead = 0
  }

  private async pump(): Promise<void> {
    if (this.playing || this.stopped) return
    this.playing = true
    try {
      while (!this.stopped && this.order.length) {
        const id = this.order[0]
        try {
          await this.playTransmission(id)
        } catch {
          // Whatever went wrong, the transmission is retired and the far end's
          // button released — a stuck "Mike is talking" is the one unacceptable outcome.
          this.stopScheduled()
        }
        this.order.shift()
        this.pieces.delete(id)
        this.totals.delete(id)
        this.cursor.delete(id)
        this.finished.add(id)
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
    let gapsInARow = 0
    let frozenSince = 0
    for (;;) {
      this.cursor.set(id, seq)
      if (this.stopped) return
      if (this.paused) {
        // Time spent on a call is not time a piece was missing — don't let it
        // count toward the gap tolerance and skip words that are already here.
        waitedSince = 0
        frozenSince = 0
        await sleep(200)
        continue
      }
      const total = this.totals.get(id)
      if (total !== undefined && seq > total) break           // the end marker says that was all

      const pieceId = this.pieces.get(id)?.get(seq)
      if (pieceId) {
        waitedSince = 0
        gapsInARow = 0
        if (!c || !(await this.schedule(c, pieceId))) {
          // The old way, for this piece: after whatever is already lined up.
          await this.drain(c)
          await this.playOne(pieceId)
        }
        seq++
        continue
      }

      // Nothing for this seq yet. While earlier audio is still PLAYING it isn't a
      // gap — they're still talking. A stream the OS has frozen isn't playing: nudge
      // it, and if it stays frozen, play what's lined up the old way and move on.
      if (c && this.playhead - c.currentTime > 0.05) {
        if (isRunning(c)) { frozenSince = 0; waitedSince = 0; await sleep(120); continue }
        void c.resume().catch(() => {})
        if (!frozenSince) frozenSince = Date.now()
        if (Date.now() - frozenSince < STALL_LIMIT_MS) { await sleep(120); continue }
        await this.rescueFrozen()
        frozenSince = 0
      }
      if (!waitedSince) waitedSince = Date.now()
      if (Date.now() - waitedSince > GAP_TOLERANCE_MS) {
        this.events.onGap?.(id, seq)
        waitedSince = 0
        seq++
        gapsInARow++
        // A gap past the end marker's count means the tail never landed — stop.
        if (total !== undefined && seq > total) break
        // No end marker and nothing for a while: they've gone. Don't spin forever.
        if (total === undefined && gapsInARow >= MAX_GAPS_WITHOUT_END) break
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
    if (isRunning(c)) return c
    // Suspended by our own call-pause and known to work: it resumes when the call ends.
    if (this.paused) return streamHasRun ? c : null
    await Promise.race([c.resume().catch(() => {}), sleep(500)])
    return isRunning(c) ? c : null
  }

  /** Decode one piece and line it up to start the instant the audio before it ends.
   *  False when it can't go in the stream — the caller plays it the old way. Never throws. */
  private async schedule(c: AudioContext, pieceId: string): Promise<boolean> {
    try {
      const blob = await this.blobFor(pieceId)
      if (!blob || this.stopped) return false
      const data = await blob.arrayBuffer()
      // The promise form; old WebKit only had callbacks (and would resolve undefined).
      const buf = await Promise.race([
        c.decodeAudioData(data).catch(() => null),
        sleep(DECODE_WAIT_MS).then(() => null),
      ])
      if (!buf || !(buf.duration > 0)) return false
      if (this.stopped) return true
      if (!this.paused && !isRunning(c)) {
        // iOS stopped the stream (an interruption, the app going to the back). Try to
        // start it again; if it won't, this piece goes the old way.
        await Promise.race([c.resume().catch(() => {}), sleep(500)])
        if (!isRunning(c)) return false
      }
      if (this.stopped) return true                 // stopped during that wait — start nothing
      // On a call, the stream must be frozen before anything goes in it.
      if (this.paused && isRunning(c)) await c.suspend().catch(() => {})
      const src = c.createBufferSource()
      src.buffer = buf
      src.connect(c.destination)
      const when = Math.max(c.currentTime + SCHEDULE_LEAD_S, this.playhead)
      src.start(when)
      const entry: Scheduled = { src, blob, start: when, end: when + buf.duration }
      this.scheduled.push(entry)
      this.playhead = entry.end
      src.onended = () => { this.scheduled = this.scheduled.filter(e => e !== entry) }
      this.release(pieceId)
      return true
    } catch {
      return false
    }
  }

  /** Wait for everything lined up in the stream to finish playing. */
  private async drain(c: AudioContext | null): Promise<void> {
    if (!c) return
    let frozenSince = 0
    while (!this.stopped && c.currentTime < this.playhead - 0.01) {
      if (this.paused || isRunning(c)) { frozenSince = 0; await sleep(100); continue }
      // Frozen, and not by us — nudge it, but never hang the channel on it.
      void c.resume().catch(() => {})
      if (!frozenSince) frozenSince = Date.now()
      if (Date.now() - frozenSince > STALL_LIMIT_MS) { await this.rescueFrozen(); return }
      await sleep(100)
    }
  }

  /** The OS froze the stream with words still in it. Play those the old way, in
   *  order, rather than lose them, and start the stream afresh next time. */
  private async rescueFrozen(): Promise<void> {
    const c = sharedContext
    const now = c ? c.currentTime : 0
    // A piece frozen part-way picks up where it stopped, not from its start.
    const unplayed = this.scheduled
      .filter(e => e.end > now + 0.01)
      .map(e => ({ blob: e.blob, from: Math.max(0, now - e.start) }))
    this.stopScheduled()
    for (const { blob, from } of unplayed) {
      if (this.stopped) return
      const url = URL.createObjectURL(blob)
      try { await this.playSrc(url, from) } finally { URL.revokeObjectURL(url) }
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

  private playSrc(src: string, fromSeconds = 0): Promise<void> {
    return new Promise(resolve => {
      if (this.stopped) { resolve(); return }
      const a = new Audio(src)
      this.current = a
      let done = false
      let limit: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (done) return
        done = true
        if (limit) clearTimeout(limit)
        if (this.current === a) this.current = null
        this.currentFinish = null
        resolve()
      }
      this.currentFinish = finish
      // A play() the OS leaves hanging (an interruption) must not hold the channel:
      // no piece is longer than 5 s, so after this long it's given up on. Time on a
      // call doesn't count — the limit is re-armed each time the piece is started.
      const arm = () => {
        if (limit) clearTimeout(limit)
        limit = setTimeout(() => { if (!this.paused) { a.pause(); finish() } else arm() }, PLAY_LIMIT_MS)
      }
      arm()
      if (fromSeconds > 0) a.addEventListener('loadedmetadata', () => { try { a.currentTime = fromSeconds } catch { /* plays from the start */ } }, { once: true })
      a.onended = finish
      // A piece that won't play must not stall the queue — the next one is already here.
      a.onerror = finish
      // On a call: don't start it — setPaused(false) plays `current` when the call ends.
      if (this.paused) return
      // …and when a pause (a call starting) is what interrupted the play(), that
      // piece is resumed by setPaused(false), not skipped.
      a.play().catch(() => { if (!this.paused) finish() })
    })
  }
}
