// Read inspection fields off a photo.
//
//   photo ──▶ Claude vision ──▶ sanitizePhotoFields ──▶ field patch
//
// Server-only. Same shape as lib/irrigation-dictate.ts and the same rule: the
// prompt makes a good answer likely, the sanitizer makes a bad one impossible.
//
// The photo is also kept on the inspection — the tech was going to take it
// anyway, so reading it costs them nothing extra and the evidence stays on the
// record next to the values it produced.

import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import {
  PHOTO_SECTIONS, sanitizePhotoFields,
  type PhotoSectionKey, type PhotoFieldSpec,
} from '@/lib/irrigation-fields'
import type { IrrigationData } from '@/lib/irrigation'

/** Anything larger is refused — the client downscales before it ever gets here. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const VISION_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export function isReadableImage(mime: string): boolean {
  return VISION_MEDIA.has(mime)
}

const SYSTEM = `You read a single field photo taken by an irrigation technician and report only what is legibly visible in it.

Rules, in order of importance:
- Report ONLY what you can actually see. If a label is blurred, cropped, glared out or absent, omit that field.
- OMIT any field you are not confident about. An omitted field is correct behaviour — the technician fills it in themselves in two seconds. A confident wrong value may never be caught, and ends up in a customer's permanent system record.
- Never infer a value from what is typical for the brand, the region, or other fields. Read, don't reason.
- You are not being asked to judge condition, quality or what work is needed. Only identify what the equipment is.`

function toolFor(sectionKey: PhotoSectionKey) {
  const section = PHOTO_SECTIONS[sectionKey]
  const properties: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(section.fields) as [string, PhotoFieldSpec][]) {
    if (spec.kind === 'enum') {
      properties[name] = { type: 'string', enum: [...spec.options], description: spec.hint }
    } else if (spec.kind === 'multi') {
      properties[name] = {
        type: 'array', description: spec.hint,
        items: { type: 'string', enum: [...spec.options] },
      }
    } else {
      properties[name] = { type: 'string', description: spec.hint }
    }
  }
  return {
    name: 'report_visible',
    description: `Report what is legibly visible in a photo of ${section.label}. Omit every field you cannot read.`,
    input_schema: { type: 'object' as const, properties, required: [] as string[] },
  }
}

/**
 * Read one section's fields from a photo. Returns only values that survive
 * validation, plus the field names written so the caller can flag them for review.
 */
export async function readFieldsFromPhoto(
  sectionKey: PhotoSectionKey,
  bytes: Buffer,
  mime: string,
): Promise<{ patch: Partial<IrrigationData>; fields: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Photo reading is not configured on this server')
  const section = PHOTO_SECTIONS[sectionKey]

  const resp = await getAnthropic({ timeout: 60_000, maxRetries: 2 }).messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    system: SYSTEM,
    tools: [toolFor(sectionKey)],
    tool_choice: { type: 'tool', name: 'report_visible' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mime as 'image/jpeg', data: bytes.toString('base64') },
        },
        {
          type: 'text',
          text: `This is a photo of ${section.label} at a customer's property.`
            + ` The technician was asked to photograph ${section.shot}.`
            + ` Report only the fields you can read from it.`,
        },
      ],
    }],
  })

  const call = resp.content.find(b => b.type === 'tool_use')
  if (!call || call.type !== 'tool_use') return { patch: {}, fields: [] }
  return sanitizePhotoFields(sectionKey, call.input)
}
