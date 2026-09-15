import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { jobberGraphQLAdmin, companyJobberUserId } from '@/lib/jobber'

const PRODUCTS_QUERY = `
  query GetProductsAndServices {
    productOrServices(first: 200) {
      nodes {
        id
        name
      }
    }
  }
`

interface ProductsResponse {
  data: {
    productOrServices: {
      nodes: Array<{ id: string; name: string }>
    }
  }
  errors?: Array<{ message: string }>
}

export async function GET() {
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  // Jobber is connected per COMPANY, not per user. `jobber_tokens` is RLS'd to
  // `auth.uid() = user_id`, so asking for the signed-in user's own token answers
  // "did *I* personally connect Jobber" — null for everyone except the one person
  // who did. Resolve the company's connected account and go through the admin
  // client instead (see companyJobberUserId in lib/jobber.ts).
  const jobberUserId = await companyJobberUserId(companyId, userId)
  if (!jobberUserId) {
    return NextResponse.json({ error: 'Jobber is not connected for your company' }, { status: 400 })
  }

  try {
    const result = await jobberGraphQLAdmin<ProductsResponse>(jobberUserId, PRODUCTS_QUERY, {})
    if (result.errors?.length) {
      return NextResponse.json({ error: result.errors[0].message }, { status: 400 })
    }
    const items = result.data.productOrServices.nodes.map(n => n.name).sort()
    return NextResponse.json({ lineItems: items })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
