-- Report §8.2 — the open-quote list gains the customer's id, so its Customer cell
-- can open that customer's file (where Call and Text live). Purely additive: one
-- extra key in each list row, no filter, no maths, no other output changed.
--
-- Why the id and not a directory uuid: the mapping from a Jobber customer to a
-- Lynxedo customer file is resolved on click by /customer/[clientId], so exactly one
-- audited place owns it (lib/customer-file.ts). Every other report table already
-- carried client_id; this function was the only one that did not.
--
-- ⚠ Re-verify the ACL after running this. A freshly created function carries the
-- default PUBLIC grant, and every scoreboard_* function is service-role-only since
-- 2026-08-12 (scoreboard_rpc_revoke_authenticated_2026_08_12). CREATE OR REPLACE
-- preserves the existing ACL, but that is worth proving rather than assuming:
--   select proacl from pg_proc where proname = 'scoreboard_quotes_open';
-- must show service_role only — no PUBLIC, no authenticated, no anon.

CREATE OR REPLACE FUNCTION public.scoreboard_quotes_open(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  open_q as (
    select q.*,
      (now()::date - q.sent_at::date) as days_out,
      case when q.service_codes is null or cardinality(q.service_codes) = 0
           then 'Unclassified' else q.service_codes[1] end as service_code
    from jobber_quotes q
    where q.company_id = p_company_id
      and q.deleted_at is null
      and q.quote_status in ('awaiting_response','changes_requested')
      and q.sent_at is not null
  )
  select case when (select ok from allowed) then jsonb_build_object(
    'as_of', now(),
    'open_total',     (select count(*) from open_q),
    'never_opened',   (select count(*) from open_q where client_viewed_at is null),
    'opened_no_reply',(select count(*) from open_q where client_viewed_at is not null),
    'oldest_days',    (select max(days_out) from open_q),
    -- The follow-through gap: the customer said yes and it never became a job.
    -- Reads 0 on a healthy book (it did on 2026-08-13) — that is the point of a
    -- watchdog, and the card says so rather than looking broken.
    'approved_not_converted', (
      select count(*) from jobber_quotes
      where company_id = p_company_id and deleted_at is null and quote_status = 'approved'
    ),
    'aging', jsonb_build_object(
      'd0_7',   (select count(*) from open_q where days_out <= 7),
      'd8_14',  (select count(*) from open_q where days_out between 8 and 14),
      'd15_30', (select count(*) from open_q where days_out between 15 and 30),
      'd31',    (select count(*) from open_q where days_out > 30)
    ),
    -- Capped, and the cap is reported so a truncated list never reads as complete.
    'list_cap', 100,
    'list_total', (select count(*) from open_q),
    'list', coalesce((
      select jsonb_agg(r order by (r->>'days_out')::int desc)
      from (
        select jsonb_build_object(
          'quote_number', o.quote_number,
          'client', coalesce(nullif(trim(c.company_name),''), nullif(trim(c.name),''), 'Unknown'),
          -- Added 2026-08-13 for the click-through. Null when the quote has no
          -- matching client row, which the widget renders as plain text.
          'client_id', o.client_id,
          'days_out', o.days_out,
          'viewed', o.client_viewed_at is not null,
          'service', o.service_code,
          'salesperson', coalesce(nullif(trim(u.name),''), 'Unassigned'),
          'jobber_uri', o.jobber_web_uri
        ) r
        from open_q o
        left join clients c on c.id = o.client_id
        left join jobber_users u
          on u.company_id = p_company_id and u.external_id = o.salesperson_external_id
        order by o.days_out desc
        limit 100
      ) w
    ), '[]'::jsonb)
  ) end;
$function$;
