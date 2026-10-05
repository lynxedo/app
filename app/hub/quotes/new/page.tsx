import { requireQuotePage } from '../gate'
import NewQuote from './NewQuote'

export const metadata = { title: 'New quote' }
export const dynamic = 'force-dynamic'

// /hub/quotes/new?contact=… | ?stop=… | ?lead=…  (or none → pick a customer)
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireQuotePage()
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null)
  return <NewQuote contactId={one(sp.contact)} stopId={one(sp.stop)} leadId={one(sp.lead)} />
}
