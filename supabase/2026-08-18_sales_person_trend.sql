-- ===========================================================================
-- Sales by person, over time — the source behind "Sales by Person over Time"
-- 2026-08-18
--
-- Ben: "Sales by Person — let's add a different version widget. Make it like the
-- Visit Revenue by Technician where it is a bar graph and we can choose either
-- board time frame or trailing X weeks/months."
--
-- The existing Sales by Person is a TABLE over one window. `scoreboard_sales`
-- aggregates `by_month` and `by_salesperson` separately and never crosses them,
-- so a per-person trend cannot be assembled from it — hence one small function
-- rather than a metric over the existing source.
--
-- ⚠⚠ THE COHORT AND THE WIN RULE ARE COPIED, NOT RE-DECIDED. Leads are counted by
-- `lead_creation_date` (the same cohort the whole Sales report uses, so "how many
-- did we sell" has one answer everywhere), and a sale is `stage = 'closed_won'` OR
-- a stage the tenant ticked `counts_as_sale` — byte-identical to
-- `scoreboard_sales`. A second definition of "sold" living in a second function is
-- exactly how a chart ends up disagreeing with the table beside it.
--
-- ⚠ Buckets are computed on the DATE column, which carries no time zone, so there
-- is no Chicago-vs-UTC question here — unlike the visit-revenue trend, which
-- buckets timestamps.
-- ===========================================================================

create or replace function public.scoreboard_sales_person_trend(
  p_company_id uuid,
  p_start      date,
  p_end        date,
  p_grain      text default 'month'
)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  g as (
    -- Anything that is not 'week' buckets by month, so a bad parameter degrades to
    -- the default rather than returning nothing.
    select case when lower(coalesce(p_grain,'month')) = 'week' then 'week' else 'month' end as grain
  ),
  sale_stages as (
    select key from public.tracker_stages
    where company_id = p_company_id and counts_as_sale = true
  ),
  cohort as (
    select
      to_char(date_trunc((select grain from g), l.lead_creation_date), 'YYYY-MM-DD') as b,
      coalesce(nullif(initcap(trim(lower(l.salesperson))),''), 'Unassigned')          as rep,
      (l.stage = 'closed_won' or l.stage in (select key from sale_stages))            as won,
      coalesce(l.annual_value, 0)                                                     as annual_value
    from leads l
    where l.company_id = p_company_id
      and l.lead_creation_date between p_start and p_end
  ),
  -- ⚠ Grouped in their own CTEs rather than inside jsonb_agg: Postgres refuses a
  -- sum() nested inside an aggregate call, so building the object first and
  -- aggregating second is the only shape that compiles.
  per_bucket as (
    select b,
           round(coalesce(sum(annual_value) filter (where won), 0), 2) as total,
           count(*) filter (where won) as cnt
    from cohort group by b
  ),
  per_person as (
    select b, rep,
           round(coalesce(sum(annual_value) filter (where won), 0), 2) as total,
           count(*) filter (where won) as cnt
    from cohort group by b, rep
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'grain', (select grain from g),
    'start', p_start,
    'end',   p_end,
    -- One row per bucket: the company line the segments add up to.
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object('b', b, 'total', total, 'count', cnt) order by b)
      from per_bucket
    ), '[]'::jsonb),
    -- One row per (bucket, salesperson). `k` is the display name: unlike the
    -- technician trend there is no stable id to key on — `leads.salesperson` is free
    -- text — so the name IS the key, normalised exactly as scoreboard_sales
    -- normalises it so the two never split one person into two bars.
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('b', b, 'k', rep, 'name', rep, 'total', total, 'count', cnt)
             order by b, rep)
      from per_person
    ), '[]'::jsonb)
  ) end;
$function$;

-- ⚠ PUBLIC first. A freshly created function carries the default PUBLIC EXECUTE
-- grant, so revoking anon/authenticated by name alone is a no-op against it.
revoke all on function public.scoreboard_sales_person_trend(uuid, date, date, text) from public;
revoke all on function public.scoreboard_sales_person_trend(uuid, date, date, text) from anon;
revoke all on function public.scoreboard_sales_person_trend(uuid, date, date, text) from authenticated;
grant execute on function public.scoreboard_sales_person_trend(uuid, date, date, text) to service_role;

-- Rollback: drop function public.scoreboard_sales_person_trend(uuid, date, date, text);
