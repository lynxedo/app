-- Crew & Labor Efficiency report (REPORTS_PRD.md §8.6) — the $/labor-hour moat.
--
-- Plus a SECURITY FIX to the two invoice functions shipped earlier the same day.
--
-- ── The security fix ────────────────────────────────────────────────────────
-- `scoreboard_invoice_window` and `scoreboard_invoice_ar` are SECURITY DEFINER,
-- take company_id as a PARAMETER, and were granted EXECUTE to `authenticated`
-- with no internal authorization check. Supabase exposes every such function at
-- /rest/v1/rpc/<name>, so any signed-in user of ANY tenant could have passed
-- another company's id and read its receivables and customer names. Anon was
-- correctly blocked; authenticated cross-tenant was not.
--
-- Every pre-existing scoreboard_* function already guards this inline (the
-- `allowed` CTE in scoreboard_techs_revenue etc.). Mine omitted it. This adds a
-- shared helper so the check lives in ONE place rather than being re-typed into
-- each new function and eventually forgotten again.
--
-- The `auth.uid() IS NULL` branch keeps service-role and server-side callers
-- working — that is the same escape hatch the existing functions use, and it is
-- safe because the service role is already trusted.

create or replace function public.scoreboard_reports_allowed(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select auth.uid()) is null
    or exists (
      select 1 from user_profiles up
      where up.id = (select auth.uid())
        and up.company_id = p_company_id
        -- Reports OR Scoreboards: these widgets are offered in the Scoreboard
        -- picker too, so a scoreboards-only user composing a board with a revenue
        -- card must be able to run its source.
        and (up.role = 'admin' or up.can_access_reports or up.can_access_scoreboards)
    );
$$;

comment on function public.scoreboard_reports_allowed(uuid) is
  'Shared authorization guard for the Reports/Scoreboards widget sources. company_id arrives as a parameter, so every SECURITY DEFINER source must check the caller actually belongs to that company.';

revoke all on function public.scoreboard_reports_allowed(uuid) from public, anon;
grant execute on function public.scoreboard_reports_allowed(uuid) to authenticated, service_role;


-- ── Crew & Labor Efficiency ─────────────────────────────────────────────────
--
-- Revenue (Jobber) ÷ real clocked hours (Hub timeclock) — two sources a
-- Jobber-only competitor structurally cannot join. Four hazards found in the live
-- data, each handled here rather than papered over:
--
-- 1. ⚠⚠ WINDOW MISMATCH. Invoices go back to 2026-01-02; the timeclock only
--    starts 2026-05-29. Dividing year-to-date revenue by three months of hours
--    reads $270.63/hr when the honest overlap figure is $91.13/hr — a 3x
--    overstatement on the flagship metric, which is precisely the broken-ratio
--    failure this product claims to beat. So the function CLAMPS its window to
--    where timeclock data actually exists and reports what it clamped to, and
--    every widget prints that effective period.
--
-- 2. DEPARTED EMPLOYEES STILL WORKED. One tech is is_active = false but has
--    149.2 hours inside the period. The existing roster function filters
--    is_active, which would drop real hours out of the denominator and inflate
--    everyone else. History does not change when someone leaves, so this does
--    NOT filter on active status.
--
-- 3. HOURS WITH NO JOBBER IDENTITY. One employee has 183.7 clocked hours and no
--    matching Jobber user, so no revenue can be attributed to them. They are
--    counted in hours and labor cost (they were really paid) but excluded from
--    the $/hour ranking, and reported by name so the gap is visible instead of
--    silently flattering everyone else's ratio.
--
-- 4. SALARIED STAFF LOG ZERO HOURS. Labor cost here is HOURLY FIELD labor only;
--    it is not total payroll, and the widgets say so.
--
-- Revenue definitions are lifted verbatim from scoreboard_techs_revenue so a
-- number means the same thing on this Report as on the boards: recurring work is
-- the sum of visit line items excluding Service Plan lines, one-off work is the
-- job total split across its completed visits, and BILLING visits are excluded.
-- ⚠ visits.total is NULL for every completed visit, which is why revenue must be
-- rebuilt from line_items rather than read off the visit.

create or replace function public.scoreboard_crew_labor(
  p_company_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  -- Where the timeclock actually has data, so the window can be clamped to it.
  coverage as (
    select min(te.date) first_day, max(te.date) last_day
    from time_entries te
    where te.company_id = p_company_id and te.total_hours > 0
  ),
  eff as (
    select
      greatest(p_start, c.first_day) as s,
      least(p_end,   c.last_day)   as e,
      c.first_day, c.last_day
    from coverage c
  ),
  entries as (
    select te.employee_id, te.date, te.total_hours
    from time_entries te, eff
    where te.company_id = p_company_id
      and te.total_hours > 0
      and te.date between eff.s and eff.e
  ),
  -- ⚠ No is_active filter: a departed employee's hours are still real history.
  people as (
    select
      e.id,
      coalesce(nullif(e.preferred_name,''), e.first_name) || ' ' || e.last_name as name,
      coalesce(nullif(e.department,''), 'Unassigned') as department,
      e.pay_type,
      e.hourly_rate,
      e.is_active,
      sum(en.total_hours) as hours,
      case when e.pay_type = 'hourly' then round(sum(en.total_hours) * coalesce(e.hourly_rate,0), 2) end as labor_cost,
      (select ju.external_id from jobber_users ju
        where ju.company_id = e.company_id
          and ju.name ilike '%' || e.last_name || '%'
          and (ju.name ilike '%' || e.first_name || '%'
               or (nullif(e.preferred_name,'') is not null and ju.name ilike '%' || e.preferred_name || '%'))
        order by ju.is_active desc nulls last, ju.external_id
        limit 1) as jobber_id
    from employees e
    join entries en on en.employee_id = e.id
    where e.company_id = p_company_id
    group by e.id, e.first_name, e.last_name, e.preferred_name, e.department,
             e.pay_type, e.hourly_rate, e.is_active, e.company_id
  ),
  -- Completed, revenue-bearing visits in the effective window.
  vis as (
    select v.id, v.external_id, v.job_id, v.tech_external_user_ids, v.completed_at
    from visits v, eff
    where v.company_id = p_company_id
      and v.deleted_at is null
      and v.visit_status = 'COMPLETED'
      and v.completed_at::date between eff.s and eff.e
      and upper(coalesce(v.title,'')) not like '%BILLING%'
  ),
  -- Company revenue, computed WITHOUT fanning out per technician. Summing the
  -- per-tech figures would double-count the 14 visits staffed by two people.
  rev_recurring as (
    select v.id as visit_id, sum(li.total) amt
    from vis v
    join jobs j on j.id = v.job_id and j.deleted_at is null and j.is_recurring = true
    join line_items li on li.parent_external_id = v.external_id and li.parent_type = 'visit'
      and li.company_id = p_company_id and li.deleted_at is null and li.name not ilike '%Service Plan%'
    group by v.id
  ),
  rev_oneoff as (
    select v.id as visit_id, (j.total / nullif(jc.n,0)) amt
    from vis v
    join jobs j on j.id = v.job_id and j.deleted_at is null and j.is_recurring = false
    join lateral (select count(*) n from visits v2
                  where v2.job_id = j.id and v2.deleted_at is null and v2.visit_status='COMPLETED') jc on true
  ),
  visit_rev as (
    select visit_id, amt from rev_recurring
    union all
    select visit_id, amt from rev_oneoff
  ),
  -- Per-technician revenue, using the SAME convention as the existing boards: a
  -- visit staffed by two people credits both in full. Per-person figures
  -- therefore sum to slightly more than company revenue (14 of 885 visits here);
  -- the widget says so rather than inventing a split.
  tech_rev as (
    select t.tid, sum(vr.amt) amt
    from (select distinct jobber_id tid from people where jobber_id is not null) t
    join vis v on t.tid = any(v.tech_external_user_ids)
    join visit_rev vr on vr.visit_id = v.id
    group by t.tid
  ),
  totals as (
    select
      (select round(sum(hours),1) from people) hours,
      (select round(sum(labor_cost),2) from people) labor_cost,
      (select round(sum(amt),2) from visit_rev) revenue,
      (select count(*) from vis) visits
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'coverage', jsonb_build_object(
      'timeclock_first', (select first_day from eff),
      'timeclock_last',  (select last_day  from eff),
      'effective_start', (select s from eff),
      'effective_end',   (select e from eff),
      'requested_start', p_start,
      'requested_end',   p_end,
      -- True when the picked window reached outside the timeclock data and had to
      -- be narrowed. The widgets use this to explain themselves.
      'clamped', (select (s <> p_start or e <> p_end) from eff),
      'has_data', (select (s <= e) from eff)
    ),
    'hours',        coalesce((select hours from totals), 0),
    'labor_cost',   coalesce((select labor_cost from totals), 0),
    'revenue',      coalesce((select revenue from totals), 0),
    'visits',       coalesce((select visits from totals), 0),
    'rev_per_hour', (select case when hours > 0 then round(revenue / hours, 2) end from totals),
    'rev_per_visit',(select case when visits > 0 then round(revenue / visits, 2) end from totals),
    'labor_pct',    (select case when revenue > 0 then round(100 * labor_cost / revenue, 1) end from totals),

    'unattributed_count', (select count(*) from people where jobber_id is null),
    'unattributed_hours', coalesce((select round(sum(hours),1) from people where jobber_id is null), 0),
    'unattributed_names', coalesce((select jsonb_agg(name order by hours desc) from people where jobber_id is null), '[]'::jsonb),
    'salaried_note', (select count(*) from employees
                      where company_id = p_company_id and pay_type <> 'hourly' and is_active),

    'people', coalesce((
      select jsonb_agg(p order by (p->>'hours')::numeric desc)
      from (
        select jsonb_build_object(
          'employee_id', pe.id,
          'name',        pe.name,
          'department',  pe.department,
          'is_active',   pe.is_active,
          'pay_type',    pe.pay_type,
          'hours',       round(pe.hours, 1),
          'labor_cost',  pe.labor_cost,
          'attributable', (pe.jobber_id is not null),
          'revenue',     case when pe.jobber_id is not null then round(coalesce(tr.amt, 0), 2) end,
          'rev_per_hour',case when pe.jobber_id is not null and pe.hours > 0
                              then round(coalesce(tr.amt,0) / pe.hours, 2) end
        ) p
        from people pe
        left join tech_rev tr on tr.tid = pe.jobber_id
      ) x
    ), '[]'::jsonb),

    'by_department', coalesce((
      select jsonb_agg(d order by (d->>'hours')::numeric desc)
      from (
        select jsonb_build_object(
          'department', department,
          'hours',      round(sum(hours), 1),
          'labor_cost', round(sum(labor_cost), 2),
          'people',     count(*)
        ) d
        from people group by department
      ) y
    ), '[]'::jsonb)
  ) end;
$$;

comment on function public.scoreboard_crew_labor(uuid, date, date) is
  'Crew & Labor Efficiency report 8.6 — revenue per clocked labor hour. CLAMPS the window to where timeclock data exists (see file header: an unclamped YTD reads 3x high). Includes departed employees; excludes people with no Jobber identity from per-person revenue and names them.';

revoke all on function public.scoreboard_crew_labor(uuid, date, date) from public, anon;
grant execute on function public.scoreboard_crew_labor(uuid, date, date) to authenticated, service_role;

create index if not exists idx_time_entries_company_date
  on time_entries (company_id, date)
  where total_hours > 0;
