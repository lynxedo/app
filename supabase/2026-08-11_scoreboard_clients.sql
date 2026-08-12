-- Clients report (REPORTS_PRD.md §8.4). APPLIED to the shared DB 2026-08-11.
--
-- ⚠⚠ NOTHING here is lifetime value, even though §8.4 asks for it. Clients go back
-- to 2025-01-15 but the invoice mirror starts at the Jobber backfill floor
-- (2026-01-02 for Heroes), so per-client spend means "billed since we started
-- holding invoices". For a customer who joined in 2025 that is a fraction of what
-- they have really paid. A partial number labelled "lifetime" reads authoritative
-- while being wrong, so `coverage.first_invoice` is returned and every widget
-- names it.
--
-- ⚠ Leads are excluded from client counts: Jobber holds 243 rows flagged is_lead
-- that never bought anything; counting them inflates the base and deflates every
-- per-client average.
--
-- ⚠ No residential/commercial split, which §8.4 also asks for: is_company is true
-- on 15 of 1,663 rows and is FALSE on known commercial accounts (an HOA management
-- firm). The field isn't maintained, so a donut built on it would be confidently
-- wrong. Needs a real mapped field first (§7 source mapping).
--
-- Authorization via scoreboard_reports_allowed() — company_id is a parameter, so
-- the function must verify the caller belongs to that company.

create or replace function public.scoreboard_clients(
  p_company_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  base as (
    select c.id, c.name, c.external_created_at, c.is_lead, c.is_archived, c.balance
    from clients c
    where c.company_id = p_company_id and c.deleted_at is null
  ),
  customers as (select * from base where not coalesce(is_lead, false)),
  billed as (
    select i.client_id, sum(i.total) amt, count(*) invoices,
           min(i.issued_date) first_billed, max(i.issued_date) last_billed
    from invoices i
    where i.company_id = p_company_id and i.deleted_at is null
      and i.invoice_status <> 'draft'
      and i.issued_date between p_start and p_end
    group by i.client_id
  ),
  billed_all as (
    select i.client_id, sum(i.total) amt, count(*) invoices,
           min(i.issued_date) first_billed, max(i.issued_date) last_billed
    from invoices i
    where i.company_id = p_company_id and i.deleted_at is null and i.invoice_status <> 'draft'
    group by i.client_id
  ),
  recurring as (
    select count(*) filter (where cancel_date is null) active_services,
           coalesce(sum(annual_value) filter (where cancel_date is null), 0) annual_value
    from recurring_services where company_id = p_company_id
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'coverage', jsonb_build_object(
      'first_client',  (select (min(external_created_at) at time zone 'America/Chicago')::date from base),
      'first_invoice', (select min(issued_date) from invoices where company_id = p_company_id and deleted_at is null),
      'requested_start', p_start,
      'requested_end', p_end
    ),
    'clients_total',    (select count(*) from customers),
    'clients_active',   (select count(*) from customers where not coalesce(is_archived, false)),
    'clients_archived', (select count(*) from customers where coalesce(is_archived, false)),
    'leads_open',       (select count(*) from base where coalesce(is_lead, false)),
    'new_in_window', (select count(*) from customers
                      where (external_created_at at time zone 'America/Chicago')::date between p_start and p_end),
    'new_30d',       (select count(*) from customers where external_created_at >= now() - interval '30 days'),
    'billed_clients',  (select count(*) from billed),
    'billed_total',    coalesce((select round(sum(amt), 2) from billed), 0),
    'billed_avg',      (select round(avg(amt), 2) from billed),
    'recurring_services', (select active_services from recurring),
    'recurring_annual_value', (select round(annual_value, 2) from recurring),
    'new_by_month', coalesce((
      select jsonb_agg(m order by m->>'month')
      from (
        select jsonb_build_object(
          'month', to_char(date_trunc('month', (external_created_at at time zone 'America/Chicago')), 'YYYY-MM'),
          'count', count(*)
        ) m
        from customers
        where (external_created_at at time zone 'America/Chicago')::date between p_start and p_end
        group by date_trunc('month', (external_created_at at time zone 'America/Chicago'))
      ) x
    ), '[]'::jsonb),
    -- Service area from property addresses. Distinct client per city so a customer
    -- with two properties in one city counts once there.
    'by_city', coalesce((
      select jsonb_agg(c order by (c->>'clients')::int desc)
      from (
        select jsonb_build_object('city', city, 'clients', count(distinct client_id)) c
        from (
          select distinct p.client_id, initcap(trim(p.city)) city
          from properties p
          join customers cu on cu.id = p.client_id
          where p.company_id = p_company_id and p.deleted_at is null
            and nullif(trim(p.city), '') is not null
        ) z
        group by city
      ) y
    ), '[]'::jsonb),
    'top_clients', coalesce((
      select jsonb_agg(t order by (t->>'billed')::numeric desc)
      from (
        select jsonb_build_object(
          'client_id', cu.id,
          'name', coalesce(nullif(trim(cu.name), ''), 'Unnamed client'),
          'billed', round(ba.amt, 2),
          'invoices', ba.invoices,
          'first_billed', ba.first_billed,
          'last_billed', ba.last_billed,
          'days_since_last', (current_date - ba.last_billed),
          'archived', coalesce(cu.is_archived, false)
        ) t
        from billed_all ba
        join customers cu on cu.id = ba.client_id
        order by ba.amt desc
        limit 50
      ) w
    ), '[]'::jsonb)
  ) end;
$$;

comment on function public.scoreboard_clients(uuid, date, date) is
  'Clients report 8.4. Per-client spend is billed-since-the-invoice-floor, NEVER lifetime value: the invoice mirror starts later than the oldest client. Leads are excluded from client counts. No residential/commercial split - is_company is unpopulated (15 of 1663).';

revoke all on function public.scoreboard_clients(uuid, date, date) from public, anon;
grant execute on function public.scoreboard_clients(uuid, date, date) to authenticated, service_role;

create index if not exists idx_clients_company_created
  on clients (company_id, external_created_at)
  where deleted_at is null;
