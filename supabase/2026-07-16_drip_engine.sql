-- Drip Marketing — unified multi-channel lead-nurture engine (PRD §5).
-- Increment 1 = SMS speed-to-lead. Additive only; applied to the shared Supabase
-- DB on 2026-07-16 via MCP. All tables company_id-scoped (multi-tenant from day 1).
--
-- A drip campaign is a sequence of ordered steps. A trigger (new_lead / lead_source)
-- enrolls a matching lead at step 0; a per-minute cron (/api/drip/process) sweeps
-- triggers into enrollments and advances each enrollment's state machine, sending
-- the step's channel content (Phase 1 = SMS via lib/txt-send.ts) and scheduling the
-- next step by its delay. An inbound reply from an enrolled number pauses the
-- enrollment (status 'replied') so a human/Amber takes over. Modeled directly on the
-- proven email automation engine (email_automations/_steps/_enrollments/_sends).
--
-- Writes go through the service-role admin client (after a can_manage_drip check);
-- authenticated users get company-scoped SELECT.

-- ── The sequence definition ──────────────────────────────────────────────────
create table if not exists public.drip_campaigns (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  description    text not null default '',
  trigger_type   text not null,                     -- new_lead | lead_source | manual
  trigger_config jsonb not null default '{}'::jsonb, -- lead_source: {"lead_source":"Angi Lead"}
  status         text not null default 'draft',      -- draft | active | paused
  quiet_hours    jsonb,                              -- optional per-campaign override of drip_settings
  last_swept_at  timestamptz,                        -- enrollment-sweep watermark (seeded at activation)
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_drip_campaigns_company on public.drip_campaigns(company_id, created_at desc);
create index if not exists idx_drip_campaigns_active  on public.drip_campaigns(status) where status = 'active';

-- ── Ordered steps within a campaign ──────────────────────────────────────────
-- `delay` is the wait BEFORE the step fires. Step 0 with {"minutes":0} = the
-- instant speed-to-lead first touch (due on the very next cron tick).
create table if not exists public.drip_steps (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.drip_campaigns(id) on delete cascade,
  step_index   integer not null,
  channel      text not null default 'sms',          -- sms (Phase 1) | email | rvm (later)
  delay        jsonb not null default '{}'::jsonb,    -- {"minutes":0} | {"hours":N} | {"days":N}
  content_ref  jsonb not null default '{}'::jsonb,    -- sms: {"body":"..."} or {"template_id":"..."}
  send_window  jsonb,                                 -- optional per-step business-hours gate
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (campaign_id, step_index)
);

-- ── One row per lead moving through a campaign ───────────────────────────────
create table if not exists public.drip_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  campaign_id        uuid not null references public.drip_campaigns(id) on delete cascade,
  lead_id            uuid,                             -- source leads row (null for manual/contact enroll)
  contact_id         uuid references public.txt_contacts(id) on delete set null,
  phone              text,                             -- E164 snapshot for sending
  phone_digits       text,                             -- last-10 for inbound reply matching
  current_step_index integer not null default 0,
  status             text not null default 'active',   -- active | replied | completed | opted_out | exited | failed
  next_run_at        timestamptz not null default now(),
  enrolled_at        timestamptz not null default now(),
  completed_at       timestamptz,
  paused_reason      text
);
-- A given lead enrolls in a given campaign once (partial: manual enrollments have null lead_id).
create unique index if not exists uniq_drip_enroll_campaign_lead
  on public.drip_enrollments(campaign_id, lead_id) where lead_id is not null;
create index if not exists idx_drip_enroll_due on public.drip_enrollments(next_run_at) where status = 'active';
create index if not exists idx_drip_enroll_campaign on public.drip_enrollments(campaign_id, status);
create index if not exists idx_drip_enroll_phone on public.drip_enrollments(company_id, phone_digits) where status = 'active';
create index if not exists idx_drip_enroll_contact on public.drip_enrollments(contact_id) where status = 'active';

-- ── Unified cross-channel send ledger (permanent audit trail for TCPA) ────────
create table if not exists public.drip_sends (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid references public.drip_enrollments(id) on delete cascade,
  campaign_id   uuid,
  company_id    uuid,
  step_index    integer,
  channel       text,
  status        text not null,   -- sent | failed | skipped_suppressed | skipped_quiet_hours | skipped_opted_out | skipped_frequency_cap
  provider_ref  text,            -- Twilio SID / Resend id / RVM id
  to_phone      text,
  body          text,
  error         text,
  sent_at       timestamptz not null default now()
);
create index if not exists idx_drip_sends_enrollment  on public.drip_sends(enrollment_id);
create index if not exists idx_drip_sends_company_day  on public.drip_sends(company_id, sent_at);

-- ── Per-company defaults ─────────────────────────────────────────────────────
create table if not exists public.drip_settings (
  company_id                uuid primary key references public.companies(id) on delete cascade,
  quiet_hours               jsonb not null default '{"start":8,"end":20,"tz":"America/Chicago"}'::jsonb,
  default_sms_number_id     uuid,
  default_email_identity_id uuid,
  send_as_user_id           uuid,      -- the Hub user drip Txt threads are owned by (sent_by); HOLD if unset
  frequency_cap             integer not null default 6,  -- max drip touches/day/lead across campaigns
  rvm_enabled               boolean not null default false,
  rvm_consent_confirmed     boolean not null default false,
  business_display_name     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ── RLS (company-scoped SELECT; writes via service role) ─────────────────────
alter table public.drip_campaigns   enable row level security;
alter table public.drip_steps       enable row level security;
alter table public.drip_enrollments enable row level security;
alter table public.drip_sends       enable row level security;
alter table public.drip_settings    enable row level security;

create policy drip_campaigns_select_company on public.drip_campaigns
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy drip_steps_select_company on public.drip_steps
  for select to authenticated
  using (campaign_id in (
    select c.id from public.drip_campaigns c
    join public.user_profiles up on up.company_id = c.company_id
    where up.id = auth.uid()));

create policy drip_enrollments_select_company on public.drip_enrollments
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy drip_sends_select_company on public.drip_sends
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy drip_settings_select_company on public.drip_settings
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));
