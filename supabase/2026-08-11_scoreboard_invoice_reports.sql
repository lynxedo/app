-- Revenue & Invoicing report (REPORTS_PRD.md §8.3) — the two data sources behind it.
--
-- TWO functions, not one, and the split is the point:
--
--   scoreboard_invoice_window(company, start, end)  what we BILLED and COLLECTED in a period
--   scoreboard_invoice_ar(company)                  what is owed RIGHT NOW
--
-- Accounts receivable is a point-in-time fact: an invoice issued in March that is
-- still unpaid today belongs in today's AR, and would vanish from a June–August
-- window. Folding both into one date-ranged function would make half its output
-- silently ignore the date range the user picked — the same class of bug as the
-- Source Coverage card that disagreed with its own label. So the window function
-- takes dates, the AR function takes none, and each widget says which it is.
--
-- Follows scoreboard_churn_summary exactly: SECURITY DEFINER, pinned search_path,
-- returns one jsonb document, and EXECUTE granted to authenticated + service_role
-- ONLY. ⚠ CREATE FUNCTION grants EXECUTE to PUBLIC by default, which is how anon
-- ended up able to read per-tech revenue in July 2026 — the REVOKEs below are
-- mandatory, not decorative (see supabase/2026-07-05_security_revoke_anon_access.sql).

/* ── Money definitions, decided against the live data on 2026-08-11 ──────────
 *
 * COLLECTED = total - outstanding_balance, NOT payments_total.
 *   177 of 2,492 invoices Jobber calls "paid" carry payments_total = 0, so summing
 *   that column understated collections by ~$21.7k against the same book. The
 *   outstanding balance is Jobber's authoritative "still owed", so deriving from
 *   it agrees with the AR figure by construction. Two numbers that must reconcile
 *   should be computed from one source, not two.
 *
 * OWED keys off the BALANCE, never invoice_status.
 *   14 invoices marked 'paid' still owe $3,044 between them — one of them 118 days
 *   past due. A collections list filtered by status would hide a quarter of the
 *   money owed, which is the exact opposite of what the page is for.
 *
 * DRAFTS are excluded from invoiced, collected and AR, and reported on their own.
 *   A draft was never sent, so it is neither revenue nor a receivable — but it is
 *   worth money sitting still, so it gets its own tile rather than disappearing.
 *
 * CREDIT BALANCES (negative outstanding) are surfaced, never netted.
 *   7 invoices carry -$2,036 of overpayment. Letting those cancel out real debt
 *   would report AR of $12,955 when $14,991 is genuinely outstanding.
 */

create or replace function public.scoreboard_invoice_window(
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
  with scoped as (
    select
      i.*,
      -- Drafts are money that hasn't been asked for yet; kept in the set so they
      -- can be counted separately, flagged so every total below can exclude them.
      (i.invoice_status = 'draft')                as is_draft,
      (i.total - i.outstanding_balance)           as collected,
      case
        when i.paid_at is null or i.issued_date is null then null
        else greatest(0, (i.paid_at at time zone 'America/Chicago')::date - i.issued_date)
      end                                         as days_to_pay,
      case
        when j.id is null then 'Unlinked'
        when j.is_recurring then 'Recurring'
        else 'One-off'
      end                                         as job_kind
    from invoices i
    left join jobs j on j.id = i.job_id and j.deleted_at is null
    where i.company_id = p_company_id
      and i.deleted_at is null
      and i.issued_date between p_start and p_end
  ),
  billed as (select * from scoped where not is_draft)
  select jsonb_build_object(
    'invoiced',        coalesce((select round(sum(total), 2)               from billed), 0),
    'collected',       coalesce((select round(sum(collected), 2)           from billed), 0),
    'still_owed',      coalesce((select round(sum(greatest(outstanding_balance, 0)), 2) from billed), 0),
    'invoice_count',   (select count(*) from billed),
    'avg_invoice',     (select round(avg(total), 2) from billed),
    'subtotal',        coalesce((select round(sum(subtotal), 2)            from billed), 0),
    'tax',             coalesce((select round(sum(tax_amount), 2)          from billed), 0),
    'tips',            coalesce((select round(sum(tips_total), 2)          from billed), 0),
    'discounts',       coalesce((select round(sum(discount_amount), 2)     from billed), 0),

    -- Median as well as average: Heroes collects on the spot, so the median is 0
    -- while a single 90-day straggler drags the average to 1.1. Reporting only the
    -- average would invent a collections problem that doesn't exist.
    'median_days_to_pay', (select percentile_disc(0.5) within group (order by days_to_pay)
                           from billed where days_to_pay is not null),
    'avg_days_to_pay',    (select round(avg(days_to_pay), 1) from billed where days_to_pay is not null),
    'paid_count',         (select count(*) from billed where days_to_pay is not null),

    'draft_count',     (select count(*) from scoped where is_draft),
    'draft_value',     coalesce((select round(sum(total), 2) from scoped where is_draft), 0),

    -- How far back the mirror actually goes, so a widget can say "we only hold
    -- invoices from X" instead of drawing an empty chart that looks like collapse.
    'earliest_invoice', (select min(issued_date) from invoices
                         where company_id = p_company_id and deleted_at is null),

    'monthly', coalesce((
      select jsonb_agg(m order by m->>'month')
      from (
        select jsonb_build_object(
          'month',     to_char(date_trunc('month', issued_date), 'YYYY-MM'),
          'invoiced',  round(sum(total), 2),
          'collected', round(sum(collected), 2),
          'count',     count(*)
        ) m
        from billed
        group by date_trunc('month', issued_date)
      ) x
    ), '[]'::jsonb),

    'mix', coalesce((
      select jsonb_agg(k order by (k->>'invoiced')::numeric desc)
      from (
        select jsonb_build_object(
          'kind',     job_kind,
          'count',    count(*),
          'invoiced', round(sum(total), 2)
        ) k
        from billed
        group by job_kind
      ) y
    ), '[]'::jsonb)
  );
$$;

comment on function public.scoreboard_invoice_window(uuid, date, date) is
  'Revenue & Invoicing report §8.3 — what was billed and collected in a window. Drafts excluded from every total and reported separately. Collected is derived from outstanding_balance, not payments_total (see file header).';


create or replace function public.scoreboard_invoice_ar(
  p_company_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with open_invoices as (
    select
      i.id,
      i.invoice_number,
      i.client_id,
      i.issued_date,
      i.due_date,
      i.invoice_status,
      i.outstanding_balance as balance,
      -- No due date means nothing is overdue yet — treat it as current rather than
      -- as infinitely late, which is what a null-propagating subtraction would do.
      coalesce(current_date - i.due_date, 0) as days_past_due,
      c.name as client_name
    from invoices i
    left join clients c on c.id = i.client_id
    where i.company_id = p_company_id
      and i.deleted_at is null
      and i.outstanding_balance > 0
      and i.invoice_status <> 'draft'
  ),
  bucketed as (
    select *,
      case
        when days_past_due <= 0  then 'Current'
        when days_past_due <= 30 then '1–30 days'
        when days_past_due <= 60 then '31–60 days'
        else '60+ days'
      end as bucket
    from open_invoices
  )
  select jsonb_build_object(
    'as_of',      current_date,
    'total_ar',   coalesce((select round(sum(balance), 2) from bucketed), 0),
    'open_count', (select count(*) from bucketed),

    -- Overdue = past its due date. Kept apart from total AR because "owed" and
    -- "late" are different problems and only one of them needs a phone call.
    'overdue_total', coalesce((select round(sum(balance), 2) from bucketed where days_past_due > 0), 0),
    'overdue_count', (select count(*) from bucketed where days_past_due > 0),

    -- The finding that justifies keying off balance instead of status.
    'paid_status_still_owing_count', (select count(*) from bucketed where invoice_status = 'paid'),
    'paid_status_still_owing_value', coalesce((select round(sum(balance), 2) from bucketed where invoice_status = 'paid'), 0),

    'draft_count', (select count(*) from invoices
                    where company_id = p_company_id and deleted_at is null and invoice_status = 'draft'),
    'draft_value', coalesce((select round(sum(total), 2) from invoices
                    where company_id = p_company_id and deleted_at is null and invoice_status = 'draft'), 0),

    'credit_count',   (select count(*) from invoices
                       where company_id = p_company_id and deleted_at is null and outstanding_balance < 0),
    'credit_balance', coalesce((select round(sum(outstanding_balance), 2) from invoices
                       where company_id = p_company_id and deleted_at is null and outstanding_balance < 0), 0),

    'buckets', coalesce((
      select jsonb_agg(b order by b->>'sort')
      from (
        select jsonb_build_object(
          'bucket',  bucket,
          'sort',    min(case bucket when 'Current' then 0 when '1–30 days' then 1 when '31–60 days' then 2 else 3 end),
          'count',   count(*),
          'balance', round(sum(balance), 2)
        ) b
        from bucketed
        group by bucket
      ) x
    ), '[]'::jsonb),

    'invoices', coalesce((
      select jsonb_agg(r order by (r->>'balance')::numeric desc)
      from (
        select jsonb_build_object(
          'id',            id,
          'invoice_number', invoice_number,
          'client_id',     client_id,
          'client_name',   coalesce(nullif(trim(client_name), ''), 'Unknown customer'),
          'balance',       round(balance, 2),
          'days_past_due', days_past_due,
          'issued_date',   issued_date,
          'status',        invoice_status
        ) r
        from bucketed
        order by balance desc
        limit 100
      ) y
    ), '[]'::jsonb)
  );
$$;

comment on function public.scoreboard_invoice_ar(uuid) is
  'Revenue & Invoicing report §8.3 — what is owed right now. Deliberately takes NO date range: AR is point-in-time. Open means outstanding_balance > 0, NOT invoice_status, because invoices marked paid can still owe.';


-- ⚠ Mandatory. CREATE FUNCTION grants EXECUTE to PUBLIC; leaving that in place is
-- how anon read four scoreboard functions in July 2026. Match the ACL the other
-- scoreboard functions carry: postgres + authenticated + service_role, nothing else.
revoke all on function public.scoreboard_invoice_window(uuid, date, date) from public, anon;
revoke all on function public.scoreboard_invoice_ar(uuid) from public, anon;
grant execute on function public.scoreboard_invoice_window(uuid, date, date) to authenticated, service_role;
grant execute on function public.scoreboard_invoice_ar(uuid) to authenticated, service_role;

-- The window function filters invoices by (company_id, issued_date) and the AR
-- function by (company_id, outstanding_balance). Both are the whole predicate, so
-- index them that way. Partial on the AR side: only a handful of invoices are open
-- at any time, so the index stays tiny no matter how much history accumulates.
create index if not exists idx_invoices_company_issued
  on invoices (company_id, issued_date)
  where deleted_at is null;

create index if not exists idx_invoices_company_open
  on invoices (company_id)
  where deleted_at is null and outstanding_balance > 0;
