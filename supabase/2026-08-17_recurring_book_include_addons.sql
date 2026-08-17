-- ===========================================================================
-- Book value: count recurring ADD-ONS, not base programs only
-- 2026-08-17
--
-- Ben, dogfooding the new cards: "For Book Value - I'm looking at WF. Only base
-- program line items are showing. We need all line items that are recurring
-- including BWP and PHC."
--
-- Measured on the live WF book before changing anything:
--   base programs   $234,881.60   already counted
--   add-ons          $12,972.20   NOT counted  <-- the bug
--   discounts        -$4,844.92   already counted (via the ilike below)
--   no definition        $240.00   still not counted, deliberately — see below
--
-- Result: WF $230,037 -> $243,009. IR, PW and MO are unchanged (no add-ons there),
-- and the company book goes $320,764 -> $333,736.
--
-- CREATE OR REPLACE with an identical signature and return shape, so the ACL is
-- preserved and no call site changes. Grants are still re-asserted below, by NAME,
-- because Supabase default privileges hand EXECUTE to anon and authenticated and
-- `revoke ... from public` does not remove those.
-- ===========================================================================

-- ⚠⚠ "ALL LINE ITEMS THAT ARE RECURRING" IS READ AS "ALL ITEMS THE DEFINITIONS TABLE
-- KNOWS ABOUT" — base or add-on — and NOT as "every item sitting on a recurring job".
-- That distinction is load-bearing rather than pedantic, and the WF view alone could
-- not have shown it:
--
--   On IR, 296 line items on recurring jobs have NO definition row at all — spray
--   heads, nozzles, "Leak Under Head", "Raising a head" — because they are one-off
--   repairs added to a Gold plan job. Annualising them would add $68,418 to a $59,571
--   IR book, MORE THAN DOUBLING it, and it would be plainly wrong: a spray head
--   replaced once is not billed four times a year.
--
--   WF's undefined items come to $240 by comparison, so looking only at WF the two
--   readings are indistinguishable.
--
-- The route to counting a currently-uncounted recurring charge is therefore to give it
-- a definition row (marked auxiliary), NOT to widen this rule.
--
-- ⚠ Per-item cadence: an add-on uses its OWN visits_per_year when set, and otherwise
-- inherits the base program's. Heroes' PHC and BWP have none, so they bill alongside
-- every visit of the base program, which is the natural reading. If an add-on is
-- applied only 4 times on an 8-visit program, setting 4 on its definition now prices
-- it correctly instead of doubling it — previously there was nowhere for that to land,
-- because one vpy was applied to the whole job.
create or replace function public.scoreboard_recurring_book(p_company_id uuid)
returns table(
  job_id uuid,
  client_id uuid,
  dept_prefix text,
  display_name text,
  -- Retained ONLY for the legacy hardcoded WF board. Both go when it is retired.
  has_phc boolean,
  has_bwp boolean,
  annual_value numeric,
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
      and coalesce(j.title, '') not ilike '%billing%'
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
  -- The job's cadence comes from its BASE program, and is the fallback for any add-on
  -- that does not state its own.
  job_vpy as (
    select ji.job_id, max(d.visits_per_year) as vpy
    from job_items ji
    join defs d on d.line_item_name = ji.norm_name and d.is_auxiliary = false
    where d.visits_per_year is not null
    group by ji.job_id
  ),
  job_annual as (
    select jv.job_id,
           sum(ji.total * coalesce(d.visits_per_year, jv.vpy)) as annual_value
    from job_vpy jv
    join job_items ji on ji.job_id = jv.job_id
    left join defs d on d.line_item_name = ji.norm_name
    where
      -- base programs with a cadence
      (d.is_auxiliary = false and d.visits_per_year is not null)
      -- recurring ADD-ONS (PHC, BWP …) — this is what was missing
      or d.is_auxiliary = true
      -- discounts carry no definition but are genuinely recurring credits
      or ji.name ilike '%discount%'
    group by jv.job_id
  ),
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
    (jan.annual_value is not null) as is_priced
  from active_jobs aj
  join job_base jb          on jb.job_id  = aj.id
  left join job_annual jan  on jan.job_id = aj.id
  left join job_aux_legacy jal on jal.job_id = aj.id
  left join job_addons jad  on jad.job_id = aj.id
$function$;

revoke all on function public.scoreboard_recurring_book(uuid) from anon;
revoke all on function public.scoreboard_recurring_book(uuid) from authenticated;
revoke all on function public.scoreboard_recurring_book(uuid) from public;
grant execute on function public.scoreboard_recurring_book(uuid) to service_role;
