-- Line items sitting on recurring jobs that the recurring book does NOT count.
-- The discovery half of the "Recurring programs" editor on Admin -> Reports.
--
-- ⚠⚠ THIS LIST IS A CAUTION, NOT A TO-DO. Most of what it returns SHOULD stay
-- uncounted. Measured on Heroes 2026-08-18: of 38 uncounted line items, all but two are
-- irrigation repair parts and one-off work — spray heads, nozzles, a broken pipe, a
-- replaced Rachio controller — billed on a job that happens to recur. Annualising them
-- at whatever cadence they inherited would MORE THAN DOUBLE a $54,559 irrigation book
-- (296 such items measured at $68,418 on 2026-08-17). The editor says so in the UI.
--
-- What it is genuinely for: the opposite failure. `WF - Fire Ant Control` (8 live jobs,
-- $1,400 per visit) and `WF - Artificial Turf Weed Control` were invisible for weeks —
-- they carried real money on recurring jobs and nothing in the product showed they were
-- unmapped. Artificial Turf turned out to belong in the book; Fire Ant did not, because
-- Jobber classes it one-off. Both decisions needed a human, and neither was surfaced.
--
-- Excludes discounts (they are handled separately by the book) and any item whose value
-- nets to zero, since adding it would change nothing either way — Heroes' aeration is
-- $0 on 46 of 48 jobs because it is bundled into a program already paid for.

create or replace function public.recurring_unmapped_line_items(p_company_id uuid)
returns table (line_item_name text, live_jobs integer, per_visit_total numeric, guessed_prefix text)
language sql stable security definer set search_path to 'public','pg_temp'
as $function$
  with live_jobs as (
    select j.id from public.jobs j join public.clients c on c.id = j.client_id
    where j.company_id = p_company_id and j.is_recurring = true and j.job_status <> 'archived'
      and j.deleted_at is null and coalesce(j.title,'') not ilike '%billing%'
      and not (coalesce(c.email,'') ilike '%fakemail%'
               or regexp_replace(coalesce(c.phone,''),'\D','','g') = '2812540991')
  ),
  defs as (select line_item_name from public.recurring_program_definitions where company_id = p_company_id)
  select
    regexp_replace(li.name, '\s*-\s*T[0-9]+$', '')            as line_item_name,
    count(distinct li.parent_id)::integer                     as live_jobs,
    round(sum(li.total)::numeric, 2)                          as per_visit_total,
    nullif(upper(split_part(regexp_replace(li.name, '\s*-\s*', '-', 'g'), '-', 1)), '') as guessed_prefix
  from public.line_items li
  join live_jobs lj on lj.id = li.parent_id
  where li.company_id = p_company_id and li.parent_type = 'job' and li.deleted_at is null
    and li.name not ilike '%discount%'
    and regexp_replace(li.name, '\s*-\s*T[0-9]+$', '') not in (select line_item_name from defs)
  group by 1, 4
  having sum(li.total) <> 0
  order by round(sum(li.total)::numeric, 2) desc
$function$;

-- ⚠⚠ Supabase's DEFAULT PRIVILEGES grant EXECUTE to anon and authenticated BY NAME on a
-- new function in `public`, and `revoke ... from public` does NOT remove those. Revoke
-- PUBLIC first, then each role by name. Verified after applying: the ACL reads exactly
-- `postgres=X | service_role=X`.
revoke all on function public.recurring_unmapped_line_items(uuid) from public;
revoke all on function public.recurring_unmapped_line_items(uuid) from anon;
revoke all on function public.recurring_unmapped_line_items(uuid) from authenticated;
grant execute on function public.recurring_unmapped_line_items(uuid) to service_role;
