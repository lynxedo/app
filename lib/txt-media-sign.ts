import crypto from 'crypto'

// Short-TTL HMAC signatures for /api/txt/media/[...key].
//
// The media route serves customer MMS photos (PII). In-app rendering is gated
// on the logged-in session, but Twilio fetches outbound MediaUrls with no
// cookies — so the send paths mint a signed URL instead. The signature covers
// the exact key + an expiry, so a leaked URL goes dead after TTL_SECONDS and
// can't be replayed for other keys.
//
// Signing key: a dedicated TXT_MEDIA_SIGNING_SECRET if ever set, otherwise the
// Twilio auth token — already a required env on prod + staging (webhook
// signature validation), so no new env var is needed. Using it as an HMAC key
// does not expose it.

const TTL_SECONDS = 3600 // Twilio fetches within seconds; 1h absorbs queue/retry delays

function signingKey(): string | null {
  return process.env.TXT_MEDIA_SIGNING_SECRET || process.env.TWILIO_AUTH_TOKEN || null
}

function hmac(secret: string, key: string, exp: number): string {
  return crypto.createHmac('sha256', secret).update(`${key}:${exp}`).digest('hex')
}

// Build the MediaUrl for an outbound Twilio send from an R2 storage key
// (e.g. "txt/{company}/12345-abc.jpg"). Falls back to the bare URL if no
// signing key exists (local dev without Twilio env) — the route will then
// reject Twilio's cookieless fetch, matching "Twilio not configured".
export function signTxtMediaUrl(baseUrl: string, key: string): string {
  const bare = `${baseUrl}/api/txt/media/${key}`
  const secret = signingKey()
  if (!secret) return bare
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS
  return `${bare}?exp=${exp}&sig=${hmac(secret, key, exp)}`
}

export function verifyTxtMediaSignature(key: string, exp: string | null, sig: string | null): boolean {
  const secret = signingKey()
  if (!secret || !exp || !sig) return false
  const expNum = parseInt(exp, 10)
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(hmac(secret, key, expNum))
  const given = Buffer.from(sig)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}
