-- ===========================================================================
-- Commission — upsells become their own basis
-- 2026-08-18
--
-- Ben: "the lead tracker we use Closed Won but there is also an Upsell section.
-- I give a bonus on upsells but it is different then regular sales."
--
-- Two changes, both additive. NO figure moves for any existing rule.
--
--   1. `commission_plans.basis` accepts four new keys, splitting the one sales
--      basis into new-business-only, upsell-only, and the combined figure it
--      already meant.
--   2. `scoreboard_people` passes through the per-person upsell split that
--      `scoreboard_sales.by_salesperson` HAS ALREADY COMPUTED since Aug 17 and
--      simply was not forwarding.
--
-- ⚠⚠ NOTHING IS RECOMPUTED HERE. `scoreboard_sales` already derives `competed_won`
-- (stage = 'closed_won') and `upsold` (stage in the tenant's `counts_as_sale`
-- stages) per salesperson. Re-deriving either one in this function would create a
-- second definition of "what is an upsell" that can drift from the Sales report —
-- the exact failure the commission feature avoids by keying plans on employees.id
-- instead of re-matching names. This migration only widens the JSON.
-- ===========================================================================

-- ── 1. the new bases ────────────────────────────────────────────────────────
-- Drop-and-add rather than a second constraint, so the allowed set stays in one
-- place. The four new keys are additions; the five existing keys are untouched,
-- so no stored row can be invalidated by this.
alter table public.commission_plans
  drop constraint if exists commission_plans_basis_chk;

alter table public.commission_plans
  add constraint commission_plans_basis_chk check (
    basis in (
      'new_sales_value','new_sales_count',   -- Closed Won only
      'upsell_value','upsell_count',         -- the "counts as a sale" stages only
      'sales_value','sales_count',           -- both, which is what these always meant
      'revenue_produced','line_revenue','item_count'
    ));

-- ── 2. forward the upsell split ─────────────────────────────────────────────
-- CREATE OR REPLACE, so the existing ACL survives (this is a SECURITY DEFINER
-- function that must stay service-role only). Re-verified after applying.
create or replace function public.scoreboard_people(p_company_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_crew  jsonb;
  v_sales jsonb;
  v_comms jsonb;
  v_out   jsonb;
begin
  if not public.scoreboard_reports_allowed(p_company_id) then
    return null;
  end if;

  v_crew  := public.scoreboard_crew_labor(p_company_id, p_start, p_end)::jsonb;
  v_sales := public.scoreboard_sales(p_company_id, p_start, p_end)::jsonb;
  v_comms := public.scoreboard_communications(p_company_id, p_start, p_end)::jsonb;

  with crew_people as (
    select (p->>'employee_id')::uuid              as emp_id,
           p->>'department'                       as dept,
           (p->>'hours')::numeric                 as hours,
           nullif(p->>'revenue','')::numeric      as revenue,
           nullif(p->>'rev_per_hour','')::numeric as rph,
           (p->>'rankable')::boolean              as rankable,
           (p->>'attributable')::boolean          as attributable
    from jsonb_array_elements(coalesce(v_crew->'people', '[]'::jsonb)) p
  ),
  roster as (
    select e.id as emp_id,
           e.user_id,
           e.is_active,
           coalesce(e.is_field_labor, false) as is_field,
           coalesce(nullif(hu.display_name,''), nullif(e.preferred_name,''),
                    e.first_name, 'Unknown')  as disp,
           lower(split_part(coalesce(nullif(hu.display_name,''), nullif(e.preferred_name,''),
                                     e.first_name, ''), ' ', 1)) as fkey
    from employees e
    left join hub_users hu on hu.id = e.user_id
    where e.company_id = p_company_id
  ),
  -- A first name must identify exactly one person or we refuse to attribute.
  fkey_counts as (
    select fkey, count(*) n from roster where fkey <> '' group by 1
  ),
  sales_rows as (
    select lower(trim(s->>'name'))          as skey,
           s->>'name'                       as sname,
           (s->>'leads')::int               as leads,
           (s->>'won')::int                 as won,
           (s->>'competed_won')::int        as competed_won,
           (s->>'upsold')::int              as upsold,
           (s->>'decided')::int             as decided,
           nullif(s->>'close_rate','')::numeric as close_rate,
           (s->>'value')::numeric           as value,
           (s->>'upsold_value')::numeric    as upsold_value
    from jsonb_array_elements(coalesce(v_sales->'by_salesperson', '[]'::jsonb)) s
  ),
  phone as (
    select coalesce(c.transferred_to_user_id, c.handled_by) as uid,
           count(*) filter (
             where c.direction = 'inbound' and c.answered_at is not null and not c.handled_by_ai
           ) as answered,
           count(*) filter (where c.direction = 'outbound') as placed,
           percentile_cont(0.5) within group (
             order by extract(epoch from (c.answered_at - c.created_at))
           ) filter (
             where c.direction = 'inbound' and c.answered_at is not null and not c.handled_by_ai
               and c.answered_at >= c.created_at
               and c.answered_at - c.created_at < interval '10 minutes'
           ) as med
    from calls c
    where c.company_id = p_company_id
      and (c.created_at at time zone 'America/Chicago')::date between p_start and p_end
      and coalesce(c.transferred_to_user_id, c.handled_by) is not null
    group by 1
  ),
  texts as (
    select m.sent_by as uid, count(*) as sent
    from txt_messages m
    where m.company_id = p_company_id
      and m.direction = 'outbound'
      and m.sent_by is not null
      and (m.created_at at time zone 'America/Chicago')::date between p_start and p_end
    group by 1
  ),
  people as (
    select r.emp_id, r.user_id, r.disp, r.is_active, r.is_field,
           cp.dept, cp.hours, cp.revenue, cp.rph, cp.rankable, cp.attributable,
           sr.leads, sr.won, sr.competed_won, sr.upsold, sr.decided, sr.close_rate,
           sr.value as sold, sr.upsold_value,
           ph.answered, ph.placed, ph.med, tx.sent
    from roster r
    left join crew_people cp on cp.emp_id = r.emp_id
    left join fkey_counts  fc on fc.fkey  = r.fkey
    left join sales_rows   sr on sr.skey  = r.fkey and coalesce(fc.n, 0) = 1
    left join phone        ph on ph.uid   = r.user_id
    left join texts        tx on tx.uid   = r.user_id
    -- Departed staff stay in when they have activity in the window: history
    -- does not change because someone left.
    where r.is_active
       or cp.emp_id is not null or sr.skey is not null
       or ph.uid is not null or tx.uid is not null
  ),
  depts as (
    select cp.dept as department,
           count(*)                                  as people,
           round(sum(cp.hours), 1)                   as hours,
           round(sum(coalesce(cp.revenue, 0)), 2)    as revenue,
           case when sum(cp.hours) > 0
                then round(sum(coalesce(cp.revenue, 0)) / sum(cp.hours), 2) end as rev_per_hour
    from crew_people cp
    where cp.dept is not null
    group by 1
  ),
  unmatched as (
    select sr.sname, sr.leads, sr.won, sr.value
    from sales_rows sr
    left join fkey_counts fc on fc.fkey = sr.skey
    where fc.fkey is null or fc.n > 1
  )
  select jsonb_build_object(
    'coverage', v_crew->'coverage',
    'rate_min_sample', coalesce((v_sales->>'rate_min_sample')::int, 10),
    -- ⚠ Forwarded so a card paying on upsells can say "no stage is ticked as Sold"
    -- instead of rendering a $0 that reads as "they sold nothing".
    'sale_stages', coalesce(v_sales->'sale_stages', '[]'::jsonb),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id',        p.user_id,
        'employee_id',    p.emp_id,
        'name',           p.disp,
        'department',     p.dept,
        'is_active',      p.is_active,
        'is_field_labor', p.is_field,
        'sales', jsonb_build_object(
          'leads',      coalesce(p.leads, 0),
          'won',        coalesce(p.won, 0),
          -- Closed Won alone, and the "counts as a sale" stages alone. Both come
          -- straight from scoreboard_sales; neither is re-derived here.
          'competed_won', coalesce(p.competed_won, 0),
          'upsold',       coalesce(p.upsold, 0),
          'decided',    coalesce(p.decided, 0),
          'close_rate', p.close_rate,
          'sold_value', coalesce(p.sold, 0),
          'upsold_value', coalesce(p.upsold_value, 0),
          'avg_deal',   case when coalesce(p.won, 0) > 0 then round(p.sold / p.won, 2) end
        ),
        'field', jsonb_build_object(
          'hours',        coalesce(p.hours, 0),
          'revenue',      p.revenue,
          'rev_per_hour', p.rph,
          'rankable',     coalesce(p.rankable, false),
          'attributable', coalesce(p.attributable, false)
        ),
        'phone', jsonb_build_object(
          'calls_answered',    coalesce(p.answered, 0),
          'calls_placed',      coalesce(p.placed, 0),
          'median_answer_sec', round(p.med::numeric, 1),
          'texts_sent',        coalesce(p.sent, 0)
        )
      ) order by coalesce(p.sold, 0) + coalesce(p.revenue, 0) desc), '[]'::jsonb)
      from people p
    ),
    'departments', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.revenue desc), '[]'::jsonb) from depts d
    ),
    -- Office-level phone outcomes. The answer RATE belongs here and nowhere else.
    'office', jsonb_build_object(
      'inbound_calls',     v_comms->'inbound_calls',
      'missed',            v_comms->'missed',
      'missed_pct',        v_comms->'missed_pct',
      'median_answer_sec', v_comms->'median_answer_sec',
      'texts_in',          v_comms->'texts_in',
      'texts_out',         v_comms->'texts_out',
      'median_reply_sec',  v_comms->'median_reply_sec'
    ),
    'unmatched_sales', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', u.sname, 'leads', u.leads, 'won', u.won, 'sold_value', u.value
      ) order by u.leads desc), '[]'::jsonb) from unmatched u
    )
  ) into v_out;

  return v_out;
end
$function$;

-- Rollback: restore the previous constraint (the five original keys) and re-apply
-- the previous function body from git. No data is written by this migration, so
-- nothing needs snapshotting — but a rule already SAVED on a new basis would fail
-- the narrower constraint, so delete those rows first if rolling back.
