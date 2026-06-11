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

async function postFcm(
  endpoint: string,
  accessToken: string,
  message: Record<string, unknown>,
): Promise<{ ok: boolean; stale: boolean }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  })
  if (res.ok) return { ok: true, stale: false }
  const text = await res.text()
  console.error('[hub-fcm] send failed:', res.status, text)
  // Only treat UNREGISTERED (uninstalled app / refreshed token) as terminal.
  // 5xx, 429, and INVALID_ARGUMENT on other fields are transient.
  try {
    const parsed = JSON.parse(text) as { error?: { details?: Array<{ errorCode?: string }> } }
    const code = parsed?.error?.details?.find(d => d.errorCode)?.errorCode
    return { ok: false, stale: code === 'UNREGISTERED' }
  } catch {
    return { ok: false, stale: false }
  }
}

const FCM_TYPE_MAP: Record<string, { channel_id: string; color: string }> = {
  dm:          { channel_id: 'dm',        color: '#0ea5e9' },
  room:        { channel_id: 'room',      color: '#8b5cf6' },
  txt:         { channel_id: 'txt',       color: '#f97316' },
  voicemail:   { channel_id: 'voicemail', color: '#ef4444' },
  'daily-log': { channel_id: 'daily_log', color: '#22c55e' },
}

export async function sendFcmPush(
  tokens: string[],
  payload: { title: string; body: string; url: string; badge?: number; type?: string; groupKey?: string }
): Promise<{ staleTokens: string[] }> {
  if (tokens.length === 0) return { staleTokens: [] }
  const projectId = process.env.FCM_PROJECT_ID
  if (!projectId) throw new Error('FCM_PROJECT_ID not set')

  const accessToken = await getFcmAccessToken()
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`

  const typeConfig = FCM_TYPE_MAP[payload.type ?? ''] ?? { channel_id: 'hub', color: '#0ea5e9' }
  const androidNotification: Record<string, unknown> = {
    channel_id: typeConfig.channel_id,
    color:      typeConfig.color,
  }
  if (typeof payload.badge === 'number') {
    // Samsung One UI honors notification_count for numeric badge display.
    // Pixel + most other launchers show a dot regardless (managed by the OS).
    androidNotification.notification_count = payload.badge
  }
  // tag replaces any prior notification with the same key — prevents flooding
  // when many messages arrive in quick succession in the same conversation.
  if (payload.groupKey) androidNotification.tag = payload.groupKey

  const staleTokens: string[] = []
  await Promise.all(tokens.map(async (token) => {
    const message: Record<string, unknown> = {
      token,
      notification: { title: payload.title, body: payload.body },
      // Top-level data — Android delivers these as Intent extras to
      // MainActivity when the user taps the notification.
      data: {
        url: payload.url,
        ...(typeof payload.badge === 'number' ? { badge: String(payload.badge) } : {}),
      },
    }
    if (Object.keys(androidNotification).length > 0) {
      message.android = { notification: androidNotification }
    }
    const { stale } = await postFcm(endpoint, accessToken, message)
    if (stale) staleTokens.push(token)
  }))

  return { staleTokens }
}

// Silent badge-only update for Android. FCM doesn't expose a direct
// "set badge" API — Android badges are launcher-managed off of visible
// notifications. We send a data-only message so the JS bridge (if listening)
// can react; on most launchers the badge will refresh naturally on the
// next visible notification.
export async function sendFcmBadgeOnly(
  tokens: string[],
  badge: number,
): Promise<{ staleTokens: string[] }> {
  if (tokens.length === 0) return { staleTokens: [] }
  const projectId = process.env.FCM_PROJECT_ID
  if (!projectId) throw new Error('FCM_PROJECT_ID not set')

  const accessToken = await getFcmAccessToken()
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`

  const staleTokens: string[] = []
  await Promise.all(tokens.map(async (token) => {
    const message: Record<string, unknown> = {
      token,
      data: { type: 'badge_clear', badge: String(badge) },
      android: { priority: 'normal' },
    }
    const { stale } = await postFcm(endpoint, accessToken, message)
    if (stale) staleTokens.push(token)
  }))

  return { staleTokens }
}
