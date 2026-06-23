import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubToken } from '@/lib/email-unsubscribe'
import { suppressEmail } from '@/lib/email-contacts'
import { recordUnsubscribeEvent } from '@/lib/email-events'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Unsubscribe', robots: { index: false } }

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const claim = verifyUnsubToken(token)

  let ok = false
  let brand = ''
  if (claim) {
    const admin = createAdminClient()
    ok = await suppressEmail(admin, claim.companyId, claim.email, 'unsubscribe')
    if (ok) await recordUnsubscribeEvent(admin, claim.companyId, claim.campaignId, claim.email)
    const { data: settings } = await admin
      .from('email_settings').select('from_name').eq('company_id', claim.companyId).maybeSingle()
    brand = settings?.from_name || ''
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f1a', color: '#e5e7eb', fontFamily: 'system-ui, Segoe UI, Helvetica, Arial, sans-serif', padding: '24px' }}>
      <div style={{ maxWidth: 480, width: '100%', background: '#111827', border: '1px solid #1f2937', borderRadius: 16, padding: 28, textAlign: 'center' }}>
        {ok ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>You&apos;re unsubscribed</h1>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: '#9ca3af', margin: 0 }}>
              {claim?.email ? <><strong style={{ color: '#e5e7eb' }}>{claim.email}</strong> has been removed from</> : 'You have been removed from'}{' '}
              {brand ? <strong style={{ color: '#e5e7eb' }}>{brand}</strong> : 'our'} marketing emails. You won&apos;t receive any more.
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 16 }}>
              Changed your mind? Just reply to any past email and we&apos;ll add you back.
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Link not valid</h1>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: '#9ca3af', margin: 0 }}>
              This unsubscribe link is invalid or has expired. If you keep getting emails you don&apos;t want, reply to one and ask to be removed.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
