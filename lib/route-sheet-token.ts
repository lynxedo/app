import { createHmac, timingSafeEqual } from 'crypto'

// Short-lived, browser-independent access token for a Daily Log route sheet.
//
// The Hub app authenticates via a session cookie, but tapping a route-sheet link
// hands the URL to whatever the device's DEFAULT browser is (Safari, Chrome, …) —
// which has no Lynxedo session, so a cookie-only check returns 401 "Unauthorized".
// The app mints one of these tokens (proving it's logged in), embeds it in the
// URL, and opens that. Because the token itself authorizes the request, the sheet
// loads even in a browser that has never signed into Lynxedo.
//
// HMAC-signed with the server-only service-role key, so a token can't be forged
// client-side. It only unlocks the single route sheet it was minted for, and only
// for a short window.

const TTL_MS = 15 * 60 * 1000 // 15 minutes — plenty for "tap link → browser opens"

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign route-sheet tokens')
  return s
}

// Token = "<expiryMs>.<hex-hmac>", HMAC computed over "<entryId>.<expiryMs>".
export function signRouteSheetToken(entryId: string): string {
  const exp = Date.now() + TTL_MS
  const sig = createHmac('sha256', secret()).update(`${entryId}.${exp}`).digest('hex')
  return `${exp}.${sig}`
}

export function verifyRouteSheetToken(entryId: string, token: string | null | undefined): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const exp = Number(token.slice(0, dot))
  const sig = token.slice(dot + 1)
  if (!Number.isFinite(exp) || Date.now() > exp) return false

  const expected = createHmac('sha256', secret()).update(`${entryId}.${exp}`).digest('hex')
  let a: Buffer, b: Buffer
  try {
    a = Buffer.from(sig, 'hex')
    b = Buffer.from(expected, 'hex')
  } catch {
    return false
  }
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
