import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listCatalog, getBillingMode } from '@/lib/billing/catalog'
import type { CompanySubscription } from '@/lib/billing/types'
import BillingView from './BillingView'

export const metadata = { title: 'Billing' }

// Company-facing Billing page (M2). This is a company-admin/owner surface: the person
// running the tenant picks their plan (base + à-la-carte modules), sees their current
// subscription status, and jumps to Stripe Checkout / the Customer Portal. It is NOT
// the platform super-admin pricing catalog (that lives at /hub/admin/platform) — this
// page only READS the catalog and the tenant's own subscription.
//
// billing_catalog / company_subscription / company_module_subscription are read with
// the service-role admin client (RLS on those tables has no company-facing read policy),
// but only AFTER we've confirmed the caller is an admin of a specific company and we
// scope every query to that company_id.
export default async function BillingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  // Billing management is limited to a company's admin/owner.
  if (!profile?.company_id || profile.role !== 'admin') redirect('/hub')

  const companyId = profile.company_id as string
  const admin = createAdminClient()
  const mode = getBillingMode()

  const [subRes, moduleRes, features, companyRes] = await Promise.all([
    admin
      .from('company_subscription')
      .select('*')
      .eq('company_id', companyId)
      .eq('mode', mode)
      .maybeSingle(),
    admin
      .from('company_module_subscription')
      .select('feature_key')
      .eq('company_id', companyId)
      .eq('mode', mode)
      .eq('active', true),
    listCatalog(admin),
    admin.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
  ])

  const subscription = (subRes.data ?? null) as CompanySubscription | null
  const subscribedKeys = ((moduleRes.data ?? []) as Array<{ feature_key: string }>).map(
    (m) => m.feature_key,
  )
  const company = {
    id: companyId,
    name: (companyRes.data?.name as string | undefined) ?? 'Your company',
  }

  return (
    <BillingView
      company={company}
      mode={mode}
      subscription={subscription}
      subscribedKeys={subscribedKeys}
      features={features}
    />
  )
}
