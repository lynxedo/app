-- The channel scorecard: what each marketing dollar is actually buying
--
-- Ben, Aug 24 2026: *"Think like a business owner that is wanting to track where his
-- marketing dollars are going. We spend X amount of dollars on Google. What is that X
-- dollars getting us? How many customers/jobs? How much revenue? Close rate? How does
-- Google compare to Angi."*
--
-- ⚠⚠ WHY THE EXISTING MARKETING CARDS COULD NOT ANSWER THIS. Nine of the ten read
-- `scoreboard_source_scorecard_range`, whose universe is `recurring_services` — people
-- who signed a RECURRING PROGRAM. One-off work (repairs, installs, service calls) is
-- not in that universe at all, so the cards silently answer a much narrower question
-- than the one being asked. Measured Jan–Aug 2026 on Google alone: 13 new recurring
-- signups, but 165 Tracker leads, 142 invoiced customers and $118,983 billed — and
-- 49% of that revenue came from customers with NO recurring program. Ben: *"the 13 is
-- not suppose to be just new Recurring customers by source. They should be new JOBS by
-- source. Every time they appear in the lead tracker, it counts."*
--
-- So this function counts JOBS from the Lead Tracker and DOLLARS from Jobber, which is
-- also Ben's instruction: *"you prob need to get revenue from Jobber since IR SVC
-- revenue is not logged into the tracker."* The Tracker's own `annual_value` is a
-- programme value, not billings — for Google it reads $35,728 against $118,983 actually
-- invoiced, so using it would understate the channel by 70%.
--
-- ⚠⚠ THE SOURCE IS NORMALISED, WHICH THE EXISTING CLOSE-RATE CARD FAILED TO DO. Raw
-- `leads.lead_source` is free text and Heroes has it spelled several ways: "Angi Leads"
-- (108) AND "Angi Lead" (28) — 21% of Angi's 2026 leads in a second bucket — plus
-- Google split across "Google (GBP / LSA)" (163), "Google" (1) and "GLSA" (1), and
-- "Referral" apart from "Customer Referral". Every count here runs through
-- `churn_normalize_source` so a channel is one row.
--
-- ⚠ CLOSE RATE DELIBERATELY EXCLUDES UPSELL-TYPE STAGES, matching the rule already
-- documented in Help and in the Sales report: a close rate is how often you win the
-- deals you COMPETED for, and an upsell to an existing customer was never in
-- competition. `closed_won / (closed_won + closed_lost)`. Stages ticked
-- `counts_as_sale` are returned separately as `sold_other` so they can be shown
-- without ever moving the rate.
--
-- ⚠ REVENUE USES THE SAME CREDIT RULE AS `scoreboard_revenue_by_source`, and the
-- default is the same ('acquisition'). Note the deliberate asymmetry: LEADS are always
-- counted under the lead's OWN source, while REVENUE is credited to the customer's
-- acquisition channel. That is what a marketing owner wants — Google keeps credit for
-- revenue it is still producing, while a repeat call shows up as this period's job
-- activity — but it means leads and revenue on one row can describe different people,
-- and `revenue_per_lead` is therefore a channel-efficiency indicator rather than an
-- arithmetic per-lead average. Said plainly here because the number invites the
-- stricter reading.
--
-- ⚠ SPEND IS HAND-ENTERED AND MAY SIMPLY NOT EXIST. There is no ad-spend feed anywhere
-- in the platform, so cost-per-lead / cost-per-customer / ROAS are NULL until somebody
-- fills the table in. NULL is returned rather than 0 precisely so the card can say
-- "no spend recorded" instead of drawing a channel as infinitely efficient — a 0 in a
-- denominator here would rank the channels you spend nothing on as the best ones.

/* ── Spend, entered per channel per month in Admin → Reports ─────────────────── */

create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The MASTER source name (lead_sources_master.master_source). Not a foreign key:
  -- the master list is tenant data that gets edited, and losing a month of recorded
  -- spend because a channel was renamed would be worse than a dangling label.
  source text not null,
  -- Always the first of the month. Enforced below rather than trusted.
  period_start date not null,
  amount numeric(12,2) not null check (amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_spend_month_start check (period_start = date_trunc('month', period_start)::date)
);

-- One figure per channel per month; the admin screen upserts on this.
create unique index if not exists marketing_spend_unique
  on public.marketing_spend (company_id, source, period_start);

create index if not exists marketing_spend_lookup
  on public.marketing_spend (company_id, period_start);

/* ⚠ RLS ON WITH NO POLICIES = service-role only, deliberately, exactly like
 * `report_goals`. What the business pays for leads is not something every Hub user
 * should be able to read straight off the REST API, and the admin route is the only
 * writer. The scorecard function below is SECURITY DEFINER, so cards still work.
 * ⚠ Without this, `public` grants would let anon read the table — the trap the
 * Aug 2026 snapshot-table review found. */
alter table public.marketing_spend enable row level security;
revoke all on public.marketing_spend from anon, authenticated;

/* ── The scorecard ───────────────────────────────────────────────────────────── */

create or replace function public.scoreboard_channel_scorecard(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_credit_rule text default 'acquisition'
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  rule as (
    select case when p_credit_rule = 'recent_touch' then 'recent_touch' else 'acquisition' end c
  ),
  /* Stages the tenant has ticked as a sale. `closed_won` is a sale by system rule and
   * is counted on its own; these are the EXTRA ones (upsells), kept apart so they can
   * never move the close rate. */
  sale_stages as (
    select key from tracker_stages
    where company_id = p_company_id and counts_as_sale and key <> 'closed_won'
  ),
  /* ── Lead side: jobs, from the Tracker, one row per appearance ───────────── */
  lead_side as (
    select
      coalesce(
        public.churn_normalize_source(p_company_id, l.lead_source),
        'Other / Unknown'
      ) as src,
      count(*)                                                          as leads,
      count(*) filter (where l.stage = 'closed_won')                    as closed_won,
      count(*) filter (where l.stage = 'closed_lost')                   as closed_lost,
      count(*) filter (where l.stage in (select key from sale_stages))  as sold_other,
      count(*) filter (where l.stage not in ('closed_won','closed_lost','closed_other')
                         and l.stage not in (select key from sale_stages))  as still_open,
      coalesce(sum(l.annual_value) filter (
        where l.stage = 'closed_won' or l.stage in (select key from sale_stages)
      ), 0)                                                             as tracker_value_sold
    from leads l, allowed a
    where a.ok
      and l.company_id = p_company_id
      and l.lead_creation_date >= p_start
      and l.lead_creation_date <= p_end
    group by 1
  ),
  /* ── Money side: Jobber invoices, credited to the client's channel ───────── */
  scoped as (
    select i.id, i.client_id, i.total, coalesce(i.payments_total, 0) as paid
    from invoices i, allowed a
    where a.ok
      and i.company_id = p_company_id
      and i.deleted_at is null
      and i.issued_date >= p_start
      and i.issued_date <= p_end
  ),
  cli as (
    select distinct c.id, c.email, c.phone, c.name,
      public.churn_normalize_source(
        p_company_id, nullif(btrim(c.custom_fields->'HLC105 Lead Source'->>'value'), '')
      ) as jobber_src
    from scoped s join clients c on c.id = s.client_id
    where c.company_id = p_company_id
  ),
  labelled as (
    select cli.id, cli.jobber_src,
      (
        select public.churn_normalize_source(p_company_id, l.lead_source)
        from leads l
        where l.company_id = p_company_id
          and coalesce(l.lead_source, '') <> ''
          and (
            (coalesce(cli.email, '') <> '' and lower(l.email) = lower(cli.email))
            or (regexp_replace(coalesce(cli.phone, ''), '\D', '', 'g') <> ''
                and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')
                  = regexp_replace(coalesce(cli.phone, ''), '\D', '', 'g'))
            or (coalesce(cli.name, '') <> ''
                and lower(btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')))
                  = lower(btrim(cli.name)))
          )
        order by l.created_at desc nulls last
        limit 1
      ) as tracker_src
    from cli
  ),
  money as (
    select
      coalesce(
        case when (select c from rule) = 'recent_touch'
             then coalesce(b.tracker_src, b.jobber_src)
             else coalesce(b.jobber_src, b.tracker_src) end,
        'Other / Unknown'
      ) as src,
      round(sum(s.total), 2)        as revenue,
      round(sum(s.paid), 2)         as collected,
      count(distinct b.id)          as customers,
      count(*)                      as invoices
    from scoped s join labelled b on b.id = s.client_id
    group by 1
  ),
  /* ── Spend: every month that STARTS inside the window ────────────────────── */
  spend as (
    select ms.source as src, sum(ms.amount) as spend, count(*) as months
    from marketing_spend ms, allowed a
    where a.ok
      and ms.company_id = p_company_id
      and ms.period_start >= date_trunc('month', p_start)::date
      and ms.period_start <= p_end
    group by 1
  ),
  merged as (
    select
      coalesce(l.src, m.src, sp.src)                as source,
      coalesce(l.leads, 0)                          as leads,
      coalesce(l.closed_won, 0)                     as closed_won,
      coalesce(l.closed_lost, 0)                    as closed_lost,
      coalesce(l.sold_other, 0)                     as sold_other,
      coalesce(l.still_open, 0)                     as still_open,
      coalesce(l.tracker_value_sold, 0)             as tracker_value_sold,
      coalesce(m.revenue, 0)                        as revenue,
      coalesce(m.collected, 0)                      as collected,
      coalesce(m.customers, 0)                      as customers,
      coalesce(m.invoices, 0)                       as invoices,
      sp.spend                                      as spend,
      coalesce(sp.months, 0)                        as spend_months
    from lead_side l
    full outer join money m on m.src = l.src
    full outer join spend sp on sp.src = coalesce(l.src, m.src)
  ),
  rows as (
    select g.*,
      coalesce(max(mm.source_group), 'Other') as source_group,
      coalesce(max(mm.cost_type), 'Unknown')  as cost_type
    from merged g
    left join lead_sources_master mm
      on mm.company_id = p_company_id and lower(mm.master_source) = lower(g.source)
    group by g.source, g.leads, g.closed_won, g.closed_lost, g.sold_other, g.still_open,
             g.tracker_value_sold, g.revenue, g.collected, g.customers, g.invoices,
             g.spend, g.spend_months
  )
  select case when not (select ok from allowed) then null::jsonb else jsonb_build_object(
    'credit_rule', (select c from rule),
    'leads',       coalesce((select sum(leads)::int      from rows), 0),
    'closed_won',  coalesce((select sum(closed_won)::int from rows), 0),
    'closed_lost', coalesce((select sum(closed_lost)::int from rows), 0),
    'revenue',     coalesce((select round(sum(revenue),2) from rows), 0),
    'customers',   coalesce((select sum(customers)::int  from rows), 0),
    -- Null, not 0, when nothing has been entered — see the header. The card branches
    -- on this to hide the spend columns entirely rather than show a row of dashes.
    'spend',       (select sum(spend) from rows where spend is not null),
    'has_spend',   exists (select 1 from rows where spend is not null),
    'by_source', coalesce((
      select jsonb_agg(x order by (x->>'revenue')::numeric desc, (x->>'leads')::int desc)
      from (
        select jsonb_build_object(
          'source',        source,
          'source_group',  source_group,
          'cost_type',     cost_type,
          'leads',         leads,
          'closed_won',    closed_won,
          'closed_lost',   closed_lost,
          'sold_other',    sold_other,
          'still_open',    still_open,
          -- ⚠ NULL when nothing was decided, so the card shows "—" rather than 0%,
          -- which would read as "we lost every one".
          'close_rate',    case when closed_won + closed_lost > 0
                                then round(100.0 * closed_won / (closed_won + closed_lost), 1)
                           end,
          'customers',     customers,
          'invoices',      invoices,
          'revenue',       revenue,
          'collected',     collected,
          'tracker_value_sold', tracker_value_sold,
          'spend',         spend,
          'spend_months',  spend_months,
          -- Every derived figure is NULL rather than 0 when its denominator is
          -- missing. A channel with no spend recorded must not out-rank one that
          -- reports its costs honestly.
          'revenue_per_lead',     case when leads > 0 then round(revenue / leads, 2) end,
          'cost_per_lead',        case when spend is not null and leads > 0
                                       then round(spend / leads, 2) end,
          'cost_per_customer',    case when spend is not null and customers > 0
                                       then round(spend / customers, 2) end,
          'roas',                 case when spend is not null and spend > 0
                                       then round(revenue / spend, 2) end
        ) x
        from rows
      ) y
    ), '[]'::jsonb)
  ) end
$function$;

revoke all on function public.scoreboard_channel_scorecard(uuid, date, date, text) from anon;
revoke all on function public.scoreboard_channel_scorecard(uuid, date, date, text) from authenticated;
revoke all on function public.scoreboard_channel_scorecard(uuid, date, date, text) from public;
grant execute on function public.scoreboard_channel_scorecard(uuid, date, date, text) to service_role;
