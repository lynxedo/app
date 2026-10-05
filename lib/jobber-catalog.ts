import { jobberGraphQLPatient } from '@/lib/jobber'

// The Jobber Products & Services list, read LIVE (Work Orders PRD rule 5: no
// cached prices). Shared by the stop's "+ Add line item" picker (Work Orders
// Phase 2) and the quote template editor / builder (Phase 4).

export type JobberCatalogItem = {
  id: string
  name: string
  description: string | null
  price: number
  taxable: boolean | null
  category: string | null
}

const CATALOG_QUERY = `
  query WorkOrderCatalog($after: String) {
    productOrServices(first: 100, after: $after) {
      nodes { id name description defaultUnitCost taxable category visible }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type Node = { id: string; name: string; description: string | null; defaultUnitCost: number | null; taxable: boolean | null; category: string | null; visible: boolean | null }

/** Visible items only, sorted by name. Throws when Jobber can't be read. */
export async function readJobberCatalog(jobberUserId: string): Promise<JobberCatalogItem[]> {
  const nodes: Node[] = []
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const res: { data?: { productOrServices: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } =
      await jobberGraphQLPatient(jobberUserId, CATALOG_QUERY, { after })
    const conn = res.data?.productOrServices
    if (!conn) break
    nodes.push(...conn.nodes)
    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }
  return nodes
    .filter(p => p.visible !== false)
    .map(p => ({ id: p.id, name: p.name, description: p.description, price: p.defaultUnitCost ?? 0, taxable: p.taxable, category: p.category }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
