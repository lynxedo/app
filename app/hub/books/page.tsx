import { createAdminClient } from '@/lib/supabase/admin'
import { loadPLData } from '@/lib/qbo-pl'

// This is a live QBO-backed financial dashboard — it must render per-request, not
// be statically prerendered at build. Without this, `next build` tried to
// pre-generate the page, ran loadPLData()'s live QuickBooks call at build time,
// and intermittently failed the whole deploy when QBO took >60s (3 retries then
// abort). force-dynamic skips build-time prerender entirely.
export const dynamic = 'force-dynamic'
import type { PLData } from '@/lib/qbo-pl'
import YTDStrip from '@/components/books/YTDStrip'
import MonthlyPLChart from '@/components/books/MonthlyPLChart'
import MonthCards from '@/components/books/MonthCards'
import CostTrendChart from '@/components/books/CostTrendChart'
import OverheadChart from '@/components/books/OverheadChart'
import RefreshButton from '@/components/books/RefreshButton'

async function isQBOConnected(): Promise<boolean> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('qbo_tokens')
      .select('id')
      .limit(1)
      .single()
    return !!data
  } catch {
    return false
  }
}

async function fetchPLData(): Promise<PLData | null> {
  try {
    return await loadPLData()
  } catch {
    return null
  }
}

export default async function BooksPage() {
  const connected = await isQBOConnected()

  if (!connected) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Books — Financial Dashboard</h1>
          <p className="text-gray-400 mb-6">Connect your QuickBooks account to get started.</p>
          <a
            href="/api/qbo/auth"
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            Connect QuickBooks
          </a>
        </div>
      </main>
    )
  }

  const plData = await fetchPLData()

  if (!plData) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Books — Financial Dashboard</h1>
        <p className="text-red-400">Failed to load QuickBooks data. Check the PM2 logs.</p>
        <RefreshButton />
      </main>
    )
  }

  const fetchedAt = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Books — Financial Dashboard</h1>
            <p className="text-gray-500 text-xs mt-0.5">Refreshed {fetchedAt} CT</p>
          </div>
          <div className="flex gap-2 items-center">
            <RefreshButton />
          </div>
        </div>

        {/* YTD Strip */}
        <YTDStrip data={plData} />

        {/* Monthly P&L Chart */}
        <MonthlyPLChart data={plData} />

        {/* Month Comparison Cards */}
        <MonthCards data={plData} />

        {/* Cost Trend + Overhead side-by-side on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CostTrendChart data={plData} />
          <OverheadChart />
        </div>

      </div>
    </main>
  )
}
