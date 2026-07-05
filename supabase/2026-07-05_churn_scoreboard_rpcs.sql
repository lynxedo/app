-- Churn / Retention + Lead-Source scoreboard RPCs — Phase A
-- Universe = recurring_services (the Hub Recurring Services board), scoped to one year:
--   Active/Upgraded/Downgraded rows + Cancelled rows whose cancel_date falls in p_year.
-- Lead source = read-time waterfall (no data mutation):
--   (1) recurring_services.lead_source  → (2) matched client's "HLC105 Lead Source"
--   custom field (email, then phone digits)  → (3) Lead Tracker (leads) match
--   → (4) NULL (callers render "Other / Unknown" + count toward the coverage badge).
-- Security: SECURITY DEFINER, admin-or-can_access_scoreboards gate with the
--   auth.uid() IS NULL service-role bypass (same pattern as scoreboard_visit_revenue);
--   anon EXECUTE revoked below.

-- ============================================================
-- Helper: normalize any raw lead-source string to a master source (or NULL)
-- ============================================================
create or replace function public.churn_normalize_source(p_company_id uuid, p_value text)
returns text
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select m.master_source from public.lead_sources_master m
      where m.company_id = p_company_id and lower(m.master_source) = lower(btrim(p_value)) limit 1),
    (select a.master_source from public.lead_source_aliases a
      where a.company_id = p_company_id and lower(a.alias) = lower(btrim(p_value)) limit 1)
  )
$$;

-- ============================================================
-- Helper: full lead-source resolution waterfall for a recurring_services row.
-- Returns NULL when nothing resolves (caller counts it as "source unknown").
-- ============================================================
create or replace function public.churn_resolve_source(
  p_company_id uuid, p_lead_source text, p_email text, p_phone text, p_name text
) returns text
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v text;
  v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
begin
  -- (1) the row's own lead_source (old Monday vocabulary → alias map)
  if coalesce(p_lead_source,'') <> '' then
    v := public.churn_normalize_source(p_company_id, p_lead_source);
    if v is not null then return v; end if;
  end if;

  -- (2) matched client's HLC105 Lead Source custom field (email first, then phone digits)
  select public.churn_normalize_source(p_company_id, c.custom_fields->'HLC105 Lead Source'->>'value')
    into v
  from public.clients c
  where c.company_id = p_company_id
    and coalesce(c.custom_fields->'HLC105 Lead Source'->>'value','') <> ''
    and (
      (coalesce(p_email,'') <> '' and lower(c.email) = lower(p_email))
      or (v_phone <> '' and regexp_replace(coalesce(c.phone,''), '\D', '', 'g') = v_phone)
    )
  order by (lower(c.email) = lower(coalesce(p_email,''))) desc
  limit 1;
  if v is not null then return v; end if;

  -- (3) Lead Tracker match (email / phone digits / full name)
  select public.churn_normalize_source(p_company_id, l.lead_source)
    into v
  from public.leads l
  where l.company_id = p_company_id
    and coalesce(l.lead_source,'') <> ''
    and (
      (coalesce(p_email,'') <> '' and lower(l.email) = lower(p_email))
      or (v_phone <> '' and regexp_replace(coalesce(l.phone,''), '\D', '', 'g') = v_phone)
      or (coalesce(p_name,'') <> '' and
          lower(btrim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,''))) = lower(btrim(p_name)))
    )
  order by l.created_at desc nulls last
  limit 1;
  return v; -- may be NULL → "source unknown"
end
$$;

-- ============================================================
-- Helper: map a raw cancellation reason to its master classification.
-- Unmapped non-blank reasons → churn_type 'Review' (visible, never dropped).
-- ============================================================
create or replace function public.churn_map_reason(p_company_id uuid, p_reason text)
returns table (master_reason text, category text, churn_type text, in_gross_churn boolean, in_controllable_churn boolean)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select * from (
    select r.master_reason, r.category, r.churn_type, r.in_gross_churn, r.in_controllable_churn
    from public.churn_reasons r
    where r.company_id = p_company_id
      and lower(r.master_reason) = lower(btrim(coalesce(p_reason,'')))
    union all
    select r.master_reason, r.category, r.churn_type, r.in_gross_churn, r.in_controllable_churn
    from public.churn_reason_aliases a
    join public.churn_reasons r
      on r.company_id = a.company_id and lower(r.master_reason) = lower(a.master_reason)
    where a.company_id = p_company_id
      and lower(a.alias) = lower(btrim(coalesce(p_reason,'')))
  ) x
  limit 1
$$;

-- ============================================================
-- RPC 1: scoreboard_churn_summary — Board 7 payload
-- ============================================================
create or replace function public.scoreboard_churn_summary(p_company_id uuid, p_year int)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is not null and not exists (
    select 1 from public.user_profiles up
    where up.id = (select auth.uid())
      and up.company_id = p_company_id
      and (up.role = 'admin' or up.can_access_scoreboards)
  ) then
    raise exception 'not authorized';
  end if;

  with scope as (
    select rs.*,
      case
        when rs.cancelled_status = 'Cancelled'
         and extract(year from rs.cancel_date) = p_year then 'churned'
        when rs.cancelled_status = 'Active' then 'active'
        when rs.cancelled_status = 'Upgraded' then 'upgraded'
        when rs.cancelled_status = 'Downgraded' then 'downgraded'
      end as bucket
    from public.recurring_services rs
    where rs.company_id = p_company_id
      and (rs.cancelled_status in ('Active','Upgraded','Downgraded')
        or (rs.cancelled_status = 'Cancelled' and extract(year from rs.cancel_date) = p_year))
  ),
  mapped as (
    select s.*,
      coalesce(m.master_reason,
               nullif(btrim(coalesce(s.cancellation_reason,'')),''),
               'Unknown')                       as reason_master,
      coalesce(m.churn_type, 'Review')          as churn_type,
      coalesce(m.in_gross_churn, true)          as in_gross,
      coalesce(m.in_controllable_churn, false)  as in_ctrl
    from scope s
    left join lateral public.churn_map_reason(p_company_id, s.cancellation_reason) m on true
  ),
  base as (
    select
      count(*) filter (where bucket = 'active')                            as active_now,
      count(*) filter (where bucket = 'upgraded')                          as upgraded_n,
      count(*) filter (where bucket = 'downgraded')                        as downgraded_n,
      count(*) filter (where bucket = 'churned' and in_gross)              as churned_gross,
      count(*) filter (where bucket = 'churned' and in_ctrl)               as churned_ctrl,
      count(*) filter (where bucket = 'churned' and churn_type = 'Company-Initiated') as churned_company,
      count(*) filter (where bucket = 'churned' and churn_type = 'Uncontrollable')    as churned_uncontrollable,
      count(*) filter (where bucket = 'churned' and churn_type = 'Review')            as churned_review,
      coalesce(sum(annual_value) filter (where bucket = 'churned' and in_gross), 0)   as churned_annual_value,
      coalesce(sum(annual_value) filter (where bucket = 'active'), 0)                 as active_annual_value,
      count(*) filter (where extract(year from sold_date) = p_year)                   as new_in_year
    from mapped
  )
  select jsonb_build_object(
    'year', p_year,
    'active_now', b.active_now,
    'upgraded', b.upgraded_n,
    'downgraded', b.downgraded_n,
    'new_in_year', b.new_in_year,
    'churned_gross', b.churned_gross,
    'churned_controllable', b.churned_ctrl,
    'churned_company_initiated', b.churned_company,
    'churned_uncontrollable', b.churned_uncontrollable,
    'churned_review', b.churned_review,
    'churned_annual_value', b.churned_annual_value,
    'active_annual_value', b.active_annual_value,
    -- waterfall: start + new − lost = active_now  →  start = active_now − new + lost
    'start_of_year', b.active_now - b.new_in_year + b.churned_gross,
    'gross_churn_pct', case when (b.active_now - b.new_in_year + b.churned_gross) > 0
      then round(100.0 * b.churned_gross / (b.active_now - b.new_in_year + b.churned_gross), 1) end,
    'controllable_churn_pct', case when (b.active_now - b.new_in_year + b.churned_gross) > 0
      then round(100.0 * b.churned_ctrl / (b.active_now - b.new_in_year + b.churned_gross), 1) end,
    'by_reason', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reason', reason_master, 'churn_type', churn_type,
        'count', n, 'annual_value', av) order by n desc), '[]'::jsonb)
      from (
        select reason_master, churn_type, count(*) n, coalesce(sum(annual_value),0) av
        from mapped where bucket = 'churned'
        group by 1, 2
      ) x
    ),
    'by_type', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'churn_type', churn_type, 'count', n, 'annual_value', av) order by n desc), '[]'::jsonb)
      from (
        select churn_type, count(*) n, coalesce(sum(annual_value),0) av
        from mapped where bucket = 'churned'
        group by 1
      ) x
    ),
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', mon, 'gross', gross_n, 'controllable', ctrl_n) order by mon), '[]'::jsonb)
      from (
        select to_char(cancel_date, 'YYYY-MM') mon,
               count(*) filter (where in_gross) gross_n,
               count(*) filter (where in_ctrl)  ctrl_n
        from mapped where bucket = 'churned'
        group by 1
      ) x
    )
  ) into result
  from base b;

  return result;
end
$$;

-- ============================================================
-- RPC 2: scoreboard_source_scorecard — Board 8 payload
-- One row per resolved master source (+ one 'Other / Unknown' row absorbing
-- unresolved rows, flagged via unresolved_count for the coverage badge).
-- ============================================================
create or replace function public.scoreboard_source_scorecard(p_company_id uuid, p_year int)
returns table (
  source text,
  source_group text,
  cost_type text,
  total_customers bigint,
  active_count bigint,
  churned_count bigint,
  retention_pct numeric,
  new_in_year bigint,
  active_annual_value numeric,
  avg_annual_value numeric,
  avg_tenure_months numeric,
  est_ltv numeric,
  unresolved_count bigint
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with gate as (
    select 1 where (select auth.uid()) is null
      or exists (
        select 1 from public.user_profiles up
        where up.id = (select auth.uid())
          and up.company_id = p_company_id
          and (up.role = 'admin' or up.can_access_scoreboards)
      )
  ),
  scope as (
    select rs.*,
      case
        when rs.cancelled_status = 'Cancelled'
         and extract(year from rs.cancel_date) = p_year then 'churned'
        when rs.cancelled_status = 'Active' then 'active'
      end as bucket
    from public.recurring_services rs, gate
    where rs.company_id = p_company_id
      and (rs.cancelled_status = 'Active'
        or (rs.cancelled_status = 'Cancelled' and extract(year from rs.cancel_date) = p_year))
  ),
  resolved as (
    select s.*,
      public.churn_resolve_source(p_company_id, s.lead_source, s.email, s.phone, s.name) as src,
      cl.external_created_at as client_since
    from scope s
    left join lateral (
      select c.external_created_at
      from public.clients c
      where c.company_id = p_company_id
        and (
          (coalesce(s.email,'') <> '' and lower(c.email) = lower(s.email))
          or (regexp_replace(coalesce(s.phone,''),'\D','','g') <> ''
              and regexp_replace(coalesce(c.phone,''),'\D','','g') = regexp_replace(s.phone,'\D','','g'))
        )
      order by (lower(c.email) = lower(coalesce(s.email,''))) desc
      limit 1
    ) cl on true
  )
  select
    coalesce(r.src, 'Other / Unknown')                                   as source,
    coalesce(max(m.source_group), 'Other')                               as source_group,
    coalesce(max(m.cost_type), 'Unknown')                                as cost_type,
    count(*)                                                             as total_customers,
    count(*) filter (where r.bucket = 'active')                          as active_count,
    count(*) filter (where r.bucket = 'churned')                         as churned_count,
    round(100.0 * count(*) filter (where r.bucket = 'active')
      / nullif(count(*), 0), 1)                                          as retention_pct,
    count(*) filter (where extract(year from r.sold_date) = p_year)      as new_in_year,
    coalesce(sum(r.annual_value) filter (where r.bucket = 'active'), 0)  as active_annual_value,
    round(avg(r.annual_value) filter (where r.bucket = 'active'), 0)     as avg_annual_value,
    round(avg(
      extract(epoch from (
        case when r.bucket = 'churned' then r.cancel_date::timestamptz else now() end
        - r.client_since
      )) / 2629800.0  -- seconds per average month
    ) filter (where r.client_since is not null), 1)                      as avg_tenure_months,
    -- Est. LTV proxy = avg annual $ × avg tenure in years (no ad-cost data yet)
    round(
      coalesce(avg(r.annual_value) filter (where r.bucket = 'active'), 0)
      * coalesce(avg(
          extract(epoch from (
            case when r.bucket = 'churned' then r.cancel_date::timestamptz else now() end
            - r.client_since
          )) / 2629800.0
        ) filter (where r.client_since is not null), 0) / 12.0
    , 0)                                                                 as est_ltv,
    count(*) filter (where r.src is null)                                as unresolved_count
  from resolved r
  left join public.lead_sources_master m
    on m.company_id = p_company_id and lower(m.master_source) = lower(coalesce(r.src, 'Other / Unknown'))
  group by coalesce(r.src, 'Other / Unknown')
  order by total_customers desc
$$;

-- ============================================================
-- Grants — new SECURITY DEFINER fns are PUBLIC-executable by default; lock down.
-- ============================================================
revoke all on function public.churn_normalize_source(uuid, text) from public, anon;
revoke all on function public.churn_resolve_source(uuid, text, text, text, text) from public, anon;
revoke all on function public.churn_map_reason(uuid, text) from public, anon;
revoke all on function public.scoreboard_churn_summary(uuid, int) from public, anon;
revoke all on function public.scoreboard_source_scorecard(uuid, int) from public, anon;

grant execute on function public.churn_normalize_source(uuid, text) to authenticated, service_role;
grant execute on function public.churn_resolve_source(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.churn_map_reason(uuid, text) to authenticated, service_role;
grant execute on function public.scoreboard_churn_summary(uuid, int) to authenticated, service_role;
grant execute on function public.scoreboard_source_scorecard(uuid, int) to authenticated, service_role;
