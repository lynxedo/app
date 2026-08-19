-- Applied to the shared DB on 2026-08-19 as migrations
--   scoreboard_goals_expansion_2026_08_19  and  scoreboard_goals_data_floor_2026_08_19
-- Recorded here so the schema history lives in the repo alongside the code.
--
-- A fourth migration, scoreboard_goals_use_period_expansion_2026_08_19, pointed the
-- row source at scoreboard_goal_periods so a repeating target is judged once per
-- period -- see 2026-08-19_goals_repeat_and_scope.sql. It was applied by patching the
-- deployed definition in place, guarded to refuse unless each of its three anchors
-- matched exactly once, and this file carries the result.
--
-- A third migration, scoreboard_goals_collection_rate_period_end_2026_08_19,
-- moved collection_rate to 'period_end' after a real August payload showed the
-- month-to-date rate reading 91.4% against a 95% target while July finished at
-- 99.98%: money needs time to arrive, so an invoice raised three days ago is not a
-- collection failure. It was applied by patching the deployed definition in place,
-- guarded to refuse unless exactly one properties row matched, and this file
-- carries the result.
--
-- Verified against the deployed function rather than assumed: with comments
-- stripped and whitespace and case normalised, this file and the live body are
-- byte-identical (md5 0f7a45c0df8ecf0e907ab66d5d327200, 9,271 chars). The two
-- differ only in comment prose.
--
-- Widens Goals & Targets from 7 measures to 23 (Ben: "There is nothing about
-- visit revenue only invoiced. Get creative and add more goals.") and adds the
-- three things the new measures need in order to be judged honestly. See
-- lib/reports/goals.ts for the catalog and the reasoning behind each field.
--
-- ⚠⚠ THREE NEW IDEAS IN THE STATUS LOGIC, each forced by a specific measure:
--
--  1. DIRECTION. Every measure until now was higher-is-better and the status
--     logic simply assumed it. Labour cost %, missed calls and reply time are
--     ceilings — hit by coming in at or BELOW the target. Without this a cost
--     overrun would be reported as an achievement. Attainment is inverted for
--     them too (target / actual), so 23.8% labour against a 22% target reads
--     92% and colours amber, instead of 108% and green.
--
--  2. JUDGE AT PERIOD END. Retention and churn can only be read as a share of
--     the whole year's book, so they start near-perfect in January and only
--     worsen. Scored the ordinary way an annual retention target would read
--     "Hit" from the first week and turn red in December. Those measures show
--     their running figure and withhold the verdict ('pending') until the
--     period is over.
--
--  3. A PROPERTIES GATE THAT FAILS LOUD. A metric key absent from the p(...)
--     list below gets NO actual and reads "No data" on the report, rather than
--     being judged by whatever the defaults happen to be. Forgetting to add a
--     new measure here is then visible, instead of silently inverting a verdict.
--
-- ⚠ PER-PERIOD SOURCE CACHE. The old function called a report function once per
-- goal, which was fine at 7 measures and is not at 23: a month with a dozen
-- sales targets would have called scoreboard_sales twelve times for the same
-- window. Goals are read period-major (the ORDER BY guarantees it), so one cache
-- slot per source is enough — the same trick the people lookup already used,
-- extended to every source. A period now costs at most one call per source, and
-- only for the sources its targets actually use.
--
-- ⚠⚠ visit_revenue READS scoreboard_visit_revenue, NOT scoreboard_crew_labor.
-- Crew clamps its window to the days timeclock data covers, because it divides
-- revenue by clocked hours. That clamp is safe for a RATE (both halves move
-- together) and unsafe for a TOTAL, where it silently shortens the period and
-- the target reads behind for a reason that has nothing to do with the work. The
-- two agree to the cent on today's data ($464,552.07 for 2026), so the unclamped
-- source changes no number now — it is protection against the first day a visit
-- is completed after the last timeclock punch.

create or replace function public.scoreboard_goals(p_company_id uuid, p_start date, p_end date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  g record;
  v_rows jsonb := '[]'::jsonb;
  v_actual numeric;
  v_total int;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_elapsed numeric;
  v_expected numeric;
  v_attain numeric;
  v_cumulative boolean;
  v_direction text;
  v_judge text;
  v_status text;
  -- One cache slot per source, all keyed on the period below.
  v_period_key text;
  v_invoice jsonb;
  v_invoiced numeric;
  v_clients jsonb;
  v_sales jsonb;
  v_quotes jsonb;
  v_crew jsonb;
  v_comms jsonb;
  v_churn jsonb;
  v_visit_rev numeric;
  v_people jsonb;
  v_person jsonb;
  v_person_name text;
begin
  if not public.scoreboard_reports_allowed(p_company_id) then
    return null;
  end if;

  -- ⚠ Counted from the SAME expansion the loop reads, so the truncation note can
  -- never disagree with the list it describes.
  select count(*) into v_total
  from public.scoreboard_goal_periods(p_company_id, p_start, p_end, v_today);

  for g in
    -- ⚠ Repeating targets are already expanded into one row per period here, so a
    -- "monthly" target is judged month by month rather than once.
    select * from public.scoreboard_goal_periods(p_company_id, p_start, p_end, v_today)
    -- ⚠ Period first, and this is load-bearing rather than cosmetic: every source
    -- cache below holds ONE period, so goals must arrive period-major or each
    -- would refill it. Company rows ahead of person rows so the table reads
    -- company-then-people within a period.
    order by period_start desc, (employee_id is not null), metric
    limit 60
  loop
    -- A new period invalidates every cached source at once.
    if v_period_key is distinct from (g.period_start::text || '|' || g.period_end::text) then
      v_period_key := g.period_start::text || '|' || g.period_end::text;
      v_invoice := null; v_clients := null; v_sales := null; v_quotes := null;
      v_crew := null; v_comms := null; v_churn := null; v_visit_rev := null;
      v_people := null;
    end if;

    v_person := null;
    v_person_name := null;
    v_cumulative := null;
    v_direction := null;
    v_judge := null;

    -- How this measure is judged. ⚠ A key missing here leaves v_cumulative null,
    -- which skips the actual entirely and reports "No data" — loud, not guessed.
    select p.cumulative, p.direction, p.judge
      into v_cumulative, v_direction, v_judge
    from (values
      ('invoiced',               true,  'higher', 'running'),
      ('collected',              true,  'higher', 'running'),
      ('collection_rate',        false, 'higher', 'period_end'),
      ('leads',                  true,  'higher', 'running'),
      ('won_value',              true,  'higher', 'running'),
      ('new_business_value',     true,  'higher', 'running'),
      ('upsell_value',           true,  'higher', 'running'),
      ('won_count',              true,  'higher', 'running'),
      ('avg_deal',               false, 'higher', 'running'),
      ('close_rate',             false, 'higher', 'running'),
      ('quotes_sent',            true,  'higher', 'running'),
      ('quote_win_rate',         false, 'higher', 'running'),
      ('visit_revenue',          true,  'higher', 'running'),
      ('rev_per_visit',          false, 'higher', 'running'),
      ('rev_per_labor_hour',     false, 'higher', 'running'),
      ('labor_pct',              false, 'lower',  'running'),
      ('new_customers',          true,  'higher', 'running'),
      ('retention_pct',          false, 'higher', 'period_end'),
      ('controllable_churn_pct', false, 'lower',  'period_end'),
      ('missed_call_pct',        false, 'lower',  'running'),
      ('answer_seconds',         false, 'lower',  'running'),
      ('reply_seconds',          false, 'lower',  'running'),
      ('outbound_calls',         true,  'higher', 'running')
    ) as p(metric, cumulative, direction, judge)
    where p.metric = g.metric;

    if v_cumulative is null then
      -- Unknown measure: no actual, no verdict. The card says so.
      v_actual := null;

    elsif g.employee_id is null then
      -- ── Company-wide ──────────────────────────────────────────────────────
      -- Fill only the source this measure needs, once per period.
      if g.metric in ('invoiced','collected','collection_rate') and v_invoice is null then
        v_invoice := (public.scoreboard_invoice_window(p_company_id, g.period_start, g.period_end))::jsonb;
      end if;
      if g.metric = 'new_customers' and v_clients is null then
        v_clients := (public.scoreboard_clients(p_company_id, g.period_start, g.period_end))::jsonb;
      end if;
      if g.metric in ('leads','won_value','new_business_value','upsell_value','won_count','avg_deal','close_rate')
         and v_sales is null then
        v_sales := (public.scoreboard_sales(p_company_id, g.period_start, g.period_end))::jsonb;
      end if;
      if g.metric in ('quotes_sent','quote_win_rate') and v_quotes is null then
        v_quotes := (public.scoreboard_quotes(p_company_id, g.period_start, g.period_end))::jsonb;
      end if;
      if g.metric in ('rev_per_visit','rev_per_labor_hour','labor_pct') and v_crew is null then
        v_crew := (public.scoreboard_crew_labor(p_company_id, g.period_start, g.period_end))::jsonb;
      end if;
      if g.metric in ('missed_call_pct','answer_seconds','reply_seconds','outbound_calls') and v_comms is null then
        v_comms := (public.scoreboard_communications(p_company_id, g.period_start, g.period_end))::jsonb;
      end if;
      -- ⚠ The unclamped revenue source. See the header.
      if g.metric = 'visit_revenue' and v_visit_rev is null then
        select coalesce(sum(vr.total), 0) into v_visit_rev
        from public.scoreboard_visit_revenue(p_company_id, g.period_start, g.period_end, 'month') vr;
      end if;
      -- ⚠ Retention and churn come from a function that takes a YEAR, so they are
      -- answerable only for a whole calendar year. The API refuses other grains;
      -- a row that got in anyway gets no actual rather than a figure for the
      -- wrong span.
      if g.metric in ('retention_pct','controllable_churn_pct') then
        if g.grain = 'year'
           and extract(year from g.period_start) = extract(year from g.period_end)
           and v_churn is null then
          v_churn := public.scoreboard_churn_summary(p_company_id, extract(year from g.period_start)::int);
        end if;
      end if;

      v_invoiced := nullif(v_invoice->>'invoiced', '')::numeric;

      v_actual := case g.metric
        when 'invoiced'  then nullif(v_invoice->>'invoiced', '')::numeric
        when 'collected' then nullif(v_invoice->>'collected', '')::numeric
        -- Derived from the SAME call as the two totals beside it, so the rate can
        -- never disagree with them. Null when nothing was billed: a period with
        -- no invoices has no collection rate, and 0% would read as a failure.
        when 'collection_rate' then case when coalesce(v_invoiced, 0) > 0
          then round(100 * nullif(v_invoice->>'collected', '')::numeric / v_invoiced, 1) end
        when 'new_customers' then nullif(v_clients->>'new_in_window', '')::numeric
        when 'leads'         then nullif(v_sales->>'leads', '')::numeric
        when 'won_value'     then nullif(v_sales->>'won_value', '')::numeric
        -- ⚠ New business by SUBTRACTION, exactly as the commission bases derive
        -- it, so the three sales measures cannot disagree about what a deal was.
        -- ⚠ Null-preserving: `greatest(coalesce(a,0) - coalesce(b,0), 0)` alone would
        -- turn "no data at all" into a confident 0, which reads as a miss rather
        -- than as nothing to measure.
        when 'new_business_value' then case when v_sales->>'won_value' is not null then greatest(
          coalesce(nullif(v_sales->>'won_value', '')::numeric, 0)
          - coalesce(nullif(v_sales->>'upsold_value', '')::numeric, 0), 0) end
        when 'upsell_value'  then nullif(v_sales->>'upsold_value', '')::numeric
        when 'won_count'     then nullif(v_sales->>'won', '')::numeric
        when 'avg_deal'      then nullif(v_sales->>'avg_deal', '')::numeric
        when 'close_rate'    then nullif(v_sales->>'close_rate', '')::numeric
        when 'quotes_sent'   then nullif(v_quotes->>'sent', '')::numeric
        -- Null below the fair-rating floor the Quotes report itself uses.
        when 'quote_win_rate' then nullif(v_quotes->>'win_rate', '')::numeric
        when 'visit_revenue' then v_visit_rev
        when 'rev_per_visit' then nullif(v_crew->>'rev_per_visit', '')::numeric
        when 'rev_per_labor_hour' then nullif(v_crew->>'rev_per_hour', '')::numeric
        when 'labor_pct'     then nullif(v_crew->>'labor_pct', '')::numeric
        when 'retention_pct' then nullif(v_churn->>'retention_pct', '')::numeric
        when 'controllable_churn_pct' then nullif(v_churn->>'controllable_churn_pct', '')::numeric
        when 'missed_call_pct' then nullif(v_comms->>'missed_pct', '')::numeric
        -- Stored and compared in whole seconds: a target of 20 means 20 seconds.
        when 'answer_seconds' then round(nullif(v_comms->>'median_answer_sec', '')::numeric)
        when 'reply_seconds'  then round(nullif(v_comms->>'median_reply_sec', '')::numeric)
        when 'outbound_calls' then nullif(v_comms->>'outbound_calls', '')::numeric
        else null
      end;

      -- ⚠⚠ A period entirely BEFORE a source's first record reads "No data", never
      -- zero. Found while testing: an invoiced target for 2025 reported $0 against
      -- $10,000 and a red "Missed", and an outbound-call target for March reported
      -- 0 of 400 — both failures the business never had, because the invoice mirror
      -- starts 2026-01-02 and the dialer 2026-05-25. A count silently reads zero
      -- where a rate already nulls itself, so the two halves of one family
      -- disagreed about what "we have no data" looks like.
      --
      -- ⚠ Only the sources that publish their own floor can do this. Leads, quotes
      -- and visit revenue expose none, so a period before their history still reads
      -- zero; lib/reports/goals.ts records that.
      if v_actual is not null then
        v_actual := case
          when g.metric in ('invoiced','collected','collection_rate')
            and coalesce(nullif(v_invoice->>'earliest_invoice','')::date, 'infinity'::date) > g.period_end
            then null
          when g.metric = 'new_customers'
            and coalesce(nullif(v_clients->'coverage'->>'first_client','')::date, 'infinity'::date) > g.period_end
            then null
          when g.metric in ('missed_call_pct','answer_seconds','outbound_calls')
            and coalesce(nullif(v_comms->'coverage'->>'first_call','')::date, 'infinity'::date) > g.period_end
            then null
          when g.metric = 'reply_seconds'
            and coalesce(nullif(v_comms->'coverage'->>'first_text','')::date, 'infinity'::date) > g.period_end
            then null
          else v_actual
        end;
      end if;

    else
      -- ── One person ────────────────────────────────────────────────────────
      -- Scoped to this company as well as this id: an employee_id alone is not
      -- authorization, and a stray cross-tenant id must resolve to nothing.
      select nullif(trim(
               coalesce(nullif(trim(coalesce(e.preferred_name, '')), ''), e.first_name, '')
               || ' ' || coalesce(e.last_name, '')
             ), '')
      into v_person_name
      from employees e
      where e.id = g.employee_id and e.company_id = p_company_id;

      if v_people is null then
        v_people := public.scoreboard_people(p_company_id, g.period_start, g.period_end);
      end if;

      select e into v_person
      from jsonb_array_elements(coalesce(v_people->'people', '[]'::jsonb)) e
      where e->>'employee_id' = g.employee_id::text;

      -- ⚠ EVERY personal figure comes out of scoreboard_people — the composer the
      -- People report and commission are both built on — so a person's target
      -- cannot disagree with the report it is judged against. Which is also why
      -- the list here is shorter than the company one: a measure absent from that
      -- composer is company-only, and the API refuses it per person.
      v_actual := case g.metric
        when 'leads'     then nullif(v_person->'sales'->>'leads', '')::numeric
        when 'won_value' then nullif(v_person->'sales'->>'sold_value', '')::numeric
        -- Null-preserving for the same reason as the company branch above: somebody
        -- absent from the People composer has no figure, not a figure of zero.
        when 'new_business_value' then case when v_person->'sales'->>'sold_value' is not null then greatest(
          coalesce(nullif(v_person->'sales'->>'sold_value', '')::numeric, 0)
          - coalesce(nullif(v_person->'sales'->>'upsold_value', '')::numeric, 0), 0) end
        when 'upsell_value' then nullif(v_person->'sales'->>'upsold_value', '')::numeric
        when 'won_count'    then nullif(v_person->'sales'->>'won', '')::numeric
        when 'avg_deal'     then nullif(v_person->'sales'->>'avg_deal', '')::numeric
        -- Null below the fair-rating floor (scoreboard_people.rate_min_sample),
        -- so a rep with three decisions reads "no data" rather than a rate the
        -- People report itself refuses to state.
        when 'close_rate'   then nullif(v_person->'sales'->>'close_rate', '')::numeric
        -- ⚠ A visit worked by two people credits BOTH, so personal figures do not
        -- add up to the company one. That is the same rule the technician charts
        -- state on their face, and it is correct for an individual's target.
        when 'visit_revenue' then nullif(v_person->'field'->>'revenue', '')::numeric
        when 'rev_per_labor_hour' then nullif(v_person->'field'->>'rev_per_hour', '')::numeric
        else null
      end;
    end if;

    v_elapsed := case
      when v_today > g.period_end then 1
      when v_today < g.period_start then 0
      else (v_today - g.period_start + 1)::numeric / nullif((g.period_end - g.period_start + 1), 0)
    end;
    v_expected := case when v_cumulative and v_elapsed > 0 then round(g.target * v_elapsed, 2) end;

    -- ⚠⚠ Attainment is INVERTED for a ceiling measure. 23.8% labour against a 22%
    -- target is a miss; computed the other way up it reads 108% and the progress
    -- bars would colour it green.
    v_attain := case
      when v_actual is null or g.target <= 0 then null
      when v_direction = 'lower' then
        case when v_actual > 0 then round(100 * g.target / v_actual, 1) else 100 end
      else round(100 * v_actual / g.target, 1)
    end;

    v_status := case
      when v_actual is null then 'unknown'
      when v_elapsed = 0 then 'open'
      -- ⚠⚠ No verdict yet for a measure that can only be read as a share of the
      -- whole period. See the header: an annual retention target would otherwise
      -- read "Hit" every January, because nobody has cancelled yet.
      when v_judge = 'period_end' and v_today <= g.period_end then 'pending'
      when v_direction = 'lower' then case
        when v_actual <= g.target then 'hit'
        when v_today > g.period_end then 'missed'
        -- 'over' is the ceiling equivalent of 'under': being under a cost target
        -- is the good outcome, so the two cannot share a word.
        when not v_cumulative then 'over'
        when v_expected is not null and v_actual <= v_expected then 'on_track'
        else 'behind'
      end
      when v_actual >= g.target then 'hit'
      when v_today > g.period_end then 'missed'
      when not v_cumulative then 'under'
      when v_expected is not null and v_actual >= v_expected then 'on_track'
      else 'behind'
    end;

    v_rows := v_rows || jsonb_build_object(
      -- ⚠ A repeating target yields several rows from ONE stored row, so the id has
      -- to carry the period or the table would hand React duplicate keys.
      'id', case when g.repeating then g.goal_id::text || ':' || g.period_start::text
                 else g.goal_id::text end,
      'repeating', g.repeating,
      'metric', g.metric,
      'grain', g.grain,
      'period_start', g.period_start,
      'period_end', g.period_end,
      'target', g.target,
      'actual', v_actual,
      'attainment_pct', v_attain,
      'elapsed_pct', round(100 * v_elapsed, 1),
      'expected_by_now', v_expected,
      'cumulative', v_cumulative,
      'closed', v_today > g.period_end,
      'status', v_status,
      'direction', v_direction,
      'employee_id', g.employee_id,
      'person_name', v_person_name
    );
  end loop;

  return jsonb_build_object(
    'as_of', v_today,
    'goals', v_rows,
    'total_in_window', v_total,
    'shown', jsonb_array_length(v_rows)
  );
end
$function$;
