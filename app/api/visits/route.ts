import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

const VISITS_QUERY = `
  query GetVisitsForRoute($filter: VisitFilterAttributes) {
    visits(first: 50, filter: $filter) {
      nodes {
        id
        startAt
        endAt
        client {
          name
          phones { number }
        }
        property {
          address {
            street1
            city
            province
            postalCode
          }
        }
        lineItems(first: 10) {
          nodes {
            name
            totalPrice
          }
        }
        job {
          id
          title
        }
      }
    }
  }
`

interface Address {
  street1: string
  city: string
  province: string
  postalCode: string
}

interface JobberVisit {
  id: string
  startAt: string | null
  endAt: string | null
  client: { name: string; phones: Array<{ number: string }> }
  property: { address: Address }
  lineItems: { nodes: Array<{ name: string; totalPrice: number }> }
  job: { id: string; title: string }
}

interface JobberVisitsResponse {
  data: { visits: { nodes: JobberVisit[] } }
  errors?: Array<{ message: string }>
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')        // YYYY-MM-DD
  const assignedTo = searchParams.get('userId') // Jobber user encoded ID

  if (!date || !assignedTo) {
    return NextResponse.json({ error: 'date and userId are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const filter = {
    startAt: {
      after:  `${date}T00:00:00`,
      before: `${date}T23:59:59`,
    },
    assignedTo: assignedTo,
  }

  try {
    const result = await jobberGraphQL<JobberVisitsResponse>(
      user.id,
      VISITS_QUERY,
      { filter }
    )

    if (result.errors?.length) {
      return NextResponse.json({ error: result.errors[0].message }, { status: 400 })
    }

    const visits = result.data.visits.nodes.map((v, i) => ({
      stopNumber: i + 1,
      id: v.id,
      clientName: v.client.name,
      phone: v.client.phones?.[0]?.number ?? null,
      address: v.property?.address ?? null,
      addressString: v.property?.address
        ? `${v.property.address.street1}, ${v.property.address.city}, ${v.property.address.province} ${v.property.address.postalCode}`
        : 'No address',
      services: v.lineItems.nodes.map(li => li.name).join(', '),
      totalPrice: v.lineItems.nodes.reduce((sum, li) => sum + (li.totalPrice ?? 0), 0),
      jobTitle: v.job?.title ?? '',
      startAt: v.startAt,
      endAt: v.endAt,
    }))

    return NextResponse.json({ visits })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
