import { requireQuotePage } from '../gate'
import QuoteBuilder from './QuoteBuilder'

export const metadata = { title: 'Quote' }
export const dynamic = 'force-dynamic'

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireQuotePage()
  const { id } = await params
  return <QuoteBuilder quoteId={id} />
}
