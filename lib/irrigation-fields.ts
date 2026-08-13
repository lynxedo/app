// Photo-fillable inspection fields.
//
// One declaration per field drives BOTH the schema Claude is given and the
// validator its answer must survive, so the two can't drift. Imported by the
// client (to know which sections get a camera button) so it stays free of Node
// built-ins.
//
// What's in here is deliberately narrow: a field appears ONLY if a photo of the
// thing genuinely answers it. Listing a field the camera can't see is an
// invitation to guess — every extra field is a chance to be confidently wrong
// about someone's sprinkler system.
//
// Excluded on purpose, and why:
//   ctrlWifi / ctrlMv / stationsUsed / accessories — not determinable from the
//     face of a controller; you have to operate it or trace the wiring.
//   bfCond / overallCond — a condition verdict. Ben's rule: judgment stays human.
//   ctrlLoc / bfLoc / poc / pump — free-text location description. A photo hints
//     at it but the tech says it in one word, and a wrong location sends the next
//     visit hunting.
//   gpm — needs a flow test, not a picture.

import type { IrrigationData } from '@/lib/irrigation'

export type PhotoFieldSpec =
  | { kind: 'text'; max: number; hint: string }
  | { kind: 'number'; max: number; hint: string }
  | { kind: 'enum'; options: readonly string[]; aliases?: Record<string, string>; hint: string }
  | { kind: 'multi'; options: readonly string[]; hint: string }

export type PhotoSectionKey = 'controller' | 'backflow' | 'supply'

export type PhotoSection = {
  key: PhotoSectionKey
  label: string
  /** Shown on the button's helper line, and given to the model as context. */
  shot: string
  fields: Record<string, PhotoFieldSpec>
}

export const PHOTO_SECTIONS: Record<PhotoSectionKey, PhotoSection> = {
  controller: {
    key: 'controller',
    label: 'controller',
    shot: 'the front of the controller, with the door open so the display and model label show',
    fields: {
      ctrlBrand: { kind: 'text', max: 40, hint: 'Manufacturer printed on the unit — e.g. Rain Bird, Hunter, Toro, Rachio, Orbit, Irritrol, Weathermatic' },
      ctrlModel: { kind: 'text', max: 40, hint: 'Model designation printed on the unit — e.g. ESP-TM2, Pro-C, X-Core' },
      stationsTotal: { kind: 'number', max: 3, hint: 'Total stations the unit supports, if printed on it or unambiguous from the model' },
      ctrlType: {
        kind: 'enum',
        options: ['Conventional', 'Smart / Wi-Fi'],
        aliases: {
          'smart': 'Smart / Wi-Fi', 'wifi': 'Smart / Wi-Fi', 'wi-fi': 'Smart / Wi-Fi',
          'smart controller': 'Smart / Wi-Fi', 'connected': 'Smart / Wi-Fi',
          'traditional': 'Conventional', 'dial': 'Conventional', 'mechanical': 'Conventional', 'basic': 'Conventional',
        },
        hint: 'Conventional (dial/buttons only) or Smart / Wi-Fi (app-connected, touchscreen)',
      },
    },
  },
  backflow: {
    key: 'backflow',
    label: 'backflow preventer',
    shot: 'the whole backflow assembly, far enough back to show whether it sits above ground or in a box',
    fields: {
      bfType: {
        kind: 'enum',
        options: ['PVB', 'RPZ / RP', 'DCV / DC', 'AVB', 'None visible'],
        aliases: {
          'rpz': 'RPZ / RP', 'rp': 'RPZ / RP', 'reduced pressure': 'RPZ / RP',
          'reduced pressure zone': 'RPZ / RP', 'reduced pressure principle': 'RPZ / RP',
          'dcv': 'DCV / DC', 'dc': 'DCV / DC', 'double check': 'DCV / DC', 'double check valve': 'DCV / DC',
          'pressure vacuum breaker': 'PVB', 'vacuum breaker': 'PVB',
          'atmospheric vacuum breaker': 'AVB',
          'none': 'None visible', 'not visible': 'None visible', 'not present': 'None visible',
        },
        hint: 'Device type, from its body shape and test cocks',
      },
      bfGrade: {
        kind: 'enum',
        options: ['Above grade', 'Below grade / box'],
        aliases: {
          'above': 'Above grade', 'above ground': 'Above grade', 'aboveground': 'Above grade',
          'below': 'Below grade / box', 'below ground': 'Below grade / box',
          'in a box': 'Below grade / box', 'box': 'Below grade / box', 'in ground': 'Below grade / box',
          'underground': 'Below grade / box', 'vault': 'Below grade / box',
        },
        hint: 'Whether the assembly stands above ground or sits in an in-ground box',
      },
      bfInsul: {
        kind: 'enum',
        options: ['Yes', 'No'],
        aliases: {
          'insulated': 'Yes', 'covered': 'Yes', 'wrapped': 'Yes', 'bag': 'Yes', 'jacket': 'Yes', 'true': 'Yes',
          'uninsulated': 'No', 'bare': 'No', 'exposed': 'No', 'none': 'No', 'false': 'No',
        },
        hint: 'Yes only if an insulation cover, bag or wrap is actually visible',
      },
    },
  },
  supply: {
    key: 'supply',
    label: 'water supply',
    shot: 'the meter, pressure gauge or point of connection — a gauge face readable in frame is ideal',
    fields: {
      psi: { kind: 'number', max: 3, hint: 'Static pressure ONLY if a gauge face is legible in the photo. Omit otherwise — never estimate pressure' },
      meterSize: {
        kind: 'enum',
        options: ['3/4"', '1"', '1-1/4"', '1-1/2"', '2"', 'Unknown'],
        aliases: {
          '3/4': '3/4"', '0.75': '3/4"', '3/4 inch': '3/4"', '.75': '3/4"',
          '1': '1"', '1 inch': '1"', '1.0': '1"',
          '1-1/4': '1-1/4"', '1 1/4': '1-1/4"', '1.25': '1-1/4"',
          '1-1/2': '1-1/2"', '1 1/2': '1-1/2"', '1.5': '1-1/2"',
          '2': '2"', '2 inch': '2"', '2.0': '2"',
          'unknown': 'Unknown', 'not visible': 'Unknown', 'illegible': 'Unknown',
        },
        hint: 'Meter or service size, only if stamped on the meter, lid or pipe',
      },
      prv: {
        kind: 'enum',
        options: ['Yes — present', 'No', 'Needed'],
        aliases: {
          'yes': 'Yes — present', 'present': 'Yes — present', 'installed': 'Yes — present', 'true': 'Yes — present',
          'no': 'No', 'absent': 'No', 'not present': 'No', 'none': 'No', 'false': 'No',
        },
        // "Needed" is a recommendation, not an observation — the model is told to
        // report presence only, and the tech upgrades it to Needed themselves.
        hint: 'Whether a pressure regulator is visible. Report presence only — use "Yes — present" or "No", never "Needed"',
      },
      source: {
        kind: 'multi',
        options: ['Municipal / City', 'Well', 'Reclaimed (purple pipe)', 'Pond / Lake', 'Booster pump'],
        hint: 'Only what the photo shows — a city meter box, a well head, purple pipe, a pond intake, a booster pump',
      },
    },
  },
}

// ── Validation ──────────────────────────────────────────────────────────────

function matchEnum(spec: Extract<PhotoFieldSpec, { kind: 'enum' } | { kind: 'multi' }>, raw: unknown): string {
  const v = String(raw ?? '').trim().replace(/[.,]+$/, '')
  if (!v) return ''
  const lower = v.toLowerCase()
  const exact = spec.options.find(o => o.toLowerCase() === lower)
  if (exact) return exact
  if (spec.kind === 'enum' && spec.aliases) {
    const alias = spec.aliases[lower]
    if (alias) return alias
  }
  return ''
}

/** First run of digits — never every digit concatenated. See lib/irrigation.ts. */
function firstNumber(raw: unknown, max: number): string {
  const m = String(raw ?? '').match(/\d+/)
  return m ? m[0].slice(0, max) : ''
}

/**
 * Coerce the model's answer for one section into values the form could have
 * produced. Fields not in the section's spec are dropped outright, and any value
 * that fails its spec is dropped rather than approximated.
 */
export function sanitizePhotoFields(
  sectionKey: PhotoSectionKey,
  raw: unknown,
): { patch: Partial<IrrigationData>; fields: string[] } {
  const section = PHOTO_SECTIONS[sectionKey]
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const fields: string[] = []

  for (const [name, spec] of Object.entries(section.fields)) {
    const value = r[name]
    if (value == null) continue

    if (spec.kind === 'multi') {
      const list = Array.isArray(value) ? value : [value]
      const cleaned = Array.from(new Set(list.map(v => matchEnum(spec, v)).filter(Boolean)))
      if (cleaned.length) { patch[name] = cleaned; fields.push(name) }
      continue
    }
    if (spec.kind === 'enum') {
      const v = matchEnum(spec, value)
      if (v) { patch[name] = v; fields.push(name) }
      continue
    }
    if (spec.kind === 'number') {
      const v = firstNumber(value, spec.max)
      if (v) { patch[name] = v; fields.push(name) }
      continue
    }
    const v = String(value).trim().replace(/\s+/g, ' ').slice(0, spec.max)
    // A model that can't read the label sometimes says so in the field itself.
    if (v && !/^(unknown|n\/?a|none|not visible|illegible|unclear)$/i.test(v)) {
      patch[name] = v; fields.push(name)
    }
  }

  return { patch: patch as Partial<IrrigationData>, fields }
}

/** Review-mark key for a top-level (non-zone) field. Zone marks are `${i}:${f}`. */
export function fieldMark(name: string): string {
  return `f:${name}`
}
