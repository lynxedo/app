// The single source of truth for the Admin → Integrations catalog.
//
// Every external integration Lynxedo offers a subscriber is listed here. Adding
// a new one = adding an entry (and its connect route / manage link), not
// rebuilding the page. Live connection STATUS is computed server-side in
// app/hub/admin/integrations/page.tsx from each provider's own source of truth;
// per-tenant SETTINGS + inbound-webhook routing live in the company_integrations
// table (the SaaS spine). Platform plumbing (Twilio, Claude, etc.) is Lynxedo's
// own keys — shown read-only, never subscriber-connected.
//
// NOTE: plain TS module — no 'use client' / server-only imports — so both the
// server page and the client panel can import it.

export type IntegrationGroup = 'lead_sources' | 'business_systems' | 'marketing'

// oauth        → "Connect" redirects the subscriber through the provider's OAuth
// domain       → DNS/domain verification handled in that module's own editor
// webhook      → the source POSTs leads to a Lynxedo URL (+ key)
// apikey       → the subscriber pastes their own API key (stored per-company)
// coming_soon  → planned, not built yet
export type ConnectionModel = 'oauth' | 'domain' | 'webhook' | 'apikey' | 'coming_soon'

export type ProviderKey =
  | 'jobber' | 'quickbooks' | 'gusto' | 'onestepgps'
  | 'angi' | 'google' | 'thumbtack' | 'networx' | 'zillow'
  | 'meta' | 'email'

export type IntegrationStatus =
  | 'connected' | 'action_needed' | 'not_connected' | 'error' | 'coming_soon'

export type IntegrationProvider = {
  key: ProviderKey
  name: string
  blurb: string
  group: IntegrationGroup
  model: ConnectionModel
  connectHref?: string     // GET → provider OAuth redirect
  disconnectHref?: string  // POST → disconnect
  manageHref?: string      // deep link to the module that owns the detailed editor
  manageLabel?: string
}

export const GROUP_LABELS: Record<IntegrationGroup, string> = {
  lead_sources: 'Lead sources',
  business_systems: 'Business systems',
  marketing: 'Marketing',
}

export const GROUP_ORDER: IntegrationGroup[] = ['lead_sources', 'business_systems', 'marketing']

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  // ── Lead sources ──────────────────────────────────────────────────────────
  {
    key: 'angi', name: 'Angi', group: 'lead_sources', model: 'webhook',
    blurb: 'Auto-import Angi leads straight into the Lead Tracker the moment they arrive.',
  },
  {
    key: 'google', name: 'Google Ads & Local Services', group: 'lead_sources', model: 'oauth',
    blurb: 'Connect your Google account to pull Local Services Ads leads — including the phone number — plus Google Ads lead-form and campaign data.',
    connectHref: '/api/auth/google', disconnectHref: '/api/auth/google/disconnect',
  },
  {
    key: 'thumbtack', name: 'Thumbtack', group: 'lead_sources', model: 'coming_soon',
    blurb: 'Auto-import Thumbtack leads into the Lead Tracker.',
  },
  {
    key: 'networx', name: 'Networx', group: 'lead_sources', model: 'coming_soon',
    blurb: 'Auto-import Networx leads into the Lead Tracker.',
  },
  {
    key: 'zillow', name: 'Zillow', group: 'lead_sources', model: 'coming_soon',
    blurb: 'Auto-import Zillow leads into the Lead Tracker.',
  },

  // ── Business systems ──────────────────────────────────────────────────────
  {
    key: 'jobber', name: 'Jobber', group: 'business_systems', model: 'oauth',
    blurb: 'Sync clients, jobs, visits and line items — the operational system of record.',
    connectHref: '/api/auth/jobber', disconnectHref: '/api/auth/jobber/disconnect',
  },
  {
    key: 'quickbooks', name: 'QuickBooks Online', group: 'business_systems', model: 'oauth',
    blurb: 'Power the Financial Dashboard — profit & loss, balances and more.',
    connectHref: '/api/qbo/auth', disconnectHref: '/api/qbo/disconnect',
  },
  {
    key: 'gusto', name: 'Gusto', group: 'business_systems', model: 'oauth',
    blurb: 'Payroll — match and sync your employee roster with Gusto.',
    connectHref: '/api/admin/gusto/connect',
    manageHref: '/hub/admin/timesheet', manageLabel: 'Match employees in Time Records',
  },
  {
    key: 'onestepgps', name: 'OneStepGPS', group: 'business_systems', model: 'apikey',
    blurb: 'Live fleet GPS — track your trucks on the map with day-by-day route history.',
    manageHref: '/hub/admin/fleet', manageLabel: 'Fleet alert settings',
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  {
    key: 'meta', name: 'Facebook & Instagram', group: 'marketing', model: 'oauth',
    blurb: 'Connect your Facebook Pages and Instagram to post from Social Marketing.',
    manageHref: '/hub/admin/marketing', manageLabel: 'Manage in Social Marketing',
  },
  {
    key: 'email', name: 'Email sending domain', group: 'marketing', model: 'domain',
    blurb: 'Verify the domain your marketing email is sent from (deliverability).',
    manageHref: '/hub/admin/email', manageLabel: 'Manage in Email Marketing',
  },
]
