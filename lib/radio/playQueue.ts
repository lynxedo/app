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
  private stopped = false
  private unlocked = false

  constructor(private events: PlayQueueEvents = {}) {}

  /** iOS won't play audio that isn't rooted in a user gesture. Called from the tap
   *  that accepts or opens the channel, so the first arriving piece just plays. */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    try {
      const a = new Audio()
      // 0.05s of silence — enough to satisfy the gesture requirement, inaudible.
      a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQQAAAAAAAAA'
      a.volume = 0
      void a.play().catch(() => { /* not fatal — the first real piece may still work */ })
    } catch { /* ditto */ }
  }

  add(p: Incoming): void {
    let m = this.pieces.get(p.transmissionId)
    if (!m) { m = new Map(); this.pieces.set(p.transmissionId, m); this.order.push(p.transmissionId) }
    m.set(p.seq, p.pieceId)
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

  /** Stop everything — the channel closed, or the screen is going away. */
  stop(): void {
    this.stopped = true
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

  private playOne(pieceId: string): Promise<void> {
    return new Promise(resolve => {
      const a = new Audio(`/api/hub/radio/piece/${pieceId}`)
      this.current = a
      let done = false
      const finish = () => { if (done) return; done = true; this.current = null; resolve() }
      a.onended = finish
      // A piece that won't play must not stall the queue — the next one is already here.
      a.onerror = finish
      a.play().catch(finish)
    })
  }
}
