-- Ticket Size by technician: one person's typical repair, and every tech side by side
--
-- Ben: "I actually want both — drill it down by a technician and then another widget
-- that is a chart that shows every tech."
--
-- ⚠⚠ A SEPARATE FUNCTION, not two more arguments on scoreboard_ticket_size. Three
-- reasons, in order of how much they matter:
--
--  1. It returns a DIFFERENT SHAPE. The chart card needs a per-technician breakdown
--     carrying a median each, and a median is the one statistic that cannot be
--     recombined from roll-ups — you cannot average two medians into the median of
--     the union. So the breakdown has to be computed in SQL, per tech, here.
--  2. It answers to a DIFFERENT GRANT. Per-person production sits behind Crew &
--     Labor; the plain Ticket Size card stays under Revenue where it shipped this
--     morning. Same split the product already makes between `kpi_visit_revenue` and
--     `kpi_visit_revenue_by_tech`.
--  3. scoreboard_ticket_size already has a 5-arg and a 7-arg overload. A third would
--     make PostgREST's candidate resolution something a future reader has to reason
--     about rather than read.
--
-- ⚠ WHY THIS IS SAFE FOR REPAIRS WHEN IT WAS NOT FOR INSTALLS. The install-credit
-- work in August established that Jobber records ONE completion date and usually ONE
-- technician per install, so a multi-day two-man install cannot be attributed from
-- visit data alone — hence the `install_labor_credits` table. Repairs are the
-- opposite shape and the data says so: of 448 IR repair tickets in Jan–Aug 2026, 433
-- name exactly one technician, 15 name two, and NONE are unassigned. Crediting the
-- tech on the visit is correct here in a way it never was for installs.
--
-- ⚠ p_tech_credit exists because the two honest answers differ. 'each' gives one
-- person the whole ticket they worked — right for "what does Lucas's typical repair
-- bill" — and consequently the technicians SUM TO MORE than the company total
-- (measured: $5,837 of double-count across the 15 shared tickets). 'split' divides a
-- shared ticket so the columns reconcile, at the cost of understating what each
-- person actually attended. Neither is a bug; the card names which one it used.

create or replace function public.scoreboard_ticket_size_by_tech(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_lines text[],          -- dept prefixes; null = every line
  p_items text[],          -- EXACT line-item names from the picker
  p_items_mode text,       -- 'include' = count only these · 'exclude' = count all but these
  p_techs text[],          -- technician NAMES as the picker offers them; null = everyone
  p_tech_credit text       -- 'each' | 'split'
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  picked as (
    -- Case- and whitespace-folded, so one ticked name also catches Jobber's
    -- near-identical twins (the "Service Call - T1" with a trailing space, 81 lines
    -- and $10,607 that exact matching would silently drop).
    select lower(regexp_replace(btrim(i), '\s+', ' ', 'g')) as k
    from unnest(coalesce(p_items, '{}'::text[])) i
    where coalesce(trim(i), '') <> ''
  ),
  wanted_techs as (
    select lower(regexp_replace(btrim(t), '\s+', ' ', 'g')) as k
    from unnest(coalesce(p_techs, '{}'::text[])) t
    where coalesce(trim(t), '') <> ''
  ),
  mode as (select case when lower(coalesce(p_items_mode, 'include')) = 'exclude'
                       then 'exclude' else 'include' end m),
  credit as (select case when lower(coalesce(p_tech_credit, 'each')) = 'split'
                         then 'split' else 'each' end c),
  -- Every line the card may look at, before the item filter, so the filter's own cost
  -- can be reported rather than guessed at.
  scoped as (
    select li.name, li.total, li.dept_prefix, v.id as visit_id,
           coalesce(v.tech_external_user_ids, array[]::text[]) as techs
    from public.visits v
    join public.line_items li
      on li.parent_external_id = v.external_id
     and li.parent_type = 'visit'
     and li.company_id = p_company_id
     and li.deleted_at is null
     and li.total <> 0
     and (p_lines is null or li.dept_prefix = any(p_lines))
    where v.company_id = p_company_id
      and v.deleted_at is null
      and v.visit_status = 'COMPLETED'
      and v.completed_at::date between p_start and p_end
  ),
  marked as (
    select s.*,
           case
             -- ⚠ Nothing ticked means EVERY line item, never none — same rule the
             -- line and person filters follow. A filter may only remove rows the card
             -- was already entitled to; "I ticked nothing" must not render zero.
             when (select count(*) from picked) = 0 then true
             when (select m from mode) = 'exclude'
               then not exists (select 1 from picked p
                                where p.k = lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')))
             else      exists (select 1 from picked p
                                where p.k = lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')))
           end as counted
    from scoped s
  ),
  -- A ticket is (visit × service line), exactly as the Revenue card defines it: a
  -- visit carrying a sprinkler repair AND a lawn treatment is two tickets.
  tickets as (
    select visit_id, dept_prefix, techs, sum(total) as ticket_total
    from marked where counted
    group by visit_id, dept_prefix, techs
    having sum(total) <> 0
  ),
  -- One row per (ticket × technician). ⚠ The name is composed EXACTLY as
  -- scoreboard_visit_revenue_trend composes it, and the no-technician bucket carries
  -- the same literal the picker offers (NO_TECH in widgets/people-filter.ts), so a
  -- name offered by the picker always matches a row this returns. Composing it any
  -- other way would produce a filter that matches nothing and an honest-looking zero.
  per_tech as (
    select coalesce(nullif(ju.name, ''), 'Unknown (' || left(t.tid, 8) || ')') as tech_name,
           case when (select c from credit) = 'split'
                then tk.ticket_total / nullif(array_length(tk.techs, 1), 0)
                else tk.ticket_total end as ticket_total
    from tickets tk
    cross join lateral unnest(tk.techs) as t(tid)
    left join public.jobber_users ju
      on ju.company_id = p_company_id and ju.external_id = t.tid
    union all
    -- The gap made visible rather than dropped. Repairs currently have none of these,
    -- which is itself worth being able to see go wrong.
    select 'Nobody assigned', tk.ticket_total
    from tickets tk
    where coalesce(array_length(tk.techs, 1), 0) = 0
  ),
  -- The person filter applies AFTER the per-tech fan-out, so the headline median is
  -- computed over exactly the selected people's tickets rather than reconstructed
  -- from per-person medians (which is not a thing that can be done).
  selected as (
    select * from per_tech
    where (select count(*) from wanted_techs) = 0
       or lower(regexp_replace(btrim(tech_name), '\s+', ' ', 'g')) in (select k from wanted_techs)
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    -- Headline: the selected people (or everyone) as ONE population.
    'ticket_count',  (select count(*) from selected),
    'avg_value',     (select round(avg(ticket_total), 2) from selected),
    'median_value',  (select round((percentile_cont(0.5) within group (order by ticket_total))::numeric, 2) from selected),
    'total_value',   (select round(sum(ticket_total), 2) from selected),
    -- What the item filter removed, so a stale tick list says so on the card's face.
    'off_list_lines', (select count(*) from marked where not counted),
    'off_list_value', (select round(sum(total), 2) from marked where not counted),
    -- ⚠ How much of the total is double-counted by 'each'. This is the number that
    -- makes "the columns do not add up to the department" explainable instead of
    -- looking like a bug — it is zero under 'split' by construction.
    'shared_tickets', (select count(*) from tickets where coalesce(array_length(techs, 1), 0) > 1),
    'credit_mode',    (select c from credit),
    -- The chart's rows. Each median computed over that person's own tickets.
    'by_tech', coalesce((
      select jsonb_agg(x order by (x->>'ticket_count')::int desc, x->>'tech')
      from (
        select jsonb_build_object(
          'tech',         tech_name,
          'ticket_count', count(*),
          'avg_value',    round(avg(ticket_total), 2),
          'median_value', round((percentile_cont(0.5) within group (order by ticket_total))::numeric, 2),
          'total_value',  round(sum(ticket_total), 2)
        ) x
        from selected group by tech_name
      ) y
    ), '[]'::jsonb)
  ) end
$function$;

revoke all on function public.scoreboard_ticket_size_by_tech(uuid, date, date, text[], text[], text, text[], text) from anon;
revoke all on function public.scoreboard_ticket_size_by_tech(uuid, date, date, text[], text[], text, text[], text) from authenticated;
revoke all on function public.scoreboard_ticket_size_by_tech(uuid, date, date, text[], text[], text, text[], text) from public;
grant execute on function public.scoreboard_ticket_size_by_tech(uuid, date, date, text[], text[], text, text[], text) to service_role;
