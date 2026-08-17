-- ===========================================================================
-- Commission plans — one row per (person, bonus rule)
-- 2026-08-17
--
-- Applied to the SHARED Supabase DB. Ships INERT: the table starts empty, and
-- every commission widget renders "No commission plans set up yet" until an admin
-- adds one in Admin → Reports. No existing figure moves.
--
-- ⚠ There is deliberately NO function here. Every basis a bonus can ride on is
-- already computed by an existing source (`people`, `visit_revenue_trend`,
-- `lead_items`), so the arithmetic is a pure metric in
-- lib/scoreboards/widgets/commission.ts and lib/reports/commission.ts. That avoids
-- a fourth SECURITY DEFINER function and the anon-grant trap that comes with one.
-- ===========================================================================

-- A technician can hold several rows, which is how "commission on irrigation sales
-- PLUS a spiff on controllers" is expressed without a compound rule type.
--
-- ⚠⚠ Keyed on employees.id, NOT a name. The three data sets a commission can be
-- based on spell people differently — `leads.salesperson` is whatever was typed into
-- the Tracker, Crew & Labor composes "Angel Morin", People Performance composes
-- "Angel" — and `scoreboard_people` already reconciles all three onto the roster.
-- Keying on the roster row means a commission figure and that person's People card
-- agree by construction, rather than via a second matching rule that can drift. This
-- is the same reasoning the widget catalogs route documents at length.
--
-- ⚠ Service-role only: RLS ON with NO policies and no anon/authenticated grants —
-- the same shape as report_goals, because this is pay data. The admin route is the
-- only way in, and the widget resolver reads it through the service-role client after
-- the route has already checked the caller's report grant.
create table if not exists public.commission_plans (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  label         text not null,
  -- sales_value | sales_count | revenue_produced | line_revenue | item_count
  basis         text not null,
  -- percent | per_unit | tiered
  rate_kind     text not null default 'percent',
  -- percent: 5 means 5%. per_unit: dollars per unit.
  rate          numeric(12,4),
  -- MARGINAL bands for rate_kind='tiered':
  --   [{"from":0,"rate":3},{"from":50000,"rate":5}]
  -- pays 3% on the first $50k and 5% only on the excess. The alternative reading —
  -- 5% on everything once you cross — creates a cliff where one more dollar of sales
  -- pays hundreds more, and that is a thing people notice in their own paycheque.
  tiers         jsonb,
  -- Nothing pays until the BASIS reaches this. Null = pays from the first dollar.
  threshold     numeric(14,2),
  -- Maximum payout for this rule. Null = uncapped.
  cap           numeric(14,2),
  -- basis='line_revenue': which service line's revenue the bonus rides on.
  line_prefix   text,
  -- basis='item_count': which Lead Tracker Service values count.
  items         text[],
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint commission_plans_basis_chk check (
    basis in ('sales_value','sales_count','revenue_produced','line_revenue','item_count')),
  constraint commission_plans_rate_kind_chk check (rate_kind in ('percent','per_unit','tiered')),
  -- A flat rule needs a rate; a tiered rule needs bands. Enforced here so a rule that
  -- could only ever pay zero cannot be saved at all.
  constraint commission_plans_rate_present_chk check (
    (rate_kind = 'tiered' and tiers is not null) or (rate_kind <> 'tiered' and rate is not null)),
  -- A line bonus without a line, or an item bonus with no items, is not a rule.
  constraint commission_plans_line_chk check (basis <> 'line_revenue' or line_prefix is not null),
  constraint commission_plans_items_chk check (
    basis <> 'item_count' or (items is not null and array_length(items, 1) > 0)),
  constraint commission_plans_nonneg_chk check (
    coalesce(rate, 0) >= 0 and coalesce(threshold, 0) >= 0 and coalesce(cap, 0) >= 0)
);

create index if not exists commission_plans_company_idx
  on public.commission_plans (company_id, employee_id);

alter table public.commission_plans enable row level security;

-- No policies, by design. Revoked by NAME rather than only from PUBLIC, because
-- Supabase's default privileges grant these two roles directly.
revoke all on public.commission_plans from anon;
revoke all on public.commission_plans from authenticated;

-- ⚠ NOT enforced in the database, and worth knowing: the basis↔rate-kind pairing.
-- A percentage of a COUNT ("3% of 7 controllers") and a flat amount per unit of a
-- DOLLAR figure are both meaningless. That pairing is validated in
-- lib/reports/commission.ts (`rateKindAllowed`), checked by the admin route before
-- saving, and the editor only offers the valid options — three layers, none of them a
-- CHECK constraint, because the rule is a two-column relationship that would need the
-- basis list duplicated in SQL and would then drift from the registry.
