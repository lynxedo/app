// Session 60 — shared IVR context built once per inbound webhook call.
//
// Both /api/dialer/voice/twiml/inbound and /api/dialer/voice/twiml/ivr need
// the same set of resolvers + URL builders to render IVR TwiML that can
// reach extensions, ring groups, and per-user voicemail. This module loads
// the per-company extension table once, returns a resolver fn that closes
// over it, plus URL builders for the new routes.

import type { SupabaseClient } from '@supabase/supabase-js'

export type IvrContext = {
  baseUrl: string
  voicemailRouteUrl: string
  ringGroupUrlFor: (groupId: string, index: number) => string
  perUserVoicemailUrlFor: (ownerUserId: string) => string
  extensionResolver: (ext: string) => { identity: string; ownerUserId: string } | null
}

// Loads the extension → user_id map for the company. Returns an IvrContext
// the IVR renderers can use without further DB hits.
export async function buildIvrContext(
  admin: SupabaseClient,
  companyId: string
): Promise<IvrContext> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const voicemailRouteUrl = `${baseUrl}/api/dialer/voice/twiml/voicemail`

  // Pull every assigned extension for the company. Heroes is ~6 users; even at
  // 100+ this is one tiny indexed SELECT per call.
  const { data: rows } = await admin
    .from('user_profiles')
    .select('id, dialer_extension')
    .eq('company_id', companyId)
    .not('dialer_extension', 'is', null)

  const extMap = new Map<string, string>() // extension → user_id
  for (const r of rows ?? []) {
    if (r.dialer_extension) extMap.set(r.dialer_extension, r.id)
  }

  return {
    baseUrl,
    voicemailRouteUrl,
    ringGroupUrlFor: (groupId, index) =>
      `${baseUrl}/api/dialer/voice/twiml/ring-group?group=${encodeURIComponent(groupId)}&i=${index}`,
    perUserVoicemailUrlFor: (ownerUserId) =>
      `${baseUrl}/api/dialer/voice/twiml/voicemail?owner=${encodeURIComponent(ownerUserId)}`,
    extensionResolver: (ext) => {
      const userId = extMap.get(ext)
      if (!userId) return null
      // Identity == hub_users.id == user_profiles.id — Twilio Voice SDK uses the
      // same uuid string we mint into the access token at /api/dialer/voice/access-token.
      return { identity: userId, ownerUserId: userId }
    },
  }
}
