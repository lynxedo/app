-- Email Marketing: multiple sending identities per company (July 8, 2026)
--
-- Turns the single-identity model (one From/domain per company on
-- email_settings) into a list of verified sending identities, so a company can
-- send from more than one domain and pick which per campaign/automation.
--
-- Heroes' goal: send "important" mail from heroeslawncare.com and everything
-- else from send.lynxedo.com to build Lynxedo's domain reputation for SaaS.
--
-- Additive + non-destructive: new table, two nullable FK columns, and a Heroes
-- seed. email_settings is untouched (still holds the company-level CAN-SPAM
-- physical_address); its legacy from_* columns are left in place, unused.

create table if not exists public.email_sending_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  label text not null,                         -- human label shown in the "Send from" dropdown
  from_name text,                              -- display name (e.g. "Heroes Lawn Care of The Woodlands")
  from_email text not null,                    -- must be on a domain verified in Resend
  reply_to text,                               -- where replies land (no verification needed)
  sending_domain text,                         -- the Resend domain this From belongs to
  resend_domain_id text,                       -- Resend's domain id, for verification refresh
  domain_verified boolean not null default false,
  is_default boolean not null default false,   -- the identity a new campaign/automation starts on
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- One row per (company, From address); case-insensitive.
create unique index if not exists email_sending_identities_company_from_key
  on public.email_sending_identities (company_id, lower(from_email));

-- At most one default per company.
create unique index if not exists email_sending_identities_one_default
  on public.email_sending_identities (company_id) where is_default;

create index if not exists email_sending_identities_company_idx
  on public.email_sending_identities (company_id);

-- RLS mirrors email_settings: company-scoped SELECT for signed-in users; all
-- writes go through the service-role admin client in gated /api/admin routes.
alter table public.email_sending_identities enable row level security;

drop policy if exists email_sending_identities_select_company on public.email_sending_identities;
create policy email_sending_identities_select_company
  on public.email_sending_identities for select
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));

-- Per-send identity choice. Null = use the company default at send time.
alter table public.email_campaigns
  add column if not exists identity_id uuid references public.email_sending_identities(id) on delete set null;
alter table public.email_automations
  add column if not exists identity_id uuid references public.email_sending_identities(id) on delete set null;

-- ── Heroes seed (company 00000000-0000-0000-0000-000000000002) ───────────────
-- heroeslawncare.com = default (important mail); send.lynxedo.com = everything
-- else. Both domains are verified in Resend as of this migration.
insert into public.email_sending_identities
  (company_id, label, from_name, from_email, reply_to, sending_domain, resend_domain_id, domain_verified, is_default)
values
  ('00000000-0000-0000-0000-000000000002',
   'Heroes Lawn Care — heroeslawncare.com',
   'Heroes Lawn Care of The Woodlands',
   'hlc105@heroeslawncare.com',
   'hlc105@heroeslawncare.com',
   'heroeslawncare.com',
   'a73864ee-69c8-4ed9-beb9-421c12ca8f41',
   true, true),
  ('00000000-0000-0000-0000-000000000002',
   'Lynxedo — send.lynxedo.com',
   'Heroes Lawn Care of The Woodlands',
   'heroes@send.lynxedo.com',
   'hlc105@heroeslawncare.com',
   'send.lynxedo.com',
   '27f43a75-78f5-464c-820c-fd724094ef95',
   true, false)
on conflict (company_id, lower(from_email)) do nothing;
