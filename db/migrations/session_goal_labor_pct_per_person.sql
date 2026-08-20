-- Goals & Targets: "Labour cost as a share of revenue" for ONE person.
--
-- Until now this measure was company-only, and the Goals form said so:
-- "this divides wages by COMPANY revenue, which is not fanned out per person."
-- That was true of the COMPANY calculation and of nothing else. The per-person
-- figure already exists and is already trusted twice over --
-- `kpi_person_labor_cost_pct` puts it on a scoreboard, and the commission
-- engine PAYS on it (`labor_pct` basis) -- because `scoreboard_crew_labor`
-- holds each person's pay and each person's credited revenue side by side.
--
-- The only thing missing was plumbing: `scoreboard_people`, the composer every
-- personal target is judged against, copied hours/revenue/rate across from crew
-- and dropped the pay figure. So the goals function genuinely could not see it,
-- and saying so was more honest than guessing. This carries it across and
-- computes the share ONCE, in the composer, so a target, the card beside it and
-- the bonus paid on it cannot disagree.
--
-- ⚠⚠ A person's percentage is NOT a smaller version of the company's. The
-- company figure divides all field pay by ALL completed work, including work no
-- technician is credited with. A person's divides their pay by the work credited
-- to them. Do not carry one target across to the other.
--
-- ⚠ Guarded to `rankable` and credited revenue > 0 -- exactly the test the
-- per-person card uses, so the two never disagree about WHO can be measured.
-- Somebody with real pay and no credited work is not 0%; they are unmeasurable,
-- and read "No data". (Bonnie Simpson reads 80% on the live book for precisely
-- this reason, which is why the commission basis carries the same caution.)
--
-- Applied by editing the live definitions rather than restating 26KB of SQL:
-- every anchor is asserted, so a miss ABORTS instead of silently re-creating
-- the function unchanged.

do $migration$
declare
  v_src text;
  v_new text;
  v_anchor text;
begin
  -- ── 1. scoreboard_people: carry each person's pay across ──────────────────
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'scoreboard_people';

  if v_src is null then
    raise exception 'scoreboard_people(uuid,date,date) not found';
  end if;
  v_new := v_src;

  -- 1a. read labor_cost out of the crew source, beside hours and revenue
  v_anchor := $a$nullif(p->>'rev_per_hour','')::numeric as rph,$a$;
  if position(v_anchor in v_new) = 0 then
    raise exception 'scoreboard_people: crew_people anchor not found';
  end if;
  v_new := replace(v_new, v_anchor,
    v_anchor || E'\n           nullif(p->>''labor_cost'','''')::numeric   as labor_cost,');

  -- 1b. carry it through the people CTE
  v_anchor := $a$cp.dept, cp.hours, cp.revenue, cp.rph, cp.rankable, cp.attributable,$a$;
  if position(v_anchor in v_new) = 0 then
    raise exception 'scoreboard_people: people-CTE anchor not found';
  end if;
  v_new := replace(v_new, v_anchor,
    $a$cp.dept, cp.hours, cp.revenue, cp.rph, cp.rankable, cp.attributable, cp.labor_cost,$a$);

  -- 1c. publish the pay figure and the share it works out to
  v_anchor := $a$          'rev_per_hour', p.rph,
          'rankable',     coalesce(p.rankable, false),$a$;
  if position(v_anchor in v_new) = 0 then
    raise exception 'scoreboard_people: field-block anchor not found';
  end if;
  v_new := replace(v_new, v_anchor,
    $a$          'rev_per_hour', p.rph,
          'labor_cost',   p.labor_cost,
          -- Their pay over the work credited to THEM -- both halves belong to the
          -- same person, which is the whole reason this is honest and the company
          -- ratio cannot be split. Null unless they are rankable and have credited
          -- revenue: a share of nothing is unmeasurable, not 0%.
          'labor_pct',    case when coalesce(p.rankable, false) and coalesce(p.revenue, 0) > 0
                               then round(100 * p.labor_cost / p.revenue, 1) end,
          'rankable',     coalesce(p.rankable, false),$a$);

  execute v_new;

  -- ── 2. scoreboard_goals: let a person's target be judged on it ────────────
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'scoreboard_goals';

  if v_src is null then
    raise exception 'scoreboard_goals not found';
  end if;
  v_new := v_src;

  v_anchor := $a$when 'rev_per_labor_hour' then nullif(v_person->'field'->>'rev_per_hour', '')::numeric$a$;
  if position(v_anchor in v_new) = 0 then
    raise exception 'scoreboard_goals: per-person metric anchor not found';
  end if;
  v_new := replace(v_new, v_anchor,
    v_anchor || E'\n        -- Their pay over their own credited work. NOT a slice of the company\n'
             || E'        -- percentage: that one divides by all completed work, including work\n'
             || E'        -- nobody is credited with, so the two are different questions.\n'
             || $a$        when 'labor_pct'          then nullif(v_person->'field'->>'labor_pct', '')::numeric$a$);

  execute v_new;
end
$migration$;
