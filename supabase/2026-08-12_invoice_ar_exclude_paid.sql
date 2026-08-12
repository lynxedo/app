-- Receivables must exclude invoices Jobber calls PAID, whatever their balance says.
-- Applied 2026-08-12.
--
-- ⚠⚠ THIS REVERSES THE RULE §8.3 SHIPPED WITH, AND THE REVERSAL IS THE POINT.
-- That build saw 14 invoices reading `invoice_status = 'paid'` while carrying a
-- positive `outstanding_balance` and concluded "the label lies, trust the amount",
-- so AR keyed off the balance alone. Ben compared the report to Jobber and it was
-- ~4x too high.
--
-- Re-reading all 36 open rows straight from Jobber by id settles which field lies,
-- and it is not the status. Three groups came back:
--
--   A  14 rows, $3,044.01 — Jobber returns status='paid' AND a non-zero
--      invoiceBalance. Jobber's own unpaid list and its Jobs screen both exclude
--      them, and all 14 carry payments_total = 0. The BALANCE is the bad field
--      here (legacy rows whose payment was recorded outside the amounts).
--   B   7 rows, $9,154.59 — Jobber will not return them by id at all: deleted
--      upstream. Handled in lib/jobber-sync.ts by tombstoning, not here.
--   C  15 rows, $2,922.44 — genuinely open, and they reconcile to Jobber EXACTLY:
--      $2,399.80 past due + $522.64 not yet due = $2,922.44.
--
-- So the durable rule is neither "trust the status" nor "trust the amount": ask
-- Jobber for the record. If it will not return it, it is gone; if it returns it
-- paid, it is paid. Only then is the balance the truth.
--
-- The paid-but-owing rows are still COUNTED and surfaced (`paid_status_still_owing_*`)
-- because they are a genuine data-quality signal worth someone's attention — they
-- are simply no longer added to money owed.

CREATE OR REPLACE FUNCTION public.scoreboard_invoice_ar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  -- Every row still carrying a balance, before we decide what counts as owed.
  candidates as (
    select i.id, i.invoice_number, i.client_id, i.issued_date, i.due_date, i.invoice_status,
      i.outstanding_balance as balance,
      coalesce(current_date - i.due_date, 0) as days_past_due,
      c.name as client_name
    from invoices i
    left join clients c on c.id = i.client_id
    where i.company_id = p_company_id
      and i.deleted_at is null
      and i.outstanding_balance > 0
      and i.invoice_status <> 'draft'
  ),
  -- Owed = still open per Jobber. 'paid' is excluded on Jobber's own authority.
  open_invoices as (
    select * from candidates where invoice_status <> 'paid'
  ),
  bucketed as (
    select *,
      case
        when days_past_due <= 0  then 'Current'
        when days_past_due <= 30 then '1-30 days'
        when days_past_due <= 60 then '31-60 days'
        else '60+ days'
      end as bucket
    from open_invoices
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'as_of',      current_date,
    'total_ar',   coalesce((select round(sum(balance), 2) from bucketed), 0),
    'open_count', (select count(*) from bucketed),
    'overdue_total', coalesce((select round(sum(balance), 2) from bucketed where days_past_due > 0), 0),
    'overdue_count', (select count(*) from bucketed where days_past_due > 0),
    -- Reported, not counted: a real recording problem someone should look at, but
    -- money Jobber considers collected.
    'paid_status_still_owing_count', (select count(*) from candidates where invoice_status = 'paid'),
    'paid_status_still_owing_value', coalesce((select round(sum(balance), 2) from candidates where invoice_status = 'paid'), 0),
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
          'sort',    min(case bucket when 'Current' then 0 when '1-30 days' then 1 when '31-60 days' then 2 else 3 end),
          'count',   count(*),
          'balance', round(sum(balance), 2)
        ) b
        from bucketed group by bucket
      ) x
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(r order by (r->>'balance')::numeric desc)
      from (
        select jsonb_build_object(
          'id', id, 'invoice_number', invoice_number, 'client_id', client_id,
          'client_name', coalesce(nullif(trim(client_name), ''), 'Unknown customer'),
          'balance', round(balance, 2), 'days_past_due', days_past_due,
          'issued_date', issued_date, 'status', invoice_status
        ) r
        from bucketed order by balance desc limit 100
      ) y
    ), '[]'::jsonb)
  ) end;
$function$;

-- ⚠ CREATE OR REPLACE re-grants EXECUTE to PUBLIC by Supabase default — the July
-- anon-leak trap. Restore the intended ACL explicitly and verify after.
REVOKE ALL ON FUNCTION public.scoreboard_invoice_ar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scoreboard_invoice_ar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.scoreboard_invoice_ar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scoreboard_invoice_ar(uuid) TO service_role;
