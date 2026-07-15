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
// coming_soon  → planned, not built yet
export type ConnectionModel = 'oauth' | 'domain' | 'webhook' | 'coming_soon'

export type ProviderKey =
  | 'jobber' | 'quickbooks' | 'gusto'
  | 'angi' | 'google_lsa' | 'google_ads' | 'thumbtack' | 'networx' | 'zillow'
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
    key: 'google_lsa', name: 'Google Local Services Ads', group: 'lead_sources', model: 'coming_soon',
    blurb: 'Pull LSA leads — including the phone number — via the Google Ads API.',
  },
  {
    key: 'google_ads', name: 'Google Ads', group: 'lead_sources', model: 'coming_soon',
    blurb: 'Import Google Ads lead-form submissions and campaign data.',
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

// Lynxedo's own platform services — same keys for every subscriber, never
// entered here. Shown read-only so it's clear what runs under the hood.
export const PLATFORM_SERVICES: { name: string; blurb: string }[] = [
  { name: 'Twilio', blurb: 'Calls & text messaging' },
  { name: 'Anthropic (Claude)', blurb: 'AI features & Guardian' },
  { name: 'Deepgram', blurb: 'Call & voicemail transcription' },
  { name: 'ElevenLabs', blurb: 'AI receptionist voice' },
  { name: 'Mapbox', blurb: 'Maps & geocoding' },
  { name: 'Cloudflare R2', blurb: 'File & media storage' },
  { name: 'Push (Apple / Android / Web)', blurb: 'Mobile & desktop notifications' },
  { name: 'Supabase', blurb: 'Database, authentication & storage' },
]
