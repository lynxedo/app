// Blocked callers — numbers whose inbound calls and/or texts we refuse.
//
// ⚠ THE CENTRAL SAFETY PROPERTY IS THAT THIS FAILS OPEN. This runs on the
// inbound voice webhook, the path every customer call takes. A block is a
// convenience; a dropped real call is lost revenue and a lost customer. So any
// error — DB down, table missing, bad data — lets the call through as if the
// caller were never blocked. The worst case is a spammer gets one more call in.
// Never "fail closed" here, and never let this throw into the webhook.
//
// The second property: a blocked call is still LOGGED (status 'blocked'). If
// someone blocks a real customer by mistake, that has to be visible in the Call
// Log — otherwise the calls simply stop and nobody can tell why. Silence is the
// failure mode that makes a wrong block unfixable.
//
// Matching is on the last 10 digits, the same `phone_digits` convention
// txt_contacts and drip already use, so +1 / (281) 555-1234 / 2815551234 all
// resolve to one block.

import { createAdminClient } from '@/lib/supabase/admin'

export type BlockKind = 'call' | 'text'

/** Last 10 digits — the match key. Empty string when there's nothing dialable. */
export function blockDigits(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '').slice(-10)
}

/**
 * Is this number blocked for this kind of contact?
 *
 * Returns false on ANY failure, by design — see the fail-open note above.
 */
export async function isNumberBlocked(
  companyId: string,
  phone: string | null | undefined,
  kind: BlockKind,
): Promise<boolean> {
  const digits = blockDigits(phone)
  // An anonymous / withheld caller has no digits to match. Blocking "unknown"
  // wholesale would refuse every withheld-number customer, so it stays allowed.
  if (digits.length < 10) return false

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('blocked_numbers')
      .select('blocks_calls, blocks_texts')
      .eq('company_id', companyId)
      .eq('phone_digits', digits)
      .maybeSingle()
    if (error || !data) return false
    return kind === 'call' ? data.blocks_calls === true : data.blocks_texts === true
  } catch {
    return false
  }
}
