/* Superseding a commission rule instead of overwriting it.
 *
 * `effective_from`/`effective_to` shipped earlier today, but nothing USED them: editing
 * a rule still mutated the single undated row, so changing a rate still rewrote every
 * month already paid. April 2026 was paid a flat $35 per upsell and cannot be
 * reproduced today because the rule now reads 5%. The columns were the mechanism; this
 * is the operation.
 *
 * Superseding is TWO writes — end-date the old version, insert the new one — and they
 * must not half-apply:
 *
 *   ⚠⚠ INSERT-THEN-UPDATE would, on a failed update, leave TWO undated rules covering
 *   the same period and pay the bonus TWICE.
 *   ⚠⚠ UPDATE-THEN-INSERT would, on a failed insert, leave a GAP and pay nothing.
 *
 * Neither is acceptable from a route that cannot open a transaction across two REST
 * calls, so both writes happen here, in one statement, atomically. A double payment is
 * the worse of the two failures and this makes it impossible.
 *
 * ⚠ The new row is passed as jsonb rather than as twenty parameters: the ROUTE has
 * already validated every field (rate kind against basis, target required on a flat
 * target rule, price floor only with a verify source, and so on) and this function is
 * deliberately not a second, drifting copy of those rules. What it does check is the
 * things only the database can: that the old rule exists, belongs to this company, and
 * that the new version starts after the old one began.
 *
 * ⚠⚠ SERVICE ROLE ONLY, like every other function touching pay. The caller is
 * `/api/admin/commission`, which has already established that the session is an admin
 * of `p_company_id`; the company scope is re-applied on every write here anyway,
 * because an id arriving from a browser proves only that a row exists.
 *
 * ROLLBACK: drop function public.commission_plan_supersede(uuid,uuid,date,jsonb);
 * — the editor falls back to plain overwrite, which is what it did before today.
 */

create or replace function public.commission_plan_supersede(
  p_company_id uuid,
  p_old_id uuid,
  /* The day the NEW version takes effect. The old one is closed the day before. */
  p_from date,
  p_new jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old  public.commission_plans;
  v_new_id uuid;
begin
  -- ⚠ Locked, so two admins superseding the same rule at once cannot both succeed and
  -- leave two overlapping versions.
  select * into v_old
  from public.commission_plans
  where id = p_old_id and company_id = p_company_id
  for update;

  if v_old.id is null then
    raise exception 'no such rule for this company' using errcode = 'no_data_found';
  end if;

  /* ⚠ A new version cannot start on or before the old one's own start — that would
   * leave the old version covering nothing while still existing, which reads on the
   * card as a rule that mysteriously stopped applying to its own period. */
  if v_old.effective_from is not null and p_from <= v_old.effective_from then
    raise exception 'the new version must start after % , when the current one began', v_old.effective_from
      using errcode = 'check_violation';
  end if;

  -- Close the old version the day before the new one starts.
  update public.commission_plans
     set effective_to = p_from - 1, updated_at = now()
   where id = p_old_id and company_id = p_company_id;

  /* The new version. ⚠ `company_id` and `effective_from` are taken from the PARAMETERS,
   * never from the payload, so a crafted body cannot write into another tenant or
   * back-date itself over a closed period. */
  insert into public.commission_plans (
    company_id, employee_id, label, basis, rate_kind, rate, tiers, threshold, cap,
    line_prefix, items, active, sort_order,
    period, tier_mode, verify_source, min_price, exclude_renewals,
    effective_from, effective_to, created_by
  ) values (
    p_company_id,
    (p_new->>'employee_id')::uuid,
    p_new->>'label',
    p_new->>'basis',
    p_new->>'rate_kind',
    nullif(p_new->>'rate','')::numeric,
    case when p_new->'tiers' = 'null'::jsonb then null else p_new->'tiers' end,
    nullif(p_new->>'threshold','')::numeric,
    nullif(p_new->>'cap','')::numeric,
    nullif(p_new->>'line_prefix',''),
    case when p_new->'items' = 'null'::jsonb or p_new->'items' is null then null
         else (select array_agg(x) from jsonb_array_elements_text(p_new->'items') x) end,
    coalesce((p_new->>'active')::boolean, true),
    coalesce((p_new->>'sort_order')::int, 0),
    coalesce(p_new->>'period','month'),
    coalesce(p_new->>'tier_mode','marginal'),
    nullif(p_new->>'verify_source',''),
    nullif(p_new->>'min_price','')::numeric,
    coalesce((p_new->>'exclude_renewals')::boolean, false),
    p_from,
    null,
    nullif(p_new->>'created_by','')::uuid
  )
  returning id into v_new_id;

  return v_new_id;
end
$function$;

revoke all on function public.commission_plan_supersede(uuid,uuid,date,jsonb) from public;
revoke all on function public.commission_plan_supersede(uuid,uuid,date,jsonb) from anon;
revoke all on function public.commission_plan_supersede(uuid,uuid,date,jsonb) from authenticated;
grant execute on function public.commission_plan_supersede(uuid,uuid,date,jsonb) to service_role;
