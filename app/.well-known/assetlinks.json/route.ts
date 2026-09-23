import { NextResponse } from 'next/server'

// Tells Android that the Lynxedo app owns lynxedo.com links.
//
// ⚠⚠ THE FINGERPRINT IS THE PLAY APP-SIGNING CERTIFICATE, NOT THE UPLOAD KEY.
// Google re-signs every bundle we upload, so the certificate that actually
// reaches a phone is Google's, not ours. Putting the upload key's fingerprint
// here is the classic mistake: verification fails silently and every link keeps
// opening in the browser with no error anywhere. It is read from Play Console →
// Test and release → Setup → App signing.
//
// ⚠ Served as a route rather than a file in public/ because it has to answer on
// every tenant subdomain — links are heroes105.lynxedo.com/…, and Android checks
// the exact host it is opening.
const PLAY_APP_SIGNING_SHA256 = process.env.ANDROID_APP_SIGNING_SHA256 ?? ''

export const dynamic = 'force-static'

export function GET() {
  // ⚠ An empty list is better than a wrong fingerprint: a wrong one makes
  // Android cache a FAILED verification, and that sticks until the app is
  // reinstalled. Nothing here simply means links keep opening in the browser,
  // which is exactly today's behaviour.
  const fingerprints = PLAY_APP_SIGNING_SHA256
    ? [PLAY_APP_SIGNING_SHA256.toUpperCase()]
    : []

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.lynxedo.hub',
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } },
  )
}
