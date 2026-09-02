/* Commission engine: unclipped production, bonus weeks, and a verified spiff.
 *
 * Three wrong behaviours, one migration. Every new column defaults to what the engine
 * already did, so applying this file on its own moves NO money — the two rules that
 * change are re-pointed by the explicit UPDATEs at the bottom, and nothing else on
 * any plan shifts.
 *
 * ⚠⚠ THE DATABASE IS SHARED BY PROD AND STAGING. That makes the ordering here matter:
 * the two new/changed functions are ADDITIVE (a brand-new RPC nothing calls yet, and
 * one extra key on an existing one), and the new columns are defaulted, so this file
 * is safe to apply BEFORE the code that reads it is deployed anywhere. The plan
 * UPDATEs at the bottom are inert under the old engine too — it does not read `period`,
 * `tier_mode` or `verify_source` at all — so they cannot half-apply a change.
 *
 * ── 1. Produced revenue was clipped by payroll ───────────────────────────────
 * `scoreboard_crew_labor` narrows its window to where timeclock AND processed payroll
 * both exist, because it divides revenue by hours and prices hours from real payroll.
 * For a RATIO that is right. For "revenue they produced" it is a silent underpayment:
 * `payroll_periods` reaches 2026-08-16 while `time_entries` reaches 2026-09-01, so
 * Josh's August production read $7,549 against the $12,140 he actually produced.
 *
 * The fix is NOT to unclamp `crew_labor` — that function feeds the Crew & Labor report
 * and five other card groups, and widening it would move figures nobody asked to move.
 * A new, deliberately narrow function computes production and hours with no payroll
 * dependency at all, and the commission engine reads THAT for the two production
 * bases. `crew_labor` keeps serving labour-cost % and the company ratios, which
 * legitimately need processed payroll.
 *
 * ⚠⚠ REVENUE IS DATED BY `scheduled_date`, NOT `completed_at`, and this reproduces
 * Ben's own weekly figures to the cent where `completed_at` does not. A visit is a
 * day's work on a route; `completed_at` is when somebody tapped Complete, which can
 * be the next morning — and at a Monday week boundary that moves the money into the
 * wrong bonus week. Measured on Josh's August: by `completed_at` the four weeks read
 * 4019.03 / 3512.25 / 3896.08 / 2463.90, by `scheduled_date` 4019.03 / 4862.25 /
 * 3188.08 / 1821.90. The second set is the one Ben's plan is written against. The
 * totals are identical — only the week each dollar lands in differs.
 *
 * ⚠⚠ A MULTI-TECH VISIT IS SPLIT EVENLY, not credited whole to each tech. Every
 * technician-facing board credits the full value to both, which is why the commission
 * card has always carried a "runs about 3.8% above what the company produced" warning.
 * Paying a percentage on a figure known to be inflated is a real overpayment, so this
 * function divides by `array_length(tech_external_user_ids, 1)` and the warning is
 * retired for production rules. Josh's August: $13,374 credited-each vs $12,140 split.
 *
 * ⚠ `visits.total` and `visits.subtotal` are NULL throughout this book — revenue is
 * only ever SUM(line_items.total) over the visit's own lines.
 *
 * ── 2. Tiered rules were monthly and marginal only ──────────────────────────
 * Two columns, both defaulted to the old behaviour:
 *   period     'month' | 'commission_weeks' | 'week'   default 'month'
 *   tier_mode  'marginal' | 'flat'                     default 'marginal'
 * The bonus weeks themselves are computed in TypeScript and PASSED IN as buckets —
 * see lib/scoreboards/widgets/windows.ts. There is deliberately no week arithmetic in
 * this file: a second definition that drifted by one day would move real money and
 * reconcile against nothing.
 *
 * ── 3. The Gold spiff paid off a tracker row with no invoice check ──────────
 * `item_count` counted `leads` rows by service and sold date alone, which paid twice
 * for things that were not sales: a Gold plan recurs annually (11 $400 Gold invoices
 * issued in Aug 2026, 9 of them renewals by this book's own evidence), and a mis-keyed
 * tracker row paid Lucas $30 for a Kassy Brock "IR - Gold $400" dated 2026-08-11 whose
 * real Gold was invoice 4406, issued 2026-04-23 and already paid to another rep.
 *
 * `scoreboard_lead_items` gains a `units` key: one row per (tracker row × service
 * value) carrying the invoice evidence for that unit. The existing `rows` aggregate is
 * untouched, so the tracked-item cards, the clone planner, the catalog route and the
 * commission editor all keep reading exactly what they read today.
 *
 * ⚠⚠ RENEWAL HISTORY IS CHECKED ON VISIT LINE ITEMS AS WELL AS INVOICE ONES, and
 * checking only invoices would have missed nine of the ten renewals. The invoice
 * mirror starts 2026-01-02, so a member who renewed in August has no prior Gold
 * INVOICE in it — but their included member visits ($0 "IR - Irrigation Service Call
 * Gold" lines) are right there on the visits. Of the 11 qualifying August invoices,
 * checking invoices alone finds 2 renewals; adding visit lines finds 9.
 *
 * ⚠ The match pattern comes from the SERVICE VALUE on the tracker row, not from the
 * plan's `items` list, so this function needs no per-plan parameter and the resolver
 * can keep deduping one query per board. 'IR - Gold' folds to the token pattern
 * '%ir%gold%', which reaches "IR - Irrigation Service Plan Gold" and its "- T1"
 * variant. ⚠⚠ The "- T1" suffix is NOT the discriminator — invoice 5847, the one real
 * August sale, is a "- T1" line at $400 while a $100 "- T1" is a single prepaid visit.
 * PRICE is what separates a sale from a member visit, which is why `min_price` exists.
 *
 * ── 4. Rules were undated ───────────────────────────────────────────────────
 * `effective_from` / `effective_to`, both null on every existing row, meaning "applies
 * to every period" — which is what an undated rule already meant. With them, a rate
 * change stops rewriting months already paid.
 *
 * ROLLBACK: `alter table commission_plans drop column …` for the seven new columns;
 * `drop function scoreboard_commission_production(uuid,date,date,text)`; and re-run
 * the pre-existing `scoreboard_lead_items` body to drop the `units` key. The two plan
 * UPDATEs are reverted by setting Josh's plan back to period='month',
 * tier_mode='marginal' and both Gold plans back to verify_source=null, min_price=null,
 * exclude_renewals=false. ⚠ Reverting the SQL alone is not enough — the engine code
 * must be reverted in the same deploy, or `revenue_produced` rules will read null from
 * a function that no longer exists and pay zero.
 */

-- ── 1. The plan columns ──────────────────────────────────────────────────────

alter table public.commission_plans
  add column if not exists period           text    not null default 'month',
  add column if not exists tier_mode        text    not null default 'marginal',
  add column if not exists verify_source    text             default null,
  add column if not exists min_price        numeric          default null,
  add column if not exists exclude_renewals boolean not null default false,
  add column if not exists effective_from   date             default null,
  add column if not exists effective_to     date             default null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commission_plans_period_chk') then
    alter table public.commission_plans add constraint commission_plans_period_chk
      check (period in ('month','commission_weeks','week'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_plans_tier_mode_chk') then
    alter table public.commission_plans add constraint commission_plans_tier_mode_chk
      check (tier_mode in ('marginal','flat'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_plans_verify_chk') then
    alter table public.commission_plans add constraint commission_plans_verify_chk
      check (verify_source is null or verify_source in ('invoice'));
  end if;
  -- ⚠ A price floor with nothing to verify against is a field that does nothing. Say
  -- so at write time rather than letting a rule look stricter than it is.
  if not exists (select 1 from pg_constraint where conname = 'commission_plans_minprice_chk') then
    alter table public.commission_plans add constraint commission_plans_minprice_chk
      check (min_price is null or verify_source is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_plans_effective_chk') then
    alter table public.commission_plans add constraint commission_plans_effective_chk
      check (effective_from is null or effective_to is null or effective_from <= effective_to);
  end if;
end $$;

comment on column public.commission_plans.period is
  'month = the window as asked for (default, and what every rule meant before this existed); commission_weeks = W1-W4 summed as one window; week = each of W1-W4 judged separately and summed. Bonus weeks are computed in lib/scoreboards/widgets/windows.ts and passed to scoreboard_commission_production as buckets.';
comment on column public.commission_plans.tier_mode is
  'marginal (default) = each band pays only on the slice above its floor; flat = the band reached pays its rate on the whole figure.';
comment on column public.commission_plans.verify_source is
  'null (default) = a counted unit is the Lead Tracker row alone; invoice = the unit must be backed by a matching invoice line in the period.';
comment on column public.commission_plans.exclude_renewals is
  'With verify_source, drops a unit whose customer already had this item before the period start - checked against BOTH invoice and visit line items, because the invoice mirror only reaches 2026-01-02.';


-- ── 2. Production and hours, with no payroll dependency ──────────────────────

create or replace function public.scoreboard_commission_production(
  p_company_id uuid,
  p_start date,
  p_end date,
  /* Extra sub-periods to total separately, as 'KEY:start:end,KEY:start:end'.
   * ⚠ Supplied by the caller rather than derived here — see the header note. Empty or
   * null is fine; then only the window totals come back. */
  p_buckets text default null
)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  buckets as (
    select split_part(t, ':', 1) as k,
           split_part(t, ':', 2)::date as s,
           split_part(t, ':', 3)::date as e,
           ord
    from unnest(string_to_array(coalesce(nullif(btrim(p_buckets), ''), ''), ',')) with ordinality as u(t, ord)
    where t <> '' and split_part(t, ':', 2) <> '' and split_part(t, ':', 3) <> ''
  ),
  /* The span actually worth scanning: the requested window plus any bucket that
   * reaches outside it. Bonus week W1 starts in the PREVIOUS month, so a board asking
   * for Aug 1-31 still needs Jul 27 onward. */
  span as (
    select least(p_start, coalesce((select min(s) from buckets), p_start)) as s,
           greatest(p_end, coalesce((select max(e) from buckets), p_end)) as e
  ),
  /* ⚠ The roster mapped to Jobber, resolved the SAME WAY `scoreboard_crew_labor`
   * resolves it — last name plus first-or-preferred, most-recently-active first. Two
   * different name matchers would credit a visit to one person on one card and nobody
   * on the next, which in a pay feature is the worst kind of disagreement. Josh Allen
   * is already in `jobber_users`, so no alias shim is needed. */
  roster as (
    select e.id as employee_id,
      (select ju.external_id from jobber_users ju
        where ju.company_id = e.company_id and ju.name ilike '%' || e.last_name || '%'
          and (ju.name ilike '%' || e.first_name || '%'
               or (nullif(e.preferred_name,'') is not null and ju.name ilike '%' || e.preferred_name || '%'))
        order by ju.is_active desc nulls last, ju.external_id limit 1) as jobber_id
    from employees e
    where e.company_id = p_company_id
  ),
  /* Completed visits and their own line-item revenue, split evenly across the techs
   * on the visit. ⚠ `visits.total`/`subtotal` are NULL on this book and are never
   * read; ⚠ joined on `parent_id`, the real FK. */
  vis as (
    select v.id, v.scheduled_date as d, v.tech_external_user_ids as techs,
           coalesce((select sum(li.total) from line_items li
                      where li.parent_type = 'visit' and li.parent_id = v.id
                        and li.deleted_at is null), 0)
             / nullif(array_length(v.tech_external_user_ids, 1), 0) as share
    from visits v, span
    where v.company_id = p_company_id
      and v.deleted_at is null
      and v.visit_status = 'COMPLETED'
      and v.scheduled_date between span.s and span.e
      and array_length(v.tech_external_user_ids, 1) > 0
  ),
  tech_day as (
    select t.tid, v.d, sum(v.share) amt
    from vis v cross join lateral unnest(v.techs) t(tid)
    where v.share is not null
    group by 1, 2
  ),
  /* ⚠⚠ HOURS COME STRAIGHT FROM `time_entries`, WHICH IS THE ENTIRE POINT OF THIS
   * FUNCTION. `total_hours` is the raw daily total; `overtime_hours` here is 0 on most
   * rows because the regular/OT split is only made when payroll is processed, and
   * waiting for that split is exactly the clip being fixed. A rate over raw hours is
   * the right rate; a rate over the 16 days payroll happens to have processed is not. */
  emp_day as (
    select te.employee_id, te.date as d, sum(te.total_hours) hours
    from time_entries te, span
    where te.company_id = p_company_id
      and te.total_hours > 0
      and te.date between span.s and span.e
    group by 1, 2
  ),
  /* The bucket span as ONE range — W1's first day to W4's last.
   *
   * ⚠⚠ EXISTS SO A WHOLE-PERIOD FIGURE IS NEVER BUILT BY ADDING ROUNDED SUB-TOTALS.
   * Summing the four rounded weeks gave $14,906.91 where the true total is $14,906.90:
   * harmless in that instance, but a rate is a division and a total assembled from
   * rounded parts is the wrong numerator by construction. A `commission_weeks` rule
   * reads THIS, not the sum of the buckets. */
  bucket_span as (
    select min(s) as s, max(e) as e from buckets
  ),
  win as (
    select r.employee_id, r.jobber_id,
      coalesce((select round(sum(td.amt), 2) from tech_day td
                 where td.tid = r.jobber_id and td.d between p_start and p_end), 0) as revenue,
      coalesce((select round(sum(ed.hours), 2) from emp_day ed
                 where ed.employee_id = r.employee_id and ed.d between p_start and p_end), 0) as hours,
      coalesce((select round(sum(td.amt), 2) from tech_day td, bucket_span bs
                 where td.tid = r.jobber_id and td.d between bs.s and bs.e), 0) as weeks_revenue,
      coalesce((select round(sum(ed.hours), 2) from emp_day ed, bucket_span bs
                 where ed.employee_id = r.employee_id and ed.d between bs.s and bs.e), 0) as weeks_hours
    from roster r
  ),
  per_bucket as (
    select r.employee_id, b.ord, b.k,
      coalesce((select round(sum(td.amt), 2) from tech_day td
                 where td.tid = r.jobber_id and td.d between b.s and b.e), 0) as revenue,
      coalesce((select round(sum(ed.hours), 2) from emp_day ed
                 where ed.employee_id = r.employee_id and ed.d between b.s and b.e), 0) as hours,
      b.s, b.e
    from roster r cross join buckets b
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'coverage', jsonb_build_object(
      'requested_start', p_start,
      'requested_end', p_end,
      -- Named so a card can say what it measured rather than implying a full month.
      'timeclock_first', (select min(d) from emp_day),
      'timeclock_last', (select max(d) from emp_day),
      'revenue_dated_by', 'scheduled_date',
      'tech_credit', 'split',
      /* ⚠ Deliberately reported and deliberately NOT acted on. This function does not
       * clip, so a caller can say "the last N days have no timeclock data yet" without
       * the window silently shrinking underneath the number. */
      'buckets', (select count(*) from buckets)
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id', w.employee_id,
        'attributable', (w.jobber_id is not null),
        'revenue', w.revenue,
        'hours', w.hours,
        'rev_per_hour', case when w.hours > 0 then round(w.revenue / w.hours, 2) end,
        /* The four bonus weeks as one figure — see `bucket_span`. Null when no buckets
         * were asked for, so a caller cannot mistake "not requested" for zero. */
        'weeks_revenue', case when (select count(*) from buckets) > 0 then w.weeks_revenue end,
        'weeks_hours', case when (select count(*) from buckets) > 0 then w.weeks_hours end,
        'weeks_rev_per_hour', case when w.weeks_hours > 0 then round(w.weeks_revenue / w.weeks_hours, 2) end,
        'buckets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'k', pb.k, 'start', pb.s, 'end', pb.e,
            'revenue', pb.revenue, 'hours', pb.hours,
            'rev_per_hour', case when pb.hours > 0 then round(pb.revenue / pb.hours, 2) end
          ) order by pb.ord)
          from per_bucket pb where pb.employee_id = w.employee_id), '[]'::jsonb)
      ))
      from win w), '[]'::jsonb)
  ) end;
$function$;

/* ⚠⚠ SERVICE ROLE ONLY, matching every other scoreboard_* function. These are the
 * figures a bonus is paid on; `authenticated` must not be able to call it directly and
 * bypass the Crew & Labor grant the widgets answer to. */
revoke all on function public.scoreboard_commission_production(uuid,date,date,text) from public;
revoke all on function public.scoreboard_commission_production(uuid,date,date,text) from anon;
revoke all on function public.scoreboard_commission_production(uuid,date,date,text) from authenticated;
grant execute on function public.scoreboard_commission_production(uuid,date,date,text) to service_role;


-- ── 3. Per-unit invoice evidence on scoreboard_lead_items ────────────────────
--
-- ⚠ ADDITIVE. `rows`, `basis`, `start`, `end`, `stages` and `coverage` are byte-for-
-- byte what they were; only `units` is new. The four existing callers (the tracked-
-- item widgets, the clone planner, the catalogs route and the commission editor) read
-- `rows` and are unaffected.

create or replace function public.scoreboard_lead_items(
  p_company_id uuid, p_start date, p_end date,
  p_basis text default 'sold'::text, p_stages text[] default null::text[]
)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
with allowed as (
  select public.scoreboard_reports_allowed(p_company_id) ok
),
cfg as (
  select case when lower(coalesce(p_basis, 'sold')) = 'created' then 'created' else 'sold' end basis
),
base as (
  select l.id,
         l.service,
         nullif(btrim(l.salesperson), '') salesperson,
         l.stage,
         l.first_name, l.last_name,
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
exploded as (
  select s.id, s.salesperson, s.first_name, s.last_name, s.basis_date,
         nullif(btrim(v), '') value
  from scoped s
  left join lateral unnest(s.service) v on true
),
per_item as (
  select value,
         mode() within group (order by salesperson) salesperson,
         count(distinct id) leads
  from exploded
  where value is not null
  group by value, lower(salesperson)
),
/* ── the per-unit half ──────────────────────────────────────────────────────
 * One row per (tracker row x service value), carrying the invoice evidence for that
 * one unit. Only built for rows that can be tied to a customer file, because the
 * evidence is an invoice and invoices hang off `clients`.
 *
 * ⚠ `leads` carries NO client id — only a name, phone and email. Matched here on the
 * whitespace-collapsed, lower-cased FULL NAME and nothing else. Phone/email matching
 * is deliberately refused: three Heroes customers share an email address, so a
 * "helpful" match would corroborate one person's spiff with another person's invoice.
 * All four of August 2026's Gold rows match exactly on name.
 */
units_base as (
  select e.id, e.value, e.salesperson, e.basis_date,
    lower(regexp_replace(btrim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')), '\s+', ' ', 'g')) as lead_key,
    /* The token pattern for this service value: fold the dash forms the tracker
     * spells inconsistently, split on dashes and spaces, require every token in
     * order. 'IR - Gold' -> '%ir%gold%'. ⚠ Same fold as `itemKey` in the widget, so
     * "IR- Gold" and "IR - Gold" cannot disagree about what they match. */
    '%' || array_to_string(
      (select array_agg(t) from unnest(regexp_split_to_array(
          lower(regexp_replace(e.value, '\s*[-–—/]\s*', '-', 'g')), '[-\s]+')) t
        where t <> ''), '%') || '%' as pat
  from exploded e
  where e.value is not null
),
/* The customer files, keyed by collapsed lower-case name, ONE row per name.
 * ⚠ `distinct on` rather than a correlated `limit 1` per unit: same answer, one scan.
 * Ordered by id so a duplicated customer name resolves the same way every time. */
cli as (
  select distinct on (lower(regexp_replace(c.name, '\s+', ' ', 'g')))
         lower(regexp_replace(c.name, '\s+', ' ', 'g')) as k, c.id
  from clients c
  where c.company_id = p_company_id
  order by 1, c.id
),
units_client as (
  select ub.*, cl.id as client_id
  from units_base ub
  left join cli cl on cl.k = ub.lead_key
),
/* ⚠⚠ THE EVIDENCE IS GATHERED PER (ITEM PATTERN, CUSTOMER), NOT PER UNIT, AND THAT IS
 * A PERFORMANCE DECISION WITH A MEASUREMENT BEHIND IT. Written the obvious way — four
 * correlated subqueries hanging off each unit — this function took **16.4 seconds** on
 * the 1900→2999 window that Admin → Reports, the catalogs route and the clone planner
 * all ask for, because `name ILIKE '%a%b%'` cannot use an index and was therefore
 * re-scanning `line_items` 877 times. Aggregating over the ~80 DISTINCT service values
 * instead brings the same window to **0.8s**. That is not a nicety: this project has
 * already put an 8.5s statement timeout on a report once.
 *
 * ⚠ Verified equivalent to the per-unit form before replacing it — 662 units across
 * 2026 and 117 across August, zero differences in price or in renewal history, with
 * the visit-history branch exercised (7 units carry prior history in August).
 *
 * ⚠ `issued_date <= p_end` is the only date bound on the join: invoices IN the period
 * give the price, invoices BEFORE it give the renewal history, and anything after the
 * period end is irrelevant to both.
 */
pats as (select distinct pat from units_base),
inv_ev as (
  select p.pat, i.client_id,
    max(li.unit_price) filter (where i.issued_date between p_start and p_end) as price,
    (array_agg(i.invoice_number order by li.unit_price desc nulls last, i.issued_date)
       filter (where i.issued_date between p_start and p_end))[1] as inv_no,
    bool_or(i.issued_date < p_start) as prior
  from pats p
  join line_items li
    on li.parent_type = 'invoice' and li.company_id = p_company_id
   and li.deleted_at is null and li.name ilike p.pat
  join invoices i
    on i.id = li.parent_id and i.deleted_at is null and i.issued_date <= p_end
  group by p.pat, i.client_id
),
/* ⚠⚠ VISIT LINES ARE A SECOND SOURCE OF RENEWAL HISTORY, and without them this check
 * misses most renewals. The invoice mirror starts 2026-01-02, so a Gold member who
 * renewed in August has no prior Gold INVOICE in it — but their included member visits
 * ($0 "IR - Irrigation Service Call Gold" lines) sit on the visits. Of the 11
 * qualifying August invoices, invoices alone identify 2 renewals; with visit lines, 9. */
vis_ev as (
  select distinct p.pat, v.client_id
  from pats p
  join line_items li
    on li.parent_type = 'visit' and li.company_id = p_company_id
   and li.deleted_at is null and li.name ilike p.pat
  join visits v
    on v.id = li.parent_id and v.deleted_at is null and v.scheduled_date < p_start
),
units as (
  select uc.id, uc.value, uc.salesperson, uc.lead_key, uc.basis_date, uc.client_id,
         ie.price, ie.inv_no,
         (coalesce(ie.prior, false) or ve.client_id is not null) as prior_history
  from units_client uc
  left join inv_ev ie on ie.pat = uc.pat and ie.client_id = uc.client_id
  left join vis_ev ve on ve.pat = uc.pat and ve.client_id = uc.client_id
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
  /* ⚠⚠ NEW. Every unit, with its evidence — never pre-filtered by a price floor,
   * because the floor lives on the PLAN and two plans on one board can name different
   * ones. The widget decides; this function only reports what is true. */
  'units', coalesce((
    select jsonb_agg(jsonb_build_object(
      'lead_id', u.id,
      'value', u.value,
      'salesperson', u.salesperson,
      'client', u.lead_key,
      'sold_date', u.basis_date,
      'matched_client', (u.client_id is not null),
      -- The best price on a matching invoice line issued in the period, and which
      -- invoice it came from. NULL means no invoice backs this unit at all.
      'invoice_price', u.price,
      'invoice_number', u.inv_no,
      'prior_history', u.prior_history
    ) order by u.basis_date, u.value)
    from units u
  ), '[]'::jsonb),
  'coverage', jsonb_build_object(
    'leads', (select count(*) from scoped),
    'no_service', (select count(*) from scoped where service is null or cardinality(service) = 0),
    'multi_service', (select count(*) from scoped where cardinality(service) > 1),
    'no_salesperson', (select count(*) from scoped where salesperson is null),
    -- ⚠ New, and load-bearing for the verified spiff: a unit whose customer file could
    -- not be found can never be corroborated, so the card has to be able to name them
    -- rather than paying zero and looking like nobody sold anything.
    'unmatched_clients', (select count(*) from units where client_id is null),
    'earliest', (select min(basis_date) from base),
    'latest', (select max(basis_date) from base)
  )
)
$function$;

-- ⚠ Re-asserted after CREATE OR REPLACE: replacing a function can reset its ACL, and
-- this one reads the whole Lead Tracker plus invoice prices.
revoke all on function public.scoreboard_lead_items(uuid,date,date,text,text[]) from public;
revoke all on function public.scoreboard_lead_items(uuid,date,date,text,text[]) from anon;
revoke all on function public.scoreboard_lead_items(uuid,date,date,text,text[]) from authenticated;
grant execute on function public.scoreboard_lead_items(uuid,date,date,text,text[]) to service_role;


-- ── 4. Re-point the two rules that are wrong, and only those two ─────────────
--
-- ⚠ Scoped by id AND company_id AND the basis/rate_kind they are expected to have, so
-- a re-run cannot touch a row that has since been edited into something else. Every
-- other plan keeps the defaults set above, which are its current behaviour.

-- Josh Allen, "Personal Production": per bonus week, band reached pays on the whole
-- week. Verified against Ben's own figures: W1 $4,019.03 @ 0.25% = $10.05,
-- W2 $4,862.25 @ 0.50% = $24.31, W3 $3,188.08 and W4 $1,821.90 both under $4,000 and
-- therefore $0 — $34.36 for August 2026, against $29.49 read monthly-and-marginal.
update public.commission_plans
   set period = 'week', tier_mode = 'flat', updated_at = now()
 where id = '60118ca7-8984-4b7b-aed6-ab904b6a50ff'
   and company_id = '00000000-0000-0000-0000-000000000002'
   and employee_id = 'fbd877c4-35e7-4c30-8e60-176df3a83385'
   and basis = 'revenue_produced' and rate_kind = 'tiered';

-- Lucas Hernandez, "Revenue Per Hour": ONE monthly rate, but measured over the bonus
-- weeks rather than the calendar month. `period` stays a single calculation — his rule
-- is total revenue / total hours, not a per-week rate. W1-W4: $14,906.90 / 201.48 hrs
-- = $73.99/hr, still short of the $85 floor, so $0 — but $0 for the right reason and
-- off the right figure, where the clipped window read $62.01.
update public.commission_plans
   set period = 'commission_weeks', updated_at = now()
 where id = 'e1320665-c725-4abd-bf82-0bedd25a34f4'
   and company_id = '00000000-0000-0000-0000-000000000002'
   and employee_id = '22a0aa46-ed44-45f2-88d2-9a19949c65bd'
   and basis = 'rev_per_hour' and rate_kind = 'target_tiered';

-- Both Gold spiffs: a unit needs a real invoice of at least $390, and a customer who
-- did not already have Gold. $390 rather than $400 because the plan is sometimes
-- invoiced at a small discount, while the things that must NOT count are a $250.20
-- prorated plan, a $205 part-year plan, a $100 single prepaid visit and a $0 included
-- member visit. ⚠ Price, not the "- T1" suffix, is the discriminator: August's one
-- real sale (invoice 5847, David E Parker) is itself a "- T1" line at $400.
update public.commission_plans
   set verify_source = 'invoice', min_price = 390, exclude_renewals = true, updated_at = now()
 where id in ('e82f476a-2c9e-4cea-b9d2-cfd0e6d4da74',   -- Josh Allen, Gold Sales
              '5711aea6-e029-4f84-bb40-0f701f7ae390')   -- Lucas Hernandez, Gold Sales
   and company_id = '00000000-0000-0000-0000-000000000002'
   and basis = 'item_count';
