import { NextRequest, NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'

const USERS_QUERY = `
  query GetUsers {
    users(first: 50) {
      nodes {
        id
        isAccountOwner
        name { full }
      }
    }
  }
`

interface JobberUsersResponse {
  data: {
    users: {
      nodes: Array<{
        id: string
        isAccountOwner: boolean
        name: { full: string }
      }>
    }
  }
  errors?: Array<{ message: string }>
}

export async function GET(req: NextRequest) {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId, supabase } = auth

  // Jobber is connected per COMPANY, not per user. `jobber_tokens` is RLS'd to
  // `auth.uid() = user_id`, so asking for the signed-in user's own token answers
  // "did *I* personally connect Jobber" — null for everyone except the one person
  // who did. Resolve the company's connected account and go through the admin
  // client instead (see companyJobberUserId in lib/jobber.ts).
  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) {
    return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })
  }

  // ?include_all=1 — admin allowlist UI uses this to see every active user
  // regardless of the saved allowlist. Default fetches only the allowlist (or
  // all active if no allowlist is configured).
  const includeAll = req.nextUrl.searchParams.get('include_all') === '1'

  try {
    const result = await jobberGraphQLAdmin<JobberUsersResponse>(jobberUserId, USERS_QUERY)

    if (result.errors?.length) {
      return NextResponse.json({ error: result.errors[0].message }, { status: 400 })
    }

    // Jobber's public schema does not expose an account-lock / deactivated
    // flag on the User type, so the visible-tech allowlist below is the
    // authoritative filter for hiding inactive employees from the dropdown.
    let users = result.data.users.nodes.map(u => ({
      id: u.id,
      name: u.name.full,
      isAccountOwner: u.isAccountOwner,
    }))

    if (!includeAll) {
      // Apply visible_tech_ids allowlist from company_routing_settings.
      const { data: hu } = await supabase
        .from('hub_users')
        .select('company_id')
        .eq('id', userId)
        .maybeSingle()
      if (hu?.company_id) {
        const { data: settings } = await supabase
          .from('company_routing_settings')
          .select('visible_tech_ids')
          .eq('company_id', hu.company_id)
          .maybeSingle()
        const allow = settings?.visible_tech_ids as string[] | null | undefined
        if (allow && allow.length > 0) {
          const allowSet = new Set(allow)
          users = users.filter(u => allowSet.has(u.id))
        }
      }
    }

    return NextResponse.json({
      users: users.map(u => ({ id: u.id, name: u.name })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
