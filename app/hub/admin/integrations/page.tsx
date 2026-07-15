import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import IntegrationsAdminPanel from './IntegrationsAdminPanel'
import type { ProviderKey, IntegrationStatus } from '@/lib/integrations-catalog'

export const metadata = { title: 'Integrations Admin' }

// Live status is derived from each provider's own source of truth, not a mirror
// — so the page can never drift from reality. Per-tenant settings + inbound
// webhook routing live in company_integrations (the SaaS spine, consumed by the
// per-tenant webhook work that follows this shell).
export default async function AdminIntegrationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_integrations')
    .eq('id', user.id)
    .single()
  if ((profile?.role !== 'admin' && !profile?.can_admin_integrations) || !profile?.company_id) {
    redirect('/hub/home')
  }
  const companyId = profile.company_id
  const admin = createAdminClient()

  const [jobber, qbo, gusto, meta, email, onestep] = await Promise.all([
    admin.from('jobber_tokens').select('id').eq('company_id', companyId).limit(1).maybeSingle(),
    admin.from('qbo_tokens').select('id').limit(1).maybeSingle(), // QBO is a single global connection today
    admin.from('gusto_connections').select('company_id').eq('company_id', companyId).maybeSingle(),
    admin.from('social_accounts').select('id, active').eq('company_id', companyId),
    admin.from('email_sending_identities').select('id, domain_verified').eq('company_id', companyId),
    admin.from('company_integrations').select('config').eq('company_id', companyId).eq('provider', 'onestepgps').maybeSingle(),
  ])

  const gustoConfigured = !!(process.env.GUSTO_CLIENT_ID && process.env.GUSTO_CLIENT_SECRET)
  const angiConfigured = !!process.env.ANGI_WEBHOOK_KEY
  const metaActive = (meta.data ?? []).filter((a: { active?: boolean | null }) => a.active).length
  const emailRows = (email.data ?? []) as { domain_verified?: boolean | null }[]
  const emailVerified = emailRows.some(e => e.domain_verified)
  // OneStepGPS: a per-company key entered here wins; else the shared env key
  // covers the original fleet company (Heroes). See lib/onestepgps.ts.
  const oneStepOwnKey = !!((onestep.data?.config ?? null) as { api_key?: string } | null)?.api_key
  const oneStepEnvKey = !!process.env.ONESTEPGPS_API_KEY
  const fleetEnvCompany = process.env.FLEET_GPS_COMPANY_ID ?? '00000000-0000-0000-0000-000000000002'

  const statuses: Record<ProviderKey, { status: IntegrationStatus; detail?: string }> = {
    jobber: jobber.data ? { status: 'connected' } : { status: 'not_connected' },
    quickbooks: qbo.data ? { status: 'connected' } : { status: 'not_connected' },
    gusto: !gustoConfigured
      ? { status: 'action_needed', detail: 'Server keys not set — contact Lynxedo' }
      : gusto.data ? { status: 'connected' } : { status: 'not_connected' },
    meta: metaActive > 0
      ? { status: 'connected', detail: `${metaActive} account${metaActive > 1 ? 's' : ''} connected` }
      : { status: 'not_connected' },
    email: emailVerified
      ? { status: 'connected' }
      : emailRows.length ? { status: 'action_needed', detail: 'Domain not verified' } : { status: 'not_connected' },
    onestepgps: oneStepOwnKey
      ? { status: 'connected', detail: 'Your OneStepGPS account' }
      : oneStepEnvKey && companyId === fleetEnvCompany
        ? { status: 'connected', detail: 'Managed key' }
        : { status: 'not_connected' },
    angi: angiConfigured
      ? { status: 'connected', detail: 'Receiving via the managed webhook' }
      : { status: 'not_connected' },
    google_lsa: { status: 'coming_soon' },
    google_ads: { status: 'coming_soon' },
    thumbtack: { status: 'coming_soon' },
    networx: { status: 'coming_soon' },
    zillow: { status: 'coming_soon' },
  }

  const webhookBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lynxedo.com'

  return <IntegrationsAdminPanel statuses={statuses} webhookBase={webhookBase} onestepgpsOwnKey={oneStepOwnKey} />
}
