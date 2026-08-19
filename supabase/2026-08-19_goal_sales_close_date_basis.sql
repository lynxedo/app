/* Sales TARGETS count a deal in the period it was sold, matching commission.
 *
 * Follows 2026-08-19_commission_close_date_basis.sql. Ben chose to move targets too,
 * so a sales target and the bonus paid on it cannot disagree.
 *
 * FIVE measures move: won_value, new_business_value, upsell_value, won_count, avg_deal.
 *
 * ⚠⚠ TWO DELIBERATELY DO NOT. `leads` is a question about arrivals by definition. And
 * `close_rate` measured over the deals that CLOSED would read 100% by construction —
 * there the cohort IS the denominator. Both keep the arrival cohort, and the Goals card
 * says so on screen rather than leaving the asymmetry to be discovered.
 *
 * Adds the company-level close-date totals to scoreboard_sales (derived from the
 * closed_cohort added by the previous migration) and `avg_deal_closed` to a person's
 * sales block in scoreboard_people, then repoints the five metrics in BOTH branches of
 * scoreboard_goals — the company one and the per-person one.
 *
 * Verified after applying: every one of Heroes' 12 live goal rows is byte-identical to
 * the values captured before the change (the only target reading the sales block is
 * Mike's August upsell target, $1,184 on either basis, so nothing moved) — and the new
 * basis proven to bite by inserting a hypothetical "value sold" target inside a
 * transaction that was rolled back: $7,945 / hit, where the old basis gave $4,285.
 * ACLs re-checked on all three functions: service_role only.
 *
 * Applied to the shared DB 2026-08-19.
 *
 * ROLLBACK: repoint the five `when` branches in scoreboard_goals back to the
 * non-`_closed` keys. The added keys can stay — nothing else reads them.
 */

do $mig$
declare
  src text; out text; n int;
  a_key text := E'    ''by_salesperson_closed'', coalesce((';
  ins_tot text := E'    ''won_closed'',           (select count(*) from closed_cohort where won),\n    ''won_value_closed'',     (select coalesce(round(sum(annual_value) filter (where won),2), 0) from closed_cohort),\n    ''upsold_closed'',        (select count(*) from closed_cohort where upsold),\n    ''upsold_value_closed'',  (select coalesce(round(sum(annual_value) filter (where upsold),2), 0) from closed_cohort),\n    ''avg_deal_closed'',      (select case when count(*) filter (where won) > 0 then round(sum(annual_value) filter (where won) / count(*) filter (where won), 2) end from closed_cohort),\n\n';
begin
  src := pg_get_functiondef('public.scoreboard_sales(uuid,date,date)'::regprocedure);
  if position('won_value_closed' in src) > 0 then raise notice 'sales already has the totals'; return; end if;
  out := src;
  n := (length(out) - length(replace(out, a_key, ''))) / length(a_key);
  if n <> 1 then raise exception 'by_salesperson_closed anchor x%', n; end if;
  execute replace(out, a_key, ins_tot || a_key);
end $mig$;

do $mig$
declare
  src text; out text; n int;
  a_emit text := E'          ''upsold_value_closed'', coalesce(p.upsold_value_closed, 0),\n';
  ins_emit text := E'          ''avg_deal_closed'',      case when coalesce(p.won_closed, 0) > 0 then round(p.sold_closed / p.won_closed, 2) end,\n';
begin
  src := pg_get_functiondef('public.scoreboard_people(uuid,date,date)'::regprocedure);
  if position('avg_deal_closed' in src) > 0 then raise notice 'people already has avg_deal_closed'; return; end if;
  out := src;
  n := (length(out) - length(replace(out, a_emit, ''))) / length(a_emit);
  if n <> 1 then raise exception 'emit anchor x%', n; end if;
  execute replace(out, a_emit, a_emit || ins_emit);
end $mig$;

do $mig$
declare
  src text; out text; n int;
  co_won  text := E'        when ''won_value''     then nullif(v_sales->>''won_value'', '''')::numeric';
  co_won_new text := E'        -- ⚠⚠ THE FIVE "HOW MUCH DID YOU SELL" MEASURES COUNT A DEAL IN THE PERIOD IT\n        -- WAS SOLD, not the period its lead arrived. Ben: "we want close date not lead\n        -- creation date." Same rule the commission bases use, so a sales target and the\n        -- bonus paid on it cannot disagree.\n        --\n        -- ⚠ ''leads'' and ''close_rate'' deliberately KEEP the arrival cohort. A lead count\n        -- is by definition about arrivals, and a close rate measured over deals that\n        -- closed would be 100% by construction — the cohort IS the denominator.\n        when ''won_value''     then nullif(v_sales->>''won_value_closed'', '''')::numeric';
  co_block text := E'        when ''new_business_value'' then case when v_sales->>''won_value'' is not null then greatest(\n          coalesce(nullif(v_sales->>''won_value'', '''')::numeric, 0)\n          - coalesce(nullif(v_sales->>''upsold_value'', '''')::numeric, 0), 0) end\n        when ''upsell_value''  then nullif(v_sales->>''upsold_value'', '''')::numeric\n        when ''won_count''     then nullif(v_sales->>''won'', '''')::numeric\n        when ''avg_deal''      then nullif(v_sales->>''avg_deal'', '''')::numeric';
  co_block_new text := E'        when ''new_business_value'' then case when v_sales->>''won_value_closed'' is not null then greatest(\n          coalesce(nullif(v_sales->>''won_value_closed'', '''')::numeric, 0)\n          - coalesce(nullif(v_sales->>''upsold_value_closed'', '''')::numeric, 0), 0) end\n        when ''upsell_value''  then nullif(v_sales->>''upsold_value_closed'', '''')::numeric\n        when ''won_count''     then nullif(v_sales->>''won_closed'', '''')::numeric\n        when ''avg_deal''      then nullif(v_sales->>''avg_deal_closed'', '''')::numeric';
  pe_won  text := E'        when ''won_value'' then nullif(v_person->''sales''->>''sold_value'', '''')::numeric';
  pe_won_new text := E'        when ''won_value'' then nullif(v_person->''sales''->>''sold_value_closed'', '''')::numeric';
  pe_block text := E'        when ''new_business_value'' then case when v_person->''sales''->>''sold_value'' is not null then greatest(\n          coalesce(nullif(v_person->''sales''->>''sold_value'', '''')::numeric, 0)\n          - coalesce(nullif(v_person->''sales''->>''upsold_value'', '''')::numeric, 0), 0) end\n        when ''upsell_value'' then nullif(v_person->''sales''->>''upsold_value'', '''')::numeric\n        when ''won_count''    then nullif(v_person->''sales''->>''won'', '''')::numeric\n        when ''avg_deal''     then nullif(v_person->''sales''->>''avg_deal'', '''')::numeric';
  pe_block_new text := E'        when ''new_business_value'' then case when v_person->''sales''->>''sold_value_closed'' is not null then greatest(\n          coalesce(nullif(v_person->''sales''->>''sold_value_closed'', '''')::numeric, 0)\n          - coalesce(nullif(v_person->''sales''->>''upsold_value_closed'', '''')::numeric, 0), 0) end\n        when ''upsell_value'' then nullif(v_person->''sales''->>''upsold_value_closed'', '''')::numeric\n        when ''won_count''    then nullif(v_person->''sales''->>''won_closed'', '''')::numeric\n        when ''avg_deal''     then nullif(v_person->''sales''->>''avg_deal_closed'', '''')::numeric';
begin
  src := pg_get_functiondef('public.scoreboard_goals(uuid,date,date)'::regprocedure);
  if position('won_value_closed' in src) > 0 then raise notice 'goals already on the close-date basis'; return; end if;
  out := src;
  n := (length(out) - length(replace(out, co_won, ''))) / length(co_won);
  if n <> 1 then raise exception 'company won_value anchor x%', n; end if;
  out := replace(out, co_won, co_won_new);
  n := (length(out) - length(replace(out, co_block, ''))) / length(co_block);
  if n <> 1 then raise exception 'company block anchor x%', n; end if;
  out := replace(out, co_block, co_block_new);
  n := (length(out) - length(replace(out, pe_won, ''))) / length(pe_won);
  if n <> 1 then raise exception 'person won_value anchor x%', n; end if;
  out := replace(out, pe_won, pe_won_new);
  n := (length(out) - length(replace(out, pe_block, ''))) / length(pe_block);
  if n <> 1 then raise exception 'person block anchor x%', n; end if;
  execute replace(out, pe_block, pe_block_new);
end $mig$;
