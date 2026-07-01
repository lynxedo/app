// Dialer caller-ID (Twilio CNAM) fallback.
//
// When an inbound number matches NONE of our own data (no saved contact name,
// no Jobber client / contact-person), we ask Twilio's Lookup v2 API for the
// carrier "caller ID" name as a LAST resort. This is the carrier's guess — it
// can be a spouse / line-holder / stale / spam — so it is always shown clearly
// labeled and NEVER written into a contact's real `name`. Our own data always
// wins upstream (see lib/dialer-lookup.ts); this is only reached with nothing.
//
// Cost: Twilio bills ~$0.01 per caller_name lookup. dialer-lookup only hits this
// when it has no name of its own AND caches the result (txt_contacts
// .caller_id_name / .caller_id_checked_at), so we pay at most once per number
// per TTL — even for numbers that come back blank.

const LOOKUP_TIMEOUT_MS = 2500

// Master kill-switch. Off unless explicitly enabled, so turning the (paid)
// lookup on/off is a single env flag with no redeploy.
export function callerIdEnabled(): boolean {
  const v = (process.env.DIALER_CALLER_ID_ENABLED || '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

// Carrier CNAM names arrive SHOUTY and often "LAST,FIRST" and truncated to 15
// chars ("SIMPSON,BENJAMI"). Title-case them and flip last,first → First Last
// for consumer records. Best-effort formatting; never throws.
export function formatCallerIdName(raw: string, type?: string | null): string {
  let s = (raw || '').trim().replace(/\s+/g, ' ')
  if (!s) return ''
  const isConsumer = (type || '').toUpperCase() === 'CONSUMER'
  if (isConsumer && (s.match(/,/g) || []).length === 1) {
    const [last, first] = s.split(',').map((p) => p.trim())
    if (first && last) s = `${first} ${last}`
  }
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .replace(/([-'’])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim()
}

export type CallerIdResult = { name: string; type: 'consumer' | 'business' | null }

// Best-effort Twilio Lookup v2 caller_name dip. Returns null on any failure,
// when disabled, when creds are missing, or when the carrier has no name.
export async function fetchTwilioCallerId(e164: string): Promise<CallerIdResult | null> {
  if (!callerIdEnabled()) return null
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token || !e164) return null

  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=caller_name`
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const cn = data?.caller_name
    const rawName: string | null = cn?.caller_name ?? null
    if (!rawName) return null
    const typeRaw = (cn?.caller_type || '').toUpperCase()
    const name = formatCallerIdName(rawName, typeRaw)
    // Reject anything with no letters (a number/garbage came back).
    if (!name || !/[a-zA-Z]/.test(name)) return null
    const type = typeRaw === 'CONSUMER' ? 'consumer' : typeRaw === 'BUSINESS' ? 'business' : null
    return { name, type }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
