// Nylas v3 webhook envelope + signature verification. Dependency-free (Node crypto only)
// so it can be imported from an Edge-safe context if the route is ever moved.
//
// Every Nylas webhook POST carries an `X-Nylas-Signature` header: the hex-encoded
// HMAC-SHA256 of the RAW request body, keyed by the webhook signing secret. We verify
// over the exact bytes we received (request.text()), never a re-serialized object —
// re-serializing would reorder/whitespace-shift the JSON and break the HMAC.

import crypto from 'crypto'

// v3 CloudEvents-style envelope. `type` is the trigger (e.g. "message.created"),
// top-level `id` is the delivery/idempotency key, and `data.object` is the
// trigger-specific object (a message for message.*, a grant for grant.*).
export type NylasNotification = {
  specversion?: string
  type: string
  id: string
  time?: number
  webhook_delivery_attempt?: number
  data: {
    application_id?: string
    grant_id?: string
    // Shape depends on `type`; handlers read the fields they need defensively.
    object?: Record<string, unknown> & { grant_id?: string }
  }
}

// Verify the HMAC-SHA256 signature of a raw webhook body. Returns false on any
// mismatch, missing header, or length difference. timingSafeEqual throws when the
// two buffers differ in length, so it is wrapped in try/catch (a length diff is a
// non-match, not an error to surface).
export function verifyNylasSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    // Decode the header as hex too; a malformed/short hex string yields a
    // different-length buffer → caught by the length guard below (never a throw).
    const providedBuf = Buffer.from(signatureHeader.trim(), 'hex')
    if (expectedBuf.length !== providedBuf.length) return false
    return crypto.timingSafeEqual(expectedBuf, providedBuf)
  } catch {
    return false
  }
}
