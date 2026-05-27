import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?include_all=1 — admin allowlist UI uses this to see every active user
  // regardless of the saved allowlist. Default fetches only the allowlist (or
  // all active if no allowlist is configured).
  const includeAll = req.nextUrl.searchParams.get('include_all') === '1'

  try {
    const result = await jobberGraphQL<JobberUsersResponse>(user.id, USERS_QUERY)

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
        .eq('id', user.id)
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
