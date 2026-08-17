-- ===========================================================================
-- Scoreboard book widgets — per-tenant program definitions, generic add-ons,
-- ticket size, and "which stages count as a sale"
-- 2026-08-17
--
-- Applied to the SHARED Supabase DB, so it lands on prod and staging at once.
-- Every part is written to be behaviour-preserving for the code running BEFORE
-- the matching deploy:
--   * scoreboard_recurring_book keeps has_phc/has_bwp, so the legacy WF board
--     (Scoreboard2View) reads exactly what it reads today. Columns are ADDED.
--   * scoreboard_ticket_size is new; scoreboard_ir_repair_ticket is left alone
--     because board 3 still calls it.
--   * scoreboard_sales changes shape only once a stage is flagged counts_as_sale,
--     and the column defaults to false.
-- ===========================================================================

begin;

-- ── PART 1 · recurring_program_definitions becomes per-company ─────────────
--
-- This table was SINGLE-TENANT: no company_id at all, and an RLS policy of
-- `USING (true)`, so any signed-in user of any tenant could read every row. It
-- also carried full table grants for `anon` (RLS blocked those, but nothing
-- should depend on that being the only thing standing in the way).
--
-- 22 rows exist and all of them are Heroes' — WF/IR/PW/MO line items.

alter table public.recurring_program_definitions
  add column if not exists company_id uuid;

update public.recurring_program_definitions
   set company_id = '00000000-0000-0000-0000-000000000002'::uuid
 where company_id is null;

alter table public.recurring_program_definitions
  alter column company_id set not null;

do $$ begin
  alter table public.recurring_program_definitions
    add constraint recurring_program_definitions_company_fkey
    foreign key (company_id) references public.companies(id) on delete cascade;
exception when duplicate_object then null; end $$;

-- Uniqueness is per company now: two tenants may both sell a line item called
-- "WF - Lawn Health Basic", and under the old global constraint the second one
-- to onboard simply could not save it.
alter table public.recurring_program_definitions
  drop constraint if exists recurring_program_definitions_line_item_name_key;

do $$ begin
  alter table public.recurring_program_definitions
    add constraint recurring_program_definitions_company_line_item_key
    unique (company_id, line_item_name);
exception when duplicate_object then null; end $$;

create index if not exists recurring_program_definitions_company_idx
  on public.recurring_program_definitions (company_id);

drop policy if exists recurring_program_definitions_select
  on public.recurring_program_definitions;

create policy recurring_program_definitions_select
  on public.recurring_program_definitions
  as permissive for select to authenticated
  using (company_id = public.get_my_company_id());

revoke all on public.recurring_program_definitions from anon;


-- ── PART 2 · tracker_stages.counts_as_sale ─────────────────────────────────
--
-- `scoreboard_sales` treated anything that was not closed_won / closed_lost /
-- closed_other as STILL OPEN. Heroes files upsells under their own stage, so 55
-- sold upsells worth $31,541 sat in Open Pipeline forever and were missing from
-- Value Sold.
--
-- ⚠ This cannot ride on `system_role`: that column is real and in use (won/lost
-- drive the Board and Needs-me columns and the drip stage_changed trigger) and a
-- partial unique index makes each role single-source per company — so closed_won
-- and upsells could not both hold 'won'.
--
-- Defaults false, so the migration on its own changes nothing for any tenant.

alter table public.tracker_stages
  add column if not exists counts_as_sale boolean not null default false;

-- Heroes: an upsell is a sale (Ben, 2026-08-17). The Tracker convention is that
-- the value entered on an upsell lead is the UPGRADE amount, not the new contract
-- total, so it adds alongside closed_won without double-counting.
update public.tracker_stages
   set counts_as_sale = true
 where company_id = '00000000-0000-0000-0000-000000000002'::uuid
   and key = 'upsells';


-- ── PART 3 · scoreboard_recurring_book · generic add-ons + pricing honesty ──
--
-- DROP + CREATE because RETURNS TABLE gains columns, which CREATE OR REPLACE
-- cannot do. ⚠ A freshly created function carries the default PUBLIC execute
-- grant, so PUBLIC is revoked and service_role re-granted at the end — matching
-- the ACL this function had before (postgres=X, service_role=X, nothing else).

drop function if exists public.scoreboard_recurring_book(uuid);

create function public.scoreboard_recurring_book(p_company_id uuid)
returns table(
  job_id uuid,
  client_id uuid,
  dept_prefix text,
  display_name text,
  -- Retained ONLY for the legacy hardcoded WF board, which reads these two by
  -- name. Both go when board 2 is retired; widgets read addon_names instead.
  has_phc boolean,
  has_bwp boolean,
  annual_value numeric,
  -- NEW ↓
  addon_names text[],
  visits_per_year integer,
  is_priced boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with active_jobs as (
    select j.id, j.client_id
    from public.jobs j
    join public.clients c on c.id = j.client_id
    where j.company_id   = p_company_id
      and j.is_recurring = true
      and j.job_status  <> 'archived'
      and j.deleted_at   is null
      and coalesce(j.title, '') not ilike '%billing%'   -- drop annual-pay billing artifacts
      and not (
        coalesce(c.email, '') ilike '%fakemail%'
        or regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = '2812540991'
      )
      and (
        (select auth.uid()) is null
        or exists (
          select 1 from public.user_profiles up
          where up.id = (select auth.uid())
            and up.company_id = p_company_id
            and (up.role = 'admin' or up.can_access_scoreboards)
        )
      )
  ),
  -- ⚠ Scoped to the caller's company now. Before PART 1 this table had no
  -- company_id, so every tenant's book was priced off Heroes' program list.
  defs as (
    select * from public.recurring_program_definitions
    where company_id = p_company_id
  ),
  job_items as (
    select li.parent_id as job_id,
           li.name,
           regexp_replace(li.name, '\s*-\s*T[0-9]+$', '') as norm_name,
           li.total
    from public.line_items li
    join active_jobs aj on aj.id = li.parent_id
    where li.company_id  = p_company_id
      and li.parent_type = 'job'
      and li.deleted_at  is null
  ),
  job_vpy as (
    select ji.job_id, max(d.visits_per_year) as vpy
    from job_items ji
    join defs d on d.line_item_name = ji.norm_name and d.is_auxiliary = false
    where d.visits_per_year is not null
    group by ji.job_id
  ),
  job_annual as (
    select jv.job_id, jv.vpy * sum(ji.total) as annual_value
    from job_vpy jv
    join job_items ji on ji.job_id = jv.job_id
    left join defs d on d.line_item_name = ji.norm_name
    where (d.is_auxiliary = false and d.visits_per_year is not null)
       or ji.name ilike '%discount%'
    group by jv.job_id, jv.vpy
  ),
  -- Add-ons are whatever the tenant flagged `is_auxiliary`, NOT two hardcoded
  -- names. ⚠ Matched on norm_name (tier-stripped) like base programs are, so an
  -- add-on sold as "WF - Plant Health Care - T2" counts instead of silently
  -- reading zero — which is what the has_phc expression below does today.
  job_addons as (
    select ji.job_id,
           array_agg(distinct d.display_name) as names
    from job_items ji
    join defs d on d.line_item_name = ji.norm_name and d.is_auxiliary = true
    group by ji.job_id
  ),
  job_aux_legacy as (
    select ji.job_id,
           bool_or(ji.name = 'WF - Plant Health Care')  as has_phc,
           bool_or(ji.name = 'WF - Bed Weed Prevention') as has_bwp
    from job_items ji
    group by ji.job_id
  ),
  job_base as (
    select distinct on (ji.job_id, d.dept_prefix)
           ji.job_id, d.dept_prefix, d.display_name, d.visits_per_year
    from job_items ji
    join defs d on d.line_item_name = ji.norm_name
    where d.is_auxiliary = false
    order by ji.job_id, d.dept_prefix, d.display_name
  )
  select
    aj.id       as job_id,
    aj.client_id,
    jb.dept_prefix,
    jb.display_name,
    coalesce(jal.has_phc, false) as has_phc,
    coalesce(jal.has_bwp, false) as has_bwp,
    coalesce(jan.annual_value, 0) as annual_value,
    coalesce(jad.names, '{}'::text[]) as addon_names,
    jb.visits_per_year::integer,
    -- ⚠ Annual value needs visits-per-year on the base program. Without it the
    -- job computes to 0 and reads as "this service line earns nothing" — which is
    -- exactly what all 10 Heroes Mosquito jobs do today. Cards must be able to
    -- say how many jobs they could not price rather than printing a confident $0.
    (jan.annual_value is not null) as is_priced
  from active_jobs aj
  join job_base jb          on jb.job_id  = aj.id
  left join job_annual jan  on jan.job_id = aj.id
  left join job_aux_legacy jal on jal.job_id = aj.id
  left join job_addons jad  on jad.job_id = aj.id
$function$;

-- ⚠⚠ REVOKED BY NAME, not just from PUBLIC. A DROP + CREATE in `public` picks up
-- Supabase's DEFAULT PRIVILEGES, which grant EXECUTE to anon and authenticated;
-- `revoke ... from public` does NOT remove those, because they are explicit grants
-- to named roles rather than the PUBLIC pseudo-role. Applying this migration with
-- only the PUBLIC revoke left the function anon-executable — verified and fixed.
--
-- It matters more than posture here: the guard below begins
-- `(select auth.uid()) is null or exists (...)`, and for an anonymous caller
-- auth.uid() IS NULL, so the guard short-circuits to TRUE. anon + EXECUTE would
-- have made every tenant's recurring book readable unauthenticated.
revoke all on function public.scoreboard_recurring_book(uuid) from anon;
revoke all on function public.scoreboard_recurring_book(uuid) from authenticated;
revoke all on function public.scoreboard_recurring_book(uuid) from public;
grant execute on function public.scoreboard_recurring_book(uuid) to service_role;


-- ── PART 4 · scoreboard_ticket_size · what one job is worth ────────────────
--
-- Generalises scoreboard_ir_repair_ticket, which hardcodes dept_prefix='IR' and
-- three Heroes-specific exclusions. ⚠ Those exclusions ARE the definition of a
-- "repair" — a service plan, an install and a drainage job are not repair
-- tickets — so they become a setting rather than disappearing.
--
-- Returns jsonb so a later measure can be added without a signature change (the
-- lesson scoreboard_sales already carries). The IR-only function is deliberately
-- left in place: board 3 still calls it until it is retired.

create or replace function public.scoreboard_ticket_size(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_lines text[] default null,     -- dept prefixes; null = every line
  p_exclude text[] default null    -- name fragments to leave out
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  ex as (
    -- ⚠ Escape LIKE metacharacters. An exclusion typed as "Slip Fix 1_inch" would
    -- otherwise widen itself into a wildcard and quietly drop more rows than it
    -- names — a silently wrong average rather than an error.
    select '%' || replace(replace(replace(f, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
    from unnest(coalesce(p_exclude, '{}'::text[])) f
    where coalesce(trim(f), '') <> ''
  ),
  tickets as (
    select v.id as visit_id, li.dept_prefix, sum(li.total) as ticket_total
    from public.visits v
    join public.line_items li
      on li.parent_external_id = v.external_id
     and li.parent_type = 'visit'
     and li.company_id = p_company_id
     and li.deleted_at is null
     and li.total <> 0
     and (p_lines is null or li.dept_prefix = any(p_lines))
     and not exists (select 1 from ex where li.name ilike ex.pat)
    where v.company_id = p_company_id
      and v.deleted_at is null
      and v.visit_status = 'COMPLETED'
      and v.completed_at::date between p_start and p_end
    -- Grain is (visit, line): a visit carrying a sprinkler repair AND a lawn
    -- treatment is two tickets, one per line, which is the only grouping where a
    -- per-line average means anything.
    group by v.id, li.dept_prefix
    having sum(li.total) <> 0
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'ticket_count',  (select count(*) from tickets),
    'avg_value',     (select round(avg(ticket_total), 2) from tickets),
    'median_value',  (select round((percentile_cont(0.5) within group (order by ticket_total))::numeric, 2) from tickets),
    'total_value',   (select round(sum(ticket_total), 2) from tickets),
    'by_line', coalesce((
      select jsonb_agg(x order by (x->>'total_value')::numeric desc)
      from (
        select jsonb_build_object(
          'line',         coalesce(dept_prefix, 'Unassigned'),
          'ticket_count', count(*),
          'avg_value',    round(avg(ticket_total), 2),
          'median_value', round((percentile_cont(0.5) within group (order by ticket_total))::numeric, 2),
          'total_value',  round(sum(ticket_total), 2)
        ) x
        from tickets group by dept_prefix
      ) y
    ), '[]'::jsonb)
  ) end
$function$;

-- Revoked BY NAME for the reason spelled out above PART 3's grants.
revoke all on function public.scoreboard_ticket_size(uuid, date, date, text[], text[]) from anon;
revoke all on function public.scoreboard_ticket_size(uuid, date, date, text[], text[]) from authenticated;
revoke all on function public.scoreboard_ticket_size(uuid, date, date, text[], text[]) from public;
grant execute on function public.scoreboard_ticket_size(uuid, date, date, text[], text[]) to service_role;


-- ── PART 5 · scoreboard_sales honours counts_as_sale ───────────────────────
--
-- CREATE OR REPLACE with the identical signature and return type, so the ACL is
-- preserved and no call site changes.
--
-- What moves, and what deliberately does not:
--   `won` / `won_value` / `avg_deal`  → now closed_won + any counts_as_sale stage.
--                                       This is the fix: those deals are sold.
--   `open` / `open_by_stage`          → sale stages are no longer "open".
--   `close_rate` / `decided`          → UNCHANGED basis (closed_won ÷ won+lost).
--                                       Ben's call: an upsell to an existing
--                                       customer is not a lead you competed for,
--                                       so it must not move the close rate.
--   time-to-close                     → stays on closed_won for the same reason;
--                                       an upsell is logged and sold same-day, so
--                                       including it would collapse the median.
--
-- ⚠ `sale_stages` is a SET of keys, not an array. Written as
-- `stage = any((select keys from sale_stages))` Postgres reads the subquery as a row
-- set and tries to compare text = text[], which fails to even create the function.
-- An empty set makes every `in` / `not in` below behave exactly as it did before the
-- column existed — that is what keeps this inert for a tenant who ticks nothing.

create or replace function public.scoreboard_sales(p_company_id uuid, p_start date, p_end date)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  sale_stages as (
    select key from public.tracker_stages
    where company_id = p_company_id and counts_as_sale = true
  ),
  cohort as (
    select l.*,
      -- Sold in open competition — the close-rate numerator.
      (l.stage = 'closed_won') as competed_won,
      -- Sold, but not competed for (Heroes: Upsells).
      (l.stage in (select key from sale_stages)) as upsold,
      -- Sold at all.
      (l.stage = 'closed_won' or l.stage in (select key from sale_stages)) as won,
      (l.stage in ('closed_won','closed_lost')) as decided,
      (l.stage = 'closed_other') as junk,
      (l.stage not in ('closed_won','closed_lost','closed_other')
        and l.stage not in (select key from sale_stages)) as open_still,
      -- One rep, one row: "Kathryn" and "kathryn" are the same person.
      coalesce(nullif(initcap(trim(lower(l.salesperson))),''), 'Unassigned') as rep
    from leads l
    where l.company_id = p_company_id
      and l.lead_creation_date between p_start and p_end
  ),
  lost as (
    select regexp_replace(regexp_replace(coalesce(nullif(trim(status),''),'Not given'), '[—–-]+', '-', 'g'),
                          '\s*-\s*', ' - ', 'g') as reason,
           count(*) n
    from cohort where stage = 'closed_lost'
    group by 1
  ),
  days as (
    select (sold_date - lead_creation_date) d
    from cohort
    where competed_won and sold_date is not null and sold_date >= lead_creation_date
  ),
  attempts as (
    select count(distinct la.lead_id) leads_with, count(*) total
    from lead_attempts la join cohort c on c.id = la.lead_id
    where la.company_id = p_company_id
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'leads',        (select count(*) from cohort),
    'won',          (select count(*) filter (where won) from cohort),
    'competed_won', (select count(*) filter (where competed_won) from cohort),
    'upsold',       (select count(*) filter (where upsold) from cohort),
    'upsold_value', coalesce((select round(sum(annual_value) filter (where upsold),2) from cohort), 0),
    'sale_stages',  (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from sale_stages),
    'lost',         (select count(*) filter (where stage='closed_lost') from cohort),
    'decided',      (select count(*) filter (where decided) from cohort),
    'open',         (select count(*) filter (where open_still) from cohort),
    'excluded_junk',(select count(*) filter (where junk) from cohort),
    -- Competed-only, unchanged from before counts_as_sale existed.
    'close_rate',   (select case when count(*) filter (where decided) > 0
                      then round(100.0 * count(*) filter (where competed_won) / count(*) filter (where decided), 1) end
                     from cohort),
    'won_value',    coalesce((select round(sum(annual_value) filter (where won),2) from cohort), 0),
    'avg_deal',     (select round(avg(annual_value) filter (where won and annual_value > 0),2) from cohort),
    'median_days_to_close', (select percentile_disc(0.5) within group (order by d) from days),
    'avg_days_to_close',    (select round(avg(d),1) from days),
    'close_time_sample',    (select count(*) from days),
    'attempts_leads',  (select leads_with from attempts),
    'attempts_total',  (select total from attempts),
    'rate_min_sample', 10,

    'by_month', coalesce((
      select jsonb_agg(m order by m->>'month')
      from (
        select jsonb_build_object(
          'month', to_char(date_trunc('month', lead_creation_date), 'YYYY-MM'),
          'leads', count(*),
          'won',   count(*) filter (where won),
          'competed_won', count(*) filter (where competed_won),
          'upsold', count(*) filter (where upsold),
          'decided', count(*) filter (where decided),
          'won_value', coalesce(round(sum(annual_value) filter (where won),2), 0),
          'competed_value', coalesce(round(sum(annual_value) filter (where competed_won),2), 0),
          'upsold_value', coalesce(round(sum(annual_value) filter (where upsold),2), 0),
          'close_rate', case when count(*) filter (where decided) > 0
                        then round(100.0 * count(*) filter (where competed_won) / count(*) filter (where decided), 1) end
        ) m
        from cohort group by date_trunc('month', lead_creation_date)
      ) x
    ), '[]'::jsonb),

    'by_source', coalesce((
      select jsonb_agg(s order by (s->>'leads')::int desc)
      from (
        select jsonb_build_object(
          'source', coalesce(nullif(trim(lead_source),''), 'Other / Unknown'),
          'leads', count(*),
          'won', count(*) filter (where won),
          'competed_won', count(*) filter (where competed_won),
          'upsold', count(*) filter (where upsold),
          'decided', count(*) filter (where decided),
          'close_rate', case when count(*) filter (where decided) >= 10
                        then round(100.0 * count(*) filter (where competed_won) / count(*) filter (where decided), 1) end,
          'value', coalesce(round(sum(annual_value) filter (where won),2), 0)
        ) s
        from cohort group by coalesce(nullif(trim(lead_source),''), 'Other / Unknown')
      ) y
    ), '[]'::jsonb),

    'by_salesperson', coalesce((
      select jsonb_agg(p order by (p->>'won')::int desc)
      from (
        select jsonb_build_object(
          'name', rep,
          'leads', count(*),
          'won', count(*) filter (where won),
          'competed_won', count(*) filter (where competed_won),
          'decided', count(*) filter (where decided),
          'close_rate', case when count(*) filter (where decided) >= 10
                        then round(100.0 * count(*) filter (where competed_won) / count(*) filter (where decided), 1) end,
          'value', coalesce(round(sum(annual_value) filter (where won),2), 0),
          'upsold', count(*) filter (where upsold),
          'upsold_value', coalesce(round(sum(annual_value) filter (where upsold),2), 0)
        ) p
        from cohort group by rep
      ) z
    ), '[]'::jsonb),

    'lost_reasons', coalesce((
      select jsonb_agg(r order by (r->>'count')::int desc)
      from (select jsonb_build_object('reason', reason, 'count', n) r from lost) w
    ), '[]'::jsonb),

    'open_by_stage', coalesce((
      select jsonb_agg(o order by (o->>'count')::int desc)
      from (
        select jsonb_build_object('stage', stage, 'count', count(*)) o
        from cohort where open_still group by stage
      ) v
    ), '[]'::jsonb)
  ) end;
$function$;

commit;
