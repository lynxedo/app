import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await jobberGraphQL<ProductsResponse>(user.id, PRODUCTS_QUERY, {})
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
