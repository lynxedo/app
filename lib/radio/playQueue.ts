'use client'

// The receiving half: plays pieces in order as they land, so you hear someone about
// 2.5 seconds after they press rather than after they finish.
//
// One <audio> element per piece, played one after another. Phase 0 compared that
// against Web-Audio-scheduled playback on iPhone Chrome, iPhone Safari and Android:
// both were clean, and this is the one that needs no decoding step, survives the
// audio being fetched over the network, and is the shorter path to a first sound.
//
// The rules that make a live-feeling queue out of files arriving out of order:
//  - Strictly in seq order. A piece that arrives early waits its turn.
//  - A missing piece is waited for, but only briefly — a dropped syllable beats a
//    stalled channel, so after GAP_TOLERANCE_MS we skip it and carry on.
//  - "He stopped talking" is the end marker's piece count, never silence. Without it
//    a receiver cannot tell a finished sentence from a slow piece.

const GAP_TOLERANCE_MS = 3000
/** How long a piece's turn waits on its download before falling back to the
 *  direct link. Normally it finished long ago — it started when the piece arrived. */
const PREFETCH_WAIT_MS = 4000

let audioUnlocked = false

/** iOS won't play audio that isn't rooted in a user gesture. Call this from a tap —
 *  Accept, opening the channel, a press of the talk button, or any tap on the page
 *  while a channel is open (the Hub-wide radio listens for them) — and WebKit lets
 *  the page play from then on, so the first arriving piece just plays. Page-wide on
 *  purpose: the player that needs it may be built after the tap that unlocks it. */
export function unlockRadioAudio(): void {
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
  /** pieceId → the downloaded audio as a blob: URL (null = download failed, use the link). */
  private prefetched = new Map<string, Promise<string | null>>()
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
    if (paused) { this.current?.pause(); return }
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
      .then(b => (b && b.size > 0 && !this.stopped ? URL.createObjectURL(b) : null))
      .catch(() => null))
  }

  private release(pieceId: string): void {
    const p = this.prefetched.get(pieceId)
    this.prefetched.delete(pieceId)
    void p?.then(url => { if (url) URL.revokeObjectURL(url) })
  }

  /** Stop everything — the channel closed, or the screen is going away. */
  stop(): void {
    this.stopped = true
    for (const id of [...this.prefetched.keys()]) this.release(id)
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
    let seq = 1
    let waitedSince = 0
    for (;;) {
      if (this.stopped) return
      if (this.paused) {
        // Time spent on a call is not time a piece was missing — don't let it
        // count toward the gap tolerance and skip words that are already here.
        waitedSince = 0
        await new Promise(r => setTimeout(r, 200))
        continue
      }
      const total = this.totals.get(id)
      if (total !== undefined && seq > total) return          // the end marker says that was all

      const pieceId = this.pieces.get(id)?.get(seq)
      if (pieceId) {
        waitedSince = 0
        await this.playOne(pieceId)
        seq++
        continue
      }

      // Nothing for this seq yet. If the end marker has arrived and we're past the
      // count, we're done; otherwise wait — but not forever.
      if (total !== undefined && seq > total) return
      if (!waitedSince) waitedSince = Date.now()
      if (Date.now() - waitedSince > GAP_TOLERANCE_MS) {
        this.events.onGap?.(id, seq)
        waitedSince = 0
        seq++
        // A gap past the end marker's count means the tail never landed — stop.
        if (total !== undefined && seq > total) return
        continue
      }
      await new Promise(r => setTimeout(r, 120))
    }
  }

  private async playOne(pieceId: string): Promise<void> {
    // Normally already downloaded. If not (a slow download, or it failed), wait a
    // little, then fall back to the direct link — the pre-prefetch behaviour.
    const pending = this.prefetched.get(pieceId) ?? Promise.resolve(null)
    const blobUrl = await Promise.race([
      pending,
      new Promise<null>(r => setTimeout(() => r(null), PREFETCH_WAIT_MS)),
    ])
    if (this.stopped) { this.release(pieceId); return }
    try {
      await this.playSrc(blobUrl ?? `/api/hub/radio/piece/${pieceId}`)
    } finally {
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
