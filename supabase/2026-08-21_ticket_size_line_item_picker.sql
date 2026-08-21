-- Ticket Size: pick the line items, instead of typing name fragments
--
-- WHY: the card's only way to say "a repair is not an install" was a comma-separated
-- list of fragments matched with ILIKE. Ben's verdict was plain — "the keyword does
-- not work for me, we need to pick and choose what line items we want" — and the
-- data agrees that fragments are genuinely hard to get right here:
--
--   * "Installation" MISSES "IR - Zone install" (no -ation), so the fragment that
--     looks obviously right leaks an install into the repair average.
--   * The fragment has to be guessed against 266 distinct names nobody can see while
--     typing into a text box. 144 of them are IR alone.
--   * ⚠⚠ The exclusion drops matching LINE ITEMS, not whole visits, so an install
--     visit leaves its unmatched lines behind as a phantom "repair". Measured on
--     Jan–Aug 2026 IR: 24 install visits left $16,263 of residue — High Efficiency
--     Upgrade ($12,250), Design and Permit Fee ($1,600), new controllers (~$1,960) —
--     which counted as 24 repair tickets averaging $678. A fragment list can only fix
--     that by guessing every one of those names too. A tick list cannot miss them.
--
-- So: two new params carrying EXACT names from a picker, and one new diagnostic.
--
-- ⚠ p_exclude is kept and still works. The fragment path is no longer offered in the
-- UI, but removing the parameter would change the signature under any caller that
-- still passes it, and fragments remain the right tool for a tenant with a naming
-- convention. Include/exclude-by-name is added ALONGSIDE it, not instead.


-- ── PART 1 · scoreboard_line_item_names · what the picker offers ───────────
--
-- ⚠⚠ AN RPC RATHER THAN A POSTGREST SELECT, and that is load-bearing: Heroes has
-- 26,998 line-item rows. A `.from('line_items').select('name')` would hit the
-- 1000-row cap and return a picker built from the first 1000 rows it happened to
-- read — a short, plausible, silently-wrong list. Aggregating in SQL returns 266
-- rows because there are 266 distinct names.
--
-- Every name ever invoiced, with no date bound, for the same reason the tracked-item
-- picker is unbounded: a line item billed twice last winter is exactly the kind of
-- thing you are trying to decide about, and a window would hide it.
create or replace function public.scoreboard_line_item_names(
  p_company_id uuid
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  agg as (
    select li.name,
           -- One name CAN carry two prefixes; the picker shows the dominant one only
           -- as a hint, and the widget always matches on the name itself.
           (array_agg(li.dept_prefix order by li.dept_prefix nulls last))[1] as dept_prefix,
           count(*)                    as lines,
           round(sum(li.total), 2)     as total_value
    from public.line_items li
    where li.company_id = p_company_id
      and li.deleted_at is null
      and coalesce(trim(li.name), '') <> ''
    group by li.name
  )
  select case when not (select ok from allowed) then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'name',        name,
             'dept_prefix', dept_prefix,
             'lines',       lines,
             'total_value', total_value
           ) order by abs(coalesce(total_value, 0)) desc, name)
    from agg
  ), '[]'::jsonb) end
$function$;

revoke all on function public.scoreboard_line_item_names(uuid) from anon;
revoke all on function public.scoreboard_line_item_names(uuid) from authenticated;
revoke all on function public.scoreboard_line_item_names(uuid) from public;
grant execute on function public.scoreboard_line_item_names(uuid) to service_role;


-- ── PART 2 · scoreboard_ticket_size · exact-name include / exclude ─────────
--
-- ⚠⚠ A NEW 7-ARG FUNCTION, and the 5-arg one is deliberately LEFT IN PLACE rather
-- than dropped or replaced. p_items and p_items_mode have NO DEFAULT, so a call
-- naming the old five arguments still resolves unambiguously to the old function and
-- a call naming seven resolves to this one. That makes the rollout order free: run
-- this file, then deploy, with no window where the deployed code is calling a
-- signature that does not exist. (Adding the params WITH defaults would have made
-- both candidates match a 5-arg call and PostgREST would fail on
-- "could not choose the best candidate function".) The 5-arg version is droppable
-- once nothing calls it — same treatment scoreboard_ir_repair_ticket already gets.
create or replace function public.scoreboard_ticket_size(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_lines text[],          -- dept prefixes; null = every line
  p_exclude text[],        -- name FRAGMENTS to leave out (legacy path, still honoured)
  p_items text[],          -- EXACT line-item names from the picker
  p_items_mode text        -- 'include' = count only these · 'exclude' = count all but these
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
  picked as (
    -- Exact names, trimmed. ⚠ Case-and-space folded on BOTH sides below, because a
    -- picker entry and the row it came from can differ by a trailing space: Heroes
    -- carries both "IR - Irrigation Service Call - T1" and the same name with a
    -- trailing space as two separate names, 81 lines and $10,607 of them.
    select lower(regexp_replace(btrim(i), '\s+', ' ', 'g')) as k
    from unnest(coalesce(p_items, '{}'::text[])) i
    where coalesce(trim(i), '') <> ''
  ),
  mode as (select case when lower(coalesce(p_items_mode, 'include')) = 'exclude'
                       then 'exclude' else 'include' end m),
  -- Every line the card is entitled to look at, BEFORE the item filter — so the
  -- filter's own cost can be reported rather than guessed at.
  scoped as (
    select li.name, li.total, li.dept_prefix, v.id as visit_id,
           (select count(*) from picked) as n_picked,
           (select m from mode) as m
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
  ),
  marked as (
    select s.*,
           case
             -- ⚠ NOTHING TICKED MEANS EVERY LINE ITEM, never none — the same rule the
             -- line and person filters follow, and the reason it is safe: a filter can
             -- only remove rows the card was already entitled to, and "I ticked
             -- nothing" must not render an honest-looking zero.
             when s.n_picked = 0 then true
             when s.m = 'exclude'
               then not exists (select 1 from picked p
                                where p.k = lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')))
             else      exists (select 1 from picked p
                                where p.k = lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')))
           end as counted
    from scoped s
  ),
  tickets as (
    select visit_id, dept_prefix, sum(total) as ticket_total
    from marked where counted
    -- Grain is (visit, line): a visit carrying a sprinkler repair AND a lawn
    -- treatment is two tickets, one per line, which is the only grouping where a
    -- per-line average means anything.
    group by visit_id, dept_prefix
    having sum(total) <> 0
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'ticket_count',  (select count(*) from tickets),
    'avg_value',     (select round(avg(ticket_total), 2) from tickets),
    'median_value',  (select round((percentile_cont(0.5) within group (order by ticket_total))::numeric, 2) from tickets),
    'total_value',   (select round(sum(ticket_total), 2) from tickets),
    -- ⚠⚠ What the filter REMOVED, so the card can say it out loud. An include list
    -- silently omits any line item nobody has ticked yet — including one invented in
    -- Jobber last week — and that blind spot is invisible by construction unless the
    -- card reports it. This is the number that makes "your list is out of date"
    -- something you can see instead of something you find out about later.
    'off_list_lines', (select count(*) from marked where not counted),
    'off_list_value', (select round(sum(total), 2) from marked where not counted),
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

revoke all on function public.scoreboard_ticket_size(uuid, date, date, text[], text[], text[], text) from anon;
revoke all on function public.scoreboard_ticket_size(uuid, date, date, text[], text[], text[], text) from authenticated;
revoke all on function public.scoreboard_ticket_size(uuid, date, date, text[], text[], text[], text) from public;
grant execute on function public.scoreboard_ticket_size(uuid, date, date, text[], text[], text[], text) to service_role;
