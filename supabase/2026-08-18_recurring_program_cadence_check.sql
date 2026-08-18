-- Per-program cadence check: what each recurring program DECLARES vs what its jobs
-- actually do. Feeds the "Recurring programs" editor on Admin -> Reports.
--
-- ⚠⚠ WHY THIS EXISTS. On 2026-08-17 two declared cadences were wrong in opposite
-- directions and both were invisible in the product: `PW 2x Week` said 104 charges a
-- year when each job is invoiced weekly (52), overstating the Pet Waste book by
-- $12,388.48; and Lawn Health Plus was briefly set to 12 on the strength of an export
-- that had the wrong formula applied. Finding either needed a database session,
-- because `recurring_program_definitions` had no screen. This puts the measurement
-- next to the declaration so a mismatch is visible on sight.
--
-- ⚠ ROUNDS, NOT VISITS. A round can span consecutive days on a larger property — the
-- crew returns the next day and that second visit bills $0.00 — so Lawn Health Basic
-- shows 16 visits against a correct declared 8. Counting visits would have doubled
-- the biggest WF program. Visits within 3 days of each other collapse into one round.
--
-- ⚠ The measured figure is ADVISORY and deliberately not used in any calculation.
-- Cadence must stay DECLARED: Jobber pre-populates line items on FUTURE visits, and
-- Heroes has no WF job with a completed visit older than 365 days (the visit mirror
-- starts at the January backfill floor), so there is no full year of real charges to
-- derive from. This column is a prompt for a human, not a source of truth.

create or replace function public.recurring_program_cadence_check(p_company_id uuid)
returns table (
  line_item_name text,
  display_name text,
  dept_prefix text,
  is_auxiliary boolean,
  declared_per_year integer,
  live_jobs integer,
  measured_rounds_typical integer,
  measured_rounds_min integer,
  measured_rounds_max integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with defs as (
    select * from public.recurring_program_definitions where company_id = p_company_id
  ),
  live_jobs as (
    select j.id, j.company_id
    from public.jobs j
    join public.clients c on c.id = j.client_id
    where j.company_id = p_company_id
      and j.is_recurring = true
      and j.job_status <> 'archived'
      and j.deleted_at is null
      and coalesce(j.title, '') not ilike '%billing%'
      and not (
        coalesce(c.email, '') ilike '%fakemail%'
        or regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = '2812540991'
      )
  ),
  -- Which live jobs carry each defined program. Same trailing "- T<n>" strip the
  -- book uses, so the editor counts exactly the jobs the book counts.
  job_program as (
    select distinct d.line_item_name, lj.id as job_id
    from public.line_items li
    join live_jobs lj on lj.id = li.parent_id
    join defs d on d.line_item_name = regexp_replace(li.name, '\s*-\s*T[0-9]+$', '')
    where li.company_id = p_company_id
      and li.parent_type = 'job'
      and li.deleted_at is null
  ),
  -- Rounds scheduled for each job over the next 12 months, collapsing visits within
  -- 3 days of one another.
  job_rounds as (
    select jp.line_item_name, jp.job_id, count(*) filter (where t.new_round) as rounds
    from job_program jp
    cross join lateral (
      select coalesce(
               lag(v.scheduled_date) over (order by v.scheduled_date) < v.scheduled_date - 3,
               true
             ) as new_round
      from public.visits v
      where v.job_id = jp.job_id
        and v.deleted_at is null
        and v.scheduled_date >= current_date
        and v.scheduled_date <  current_date + 365
    ) t
    group by jp.line_item_name, jp.job_id
  )
  select
    d.line_item_name,
    d.display_name,
    d.dept_prefix,
    d.is_auxiliary,
    d.visits_per_year::integer                                as declared_per_year,
    (select count(*) from job_program jp
      where jp.line_item_name = d.line_item_name)::integer    as live_jobs,
    -- The typical case, not the average: one oddly-scheduled job should not move it.
    (select mode() within group (order by jr.rounds) from job_rounds jr
      where jr.line_item_name = d.line_item_name and jr.rounds > 0)::integer
                                                              as measured_rounds_typical,
    (select min(jr.rounds) from job_rounds jr
      where jr.line_item_name = d.line_item_name and jr.rounds > 0)::integer
                                                              as measured_rounds_min,
    (select max(jr.rounds) from job_rounds jr
      where jr.line_item_name = d.line_item_name and jr.rounds > 0)::integer
                                                              as measured_rounds_max
  from defs d
  order by d.is_auxiliary, d.dept_prefix, d.display_name
$function$;

-- ⚠⚠ Supabase's DEFAULT PRIVILEGES grant EXECUTE to anon and authenticated BY NAME on
-- every new function in `public`, and `revoke ... from public` does NOT remove those.
-- Revoke PUBLIC first, then each role by name — this exact trap briefly exposed
-- scoreboard_recurring_book to unauthenticated callers on 2026-08-17.
revoke all on function public.recurring_program_cadence_check(uuid) from public;
revoke all on function public.recurring_program_cadence_check(uuid) from anon;
revoke all on function public.recurring_program_cadence_check(uuid) from authenticated;
grant execute on function public.recurring_program_cadence_check(uuid) to service_role;
