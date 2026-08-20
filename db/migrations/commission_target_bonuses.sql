-- Commission: bonuses paid for HITTING A TARGET, on the two Crew & Labor ratios.
--
-- Ben: "Need the ability to set up a commission/bonus for hitting a revenue per hour
-- figure and one for the payroll to production revenue %."
--
-- NON-DESTRUCTIVE. Four new `basis` values, two new `rate_kind` values, and two new
-- guards. No column is dropped, renamed or retyped; no row is written. Every rule
-- already saved still validates against the widened checks and still pays exactly what
-- it paid before — verified against the four live rules first (item_count/per_unit,
-- new_sales_value/percent, upsell_count/per_unit, upsell_value/percent).
--
-- One transaction, so a constraint that fails to validate leaves the old one in place
-- rather than the table unguarded.

begin;

-- 1. The four ratio bases. `rev_per_hour` / `labor_pct` are the person's OWN figures;
--    the `company_` pair are the whole crew's, for a lead or manager paid on how the
--    business performs rather than on their own day.
alter table public.commission_plans drop constraint if exists commission_plans_basis_chk;
alter table public.commission_plans add constraint commission_plans_basis_chk
  check (basis = any (array[
    'new_sales_value',  'new_sales_count',
    'upsell_value',     'upsell_count',
    'sales_value',      'sales_count',
    'revenue_produced', 'line_revenue',  'item_count',
    'rev_per_hour',     'company_rev_per_hour',
    'labor_pct',        'company_labor_pct'
  ]));

-- 2. Two rate kinds that pay a flat amount for clearing a line, rather than a rate
--    applied to a figure. A ratio cannot take a rate: 5% of "$91.84 per labour hour" is
--    $4.59, which is a category error rather than a small bonus.
alter table public.commission_plans drop constraint if exists commission_plans_rate_kind_chk;
alter table public.commission_plans add constraint commission_plans_rate_kind_chk
  check (rate_kind = any (array['percent', 'per_unit', 'tiered', 'target_flat', 'target_tiered']));

-- 3. ⚠⚠ THE ONE THAT WOULD OTHERWISE HAVE BROKEN THE FEATURE SILENTLY AT INSERT TIME.
--    The old check read "tiered => tiers must exist, anything else => rate must exist".
--    `target_tiered` keeps its numbers in `tiers` and leaves `rate` null, so it is
--    "anything else" and would have been rejected for having no rate. Both banded kinds
--    are now named explicitly instead of one being spelled out and the other implied.
alter table public.commission_plans drop constraint if exists commission_plans_rate_present_chk;
alter table public.commission_plans add constraint commission_plans_rate_present_chk
  check (
    (rate_kind in ('tiered', 'target_tiered') and tiers is not null)
    or (rate_kind not in ('tiered', 'target_tiered') and rate is not null)
  );

-- 4. ⚠⚠ A flat target rule with no target has no line to be on the right side of, and
--    the only reading of "no line" that a comparison can produce is "everybody clears
--    it" — so an unguarded row would pay every holder, every period, for nothing. The
--    API rejects it as well; this is the backstop underneath, in the same spirit as the
--    RLS-with-no-policies that makes this table service-role only.
alter table public.commission_plans drop constraint if exists commission_plans_target_chk;
alter table public.commission_plans add constraint commission_plans_target_chk
  check (rate_kind <> 'target_flat' or threshold is not null);

-- 5. Basis and rate kind have to agree. A ratio is paid by target, an amount is paid by
--    rate, and the reverse of either produces a number nobody can use. The app decides
--    this in one place (`rateKindAllowed` in lib/reports/commission.ts); this is the
--    same rule written where a hand-typed INSERT also has to obey it.
alter table public.commission_plans drop constraint if exists commission_plans_basis_kind_chk;
alter table public.commission_plans add constraint commission_plans_basis_kind_chk
  check (
    case
      when basis in ('rev_per_hour', 'company_rev_per_hour', 'labor_pct', 'company_labor_pct')
        then rate_kind in ('target_flat', 'target_tiered')
      else rate_kind in ('percent', 'per_unit', 'tiered')
    end
  );

commit;
