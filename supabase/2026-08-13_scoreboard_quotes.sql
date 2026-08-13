-- Quote widgets for Report §8.2 Sales & Pipeline. APPLIED to the shared DB as
-- `scoreboard_quotes_2026_08_13`; this file is the repo record.
--
-- TWO functions, deliberately — the same split §8.3 made for receivables. The cohort
-- half answers a question about a PERIOD ("of the quotes we sent in July, how many did
-- we win"); the open half answers a question about TODAY ("which quotes are unanswered
-- right now"). One date-ranged function would have made the open cards silently ignore
-- the picker above them. The open cards say "as of today" on their face.
--
-- ⚠⚠ WON KEYS OFF THE STATUS, NOT THE TIMESTAMPS — the opposite of the usual Jobber
-- rule, where a status is a label and you reconcile against the amount. Measured on the
-- live book 2026-08-13: 28 of 113 converted quotes carry NO `approvedAt`, because they
-- were sold in person and converted straight to a job. Keying on the timestamp would
-- have reported 86 wins against a true 113 — discarding a quarter of real sales, and
-- specifically the ones closed face-to-face. The reverse exists too: one ARCHIVED quote
-- carries an `approvedAt` (approved, then killed), which timestamp logic scores as a win.
--
-- ⚠ NO DOLLARS: `amounts.total` excludes optional line items and Heroes quotes options
-- constantly (a $14,175 quote reporting $0.00). See 2026-08-13_jobber_quotes.sql.
--
-- Verified after applying — anon=false, authenticated=false, service_role=true on both,
-- and the figures reconcile to hand-written SQL: 237 sent · 113 won · 92 lost · 32 open
-- · 55.1% win rate · 11 never opened · 0 approved-not-converted.

CREATE OR REPLACE FUNCTION public.scoreboard_quotes(p_company_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  cohort as (
    select q.*,
      -- ⚠ `sent_at ?? created_at`. Five converted quotes were never formally sent
      -- (sold on the spot, then converted), so a sent-only cohort silently drops real
      -- wins. The count of these is returned so the card can say so.
      coalesce(q.sent_at, q.external_created_at) as cohort_at,
      (q.quote_status in ('approved','converted')) as won,
      (q.quote_status = 'archived') as lost,
      (q.quote_status in ('awaiting_response','changes_requested')) as still_open,
      -- One rep, one row — the same normalisation `scoreboard_sales` needed.
      coalesce(nullif(trim(q.salesperson_external_id),''), 'unassigned') as rep_key,
      -- Line items with no recognised prefix get their own named bucket rather than
      -- being dropped, the way unallocated labour hours do in Service Lines.
      case when q.service_codes is null or cardinality(q.service_codes) = 0
           then 'Unclassified' else q.service_codes[1] end as service_code
    from jobber_quotes q
    where q.company_id = p_company_id
      and q.deleted_at is null
      -- A draft was never shown to anyone, so it is not a quote that can be won or
      -- lost. Heroes currently holds none; other tenants will.
      and coalesce(q.quote_status,'') <> 'draft'
      and coalesce(q.sent_at, q.external_created_at)::date between p_start and p_end
  ),
  win_days as (
    select extract(epoch from (coalesce(approved_at, converted_at) - sent_at)) / 86400.0 as d
    from cohort
    where won and sent_at is not null
      and coalesce(approved_at, converted_at) is not null
      -- Same guard as time-to-close in §8.2: a decision stamped before the send date
      -- is a migration artefact, not a negative duration.
      and coalesce(approved_at, converted_at) >= sent_at
  )
  select case when (select ok from allowed) then jsonb_build_object(
    'sent',            (select count(*) from cohort),
    'won',             (select count(*) from cohort where won),
    'lost',            (select count(*) from cohort where lost),
    'still_open',      (select count(*) from cohort where still_open),
    'decided',         (select count(*) from cohort where won or lost),
    'sold_on_the_spot',(select count(*) from cohort where sent_at is null),
    'viewed',          (select count(*) from cohort where sent_at is not null and client_viewed_at is not null),
    'never_viewed',    (select count(*) from cohort where sent_at is not null and client_viewed_at is null),
    'no_salesperson',  (select count(*) from cohort where rep_key = 'unassigned'),
    'rate_min_sample', 10,
    'win_rate', (select case when count(*) filter (where won or lost) >= 10
                  then round(100.0 * count(*) filter (where won) / count(*) filter (where won or lost), 1)
                end from cohort),
    'median_days_to_win',
      (select round(percentile_cont(0.5) within group (order by d)::numeric, 1) from win_days),
    'win_time_sample', (select count(*) from win_days),

    'by_month', coalesce((
      select jsonb_agg(m order by m->>'month')
      from (
        select jsonb_build_object(
          'month', to_char(date_trunc('month', cohort_at), 'YYYY-MM'),
          'sent', count(*),
          'won', count(*) filter (where won),
          'decided', count(*) filter (where won or lost),
          'win_rate', case when count(*) filter (where won or lost) >= 10
                      then round(100.0 * count(*) filter (where won) / count(*) filter (where won or lost), 1) end
        ) m
        from cohort group by date_trunc('month', cohort_at)
      ) a
    ), '[]'::jsonb),

    'by_salesperson', coalesce((
      select jsonb_agg(p order by (p->>'sent')::int desc)
      from (
        select jsonb_build_object(
          'rep_id', c.rep_key,
          'name', coalesce(nullif(trim(u.name),''), case when c.rep_key='unassigned' then 'Unassigned' else 'Unknown user' end),
          'sent', count(*),
          'won', count(*) filter (where c.won),
          'decided', count(*) filter (where c.won or c.lost),
          'win_rate', case when count(*) filter (where c.won or c.lost) >= 10
                      then round(100.0 * count(*) filter (where c.won) / count(*) filter (where c.won or c.lost), 1) end
        ) p
        from cohort c
        left join jobber_users u
          on u.company_id = p_company_id and u.external_id = c.rep_key
        group by c.rep_key, u.name
      ) z
    ), '[]'::jsonb),

    'by_service', coalesce((
      select jsonb_agg(s order by (s->>'sent')::int desc)
      from (
        select jsonb_build_object(
          'code', service_code,
          'sent', count(*),
          'won', count(*) filter (where won),
          'decided', count(*) filter (where won or lost),
          'win_rate', case when count(*) filter (where won or lost) >= 10
                      then round(100.0 * count(*) filter (where won) / count(*) filter (where won or lost), 1) end
        ) s
        from cohort group by service_code
      ) y
    ), '[]'::jsonb)
  ) end;
$function$;

-- ── The open book, as of today ────────────────────────────────────────────────
--
-- Takes NO date window, for the reason at the top of this file.
--
-- ⚠⚠ `never_opened` REQUIRES a real `sent_at`. Ben's guard, and a correctness rule not
-- a nicety: a quote with no sent_at was sold on the spot, so "the customer never opened
-- it" is false — it was never sent to them. Listing those would send someone chasing a
-- customer who has already bought.
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

-- ⚠⚠ SERVICE-ROLE ONLY, per the Aug-12 rule. The in-function guard is
-- `scoreboard_reports_allowed`, which ALL nine Heroes users pass, so the per-report
-- grant is enforced by the route and there is no second net below it.
-- ⚠⚠ Revoke PUBLIC FIRST — a freshly created function carries the default PUBLIC grant,
-- so revoking `authenticated` by name alone is a silent no-op.
REVOKE ALL ON FUNCTION public.scoreboard_quotes(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scoreboard_quotes(uuid, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.scoreboard_quotes(uuid, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.scoreboard_quotes(uuid, date, date) TO service_role;

REVOKE ALL ON FUNCTION public.scoreboard_quotes_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scoreboard_quotes_open(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.scoreboard_quotes_open(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.scoreboard_quotes_open(uuid) TO service_role;
