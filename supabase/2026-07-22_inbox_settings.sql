-- Shared Inbox — company-level settings (Step 3c). First use: the default email
-- signature template applied to anyone who hasn't set their own.
-- APPLIED to the shared DB via Supabase MCP apply_migration `inbox_settings_2026_07_22`.
-- Additive: one table. Reads by company members (RLS); writes service-role (the API
-- gates PUT to managers/admins).

create table if not exists public.inbox_settings (
  company_id uuid primary key references public.companies(id),
  default_signature text,                 -- template, tokens {Name} / {Job Title}
  updated_at timestamptz not null default now()
);

alter table public.inbox_settings enable row level security;
drop policy if exists inbox_settings_select on public.inbox_settings;
create policy inbox_settings_select on public.inbox_settings for select to authenticated
using ( company_id in (select company_id from public.user_profiles where id = auth.uid()) );
