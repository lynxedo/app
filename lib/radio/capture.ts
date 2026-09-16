'use client'

// Radio's microphone. Everything here is a direct consequence of Phase 0
// (Sep 16 2026 — see Hub/HUB_RADIO_PRD.md, "Phase 0 — what it found"), so the
// three rules below are findings, not preferences:
//
//  1. NEVER stop and restart the recorder to make a piece. Doing that loses
//     86–204ms of speech at every restart on every platform measured; "twenty-four"
//     came back as "four". We hold one unbroken capture and cut pieces out of it,
//     so a join is an index into a buffer that was never interrupted.
//  2. AudioWorklet, not ScriptProcessorNode. The old API hands each buffer to the
//     main thread, and on WebKit a late main thread can read a buffer that was
//     overwritten under it — the sample COUNT survives, the CONTENT doesn't, so the
//     loss never shows up as a gap. ScriptProcessor stays only as a fallback.
//  3. Voice processing OFF, all three constraints. Android Chrome's auto-gain
//     slashed the volume mid-take, reproducibly, in the recording itself. A
//     one-at-a-time radio has nothing playing while you talk, so there is no echo
//     to cancel — off is correct here regardless.
//
// Nothing heavier than a memcpy runs on the capture path: an early build encoded
// WAV inside the audio callback and stalled capture at every cut, breaking the very
// continuity this design exists to protect. Resampling, encoding and uploading all
// happen on the main thread, where the worklet doesn't care what they cost.

import {
  RADIO_HOLD_CAP_MS,
  RADIO_PIECE_FIRST_MS,
  RADIO_PIECE_REST_MS,
} from './types'

/** Telephone quality. ~160KB per 5s piece as WAV; Opus later cuts that to ~25KB. */
const OUTPUT_RATE = 16_000
const UPLOAD_ATTEMPTS = 3

const WORKLET_SRC = `
class RadioCap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0
    this.port.onmessage = () => { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0 } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true
    let i = 0
    while (i < ch.length) {
      const take = Math.min(ch.length - i, 4096 - this.n)
      this.buf.set(ch.subarray(i, i + take), this.n); this.n += take; i += take
      if (this.n === 4096) { this.port.postMessage(this.buf); this.buf = new Float32Array(4096); this.n = 0 }
    }
    return true
  }
}
registerProcessor('radio-cap', RadioCap)
`

/** Down to 16kHz by averaging each output sample's source window — the averaging
 *  is also the anti-alias filter, which plain decimation would skip. */
function resample(src: Float32Array, srcRate: number, dstRate = OUTPUT_RATE): Float32Array {
  if (srcRate === dstRate) return src
  const ratio = srcRate / dstRate
  const out = new Float32Array(Math.floor(src.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(src.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += src[j]
    out[i] = end > start ? sum / (end - start) : 0
  }
  return out
}

function wavBlob(samples: Float32Array, rate: number): Blob {
  const ab = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(ab)
  const tag = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  tag(0, 'RIFF');  v.setUint32(4, 36 + samples.length * 2, true); tag(8, 'WAVE')
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  tag(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([ab], { type: 'audio/wav' })
}

/** Phase 0: a Bluetooth headset is clean for ~30s on the web path and then degrades,
 *  on every capture method and both playback paths. We can't fix it before the native
 *  release, so we say so — a silent degradation 30 seconds in is far worse. */
export function bluetoothWarningFor(stream: MediaStream | null): string | null {
  const label = stream?.getAudioTracks()[0]?.label ?? ''
  if (!label) return null
  if (/airpod|bluetooth|\bbt\b|headset|buds|beats|jabra|bose|sony wh|wireless/i.test(label)) {
    return `Radio is using “${label}”. Bluetooth earpieces drop out after about half a minute — use the phone’s own microphone until the app update.`
  }
  return null
}

export type CaptureEvents = {
  /** Fires once per piece, after it has been handed to the uploader. */
  onPiece?: (seq: number) => void
  /** A piece that could not be uploaded after every retry. The rest still play. */
  onPieceFailed?: (seq: number) => void
  /** The 60s cap released the button for them. */
  onCap?: () => void
  onError?: (message: string) => void
}

export class RadioCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private workletReady = false

  private accepting = false        // true from press to the tail flush
  private batches: Float32Array[] = []
  private held = 0                 // source-rate samples held
  private target = 0               // source-rate samples wanted for the piece being filled
  private seq = 0
  private startedAt = 0
  private capTimer: ReturnType<typeof setTimeout> | null = null
  private uploads: Promise<void>[] = []
  private flushResolve: (() => void) | null = null

  /** Set once the far end has a transmission id. Pieces before it are held. */
  private transmissionId: string | null = null
  private pending: { seq: number; blob: Blob; durationMs: number }[] = []

  constructor(private events: CaptureEvents = {}) {}

  get mediaStream() { return this.stream }
  /** The transmission this hold belongs to; null if the far end never confirmed one. */
  get currentTransmissionId() { return this.transmissionId }
  get captureKind() { return this.node instanceof AudioWorkletNode ? 'audioworklet' : this.node ? 'scriptprocessor' : 'none' }

  /** Opens the mic and builds the graph. Called once when the channel opens, so the
   *  first press doesn't wait on a permission prompt. Safe to call repeatedly. */
  async open(): Promise<void> {
    if (this.stream?.active && this.node) return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = this.ctx ?? new Ctx()
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this.stream = await navigator.mediaDevices.getUserMedia({
      // See rule 3 at the top of this file — these being false is a Phase 0 finding.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })

    const c = this.ctx
    this.source = c.createMediaStreamSource(this.stream)
    // Silent sink: some browsers won't pump a capture node unless it reaches the
    // destination, and routing a mic to the speakers at audible gain is a feedback
    // howl on a phone held to your face.
    this.sink = c.createGain(); this.sink.gain.value = 0

    let node: AudioWorkletNode | ScriptProcessorNode | null = null
    if (c.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        if (!this.workletReady) {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
          await c.audioWorklet.addModule(url)
          URL.revokeObjectURL(url)
          this.workletReady = true
        }
        const w = new AudioWorkletNode(c, 'radio-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
        w.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (!this.accepting) return
          this.absorb(e.data)
          // Only the flush reply is ever shorter than a full batch.
          if (e.data.length < 4096 && this.flushResolve) { const r = this.flushResolve; this.flushResolve = null; r() }
        }
        node = w
      } catch { node = null }
    }
    if (!node) {
      const sp = c.createScriptProcessor(4096, 1, 1)
      sp.onaudioprocess = e => {
        if (!this.accepting) return
        this.absorb(new Float32Array(e.inputBuffer.getChannelData(0)))  // copy — the event buffer is reused
      }
      node = sp
    }
    this.node = node
    this.source.connect(node as AudioNode)
    ;(node as AudioNode).connect(this.sink)
    this.sink.connect(c.destination)
  }

  /** Begin a hold. The caller starts the transmission over the network in parallel and
   *  hands the id back via `attach` — audio is captured from this instant either way,
   *  so the first syllable isn't lost to a round trip. */
  begin(): void {
    if (!this.node) throw new Error('Radio capture is not open')
    this.accepting = true
    this.batches = []; this.held = 0; this.seq = 0
    this.uploads = []; this.pending = []; this.transmissionId = null
    this.startedAt = performance.now()
    this.target = Math.round(this.srcRate * RADIO_PIECE_FIRST_MS / 1000)
    this.capTimer = setTimeout(() => this.events.onCap?.(), RADIO_HOLD_CAP_MS)
  }

  /** The transmission id arrived; release anything recorded while we waited. */
  attach(transmissionId: string): void {
    this.transmissionId = transmissionId
    const queued = this.pending
    this.pending = []
    for (const p of queued) this.send(p.seq, p.blob, p.durationMs)
  }

  /** Release. Flushes the tail, waits for uploads, and reports what to put in the
   *  end marker. Returns zero pieces if the hold was abandoned (e.g. a 409). */
  async end(): Promise<{ pieceCount: number; durationMs: number }> {
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = null }
    const durationMs = Math.round(performance.now() - this.startedAt)

    if (this.node instanceof AudioWorkletNode) {
      await new Promise<void>(res => {
        this.flushResolve = res
        setTimeout(() => { if (this.flushResolve) { this.flushResolve = null; res() } }, 300)
        try {
          if (this.node instanceof AudioWorkletNode) this.node.port.postMessage('flush')
          else res()
        } catch { res() }
      })
    }
    this.accepting = false
    if (this.held > 0) { this.target = this.held; this.cut() }   // the tail, however short
    this.batches = []; this.held = 0

    // Snapshot before awaiting. A second press can call begin() while these uploads
    // are still in flight, and begin() replaces both fields — awaiting this.uploads
    // afterwards would wait on the NEW hold's (empty) list and report the NEW seq,
    // sending an end marker whose piece count is wrong for the transmission it ends.
    // The in-flight uploads captured their own transmission id, so they still land.
    const uploads = this.uploads
    const pieceCount = this.seq
    await Promise.allSettled(uploads)
    return { pieceCount, durationMs }
  }

  /** Abandon the hold without sending anything — used when the far end says the other
   *  person got there first. Hearing your own sentence replayed into a conversation
   *  that has moved on is worse than losing it. */
  discard(): void {
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = null }
    this.accepting = false
    this.batches = []; this.held = 0; this.pending = []; this.transmissionId = null
  }

  /** Drop the mic. The recording indicator staying on all afternoon is the fastest
   *  way to lose trust in a feature like this. */
  close(): void {
    this.discard()
    try { this.source?.disconnect() } catch { /* already gone */ }
    try { (this.node as AudioNode | null)?.disconnect() } catch { /* already gone */ }
    try { this.sink?.disconnect() } catch { /* already gone */ }
    if (this.node && 'onaudioprocess' in this.node) (this.node as ScriptProcessorNode).onaudioprocess = null
    this.stream?.getTracks().forEach(t => t.stop())
    this.source = null; this.node = null; this.sink = null; this.stream = null
  }

  private get srcRate() { return this.ctx?.sampleRate ?? 48_000 }

  private absorb(batch: Float32Array): void {
    this.batches.push(batch)
    this.held += batch.length
    while (this.held >= this.target) {
      this.cut()
      this.target = Math.round(this.srcRate * RADIO_PIECE_REST_MS / 1000)
    }
  }

  /** Take `target` source samples off the front and turn them into a piece. */
  private cut(): void {
    const take = Math.min(this.held, this.target)
    if (take <= 0) return
    const src = new Float32Array(take)
    let filled = 0
    while (filled < take && this.batches.length) {
      const head = this.batches[0]
      const need = take - filled
      if (head.length <= need) { src.set(head, filled); filled += head.length; this.batches.shift() }
      else { src.set(head.subarray(0, need), filled); this.batches[0] = head.subarray(need); filled += need }
    }
    this.held -= take

    const seq = ++this.seq
    const blob = wavBlob(resample(src, this.srcRate), OUTPUT_RATE)
    const durationMs = Math.round((take / this.srcRate) * 1000)
    if (this.transmissionId) this.send(seq, blob, durationMs)
    else this.pending.push({ seq, blob, durationMs })   // still waiting on the id
  }

  private send(seq: number, blob: Blob, durationMs: number): void {
    const id = this.transmissionId
    if (!id) return
    this.uploads.push((async () => {
      for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
        try {
          const body = new FormData()
          body.append('file', blob, `${seq}.wav`)
          body.append('seq', String(seq))
          body.append('durationMs', String(durationMs))
          const res = await fetch(`/api/hub/radio/transmission/${id}/piece`, { method: 'POST', body })
          if (res.ok) { this.events.onPiece?.(seq); return }
          // A rejection on our side won't get better by trying again.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) break
        } catch { /* a dead zone — this is exactly the case retrying exists for */ }
        if (attempt < UPLOAD_ATTEMPTS) await new Promise(r => setTimeout(r, 300 * attempt * attempt))
      }
      this.events.onPieceFailed?.(seq)
    })())
  }
}
