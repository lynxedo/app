import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

export const dynamic = 'force-dynamic'

const CLIENT_SEARCH = `
  query ClientSearch($filter: ClientFilterInput, $first: Int) {
    clients(filter: $filter, first: $first) {
      nodes {
        id
        firstName
        lastName
        companyName
        defaultPhone {
          friendlyNumber
        }
        billingAddress {
          street
          city
          province
        }
      }
    }
  }
`

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('can_access_forms')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_forms) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = new URL(request.url).searchParams.get('q') ?? ''
  if (q.trim().length < 2) return NextResponse.json({ clients: [] })

  try {
    const result = await jobberGraphQL<{
      data: {
        clients: {
          nodes: Array<{
            id: string
            firstName: string
            lastName: string
            companyName: string | null
            defaultPhone: { friendlyNumber: string } | null
            billingAddress: { street: string; city: string; province: string } | null
          }>
        }
      }
    }>(user.id, CLIENT_SEARCH, { filter: { searchTerm: q }, first: 10 })

    const nodes = result?.data?.clients?.nodes ?? []
    const clients = nodes.map(c => ({
      id: c.id,
      name: c.companyName || `${c.firstName} ${c.lastName}`.trim(),
      phone: c.defaultPhone?.friendlyNumber ?? null,
      address: c.billingAddress
        ? [c.billingAddress.street, c.billingAddress.city].filter(Boolean).join(', ')
        : null,
    }))
    return NextResponse.json({ clients })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Jobber search failed'
    return NextResponse.json({ error: msg, clients: [] }, { status: 500 })
  }
}
