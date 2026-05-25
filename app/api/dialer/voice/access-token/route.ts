import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mintVoiceAccessToken, voiceConfigured } from '@/lib/twilio-voice'

// Mint a short-lived Twilio Voice Access Token for the calling user. The
// Voice JS SDK in the browser exchanges this for a WebRTC registration with
// Twilio. Token identity == hub_users.id (UUID); inbound calls find the
// right browser session by matching identity.
//
// Without env creds (TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET /
// TWILIO_TWIML_APP_SID), returns { configured: false } so the UI can show
// a "not configured" state cleanly.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_dialer, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.can_access_dialer) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!voiceConfigured()) {
    return NextResponse.json({
      configured: false,
      error: 'twilio_not_configured',
    })
  }

  const result = await mintVoiceAccessToken({ identity: user.id })
  if (!result.ok) {
    return NextResponse.json(
      { configured: true, error: result.error },
      { status: 500 }
    )
  }

  return NextResponse.json({
    configured: true,
    token: result.token,
    identity: result.identity,
    ttlSeconds: result.ttlSeconds,
    expiresAt: result.expiresAt,
  })
}
