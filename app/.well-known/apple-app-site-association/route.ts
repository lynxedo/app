import { NextResponse } from 'next/server'

// Tells iOS that the Lynxedo app owns lynxedo.com links, so tapping one in
// Jobber, a text or an email opens the app instead of Safari.
//
// ⚠ Served as a ROUTE, not a file in public/, for three reasons:
//   • It must exist on EVERY tenant subdomain — links are heroes105.lynxedo.com/…
//     and iOS checks the association on the exact host it is opening.
//   • It has no .json extension but must be served as application/json.
//   • Apple fetches it directly over https with no redirects allowed.
//
// ⚠ appIDs is <team>.<bundle>. The team prefix is not a secret — the file is
// public by design and Apple requires it to be readable without auth.
const TEAM = '24DT99YBB9'
const BUNDLE = 'com.lynxedo.hub'

export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${TEAM}.${BUNDLE}`],
            components: [
              // Everything under /hub is the app's. The marketing site, the
              // login flow and /api are deliberately NOT claimed: a password
              // reset or an OAuth callback has to be able to finish in a
              // browser, and swallowing those into the app would strand people.
              { '/': '/hub/*', comment: 'the Hub' },
              { '/': '/hub', comment: 'the Hub root' },
            ],
          },
        ],
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        // Apple caches this; a short life means a mistake is not permanent.
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
