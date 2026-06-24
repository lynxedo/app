import crypto from 'node:crypto'

// Stateless, signed unsubscribe tokens (HMAC-SHA256). No DB lookup needed to
// validate. Reuses an existing server secret so there's nothing new to set;
// EMAIL_UNSUB_SECRET can override if we ever want to rotate independently.
function secret(): string {
  return (
    process.env.EMAIL_UNSUB_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'lynxedo-unsub-fallback'
  )
}

// The optional campaignId is appended as a 3rd payload field so campaign
// unsubscribe links can be attributed in analytics (Session 5). Old 2-field
// tokens still verify (campaignId comes back null).
export function signUnsubToken(companyId: string, email: string, campaignId?: string | null): string {
  const payload = `${companyId}|${email.toLowerCase()}|${campaignId || ''}`
  const p = Buffer.from(payload).toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(p).digest('base64url')
  return `${p}.${sig}`
}

export function verifyUnsubToken(
  token: string | null | undefined,
): { companyId: string; email: string; campaignId: string | null } | null {
  if (!token) return null
  const [p, sig] = token.split('.')
  if (!p || !sig) return null
  const expected = crypto.createHmac('sha256', secret()).update(p).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const [companyId, email, campaignId] = Buffer.from(p, 'base64url').toString('utf8').split('|')
  if (!companyId || !email) return null
  return { companyId, email, campaignId: campaignId || null }
}
