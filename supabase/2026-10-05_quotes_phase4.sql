-- Work Orders & Quotes PRD — Phase 4 (Quotes), session 1: the groundwork.
--
-- Ben's decisions (Oct 5 2026): approval = typed name + timestamp; deposits
-- possible but optional (per template, per quote); a quote expires 30 days
-- after it is sent; technicians AND the office may build and send quotes.
--
-- Jobber, verified by introspection the same day: there is NO mutation that
-- approves a quote (quoteEdit has no status; the only transition is
-- AWAITING_RESPONSE on create). So on approval Hub records it here, marks the
-- add-ons the customer picked as not optional on the Jobber quote
-- (quoteEditLineItems.optional=false), pins a note, and the office clicks
-- Approve in Jobber from a link. jobCreate(quoteId) can turn a quote into a
-- job later. Deposits map to quote.deposit = CostModifierAttributes {rate, type}.
--
-- ADDITIVE. Applied to the shared DB via Supabase MCP apply_migration
-- `quotes_phase4_2026_10_05`.

-- 1) Permission flags ----------------------------------------------------------
-- can_access_quotes: build + send quotes (techs and office). can_admin_quotes:
-- templates, terms and the reviews list. Admins always have both.
alter table public.user_profiles
  add column if not exists can_access_quotes boolean not null default false,
  add column if not exists can_admin_quotes boolean not null default false;

-- 2) Templates ------------------------------------------------------------------
create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  service_line text,
  title text not null default '',
  intro text not null default '',
  terms text not null default '',
  -- [{jobber_product_id?, pricer_program_id?, name, description, quantity, unit_price | null, optional, recommended}]
  default_items jsonb not null default '[]'::jsonb,
  default_review_ids uuid[] not null default '{}',
  deposit_type text check (deposit_type in ('percent', 'fixed')),
  deposit_value numeric(12,2),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists quote_templates_company_idx on public.quote_templates (company_id, sort_order) where deleted_at is null;

-- 3) Reviews shown at the bottom of a quote (a curated list; the builder picks 3)
create table if not exists public.company_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  author text not null,
  rating int not null default 5 check (rating between 1 and 5),
  body text not null,
  review_date date,
  source text not null default 'google',
  source_url text,
  featured boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists company_reviews_company_idx on public.company_reviews (company_id, sort_order) where deleted_at is null;

-- 4) Quotes --------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.txt_contacts(id) on delete cascade,
  jobber_client_id text,
  jobber_property_id text,
  property_address text,
  -- Where it was started from (any or none).
  stop_id uuid references public.daily_log_stops(id) on delete set null,
  lead_id uuid,
  template_id uuid references public.quote_templates(id) on delete set null,
  title text not null default '',
  intro text not null default '',
  terms text not null default '',
  internal_notes text not null default '',          -- NEVER on the customer page
  review_ids uuid[] not null default '{}',
  deposit_type text check (deposit_type in ('percent', 'fixed')),
  deposit_value numeric(12,2),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed', 'approved', 'changes_requested', 'expired', 'archived')),
  sent_at timestamptz,
  sent_via text[] not null default '{}',
  expires_at timestamptz,                            -- sent_at + 30 days (Ben)
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  approved_at timestamptz,
  approved_name text,                                -- typed name (Ben)
  approved_ip text,
  approved_user_agent text,
  changes_message text,
  changes_requested_at timestamptz,
  total_required numeric(12,2),
  total_selected numeric(12,2),
  salesperson_user_id uuid references auth.users(id) on delete set null,
  jobber_quote_id text,
  jobber_quote_number text,
  jobber_synced_at timestamptz,
  jobber_sync_error text,
  share_token text unique,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists quotes_company_status_idx on public.quotes (company_id, status, updated_at desc) where deleted_at is null;
create index if not exists quotes_contact_idx on public.quotes (company_id, contact_id) where deleted_at is null;
create index if not exists quotes_jobber_idx on public.quotes (company_id, jobber_quote_id) where jobber_quote_id is not null;

create table if not exists public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  sort_order int not null default 0,
  optional boolean not null default false,           -- an add-on the customer may tick (unticked by default — Ben)
  recommended boolean not null default false,
  jobber_product_id text,
  pricer_ref jsonb,                                  -- {program_id, sqft, ...} when priced by the Pricer
  name text not null,
  description text not null default '',
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  taxable boolean,
  selected_by_customer boolean not null default false,
  jobber_line_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quote_line_items_quote_idx on public.quote_line_items (quote_id, sort_order);

create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,      -- created | sent | viewed | approved | changes_requested | expired | reminder | jobber_synced | jobber_error
  actor_user_id uuid references auth.users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quote_events_quote_idx on public.quote_events (quote_id, created_at);

-- 5) RLS: read-isolation by company; ALL writes go through the service-role
-- admin client with per-route checks (can_access_quotes / can_admin_quotes).
-- The public quote page reads by verified share token with the admin client.
do $$
declare t text;
begin
  foreach t in array array['quote_templates', 'company_reviews', 'quotes', 'quote_line_items', 'quote_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select company_id from public.user_profiles where id = auth.uid()))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- 6) get_admin_users(uuid) returns the two new flags. Adding return columns
-- forces DROP + CREATE, which re-grants EXECUTE to PUBLIC — restore the exact
-- prior ACL (authenticated + service_role only). Body otherwise unchanged.
drop function if exists public.get_admin_users(uuid);
create function public.get_admin_users(p_company_id uuid)
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, role text, can_access_routing boolean, can_access_lawn boolean, can_access_call_log boolean, can_access_responder boolean, can_access_timesheet boolean, can_access_books boolean, can_access_tracker boolean, can_access_hub boolean, can_access_fleet boolean, can_access_zone_sizer boolean, can_access_dialer boolean, can_access_txt boolean, can_access_unified_inbox boolean, can_post_shout_outs boolean, can_access_marketing boolean, can_admin_marketing boolean, can_access_forms boolean, can_admin_forms boolean, can_admin_products boolean, can_access_daily_log_v2 boolean, can_access_call_log2 boolean, can_access_scoreboards boolean, can_access_files boolean, can_access_pesticide_records boolean, can_access_pricer boolean, can_access_email boolean, can_admin_email boolean, can_manage_drip boolean, can_access_coaching boolean, can_access_beta boolean, can_access_shared_inbox boolean, can_compose_shared_email boolean, can_manage_shared_inbox boolean, can_access_irrigation boolean, can_admin_people boolean, can_admin_hub boolean, can_admin_guardian boolean, can_admin_ai boolean, can_admin_txt boolean, can_admin_announcements boolean, can_admin_file_tags boolean, can_admin_routing boolean, can_admin_timesheet boolean, can_admin_fleet boolean, can_admin_daily_log boolean, can_admin_zone_sizer boolean, can_admin_dialer boolean, can_admin_contacts boolean, can_admin_integrations boolean, dialer_global_ring boolean, display_name text, avatar_url text, invite_sent_at timestamp with time zone, phone text, full_name text, locked_at timestamp with time zone, deactivated_at timestamp with time zone, can_access_reports boolean, can_access_radio boolean, can_access_quotes boolean, can_admin_quotes boolean)
 language sql
 security definer
 set search_path to 'public'
as $function$
  SELECT
    up.id, au.email::text, au.created_at, au.last_sign_in_at, up.role,
    up.can_access_routing, up.can_access_lawn, up.can_access_call_log,
    up.can_access_responder, up.can_access_timesheet, up.can_access_books,
    up.can_access_tracker, up.can_access_hub, up.can_access_fleet,
    up.can_access_zone_sizer, up.can_access_dialer, up.can_access_txt,
    up.can_access_unified_inbox,
    up.can_post_shout_outs,
    up.can_access_marketing, up.can_admin_marketing, up.can_access_forms,
    up.can_admin_forms, up.can_admin_products, up.can_access_daily_log_v2,
    up.can_access_call_log2, up.can_access_scoreboards,
    up.can_access_files, up.can_access_pesticide_records,
    up.can_access_pricer,
    up.can_access_email, up.can_admin_email,
    up.can_manage_drip,
    up.can_access_coaching,
    up.can_access_beta,
    up.can_access_shared_inbox, up.can_compose_shared_email, up.can_manage_shared_inbox,
    up.can_access_irrigation,
    up.can_admin_people, up.can_admin_hub,
    up.can_admin_guardian, up.can_admin_ai, up.can_admin_txt, up.can_admin_announcements, up.can_admin_file_tags,
    up.can_admin_routing, up.can_admin_timesheet, up.can_admin_fleet, up.can_admin_daily_log,
    up.can_admin_zone_sizer, up.can_admin_dialer, up.can_admin_contacts,
    up.can_admin_integrations,
    up.dialer_global_ring, hu.display_name, hu.avatar_url,
    up.invite_sent_at, up.phone, up.full_name,
    up.locked_at, up.deactivated_at,
    up.can_access_reports,
    up.can_access_radio,
    up.can_access_quotes,
    up.can_admin_quotes
  FROM public.user_profiles up
  JOIN auth.users au ON au.id = up.id
  LEFT JOIN public.hub_users hu ON hu.id = up.id
  WHERE up.company_id = p_company_id
$function$;
revoke all on function public.get_admin_users(uuid) from public, anon;
grant execute on function public.get_admin_users(uuid) to authenticated, service_role;
