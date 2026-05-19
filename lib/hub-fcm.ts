import { createSign } from 'crypto'

let cachedToken: { value: string; expiresAt: number } | null = null

async function getFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value

  const clientEmail = process.env.FCM_CLIENT_EMAIL ?? ''
  const privateKey = (process.env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) throw new Error('FCM credentials not configured')

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url')

  const unsigned = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(unsigned)
  const signature = sign.sign(privateKey, 'base64url')
  const jwt = `${unsigned}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in }
  return cachedToken.value
}

export async function sendFcmPush(
  tokens: string[],
  payload: { title: string; body: string; url: string }
) {
  if (tokens.length === 0) return
  const projectId = process.env.FCM_PROJECT_ID
  if (!projectId) throw new Error('FCM_PROJECT_ID not set')

  const accessToken = await getFcmAccessToken()
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`

  await Promise.allSettled(tokens.map(token =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          android: {
            notification: { click_action: 'OPEN_HUB' },
            data: { url: payload.url },
          },
        },
      }),
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text()
        console.error('[hub-fcm] send failed:', r.status, text)
      }
    })
  ))
}
