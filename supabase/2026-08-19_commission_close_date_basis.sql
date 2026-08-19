/* Commission counts a sale in the period it was SOLD, not the period its lead arrived.
 *
 * Ben, asked directly: "we want close date not lead creation date. fix that."
 *
 * ⚠⚠ ADDITIVE, and that is the whole design. `scoreboard_sales`'s existing cohort —
 * leads CREATED in the window — is the right one for a funnel, because close rate and
 * lost reasons are questions about the leads that came in. It is the wrong one for
 * paying somebody: a lead that arrived in July and closed in August is August's work.
 * On Heroes' real August that gap was $4,285 vs $7,945 of basis for one person, and
 * $426 vs $718 of commission.
 *
 * So a SECOND cohort is added beside the first and exposed under its own key, rather
 * than merged into `by_salesperson`: a rep who closed a deal in the window but had no
 * new lead would otherwise appear as an extra all-zero row in the Sales report's person
 * chart — a visible change to a card nobody asked to change.
 *
 * Verified after applying: the existing figures reconcile to the cent against
 * independent SQL ($238,334.24 for 2026 YTD, 0 mismatches across every rep) and the new
 * ones do too ($240,682.24). ACLs re-checked after CREATE OR REPLACE — service_role
 * only, anon and authenticated false on both functions.
 *
 * ⚠ Written as guarded text edits on the LIVE function definitions rather than as
 * hand-retyped bodies, so nothing could be transcribed wrongly. Re-running is refused
 * rather than silently duplicating the CTE.
 *
 * Applied to the shared DB 2026-08-19.
 *
 * ROLLBACK: re-run this file's inverse by deleting the `closed_cohort` CTE and the
 * `by_salesperson_closed` key from scoreboard_sales, and the `sales_closed_rows` CTE,
 * its join, its four columns and its four emitted keys from scoreboard_people. Nothing
 * else reads them, so removing them cannot affect any other card — but the commission
 * cards must be reverted in the same deploy or they will read null and pay zero.
 */

do $mig$
declare
  src text; out text; n int;
  a_cohort text := E'  lost as (\n    select regexp_replace(';
  a_lost   text := E'    ''lost_reasons'', coalesce((';
  ins_cohort text := E'  closed_cohort as (\n    select l.*,\n      (l.stage = ''closed_won'') as competed_won,\n      (l.stage in (select key from sale_stages)) as upsold,\n      (l.stage = ''closed_won'' or l.stage in (select key from sale_stages)) as won,\n      coalesce(nullif(initcap(trim(lower(l.salesperson))),''''), ''Unassigned'') as rep\n    from leads l\n    where l.company_id = p_company_id\n      and l.sold_date between p_start and p_end\n  ),\n';
  ins_key text := E'    ''by_salesperson_closed'', coalesce((\n      select jsonb_agg(p order by (p->>''value'')::numeric desc)\n      from (\n        select jsonb_build_object(\n          ''name'', rep,\n          ''won'', count(*) filter (where won),\n          ''competed_won'', count(*) filter (where competed_won),\n          ''upsold'', count(*) filter (where upsold),\n          ''value'', coalesce(round(sum(annual_value) filter (where won),2), 0),\n          ''upsold_value'', coalesce(round(sum(annual_value) filter (where upsold),2), 0)\n        ) p\n        from closed_cohort group by rep\n      ) zc\n    ), ''[]''::jsonb),\n\n';
begin
  src := pg_get_functiondef('public.scoreboard_sales(uuid,date,date)'::regprocedure);
  if position('closed_cohort' in src) > 0 then
    raise notice 'scoreboard_sales already carries closed_cohort — skipping';
    return;
  end if;
  out := src;
  n := (length(out) - length(replace(out, a_cohort, ''))) / length(a_cohort);
  if n <> 1 then raise exception 'cohort anchor found % times, expected 1', n; end if;
  out := replace(out, a_cohort, ins_cohort || a_cohort);
  n := (length(out) - length(replace(out, a_lost, ''))) / length(a_lost);
  if n <> 1 then raise exception 'lost_reasons anchor found % times, expected 1', n; end if;
  out := replace(out, a_lost, ins_key || a_lost);
  execute out;
end $mig$;

do $mig$
declare
  src text; out text; n int;
  a_phone text := E'  phone as (\n    select coalesce(c.transferred_to_user_id';
  a_cols  text := E'           sr.value as sold, sr.upsold_value,\n';
  a_join  text := E'    left join sales_rows   sr on sr.skey  = r.fkey and coalesce(fc.n, 0) = 1\n';
  a_where text := E'       or cp.emp_id is not null or sr.skey is not null\n';
  a_emit  text := E'          ''upsold_value'', coalesce(p.upsold_value, 0),\n';
  ins_cte text := E'  sales_closed_rows as (\n    select lower(trim(s->>''name''))          as skey,\n           (s->>''won'')::int                 as won,\n           (s->>''competed_won'')::int        as competed_won,\n           (s->>''upsold'')::int              as upsold,\n           (s->>''value'')::numeric           as value,\n           (s->>''upsold_value'')::numeric    as upsold_value\n    from jsonb_array_elements(coalesce(v_sales->''by_salesperson_closed'', ''[]''::jsonb)) s\n  ),\n';
  ins_cols text := E'           scr.won as won_closed, scr.upsold as upsold_closed,\n           scr.value as sold_closed, scr.upsold_value as upsold_value_closed,\n';
  ins_join text := E'    left join sales_closed_rows scr on scr.skey = r.fkey and coalesce(fc.n, 0) = 1\n';
  ins_where text := E'       or scr.skey is not null\n';
  ins_emit text := E'          ''won_closed'',          coalesce(p.won_closed, 0),\n          ''upsold_closed'',       coalesce(p.upsold_closed, 0),\n          ''sold_value_closed'',   coalesce(p.sold_closed, 0),\n          ''upsold_value_closed'', coalesce(p.upsold_value_closed, 0),\n';
begin
  src := pg_get_functiondef('public.scoreboard_people(uuid,date,date)'::regprocedure);
  if position('sales_closed_rows' in src) > 0 then
    raise notice 'scoreboard_people already carries sales_closed_rows — skipping';
    return;
  end if;
  out := src;
  n := (length(out) - length(replace(out, a_phone, ''))) / length(a_phone);
  if n <> 1 then raise exception 'phone anchor x%', n; end if;
  out := replace(out, a_phone, ins_cte || a_phone);
  n := (length(out) - length(replace(out, a_cols, ''))) / length(a_cols);
  if n <> 1 then raise exception 'cols anchor x%', n; end if;
  out := replace(out, a_cols, a_cols || ins_cols);
  n := (length(out) - length(replace(out, a_join, ''))) / length(a_join);
  if n <> 1 then raise exception 'join anchor x%', n; end if;
  out := replace(out, a_join, a_join || ins_join);
  n := (length(out) - length(replace(out, a_where, ''))) / length(a_where);
  if n <> 1 then raise exception 'where anchor x%', n; end if;
  out := replace(out, a_where, a_where || ins_where);
  n := (length(out) - length(replace(out, a_emit, ''))) / length(a_emit);
  if n <> 1 then raise exception 'emit anchor x%', n; end if;
  out := replace(out, a_emit, a_emit || ins_emit);
  execute out;
end $mig$;
