// Nylas transport configuration. All read via process.env at point of use (repo convention).
// The Nylas API key is the single app-level secret; individual mailboxes are referenced by grant id.

export function nylasApiUri(): string {
  return process.env.NYLAS_API_URI || 'https://api.us.nylas.com'
}

export function nylasApiKey(): string | undefined {
  return process.env.NYLAS_API_KEY
}

export function nylasClientId(): string | undefined {
  return process.env.NYLAS_CLIENT_ID
}

export function nylasRedirectUri(): string {
  return (
    process.env.NYLAS_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com'}/api/auth/nylas/callback`
  )
}

// True once Ben provisions the production Nylas app + sets the two env vars.
// Until then the whole feature stays dark (connect no-ops, status = "setup pending").
export function nylasConfigured(): boolean {
  return Boolean(nylasApiKey() && nylasClientId())
}

// Signing secret for inbound Nylas webhooks (X-Nylas-Signature = HMAC-SHA256 of the raw body).
// When unset the webhook endpoint skips verification and stays dark/safe (logs + records only).
export function nylasWebhookSecret(): string | undefined {
  return process.env.NYLAS_WEBHOOK_SECRET
}
