/* Tracked items — count what we sold, from the Lead Tracker's Service column.
 *
 * The question: "how many Rachio controllers did we sell, and who sold them?"
 *
 * ⚠⚠ WHY THE LEAD TRACKER AND NOT JOBBER INVOICES. Invoice line items look like
 * the obvious source (they are the actual money), and they were the first design.
 * Two measurements killed it:
 *   · `invoices.salesperson_external_id` is set on only 994 of 2,586 invoices
 *     (38%), and on 12 of the 19 Rachio lines nobody is named — so "who sold it"
 *     is unanswerable there. `leads.salesperson` is set on 706 of 798 (88%).
 *   · The invoice mirror starts 2026-01-02 (the Jobber backfill floor). Leads go
 *     back to 2025-07-13, so the Tracker holds a year more history.
 * Quote line items would be the third candidate; they are not mirrored at all
 * (`line_items.parent_type` is only visit/invoice/job).
 *
 * ⚠⚠ STAGE CLASSIFIES, THE DATE ONLY TIMES IT. 163 leads carry a `sold_date`
 * while NOT being in a won stage (99 closed_lost, 55 upsells) — so a sold date is
 * not proof of a sale, and filtering on "has a sold_date" would overcount by 39%.
 * All 413 closed_won leads DO have a sold_date, which is what makes it safe as a
 * window basis. Same finding as the Jobber quotes work: status classifies,
 * timestamps measure timing.
 *
 * ⚠ `p_stages` is a PARAMETER, not a literal, because `tracker_stages` is
 * admin-editable per tenant and its `system_role` column is unused — so there is
 * no stage key this function may safely assume exists. Empty/null = no stage
 * filter at all, which is how a widget asks "how many people ASKED for this".
 *
 * ⚠ Heroes has 'upsells' (57 leads, 55 with a sold date) sitting outside
 * closed_won. An upsell IS a sale, so the widget offers those stages rather than
 * hardcoding a guess about which ones count.
 *
 * Returns RAW service values. Grouping the spellings of one product ("IR- Rachio"
 * and "IR - Rachio" are the same 13 leads typed two ways) happens in the widget,
 * where it is visible and reversible, not silently in here.
 *
 * Service-role only, and PUBLIC is revoked FIRST: a freshly created function
 * carries the default PUBLIC grant, so revoking `authenticated` by name is a
 * no-op. See supabase/2026-08-12_scoreboard_rpc_revoke_authenticated.sql and
 * REPORTS_PRD.md §17 — the API route is the only door, and it checks the grant.
 */

create or replace function public.scoreboard_lead_items(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_basis text default 'sold',
  p_stages text[] default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
with allowed as (
  select public.scoreboard_reports_allowed(p_company_id) ok
),
cfg as (
  select case when lower(coalesce(p_basis, 'sold')) = 'created' then 'created' else 'sold' end basis
),
/* Every lead this company holds, with the basis date resolved once. Used both for
 * the window slice and for the data floor the card reports. */
base as (
  select l.id,
         l.service,
         nullif(btrim(l.salesperson), '') salesperson,
         l.stage,
         case when (select basis from cfg) = 'created' then l.lead_creation_date else l.sold_date end basis_date
  from leads l
  where (select ok from allowed)
    and l.company_id = p_company_id
),
scoped as (
  select * from base
  where basis_date between p_start and p_end
    and (p_stages is null or cardinality(p_stages) = 0 or stage = any(p_stages))
),
/* ⚠ LEFT JOIN LATERAL, not a plain unnest: `service` is text[] and is empty on 36
 * leads. A plain unnest drops those rows entirely, so they would vanish from the
 * coverage counts that exist to say how many leads could not be classified. */
exploded as (
  select s.id, s.salesperson, nullif(btrim(v), '') value
  from scoped s
  left join lateral unnest(s.service) v on true
),
per_item as (
  select value,
         /* Most common spelling of the name, so "Kathryn" and "kathryn" are one
          * person (11 raw values collapse to 10) without the display flipping to
          * whichever sorted first. */
         mode() within group (order by salesperson) salesperson,
         count(distinct id) leads
  from exploded
  where value is not null
  group by value, lower(salesperson)
)
select jsonb_build_object(
  'basis', (select basis from cfg),
  'start', p_start,
  'end', p_end,
  'stages', coalesce(to_jsonb(p_stages), '[]'::jsonb),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'value', value,
             'salesperson', salesperson,
             'leads', leads
           ) order by leads desc, value)
    from per_item
  ), '[]'::jsonb),
  'coverage', jsonb_build_object(
    'leads', (select count(*) from scoped),
    'no_service', (select count(*) from scoped where service is null or cardinality(service) = 0),
    'multi_service', (select count(*) from scoped where cardinality(service) > 1),
    'no_salesperson', (select count(*) from scoped where salesperson is null),
    'earliest', (select min(basis_date) from base),
    'latest', (select max(basis_date) from base)
  )
)
$function$;

revoke all on function public.scoreboard_lead_items(uuid, date, date, text, text[]) from public;
revoke all on function public.scoreboard_lead_items(uuid, date, date, text, text[]) from anon;
revoke all on function public.scoreboard_lead_items(uuid, date, date, text, text[]) from authenticated;
grant execute on function public.scoreboard_lead_items(uuid, date, date, text, text[]) to service_role;
