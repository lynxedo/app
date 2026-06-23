-- Email Marketing Session 5: event tracking + analytics.
-- Applied to the shared Supabase DB on 2026-06-23 via MCP. Additive only.
--
-- email_events is the engagement log: Resend webhook events (delivered / opened /
-- clicked / bounced / complained / delivery_delayed) plus our own 'unsubscribed'
-- event (logged when someone uses a campaign's unsubscribe link). Events match
-- back to a send via provider_message_id -> email_campaign_recipients, so we
-- denormalize campaign_id + recipient_id at insert time for fast per-campaign
-- analytics. event_id (Svix delivery id) makes webhook retries idempotent.
--
-- NOTE (deliberate deviation from PRD §6b): we do NOT build the separate
-- email_sends ledger yet — email_campaign_recipients already IS the campaign send
-- ledger (it holds provider_message_id, email, contact_id, campaign_id, status).
-- email_sends gets introduced in Session 6 when the automation engine needs a
-- unified ledger spanning campaigns + automation steps.

create table if not exists public.email_events (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references public.companies(id) on delete cascade,
  campaign_id         uuid references public.email_campaigns(id) on delete cascade,
  recipient_id        uuid references public.email_campaign_recipients(id) on delete set null,
  email               text,
  provider_message_id text,
  type                text not null,  -- delivered|opened|clicked|bounced|complained|delivery_delayed|sent|unsubscribed
  url                 text,           -- for 'clicked'
  occurred_at         timestamptz not null default now(),
  event_id            text,           -- Svix delivery id (retry-idempotency)
  raw                 jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists idx_email_events_campaign on public.email_events(campaign_id, type);
create index if not exists idx_email_events_provider  on public.email_events(provider_message_id);
-- Idempotency: one logged row per (Svix delivery, type). Partial so rows we log
-- ourselves (unsubscribe) without an event_id are unconstrained.
create unique index if not exists email_events_event_uniq
  on public.email_events(event_id, type) where event_id is not null;

alter table public.email_events enable row level security;

create policy email_events_select_company on public.email_events
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

-- Per-campaign engagement funnel (distinct recipients per event type). Called
-- ONLY via the service-role admin client from the campaign detail route, which
-- has already verified the campaign belongs to the caller's company — so this is
-- granted to service_role only (NOT authenticated/anon), closing any
-- cross-company aggregate leak.
create or replace function public.email_campaign_stats(p_campaign_id uuid)
returns table(
  delivered bigint, opened bigint, clicked bigint,
  bounced bigint, complained bigint, unsubscribed bigint
)
language sql security definer set search_path to 'public' as $$
  select
    count(distinct recipient_id) filter (where type = 'delivered'),
    count(distinct recipient_id) filter (where type = 'opened'),
    count(distinct recipient_id) filter (where type = 'clicked'),
    count(distinct recipient_id) filter (where type = 'bounced'),
    count(distinct recipient_id) filter (where type = 'complained'),
    count(distinct recipient_id) filter (where type = 'unsubscribed')
  from public.email_events where campaign_id = p_campaign_id;
$$;
revoke execute on function public.email_campaign_stats(uuid) from public, anon, authenticated;
grant  execute on function public.email_campaign_stats(uuid) to service_role;
