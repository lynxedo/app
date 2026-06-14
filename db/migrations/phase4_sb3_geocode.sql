-- ============================================================================
-- Phase 4 DB migrations — REVIEW BEFORE APPLYING (shared prod+staging DB).
-- All additive (new functions + new table). Take a backup first:
--   https://supabase.com/dashboard/project/nhvwdulyzolevoeayjum/database/backups
-- ============================================================================

-- ── SB3: batched scoreboard tech queries ────────────────────────────────────
-- Today the scoreboards route calls scoreboard_tech_revenue + scoreboard_tech_hours
-- ONCE PER TECHNICIAN (an N+1). These two new functions take an ARRAY of techs and
-- return every tech's rows in a single call. Additive — the existing per-tech
-- functions are left untouched. The permission check is evaluated ONCE here (the
-- SB2 intent, done the safe way) since the route already gates the caller.

create or replace function public.scoreboard_techs_revenue(
  p_company_id uuid, p_start date, p_end date, p_bucket text, p_tech_external_ids text[]
) returns table(tech_external_id text, bucket date, dept text, total numeric)
  language sql security definer set search_path to 'public', 'pg_temp'
as $function$
  select
    t.tech_external_id,
    date_trunc(case when p_bucket = 'week' then 'week' else 'month' end,
               v.scheduled_date)::date as bucket,
    case
      when coalesce(j.dept_prefix, '') <> '' then j.dept_prefix
      when upper(coalesce(j.title, '')) ~ '^(WF|IR|PW|MO|LD)([ -]|$)'
        then substring(upper(j.title) from '^(WF|IR|PW|MO|LD)')
      when upper(coalesce(v.title, '')) ~ '^(WF|IR|PW|MO|LD)([ -]|$)'
        then substring(upper(v.title) from '^(WF|IR|PW|MO|LD)')
      when coalesce(j.title, '') ilike '%pet waste%' or coalesce(j.title, '') ilike '%pest%'
        then 'PW'
      else 'Other'
    end as dept,
    coalesce(sum(li.total), 0) as total
  from unnest(p_tech_external_ids) as t(tech_external_id)
  join visits v
    on t.tech_external_id = any(v.tech_external_user_ids)
   and v.company_id     = p_company_id
   and v.deleted_at     is null
   and v.visit_status   = 'COMPLETED'
   and v.scheduled_date between p_start and p_end
   and upper(coalesce(v.title, '')) not like '%BILLING%'
  left join jobs j
    on j.id = v.job_id and j.deleted_at is null
  left join line_items li
    on li.parent_external_id = v.external_id
   and li.parent_type        = 'visit'
   and li.company_id         = p_company_id
   and li.deleted_at         is null
  where (
    (select auth.uid()) is null
    or exists (
      select 1 from user_profiles up
      where up.id = (select auth.uid())
        and up.company_id = p_company_id
        and (up.role = 'admin' or up.can_access_scoreboards)
    )
  )
  group by 1, 2, 3
  order by 1, 2, 3
$function$;

create or replace function public.scoreboard_techs_hours(
  p_company_id uuid, p_start date, p_end date, p_employee_ids uuid[]
) returns table(employee_id uuid, hours numeric)
  language sql security definer set search_path to 'public', 'pg_temp'
as $function$
  select e.employee_id, coalesce(sum(te.total_hours), 0) as hours
  from unnest(p_employee_ids) as e(employee_id)
  left join time_entries te
    on te.employee_id = e.employee_id
   and te.company_id  = p_company_id
   and te.date between p_start and p_end
  where (
    (select auth.uid()) is null
    or exists (
      select 1 from user_profiles up
      where up.id = (select auth.uid())
        and up.company_id = p_company_id
        and (up.role = 'admin' or up.can_access_scoreboards)
    )
  )
  group by e.employee_id
$function$;

-- ── #29: geocode cache ──────────────────────────────────────────────────────
-- Recurring customer addresses are re-geocoded on every route build. Cache the
-- (address -> lat/lng) result so a known address is a DB hit, not an external
-- geocoder round-trip. Accessed only via the server admin client; RLS on with no
-- policy denies anon/authenticated direct access (admin/service role bypasses).
create table if not exists public.geocode_cache (
  address_key text primary key,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);
alter table public.geocode_cache enable row level security;
