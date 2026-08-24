-- Revenue by lead source: which channel the money actually came from
--
-- Ben asked for "annual revenue by source". Two things about that request turned
-- out to be load-bearing, and both are answered here rather than in the widget.
--
-- ⚠⚠ 1. THERE IS NO "ANNUAL". `invoices` for Heroes begins 2026-01-02 — the mirror
-- holds ~8 months, so a year-to-date window and a trailing-twelve window return the
-- IDENTICAL number. The function is therefore plain start/end and the card says on
-- its face what slice it read. Naming it "annual" would have implied a full year of
-- history that does not exist, which is the same trap the visit-history floor set in
-- August (a trailing-12 ticket average that silently equalled YTD).
--
-- ⚠⚠ 2. "BY SOURCE" HAS TWO HONEST ANSWERS AND THEY DISAGREE ABOUT A THIRD OF THE
-- MONEY. Ben's instinct was to read the Lead Tracker rather than Jobber. Measured on
-- Jan–Aug 2026, of 538 invoiced clients:
--
--     * 350 clients ($295,314) match a Lead Tracker row; 188 ($182,646) do NOT —
--       the Tracker only starts 2025-07-13, so anyone won before then has no row.
--     * 161 clients — $163,445, 34% of revenue — get a DIFFERENT label from each.
--
-- The disagreement is almost entirely one-directional, and that is the whole story:
-- a Tracker row is created when someone calls back for a NEW job, so an existing
-- customer's repair is logged "Repeat / Existing Customer", while Jobber's client
-- field still holds the channel that originally WON them. Jobber "SERV" → Tracker
-- "Repeat" is 40 clients and $14,851; Jobber "Google (GBP / LSA)" → Tracker "Repeat"
-- is 158 clients and $41,765.
--
-- So the two rules answer different questions and neither is wrong:
--
--   'acquisition'   — Jobber's client field wins, Tracker fills its blanks.
--                     "Which channel won the customers who paid me this period."
--                     Judges long-run channel value. SERV reads $21,060.
--   'recent_touch'  — Lead Tracker wins, Jobber fills its blanks.
--                     "What prompted the work I did this period."
--                     Honest that ~47% is repeat business. SERV reads $1,608.
--
-- Ben chose to have BOTH as a setting on the card, defaulting to 'acquisition',
-- with the card naming the rule it used — the same shape as `p_tech_credit` on
-- scoreboard_ticket_size_by_tech, and for the same reason: when two readings are
-- both defensible, the card must say which one produced the number.
--
-- ⚠ The Tracker is not merely the lesser source — it is the ONLY one that can
-- attribute ~$12.4k that Jobber files as Unknown (Google $6,926, Customer Referral
-- $2,223, Angi Leads $1,870, Website $1,427) and the only source naming Google Ads
-- (PPC) at all ($475, which Jobber has at $0). That is why it is the fallback under
-- 'acquisition' rather than being ignored.
--
-- ⚠ WHAT THIS DELIBERATELY DOES NOT READ: `recurring_services.lead_source`, which is
-- step 1 of `churn_resolve_source` and therefore feeds the nine neighbouring
-- Marketing cards. Two reasons. It is set on only 190 of 484 rows, and including it
-- would move $55,038 of this card's revenue by a rule the user did not pick — making
-- the setting a three-way blend that no label could honestly describe. The card
-- resolves exactly the two sources the setting names. Stated plainly so nobody later
-- "fixes" the inconsistency without knowing it was chosen: this card and the
-- Lead-Source Scorecard can disagree, because they measure different universes
-- (dollars invoiced vs. recurring customers on the book) by different rules.
--
-- ⚠ Source is resolved ONCE PER CLIENT, not per invoice — 538 clients against 2,690
-- invoices. The email/phone/name expressions match the functional indexes added
-- 2026-07-27 (churn_source_resolver_lookup_indexes) character for character; change
-- one and the resolver goes back to sequential scans and trips the 8s statement
-- timeout for `authenticated` while still looking fine to service_role.

create or replace function public.scoreboard_revenue_by_source(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_credit_rule text default 'acquisition'  -- 'acquisition' | 'recent_touch'
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  rule as (
    -- Anything unrecognised falls back to the documented default rather than
    -- returning an empty card that looks like "no revenue".
    select case when p_credit_rule = 'recent_touch' then 'recent_touch' else 'acquisition' end c
  ),
  scoped as (
    select i.id, i.client_id, i.total, coalesce(i.payments_total, 0) as paid
    from invoices i, allowed a
    where a.ok
      and i.company_id = p_company_id
      and i.deleted_at is null
      and i.issued_date >= p_start
      and i.issued_date <= p_end
  ),
  -- One row per client that billed anything in the window. Both labels resolved
  -- here so switching the rule never changes which clients are in scope.
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
        -- Most recent Tracker row: 'recent_touch' means the LATEST thing that
        -- brought them in, not the first.
        order by l.created_at desc nulls last
        limit 1
      ) as tracker_src
    from cli
  ),
  credited as (
    select s.id, s.total, s.paid,
      coalesce(
        case when (select c from rule) = 'recent_touch'
             then coalesce(b.tracker_src, b.jobber_src)
             else coalesce(b.jobber_src, b.tracker_src) end,
        'Other / Unknown'
      ) as src,
      b.id as client_id
    from scoped s join labelled b on b.id = s.client_id
  ),
  rows as (
    select r.src,
      coalesce(max(m.source_group), 'Other') as source_group,
      coalesce(max(m.cost_type), 'Unknown')  as cost_type,
      round(sum(r.total), 2)                 as invoiced,
      round(sum(r.paid), 2)                  as collected,
      count(*)                               as invoice_count,
      count(distinct r.client_id)            as client_count
    from credited r
    left join lead_sources_master m
      on m.company_id = p_company_id
     and lower(m.master_source) = lower(r.src)
    group by r.src
  )
  select case when not (select ok from allowed) then null::jsonb else jsonb_build_object(
    'credit_rule', (select c from rule),
    'invoiced',    coalesce((select round(sum(invoiced), 2)   from rows), 0),
    'collected',   coalesce((select round(sum(collected), 2)  from rows), 0),
    'invoices',    coalesce((select sum(invoice_count)::int   from rows), 0),
    -- ⚠ Summed from the per-source rows, so it is clients-per-source added up. A
    -- client cannot appear under two sources in one run (one label per client per
    -- rule), so this equals the distinct client count — unlike the shared-ticket
    -- case on the by-tech card, there is no double-count to warn about here.
    'clients',     coalesce((select sum(client_count)::int    from rows), 0),
    -- The bucket that is NOT a channel. Kept as its own figure so the card can say
    -- how much of the total is unattributed instead of drawing it as a rival to
    -- Google — the same correction the Board 8 coverage card needed in August.
    'unknown',     coalesce((select invoiced from rows where src = 'Other / Unknown'), 0),
    'by_source', coalesce((
      select jsonb_agg(x order by (x->>'invoiced')::numeric desc)
      from (
        select jsonb_build_object(
          'source',        src,
          'source_group',  source_group,
          'cost_type',     cost_type,
          'invoiced',      invoiced,
          'collected',     collected,
          'invoice_count', invoice_count,
          'client_count',  client_count
        ) x
        from rows
      ) y
    ), '[]'::jsonb)
  ) end
$function$;

revoke all on function public.scoreboard_revenue_by_source(uuid, date, date, text) from anon;
revoke all on function public.scoreboard_revenue_by_source(uuid, date, date, text) from authenticated;
revoke all on function public.scoreboard_revenue_by_source(uuid, date, date, text) from public;
grant execute on function public.scoreboard_revenue_by_source(uuid, date, date, text) to service_role;
