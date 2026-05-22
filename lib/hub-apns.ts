import * as http2 from 'http2'
import * as crypto from 'crypto'

// JWT is valid 1 hour; refresh at 45 min to stay well within the limit
let cachedJwt: { token: string; issuedAt: number } | null = null

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

export async function sendApnsPush(
  deviceTokens: string[],
  payload: { title: string; body: string; url: string }
): Promise<{ staleTokens: string[] }> {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const bundleId = process.env.APNS_BUNDLE_ID ?? 'com.lynxedo.hub'
  const keyContent = process.env.APNS_KEY_CONTENT
  console.log(`[hub-apns] sendApnsPush called: tokens=${deviceTokens.length} keyId=${keyId ? 'set' : 'MISSING'} teamId=${teamId ? 'set' : 'MISSING'} bundleId=${bundleId} keyContent=${keyContent ? 'set' : 'MISSING'}`)
  if (!keyId || !teamId || !keyContent || deviceTokens.length === 0) {
    console.log('[hub-apns] early return — missing creds or no tokens')
    return { staleTokens: [] }
  }

  // APNS_KEY_CONTENT stored with escaped newlines in .env.local
  const privateKey = keyContent.replace(/\\n/g, '\n')
  let jwt: string
  try {
    jwt = getJwt(keyId, teamId, privateKey)
  } catch (err) {
    console.error('[hub-apns] JWT sign failed:', (err as Error).message)
    return { staleTokens: [] }
  }

  const staleTokens: string[] = []

  const apnsBody = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    },
    url: payload.url,
  })
  const bodyLength = Buffer.byteLength(apnsBody)

  // TestFlight apps use the production APNs endpoint (not sandbox)
  const session = http2.connect('https://api.push.apple.com')
  session.on('error', (err) => {
    console.error('[hub-apns] session error:', err.message)
  })

  await Promise.allSettled(
    deviceTokens.map(
      (deviceToken) =>
        new Promise<void>((resolve, reject) => {
          const req = session.request({
            ':method': 'POST',
            ':path': `/3/device/${deviceToken}`,
            ':scheme': 'https',
            ':authority': 'api.push.apple.com',
            authorization: `bearer ${jwt}`,
            'apns-push-type': 'alert',
            'apns-topic': bundleId,
            'content-type': 'application/json',
            'content-length': bodyLength,
          })

          req.write(apnsBody)
          req.end()

          let status = 0
          let responseBody = ''
          req.on('response', (headers) => {
            status = headers[':status'] as number
          })
          req.on('data', (chunk) => {
            responseBody += chunk
          })
          req.on('end', () => {
            console.log(`[hub-apns] response status=${status} token=${deviceToken.slice(0, 8)}…`)
            if (status === 200) {
              resolve()
            } else {
              console.error(
                `[hub-apns] status ${status} token=${deviceToken.slice(0, 8)}… body=${responseBody}`
              )
              // 410 Gone OR BadDeviceToken/Unregistered reason → terminal,
              // mark for deletion. Anything else (timeout, server error,
              // throttling) leaves the token alone.
              if (status === 410) {
                staleTokens.push(deviceToken)
              } else {
                try {
                  const parsed = JSON.parse(responseBody) as { reason?: string }
                  if (parsed.reason === 'BadDeviceToken' || parsed.reason === 'Unregistered') {
                    staleTokens.push(deviceToken)
                  }
                } catch { /* not JSON */ }
              }
              reject(new Error(`APNs ${status}`))
            }
          })
          req.on('error', (err) => {
            console.error('[hub-apns] req error:', err.message)
            reject(err)
          })
        })
    )
  )

  session.close()
  return { staleTokens }
}
