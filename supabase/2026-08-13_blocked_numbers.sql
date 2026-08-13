-- 2026-08-13_blocked_numbers.sql
-- APPLIED to the shared Supabase DB on 2026-08-13.
--
-- Blocked callers: numbers whose inbound calls and/or texts we refuse.
-- Enforced in app/api/dialer/voice/twiml/inbound (Reject busy) and
-- app/api/txt/twilio/sms/inbound (drop), via lib/blocked-numbers.ts.
--
-- Additive and inert: the table ships empty, so nothing changes until someone
-- blocks a number. Rollback = drop the table (the code fails open, so the
-- webhooks keep working with it gone).

create table if not exists public.blocked_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  -- Last 10 digits, matching the phone_digits convention used across the app
  -- (txt_contacts, drip). Matching on digits rather than the formatted number
  -- means +1 / (281) 555-1234 / 2815551234 all resolve to the same block.
  phone_digits text not null,
  -- As entered, for display only. Never matched on.
  phone text,
  reason text,
  blocks_calls boolean not null default true,
  blocks_texts boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists blocked_numbers_company_digits_uidx
  on public.blocked_numbers (company_id, phone_digits);

-- Service-role only: RLS on with NO policies, and the direct grants revoked.
-- The inbound webhooks and the admin route all use the service-role client and
-- carry their own gates; nothing should reach this table from the browser.
-- Verified after apply: rls_enabled=t, policy_count=0,
-- anon select/insert=f, authenticated select/insert=f, service_role select=t.
alter table public.blocked_numbers enable row level security;
revoke all on public.blocked_numbers from anon, authenticated;
