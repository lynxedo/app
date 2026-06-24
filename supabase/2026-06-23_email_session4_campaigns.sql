-- Email Marketing Session 4: one-off campaigns (throttled blasts).
-- Applied to the shared Supabase DB on 2026-06-23 via MCP. Additive only.
-- Mirrors the proven txt_broadcasts / txt_broadcast_recipients queue (Phase 2 SMS):
-- a campaign snapshots a rendered email (subject + body_html with {{merge}} tokens
-- intact), enqueues one recipient row per audience member, and the
-- /api/email/campaigns/process cron drains them under the campaign's throttle.
-- Writes go through the service-role admin client (after a can_access_email check
-- in the route); authenticated users get a company-scoped SELECT policy, mirroring
-- email_templates / email_segments.

create table if not exists public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  created_by      uuid references auth.users(id),
  -- template/segment kept for provenance; nullable so deleting one doesn't erase
  -- campaign history. The actual sent content is frozen in subject/body_html below.
  template_id     uuid references public.email_templates(id) on delete set null,
  segment_id      uuid references public.email_segments(id) on delete set null,
  name            text not null default '',
  subject         text not null default '',
  -- send-time snapshot: rendered, email-safe HTML with {{first_name}} merge tokens
  -- still present (filled per-recipient at send) and image paths absolutized.
  body_html       text not null default '',
  status          text not null default 'queued',  -- draft|queued|processing|complete|canceled
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  failed_count    integer not null default 0,
  skipped_count   integer not null default 0,
  throttle_per_min integer not null default 60,     -- ≤120 (Resend default 2 req/s); clamped in the route
  scheduled_at    timestamptz,                      -- null => send asap
  started_at      timestamptz,
  completed_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_email_campaigns_company on public.email_campaigns(company_id, created_at desc);
create index if not exists idx_email_campaigns_drain   on public.email_campaigns(status) where status in ('queued','processing');

create table if not exists public.email_campaign_recipients (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id          uuid references public.txt_contacts(id) on delete set null,
  email               text not null,
  -- name snapshot so the drainer renders {{merge}} without re-querying the
  -- directory (immune to mid-campaign contact edits).
  first_name          text,
  last_name           text,
  status              text not null default 'queued', -- queued|sent|failed|skipped
  provider_message_id text,
  error_message       text,
  processed_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_email_campaign_recipients_campaign on public.email_campaign_recipients(campaign_id);
create index if not exists idx_email_campaign_recipients_drain on public.email_campaign_recipients(campaign_id, status) where status = 'queued';

alter table public.email_campaigns           enable row level security;
alter table public.email_campaign_recipients enable row level security;

create policy email_campaigns_select_company on public.email_campaigns
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy email_campaign_recipients_select_company on public.email_campaign_recipients
  for select to authenticated
  using (campaign_id in (
    select c.id from public.email_campaigns c
    join public.user_profiles up on up.company_id = c.company_id
    where up.id = auth.uid()
  ));
