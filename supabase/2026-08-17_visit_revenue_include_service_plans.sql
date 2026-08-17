-- ===========================================================================
-- Count recurring service-plan line items as visit revenue
-- 2026-08-17
--
-- Ben: "I want to make sure the Visit revenue widget shows all revenue, all line
-- items, for the service line."
--
-- ⚠⚠ THE CODE CARRIED A COMMENT ASSERTING THE OPPOSITE, AND IT WAS WRONG.
-- `scoreboard_visit_revenue` read: "Exclude the annual membership plan line — it
-- rides on a visit only so it can be invoiced, but it is NOT per-visit revenue."
-- That claim is testable, so it was tested per job across 2026 before changing
-- anything:
--
--   tier        completed visits   visits carrying a plan   plan $ YTD   annual ÷ 4
--   IR Gold          1.82                1.82                 192.22        96.91
--   IR Silver        2.00                2.00                 199.81        99.90  exact
--   IR Bronze        1.00                1.00                  97.50        97.50  exact
--
-- The plan line lands on EVERY completed visit at exactly annual ÷ visits-per-year.
-- It is per-visit revenue. Excluding it was dropping the entire recurring half of the
-- irrigation book out of every revenue figure in the product.
--
-- ⚠ Aggregates alone would NOT have settled this. Gold's per-visit amounts range
-- $0–$400 against a $390 annual, so in aggregate the "annual fee riding once" reading
-- looks plausible. What killed it is that `visits carrying a plan` EQUALS
-- `completed visits` in all three tiers — the line is on every visit, not one.
--
-- MEASURED EFFECT (2026 YTD, through the real function paths):
--   visit revenue, company     435,025.14 -> 459,273.80   (+24,248.66)
--   visit revenue, IR line     211,989.36 -> 236,238.02   (+24,248.66, ALL of it)
--   crew revenue               432,281.14 -> 456,329.80
--   revenue per labour hour         86.79 ->      91.62
--   service line revenue       141,053.74 -> 145,146.07   (smaller: this one clamps
--                                                          to timeclock coverage)
-- Per technician, the increase lands only on irrigation, which is the coherence check
-- that matters: Lucas 61,209 -> 75,601 ($45.56 -> $56.27/hr), Angel 116,236 ->
-- 122,160, while Mike (Fert Tech) moves 196,662 -> 197,262 and Pet Waste not at all.
-- Lucas looked like the weakest performer partly because his plan revenue was absent.
--
-- Applied to all EIGHT functions that shared the exclusion, so there is ONE definition
-- of visit revenue rather than two disagreeing ones:
--   scoreboard_crew_labor · scoreboard_home_pulse · scoreboard_service_lines ·
--   scoreboard_service_lines_unclassified · scoreboard_tech_revenue ·
--   scoreboard_techs_revenue · scoreboard_visit_revenue · scoreboard_visit_revenue_trend
--
-- ⚠ `scoreboard_ir_repair_ticket` deliberately KEEPS the exclusion: a membership plan
-- is not a repair ticket. Same reasoning makes the exclusion list a SETTING on the new
-- `scoreboard_ticket_size`, rather than a rule baked in.
--
-- Rewritten programmatically rather than by hand so the eight cannot drift from each
-- other, and via CREATE OR REPLACE so every ACL is preserved (re-verified after: 0 of
-- the scoreboard_* functions are anon- or authenticated-executable).
-- ===========================================================================

do $$
declare
  fn record;
  src text;
  fixed text;
  n int := 0;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prosrc ilike '%Service Plan%'
      -- A plan is not a repair. This one is correct as it stands.
      and p.proname <> 'scoreboard_ir_repair_ticket'
    order by p.proname
  loop
    src := pg_get_functiondef(fn.oid);
    -- Remove only the predicate, leaving surrounding syntax — including the closing
    -- paren in scoreboard_service_lines_unclassified — untouched.
    fixed := regexp_replace(src, '\s+and\s+li\.name\s+not\s+ilike\s+''%Service Plan%''', '', 'gi');
    if fixed = src then
      raise exception 'no predicate matched in %, refusing to continue', fn.proname;
    end if;
    execute fixed;
    n := n + 1;
    raise notice 'rewrote %', fn.proname;
  end loop;
  -- Fail loudly rather than silently rewriting a different number than intended.
  if n <> 8 then
    raise exception 'expected 8 functions, rewrote %', n;
  end if;
end $$;

-- A comment that now contradicts the code beneath it is worse than no comment.
do $$
declare src text; fixed text; oid_ oid;
begin
  select p.oid into oid_ from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='scoreboard_visit_revenue';
  src := pg_get_functiondef(oid_);
  fixed := replace(
    src,
    '-- Exclude the annual membership plan line ("... Service Plan ...") — it rides on a'
    || E'\n  -- visit only so it can be invoiced, but it is NOT per-visit revenue.',
    '-- Membership plan lines ARE counted. A previous comment here claimed they rode on'
    || E'\n  -- a visit only to be invoiced and were not per-visit revenue; measured per job on'
    || E'\n  -- 2026-08-17 that is false — the plan line lands on EVERY completed visit at'
    || E'\n  -- exactly annual / visits-per-year (Silver $99.90, Bronze $97.50, both exact), so'
    || E'\n  -- excluding it dropped the whole recurring half of the irrigation book.');
  if fixed = src then
    raise notice 'comment not found — nothing to correct';
  else
    execute fixed;
    raise notice 'corrected the stale comment';
  end if;
end $$;
