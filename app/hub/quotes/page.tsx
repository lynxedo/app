import { requireQuotePage } from './gate'
import QuotesList from './QuotesList'

export const metadata = { title: 'Quotes' }
export const dynamic = 'force-dynamic'

export default async function QuotesPage() {
  const { canAdmin } = await requireQuotePage()
  return <QuotesList canAdmin={canAdmin} />
}
