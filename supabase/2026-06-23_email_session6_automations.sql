-- Email Marketing Sessions 6–7: the automation engine.
-- Applied to the shared Supabase DB on 2026-06-23 via MCP. Additive only.
--
-- An automation is a journey: a trigger enrolls contacts, who then walk ordered
-- steps (send an email / wait N days / branch on a tag). A per-minute cron sweeps
-- triggers (new_client, tag_added) into enrollments and advances each enrollment's
-- state machine. Mirrors PRD §5. Writes go through the service-role admin client
-- (after a can_access_email check); authenticated users get company-scoped SELECT.

-- ── The journey definition ───────────────────────────────────────────────────
create table if not exists public.email_automations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  description    text not null default '',
  trigger_type   text not null,                 -- new_client | tag_added | manual
  trigger_config jsonb not null default '{}'::jsonb,  -- tag_added: {"tag_id": "..."}
  status         text not null default 'draft',  -- draft | active | paused
  last_swept_at  timestamptz,                    -- enrollment-sweep watermark (new_client cutoff)
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_email_automations_company on public.email_automations(company_id, created_at desc);
create index if not exists idx_email_automations_active on public.email_automations(status) where status = 'active';

-- ── Ordered steps within a journey ───────────────────────────────────────────
create table if not exists public.email_automation_steps (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  step_index    integer not null,
  type          text not null,                  -- send | wait | condition
  config        jsonb not null default '{}'::jsonb,
                -- send:      {"template_id": "..."}
                -- wait:      {"days": 7}  (or {"hours": N})
                -- condition: {"if": {"has_tag": "<tag_id>"}, "then_step": 4, "else_step": 6}
  created_at    timestamptz not null default now(),
  unique (automation_id, step_index)
);

-- ── One row per contact moving through a journey ─────────────────────────────
create table if not exists public.email_automation_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  automation_id      uuid not null references public.email_automations(id) on delete cascade,
  company_id         uuid not null,
  contact_id         uuid references public.txt_contacts(id) on delete cascade,
  email              text not null,
  first_name         text,
  last_name          text,
  current_step_index integer not null default 0,
  next_run_at        timestamptz not null default now(),
  status             text not null default 'active',  -- active | completed | exited | paused
  enrolled_at        timestamptz not null default now(),
  completed_at       timestamptz,
  unique (automation_id, contact_id)
);
create index if not exists idx_email_enroll_due on public.email_automation_enrollments(next_run_at) where status = 'active';
create index if not exists idx_email_enroll_automation on public.email_automation_enrollments(automation_id, status);

-- ── Send ledger for automation emails (the automation analog of
--    email_campaign_recipients; lets the Resend webhook attribute opens/clicks/
--    bounces back to an automation + auto-suppress them) ─────────────────────-─
create table if not exists public.email_automation_sends (
  id                  uuid primary key default gen_random_uuid(),
  automation_id       uuid references public.email_automations(id) on delete cascade,
  enrollment_id       uuid references public.email_automation_enrollments(id) on delete set null,
  step_index          integer,
  company_id          uuid,
  contact_id          uuid,
  email               text,
  template_id         uuid,
  provider_message_id text,
  sent_at             timestamptz not null default now()
);
create index if not exists idx_email_auto_sends_provider on public.email_automation_sends(provider_message_id);
create index if not exists idx_email_auto_sends_automation on public.email_automation_sends(automation_id);

-- ── email_events: attribute automation events too (additive) ─────────────────-
alter table public.email_events add column if not exists automation_id uuid;
alter table public.email_events add column if not exists enrollment_id uuid;

-- ── RLS (company-scoped SELECT; writes via service role) ─────────────────────-
alter table public.email_automations           enable row level security;
alter table public.email_automation_steps      enable row level security;
alter table public.email_automation_enrollments enable row level security;
alter table public.email_automation_sends      enable row level security;

create policy email_automations_select_company on public.email_automations
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy email_automation_steps_select_company on public.email_automation_steps
  for select to authenticated
  using (automation_id in (
    select a.id from public.email_automations a
    join public.user_profiles up on up.company_id = a.company_id
    where up.id = auth.uid()
  ));

create policy email_automation_enroll_select_company on public.email_automation_enrollments
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

create policy email_automation_sends_select_company on public.email_automation_sends
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));
