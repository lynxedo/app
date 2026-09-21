import * as http2 from 'http2'
import * as crypto from 'crypto'

// JWT is valid 1 hour; refresh at 45 min to stay well within the limit
let cachedJwt: { token: string; issuedAt: number } | null = null

// HTTP/2 sessions to api.push.apple.com can be reused across many pushes.
// Opening a fresh one per call adds a TLS handshake (50–200ms). Cache one
// and recreate on error/close.
let cachedSession: http2.ClientHttp2Session | null = null

function getSession(): http2.ClientHttp2Session {
  if (cachedSession && !cachedSession.closed && !cachedSession.destroyed) {
    return cachedSession
  }
  const session = http2.connect('https://api.push.apple.com')
  session.on('error', (err) => {
    console.error('[hub-apns] session error:', err.message)
    if (cachedSession === session) cachedSession = null
  })
  session.on('close', () => {
    if (cachedSession === session) cachedSession = null
  })
  cachedSession = session
  return session
}

function getJwt(keyId: string, teamId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && now - cachedJwt.issuedAt < 2700) return cachedJwt.token

  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString('base64url')
  const signable = `${header}.${payload}`

  const sign = crypto.createSign('SHA256')
  sign.update(signable)
  const sig = sign
    .sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
    .toString('base64url')

  const token = `${signable}.${sig}`
  cachedJwt = { token, issuedAt: now }
  return token
}

interface ApnsRequestOptions {
  jwt: string
  bundleId: string
  apnsBody: string
  pushType: 'alert' | 'background'
  priority: 5 | 10
}

async function sendOne(deviceToken: string, opts: ApnsRequestOptions): Promise<{ ok: boolean; stale: boolean }> {
  const session = getSession()
  const bodyLength = Buffer.byteLength(opts.apnsBody)

  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream
    try {
      req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        ':scheme': 'https',
        ':authority': 'api.push.apple.com',
        authorization: `bearer ${opts.jwt}`,
        'apns-push-type': opts.pushType,
        'apns-priority': opts.priority,
        'apns-topic': opts.bundleId,
        'content-type': 'application/json',
        'content-length': bodyLength,
      })
    } catch (err) {
      console.error('[hub-apns] request open failed:', (err as Error).message)
      // Session may be in a bad state — drop it so the next call recreates.
      if (cachedSession === session) cachedSession = null
      resolve({ ok: false, stale: false })
      return
    }

    req.write(opts.apnsBody)
    req.end()

    let status = 0
    let responseBody = ''
    req.on('response', (headers) => {
      status = headers[':status'] as number
    })
    req.on('data', (chunk) => { responseBody += chunk })
    req.on('end', () => {
      if (status === 200) {
        resolve({ ok: true, stale: false })
        return
      }
      console.error(
        `[hub-apns] status ${status} token=${deviceToken.slice(0, 8)}… body=${responseBody}`
      )
      // 410 Gone OR BadDeviceToken/Unregistered reason → terminal, mark for
      // deletion. Anything else (timeout, server error, throttling) leaves
      // the token alone.
      if (status === 410) {
        resolve({ ok: false, stale: true })
        return
      }
      try {
        const parsed = JSON.parse(responseBody) as { reason?: string }
        const stale = parsed.reason === 'BadDeviceToken' || parsed.reason === 'Unregistered'
        resolve({ ok: false, stale })
      } catch {
        resolve({ ok: false, stale: false })
      }
    })
    req.on('error', (err) => {
      console.error('[hub-apns] req error:', err.message)
      resolve({ ok: false, stale: false })
    })
  })
}

function loadCreds(): { jwt: string; bundleId: string } | null {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const bundleId = process.env.APNS_BUNDLE_ID ?? 'com.lynxedo.hub'
  const keyContent = process.env.APNS_KEY_CONTENT
  if (!keyId || !teamId || !keyContent) return null
  const privateKey = keyContent.replace(/\\n/g, '\n')
  try {
    return { jwt: getJwt(keyId, teamId, privateKey), bundleId }
  } catch (err) {
    console.error('[hub-apns] JWT sign failed:', (err as Error).message)
    return null
  }
}

export async function sendApnsPush(
  deviceTokens: string[],
  payload: { title: string; body: string; url: string; badge?: number; type?: string; groupKey?: string; sound?: string }
): Promise<{ staleTokens: string[] }> {
  if (deviceTokens.length === 0) return { staleTokens: [] }
  const creds = loadCreds()
  if (!creds) return { staleTokens: [] }

  // Resolve sound: stored as 'default' or a bare name like 'Glass' → 'Glass.caf'
  const soundValue = !payload.sound || payload.sound === 'default'
    ? 'default'
    : `${payload.sound}.caf`

  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: soundValue,
  }
  if (typeof payload.badge === 'number') aps.badge = payload.badge
  // thread-identifier groups notifications from the same conversation in the
  // iOS notification center (Phase 3). Uses groupKey which encodes the
  // conversation type + id (e.g. "dm:abc123", "room:xyz789").
  if (payload.groupKey) aps['thread-identifier'] = payload.groupKey

  // ⚠ The category is what puts a Reply box on the notification. iOS looks up
  // actions registered under this identifier at launch, so a payload without it
  // is a notification you can only tap. Only DMs and rooms get one — they are
  // the two things a reply can be POSTed to; a voicemail or an inbound text has
  // no single endpoint to answer.
  const canReply = payload.type === 'dm' || payload.type === 'room'
  if (canReply && payload.groupKey) aps.category = 'LYNXEDO_REPLY'

  const apnsBody = JSON.stringify({
    aps,
    url: payload.url,
    // The app needs these to know WHERE the reply goes — same two fields the
    // Android side reads, so one server shape serves both.
    ...(canReply ? { type: payload.type, groupKey: payload.groupKey } : {}),
  })

  const staleTokens: string[] = []
  await Promise.all(
    deviceTokens.map(async (token) => {
      const { stale } = await sendOne(token, {
        jwt: creds.jwt,
        bundleId: creds.bundleId,
        apnsBody,
        pushType: 'alert',
        priority: 10,
      })
      if (stale) staleTokens.push(token)
    })
  )
  return { staleTokens }
}

// Silent badge-only update (no alert, no sound). Used when the user reads
// something on one device and we want their other devices' badges to
// reflect the new lower count.
export async function sendApnsBadgeOnly(
  deviceTokens: string[],
  badge: number,
): Promise<{ staleTokens: string[] }> {
  if (deviceTokens.length === 0) return { staleTokens: [] }
  const creds = loadCreds()
  if (!creds) return { staleTokens: [] }

  const apnsBody = JSON.stringify({
    aps: { 'content-available': 1, badge },
  })

  const staleTokens: string[] = []
  await Promise.all(
    deviceTokens.map(async (token) => {
      const { stale } = await sendOne(token, {
        jwt: creds.jwt,
        bundleId: creds.bundleId,
        apnsBody,
        pushType: 'background',
        priority: 5,
      })
      if (stale) staleTokens.push(token)
    })
  )
  return { staleTokens }
}
