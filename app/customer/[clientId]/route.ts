import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveCustomerFileTarget } from '@/lib/customer-file'

/* "Open this customer" — the click-through from a report row to the customer file,
 * where texting and calling them live (Report PRD §8.3).
 *
 * Reports and Scoreboards hand out /customer/<clients.id> rather than a directory
 * uuid, so the mapping is resolved once here (see lib/customer-file.ts) instead of
 * in every RPC and every drill-down that happens to list a customer.
 *
 * ⚠ DELIBERATELY OUTSIDE /hub. proxy.ts bounces an unauthenticated /hub/* request
 * to /login with no ?next=, which would silently drop the customer someone was
 * heading to — the exact fault fixed for Google sign-in in August. Outside the
 * middleware matcher, the signed-out branch below runs and carries the destination
 * through the login form. Same reason /j/c/[clientId] sits where it does.
 */

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  // A RELATIVE Location, deliberately: behind the Cloudflare tunnel `request.url`
  // is the internal origin, so building an absolute URL from it sends the browser
  // to localhost:3000. It also keeps a tenant on their own subdomain.
  const to = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } })

  // Anything that isn't a uuid is a probe, not a mistyped link.
  if (!UUID.test(clientId)) return to('/hub/contacts')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return to(`/login?next=${encodeURIComponent(`/customer/${clientId}`)}`)

  // RLS scopes both lookups to the caller's company.
  const target = await resolveCustomerFileTarget(supabase, clientId)

  // No directory record (37 of Heroes' 1,672 Jobber customers) lands on the
  // directory, where the name can be searched — the same fallback /j/c has used
  // since it shipped. Not a redirect out to Jobber: in the iOS and Android shells
  // that navigates the whole webview to a site with no way back into the Hub.
  return to(target.kind === 'contact' ? target.path : '/hub/contacts')
}
