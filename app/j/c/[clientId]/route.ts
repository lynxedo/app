import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Resolver behind the "Lynxedo Customer File" link custom field in Jobber.
//
// Jobber stores /j/c/<numeric Jobber client id> — never a Lynxedo contact UUID.
// Two reasons. The link keeps working when contacts are merged, so we never have
// to rewrite ~1,600 custom field values. And the numeric id is URL-safe: Jobber's
// own encoded ids are base64, whose alphabet includes "/" and "+", either of which
// would break a path segment. (Today's data happens to contain neither, but that's
// the data being lucky, not a guarantee.)
//
// Auth is resolved HERE, not by the destination. /hub/contacts/[id] — like 73 other
// Hub pages — does a bare redirect('/login') with no ?next=, so a signed-out tech
// tapping this from Jobber Mobile would sign in and land on Hub home, having lost
// the customer they were headed to. Bouncing the signed-out case back through
// /j/c/<id> also means no contact UUID is handed out before the caller has proved
// who they are.

export const dynamic = 'force-dynamic'

// Rebuild Jobber's encoded id so the lookup stays an exact, indexed match on the
// value the sync already stores, rather than decoding every row to compare.
function encodedClientId(numeric: string): string {
  return Buffer.from(`gid://Jobber/Client/${numeric}`).toString('base64')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  // A RELATIVE Location, deliberately. Behind the Cloudflare tunnel `request.url`
  // is the internal origin, so NextResponse.redirect(new URL(path, request.url))
  // sends the browser to localhost:3000. A relative reference (RFC 7231 7.1.2) is
  // resolved by the browser against the address it actually asked for, which also
  // keeps a tenant on its own subdomain — hardcoding NEXT_PUBLIC_APP_URL would
  // bounce heroes105.lynxedo.com users to the apex mid-flow.
  const to = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } })

  // A Jobber record id is digits. Anything else is a probe, not a mistyped link.
  if (!/^\d{1,20}$/.test(clientId)) return to('/hub/contacts')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return to(`/login?next=${encodeURIComponent(`/j/c/${clientId}`)}`)

  // RLS scopes this to the caller's own company, so a Jobber id belonging to
  // another tenant simply doesn't resolve here.
  const { data } = await supabase
    .from('txt_contacts')
    .select('id')
    .eq('jobber_client_id', encodedClientId(clientId))
    .maybeSingle()

  // Roughly 3% of Jobber clients have no directory record yet. Land those on the
  // directory rather than a dead end — the tech can search from there.
  return to(data?.id ? `/hub/contacts/${data.id}` : '/hub/contacts')
}
