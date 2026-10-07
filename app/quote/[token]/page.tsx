import { createAdminClient } from '@/lib/supabase/admin'
import { loadPublicQuote, quoteByToken } from '@/lib/quote-public'
import QuotePublic from './QuotePublic'

// Public, no-login customer quote page (Work Orders & Quotes PRD — Phase 4,
// session 4). Reached only through the unguessable link sent by text / email.
// Renders ONLY the allowlisted CustomerQuote (lib/quotes.ts toCustomerQuote) —
// internal notes, Jobber ids, Pricer refs and who built it never appear.
// Outside proxy.ts's matcher, so it needs no session.

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'Your quote' }

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const q = await quoteByToken(admin, token)
  if (!q) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center text-gray-700">
          <h1 className="text-xl font-semibold text-gray-900">This link isn’t valid</h1>
          <p className="mt-2 text-sm">The quote may have been replaced. Please contact us and we’ll send you a fresh link.</p>
        </div>
      </main>
    )
  }
  const view = await loadPublicQuote(admin, q)
  return <QuotePublic token={token} initial={view} />
}
