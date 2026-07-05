-- Churn scoreboard: retention math rework to a consistent, any-year "full-year book" method.
-- WHY: the prior formula derived the start-of-year base from TODAY's active count, so it
-- only worked for the current year. The Recurring Services board began in 2025, so there is
-- no Jan-1-2025 base to measure against — a start-of-year cohort is impossible for 2025.
-- The full-year-book method works identically for any year and matches how an owner thinks:
--   retention(Y) = 1 − (services cancelled during Y ÷ services on the book at any point in Y)
--   on-book(Y)  = sold before Y ends AND (never cancelled OR cancelled on/after Y starts)
-- This lets the board show 2025 (full year, reminder) beside 2026 (YTD, headline).

create or replace function public.scoreboard_churn_summary(p_company_id uuid, p_year int)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  result jsonb;
  ys date := make_date(p_year, 1, 1);
  ye date := make_date(p_year + 1, 1, 1);
begin
  if (select auth.uid()) is not null and not exists (
    select 1 from public.user_profiles up
    where up.id = (select auth.uid())
      and up.company_id = p_company_id
      and (up.role = 'admin' or up.can_access_scoreboards)
  ) then
    raise exception 'not authorized';
  end if;

  with scope as (
    select rs.*,
      (rs.sold_date < ye and (rs.cancel_date is null or rs.cancel_date >= ys)) as on_book,
      (rs.cancelled_status = 'Cancelled' and rs.cancel_date >= ys and rs.cancel_date < ye) as churned_in_year
    from public.recurring_services rs
    where rs.company_id = p_company_id
  ),
  ch as (
    select s.annual_value, s.cancel_date,
      coalesce(m.master_reason, nullif(btrim(coalesce(s.cancellation_reason,'')),''), 'Unknown') as reason_master,
      coalesce(m.churn_type, 'Review')          as churn_type,
      coalesce(m.in_gross_churn, true)          as in_gross,
      coalesce(m.in_controllable_churn, false)  as in_ctrl
    from scope s
    left join lateral public.churn_map_reason(p_company_id, s.cancellation_reason) m on true
    where s.churned_in_year
  ),
  base as (
    select
      (select count(*) from scope where on_book)                                          as book_size,
      (select count(*) from scope where cancelled_status = 'Active')                       as active_now,
      (select count(*) from scope where extract(year from sold_date) = p_year)             as new_in_year,
      (select coalesce(sum(annual_value),0) from scope where cancelled_status = 'Active')  as active_annual_value,
      count(*) filter (where in_gross)                                                     as churned_gross,
      count(*) filter (where in_ctrl)                                                      as churned_ctrl,
      count(*) filter (where churn_type = 'Company-Initiated')                             as churned_company,
      count(*) filter (where churn_type = 'Uncontrollable')                                as churned_uncontrollable,
      count(*) filter (where churn_type = 'Review')                                        as churned_review,
      coalesce(sum(annual_value) filter (where in_gross), 0)                               as churned_annual_value
    from ch
  )
  select jsonb_build_object(
    'year', p_year,
    'book_size', b.book_size,
    'active_now', b.active_now,
    'new_in_year', b.new_in_year,
    'churned_gross', b.churned_gross,
    'churned_controllable', b.churned_ctrl,
    'churned_company_initiated', b.churned_company,
    'churned_uncontrollable', b.churned_uncontrollable,
    'churned_review', b.churned_review,
    'churned_annual_value', b.churned_annual_value,
    'active_annual_value', b.active_annual_value,
    'retention_pct', case when b.book_size > 0 then round(100.0 * (b.book_size - b.churned_gross) / b.book_size, 1) end,
    'gross_churn_pct', case when b.book_size > 0 then round(100.0 * b.churned_gross / b.book_size, 1) end,
    'controllable_churn_pct', case when b.book_size > 0 then round(100.0 * b.churned_ctrl / b.book_size, 1) end,
    'by_reason', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reason', reason_master, 'churn_type', churn_type, 'count', n, 'annual_value', av) order by n desc), '[]'::jsonb)
      from (select reason_master, churn_type, count(*) n, coalesce(sum(annual_value),0) av from ch group by 1,2) x
    ),
    'by_type', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'churn_type', churn_type, 'count', n, 'annual_value', av) order by n desc), '[]'::jsonb)
      from (select churn_type, count(*) n, coalesce(sum(annual_value),0) av from ch group by 1) x
    ),
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', mon, 'gross', gross_n, 'controllable', ctrl_n) order by mon), '[]'::jsonb)
      from (select to_char(cancel_date,'YYYY-MM') mon,
                   count(*) filter (where in_gross) gross_n,
                   count(*) filter (where in_ctrl) ctrl_n
            from ch group by 1) x
    )
  ) into result
  from base b;

  return result;
end
$$;

revoke all on function public.scoreboard_churn_summary(uuid, int) from public, anon;
grant execute on function public.scoreboard_churn_summary(uuid, int) to authenticated, service_role;
