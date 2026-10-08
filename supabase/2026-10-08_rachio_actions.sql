-- Rachio test run (Oct 8 2026): every command Hub sends to a customer's
-- controller is recorded — who, which controller / zone, what, when, result.
-- ADDITIVE. RLS on, no policies → service-role only (written by the API).
create table if not exists public.rachio_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  contact_id uuid references public.txt_contacts(id) on delete set null,
  inspection_id uuid references public.irrigation_inspections(id) on delete set null,
  device_id text not null,
  zone_id text,
  zone_number int,
  action text not null check (action in ('zone_start', 'stop')),
  seconds int,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists rachio_actions_company_idx on public.rachio_actions (company_id, created_at desc);
alter table public.rachio_actions enable row level security;
revoke all on public.rachio_actions from anon, authenticated;
