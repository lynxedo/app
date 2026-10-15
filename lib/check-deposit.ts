// Check deposits — server side.
//
//   photo ──▶ Claude vision ──▶ sanitize ──▶ { problems, read }
//
// A tech photographs a customer's paper check, front and back. Zac deposits it
// with his bank's mobile deposit by photographing the photo, so the photo has to
// be one a bank app will accept: flat, square-on, sharp, no glare, all four
// corners, on a dark background. The model judges that; the sanitizer makes sure
// only known problem codes and well-formed numbers ever reach the screen.
//
// The amount and check number it reads come back as `read` — the CLIENT compares
// them with what was typed, so the comparison is always against the current
// fields, not whatever was typed when the photo was taken.

import { getAnthropic, CLAUDE_MODEL } from '@/lib/anthropic'
import type { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export type CheckSide = 'front' | 'back'

/** Anything larger is refused — the client downscales before it ever gets here. */
export const MAX_CHECK_IMAGE_BYTES = 8 * 1024 * 1024

const VISION_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp'])
export function isCheckImage(mime: string): boolean {
  return VISION_MEDIA.has(mime)
}

/** Photo problems that mean "retake". */
export const RETAKE_PROBLEMS = {
  not_a_check: 'This doesn’t look like a check.',
  wrong_side: 'This looks like the other side of the check.',
  blurry: 'It’s blurry — hold still and let the camera focus.',
  glare: 'There’s glare on it — tilt away from the light or move out of direct sun.',
  angled: 'It’s at an angle — hold the phone flat, straight above the check.',
  cut_off: 'Part of the check is cut off — get all four corners in.',
  background: 'The background is too light — put the check on something dark.',
  too_far: 'It’s too far away — fill most of the picture with the check.',
  too_dark: 'It’s too dark to read — find more light.',
} as const
export type RetakeProblem = keyof typeof RETAKE_PROBLEMS

export type CheckPhotoReview = {
  /** No retake problems found. */
  ok: boolean
  problems: RetakeProblem[]
  /** What the model could read. Every field omitted when not confidently legible. */
  read: {
    amount_cents?: number
    check_number?: string
    payer?: string
    /** Back only: something is signed / written in the endorsement area. */
    endorsed?: boolean
  }
}

const SYSTEM = `You check photos of paper checks that a field technician took so the business owner can deposit them with a bank's mobile-deposit app.

A bank app rejects a photo that is blurry, has glare, is shot at an angle, crops any edge or corner, or sits on a light background (the app cannot find the check's edges). Your job is to catch those problems before the technician leaves the customer, and to read a few values off the check.

Rules:
- Judge only what you can see. Be strict about problems a bank app would reject; ignore cosmetic ones (a small shadow, a slightly off-centre check).
- "angled" means the check is visibly a trapezoid (shot from the side), not merely rotated a few degrees.
- "background" means the surface around the check is white or light-coloured, so the check's edges blend into it.
- Report a value ONLY when you can read it with confidence. Omit it otherwise — the technician types it themselves. Never guess a digit.
- The check number is the number printed at the top right of the check (usually 3–6 digits), NOT the routing or account number along the bottom.`

const TOOL = {
  name: 'report_check_photo',
  description: 'Report the problems that would make a bank app reject this photo, and the values you can read on it.',
  input_schema: {
    type: 'object' as const,
    properties: {
      problems: {
        type: 'array',
        description: 'Every problem a bank mobile-deposit app would reject. Empty when the photo is good.',
        items: { type: 'string', enum: Object.keys(RETAKE_PROBLEMS) },
      },
      amount: {
        type: 'string',
        description: 'Front only: the numeric dollar amount in the amount box, e.g. "250.00". Omit if not clearly legible.',
      },
      check_number: {
        type: 'string',
        description: 'Front only: the check number printed top right, digits only. Omit if not clearly legible.',
      },
      payer: {
        type: 'string',
        description: 'Front only: the name printed top left (who wrote the check). Omit if not legible.',
      },
      endorsed: {
        type: 'boolean',
        description: 'Back only: true if there is a signature, stamp or handwriting in the endorsement area on the back.',
      },
    },
    required: ['problems'],
  },
}

function sanitizeReview(side: CheckSide, raw: unknown): CheckPhotoReview {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const problems = Array.isArray(input.problems)
    ? [...new Set(input.problems.filter((p): p is RetakeProblem => typeof p === 'string' && p in RETAKE_PROBLEMS))]
    : []
  const read: CheckPhotoReview['read'] = {}
  if (side === 'front') {
    if (typeof input.amount === 'string') {
      const cleaned = input.amount.replace(/[$,\s]/g, '')
      if (/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) {
        const cents = Math.round(parseFloat(cleaned) * 100)
        if (cents > 0) read.amount_cents = cents
      }
    }
    if (typeof input.check_number === 'string') {
      const digits = input.check_number.replace(/\D/g, '')
      if (digits.length >= 1 && digits.length <= 10) read.check_number = digits
    }
    if (typeof input.payer === 'string' && input.payer.trim()) {
      read.payer = input.payer.trim().slice(0, 120)
    }
  } else if (typeof input.endorsed === 'boolean') {
    read.endorsed = input.endorsed
  }
  return { ok: problems.length === 0, problems, read }
}

/** Ask Claude whether a bank app would take this photo, and what it can read. */
export async function reviewCheckPhoto(side: CheckSide, bytes: Buffer, mime: string): Promise<CheckPhotoReview> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Photo checking is not configured on this server')

  const resp = await getAnthropic({ timeout: 60_000, maxRetries: 2 }).messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'report_check_photo' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg', data: bytes.toString('base64') } },
        {
          type: 'text',
          text: side === 'front'
            ? 'This should be the FRONT of a check (payee line, amount box, signature). If it is clearly the back, report wrong_side.'
            : 'This should be the BACK of a check (endorsement area, mostly blank). If it is clearly the front, report wrong_side.',
        },
      ],
    }],
  })

  const call = resp.content.find(b => b.type === 'tool_use')
  if (!call || call.type !== 'tool_use') return { ok: true, problems: [], read: {} }
  return sanitizeReview(side, call.input)
}

// ── Where checks are posted ───────────────────────────────────────────────

const CHECKS_ROOM_NAME = 'checks and cash'

/**
 * The company's checks room, resolved BY NAME per company (never a hardcoded
 * uuid — see the office-alerts note on a second tenant posting into Heroes'
 * room). Exact name first, then any active room with "check" in its name.
 */
export async function getChecksRoomId(admin: SupabaseAdmin, companyId: string): Promise<string | null> {
  const { data: rooms } = await admin
    .from('rooms')
    .select('id, name')
    .eq('company_id', companyId)
    .is('archived_at', null)
  const list = (rooms ?? []) as { id: string; name: string | null }[]
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  return list.find(r => norm(r.name) === CHECKS_ROOM_NAME)?.id
    ?? list.find(r => norm(r.name).includes('check'))?.id
    ?? null
}

/**
 * Who looks after the checks: the checks room's members (Zac, Kathryn, Ben at
 * Heroes) plus admins. They see every check and mark them deposited; anyone
 * else sees only the checks they sent.
 */
export async function canManageChecks(
  admin: SupabaseAdmin, companyId: string, userId: string, role: string | null,
): Promise<boolean> {
  if (role === 'admin') return true
  const roomId = await getChecksRoomId(admin, companyId)
  if (!roomId) return false
  const { data } = await admin
    .from('room_members')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
