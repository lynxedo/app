// Zone dictation — turn a tech talking (or typing) their way around a yard into
// validated zone rows.
//
//   audio ──▶ Deepgram ──▶ transcript ──┐
//                                        ├──▶ Claude ──▶ sanitize ──▶ zone rows
//   typed notes ─────────────────────────┘
//
// Server-only: reads DEEPGRAM_API_KEY / ANTHROPIC_API_KEY.
//
// The safety property lives in the LAST step, not the prompt. Every field the
// model proposes goes through `sanitizeDictatedZone`, which maps constrained
// fields onto the exact options the form offers and blanks anything it can't
// match. The prompt makes good output likely; the sanitizer makes bad output
// impossible. (Same lesson as the AI receptionist's masked-readback bug, where a
// plausible-looking string won a precedence chain because nothing checked its
// shape before it was written into a real lead.)

import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import {
  sanitizeDictatedZone, zoneIsEmpty, ZONE_WATERS, ZONE_HEADS, ZONE_SUN, ZONE_SLOPE,
  type IrrigationZone, type DictatedZone,
} from '@/lib/irrigation'

/** Longest recording we'll accept (~2 min of typical phone audio). */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024
/** Longest typed note we'll accept. */
export const MAX_NOTE_CHARS = 6000

// ── Transcription ───────────────────────────────────────────────────────────

// One speaker (the tech), spoken outdoors near running water. nova-2 general
// with smart_format handles the numbers ("zone three" → "zone 3") that matter
// most here. No sentiment/summary — this is dictation, not a conversation.
const DG_QUERY = ['model=nova-2', 'smart_format=true', 'punctuate=true', 'numerals=true'].join('&')

export async function transcribeDictation(bytes: Buffer, contentType: string): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error('Voice notes are not configured on this server')
  const res = await fetch(`https://api.deepgram.com/v1/listen?${DG_QUERY}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': contentType || 'audio/webm' },
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 160)}`)
  }
  const dg = (await res.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  }
  return (dg.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim()
}

// ── Extraction ──────────────────────────────────────────────────────────────

const SYSTEM = `You convert an irrigation technician's spoken field notes into structured zone records.

The tech is walking a property, running one zone at a time, describing what they see. They speak in fragments, out of order, and often correct themselves ("zone four — sorry, zone five"). Honour the correction.

Rules:
- Emit one record per zone the tech describes. If they describe three zones, emit three records.
- OMIT any field the tech did not mention. Never guess, never infer, never fill a field from what is "typical". An omitted field is correct; a plausible invented one is a defect.
- If the tech mentions a problem (broken head, leak, coverage gap, stuck valve, low pressure), put it in "issues" verbatim in plain words.
- "area" is where the zone waters in the tech's own words ("front lawn", "north side beds").
- Numbers: zone/count/runtime are digits only.
- If the audio is unclear or describes something that is not a zone, return no records rather than a guessed one.

Zone numbers:
- Always give the zone number. When the tech says "next zone" / "next one" / "moving on", it is one more than the zone they just described; if it's the first zone in these notes, one more than the highest zone already on the form (zone 1 if the form has none).

Editing a zone that is already on the form (you are given the zones on the form):
- "edit zone 3", "change zone 3", "correction on zone 3", "go back to zone 3", "zone 3 should be…" → mode "edit". Give only the fields being changed, with their NEW values. Do not create a new zone for it.
- "add to zone 3", "also on zone 3", "one more thing on zone 3" → mode "add". Put the added problem in "issues" (just the new part, not what's already there). For a head count change like "two more heads", give the new total using the count on the form.
- Otherwise leave mode out.
- These are the only times a zone that is already on the form should appear in your output with fields it already has.`

const ZONE_TOOL = {
  name: 'record_zones',
  description: 'Record the irrigation zones described in the notes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      zones: {
        type: 'array',
        description: 'One entry per zone described. Empty if no zone was clearly described.',
        items: {
          type: 'object',
          properties: {
            zone: { type: 'string', description: 'Zone/station number, digits only' },
            area: { type: 'string', description: "Area served, in the tech's words" },
            waters: { type: 'string', enum: [...ZONE_WATERS] },
            head: { type: 'string', enum: [...ZONE_HEADS] },
            count: { type: 'string', description: 'Number of heads, digits only' },
            nozzle: { type: 'string', description: 'Nozzle or brand if named' },
            sun: { type: 'string', enum: [...ZONE_SUN] },
            slope: { type: 'string', enum: [...ZONE_SLOPE] },
            valve: { type: 'string', description: 'Valve box location for this zone' },
            runtime: { type: 'string', description: 'Run time in minutes, digits only' },
            issues: { type: 'string', description: 'Condition or problems noted' },
            mode: { type: 'string', enum: ['edit', 'add'], description: 'Only when the tech says to edit/change or add to a zone' },
          },
        },
      },
    },
    required: ['zones'],
  },
}

/**
 * Extract zone rows from a transcript. Returns only values that survive
 * validation — the caller can write these straight into the form.
 */
/** The zones already on the form, as context for "next zone" / "edit zone 3". */
function describeExisting(zones: IrrigationZone[]): string {
  const lines = zones
    .filter(z => !zoneIsEmpty(z))
    .slice(0, 60)
    .map((z, i) => {
      const parts = [
        z.area, z.waters, z.head, z.count ? `${z.count} heads` : '', z.nozzle,
        z.sun, z.slope, z.valve ? `valve: ${z.valve}` : '', z.runtime ? `${z.runtime} min` : '',
        z.issues ? `issues: ${z.issues}` : '',
      ].filter(Boolean).join(' · ')
      return `Zone ${z.zone || `(unnumbered #${i + 1})`}: ${parts}`.slice(0, 400)
    })
  return lines.length ? lines.join('\n') : '(none yet)'
}

/** Coerce whatever the client sent as the form's current zones into rows. */
export function parseExistingZones(raw: unknown): IrrigationZone[] {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (!Array.isArray(v)) return []
  return v.slice(0, 60).map(z => {
    const r = (z && typeof z === 'object' ? z : {}) as Record<string, unknown>
    const t = (k: string) => String(r[k] ?? '').slice(0, 300)
    return {
      zone: t('zone'), area: t('area'), waters: t('waters'), head: t('head'), count: t('count'),
      nozzle: t('nozzle'), sun: t('sun'), slope: t('slope'), valve: t('valve'), runtime: t('runtime'), issues: t('issues'),
    }
  })
}

export async function extractZones(transcript: string, existing: IrrigationZone[] = []): Promise<DictatedZone[]> {
  const text = transcript.trim()
  if (!text) return []
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Voice notes are not configured on this server')

  const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [ZONE_TOOL],
    tool_choice: { type: 'tool', name: 'record_zones' },
    messages: [{
      role: 'user',
      content: `Zones already on the form:\n${describeExisting(existing)}\n\nThe tech's notes:\n${text.slice(0, MAX_NOTE_CHARS)}`,
    }],
  })

  const call = resp.content.find(b => b.type === 'tool_use')
  if (!call || call.type !== 'tool_use') return []
  const raw = (call.input as { zones?: unknown })?.zones
  if (!Array.isArray(raw)) return []

  return raw
    .map(sanitizeDictatedZone)
    // A record with nothing but a zone number tells the tech nothing — drop it.
    .filter(z => Object.keys(z).some(k => k !== 'zone' && k !== 'mode'))
    .slice(0, 40)
}

// ── Final notes polish ──────────────────────────────────────────────────────
// The tech talks or thumbs out their closing notes in the yard; Polish turns the
// fumbling into something fit for the customer's summary. It edits THEIR words —
// it never adds a finding, a price, a date or a promise that wasn't there.

const POLISH_SYSTEM = `You are editing an irrigation technician's closing notes for a homeowner's irrigation inspection summary. The homeowner will read the result.

Clean up the tech's OWN notes:
- Fix grammar, spelling, punctuation and capitalization. Fix obvious speech-to-text slips in irrigation terms (rotor, spray head, MP rotator, drip, backflow, PVB, RPZ, valve box, controller, station, zone, PSI).
- Turn fragments into short, clear, friendly, professional sentences. When the notes cover several separate points, put each on its own line starting with "- ".
- Keep every fact, zone number, count, measurement and recommendation the tech gave. Keep their meaning; refine, don't rewrite from scratch.
- NEVER add anything that is not in the notes: no new problems, recommendations, prices, dates, schedules or promises.
- No greeting, sign-off, heading or markdown other than the "- " lines.
- If the notes are already clean, return them essentially unchanged.
- Return ONLY the polished notes, with no commentary.`

/** Polish the tech's final notes. Throws on failure — the caller keeps their text. */
export async function polishNotes(text: string): Promise<string> {
  const notes = text.trim().slice(0, MAX_NOTE_CHARS)
  if (!notes) return ''
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI is not configured on this server')

  const anthropic = getAnthropic({ timeout: 60_000, maxRetries: 2 })
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: POLISH_SYSTEM,
    messages: [{ role: 'user', content: `Polish these notes:\n\n${notes}` }],
  })
  return resp.content
    .filter(b => b.type === 'text')
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
}
