import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

const USERS_QUERY = `
  query GetUsers {
    users(first: 50) {
      nodes {
        id
        name {
          full
        }
      }
    }
  }
`

interface JobberUsersResponse {
  data: {
    users: {
      nodes: Array<{ id: string; name: { full: string } }>
    }
  }
  errors?: Array<{ message: string }>
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await jobberGraphQL<JobberUsersResponse>(user.id, USERS_QUERY)

    if (result.errors?.length) {
      return NextResponse.json({ error: result.errors[0].message }, { status: 400 })
    }

    const users = result.data.users.nodes.map(u => ({
      id: u.id,
      name: u.name.full,
    }))

    return NextResponse.json({ users })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
