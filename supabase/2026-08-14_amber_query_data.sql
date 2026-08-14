-- Amber / Hub Assistant: read-only SQL over the Jobber mirror + Hub ops data.
-- APPLIED to the shared DB 2026-08-14 as migration `amber_query_data_2026_08_14_v2`.
--
-- WHY THIS EXISTS
-- The assistant could only reach data one record at a time (search_clients,
-- get_client_details, get_jobs). A question like "all the service addresses of
-- the PW customers" therefore became a paginated crawl of an external API — one
-- API page per model turn — which could never finish inside the tool-iteration
-- cap. Meanwhile the answer was ONE query away in our own Postgres: the Jobber
-- mirror already holds it, and line_items.dept_prefix already encodes the
-- WF/IR/PW convention.
--
-- THE SECURITY MODEL — layers, strongest first:
--
--  1. GRANTS (the real gate). The dynamic SQL executes as `amber_reader`, a
--     NOLOGIN role holding SELECT on the `amber` views and NOTHING else — no
--     write privilege anywhere, no access to public.*, auth.*, or any credential
--     table. Enforced by Postgres, not by inspecting query text.
--
--     How the privilege drop happens: amber.run_query is SECURITY DEFINER and is
--     OWNED BY amber_reader, so its body runs with that role's tiny privilege set.
--     ⚠ Two other routes were tried and are dead ends worth recording:
--       * `SET role = amber_reader` as a function attribute -> Postgres refuses:
--         "cannot set parameter role within security-definer function".
--       * owning a function in `public` -> ALTER OWNER requires the new owner to
--         hold CREATE on the schema, and amber_reader must never have that.
--     Hence the executor lives in `amber` (where amber_reader can hold CREATE)
--     with a thin SECURITY DEFINER wrapper in `public`, because PostgREST only
--     exposes the public schema to supabase-js .rpc().
--
--     A useful side effect of SECURITY DEFINER: the same Postgres restriction
--     means the submitted SQL cannot SET/RESET role either, so there is no path
--     back up to the calling role.
--
--  2. THE VIEWS (allow-list + tenant scope). Every view filters
--     `company_id = amber.current_company()`, read from a GUC the function sets
--     from the resolved HubActor's company — never from model output. Unset ->
--     NULL -> the comparison is NULL -> ZERO rows. It fails closed. Views are
--     owned by the migration role, not amber_reader, so they can read the
--     underlying public tables while amber_reader still cannot touch those tables.
--
--  3. transaction_read_only, statement_timeout, a row cap, and a shape check
--     (SELECT/WITH only, single statement). Belt and braces.
--
-- VERIFIED after applying (all eight passed):
--   heroes PW count -> 17 clients   | WITH ... UPDATE -> rejected by Postgres
--   public.employees -> permission denied      | calls.coaching_grade -> no such column
--   null company -> refused         | public.jobber_tokens -> permission denied
--   DELETE -> rejected by shape check
--   grants: anon/authenticated cannot execute either function; service_role can
--   execute only the public wrapper; amber_reader cannot read public.employees.
--
-- ⚠ EXCLUDED ON PURPOSE — read before widening:
--   * employees / payroll_periods / timeclock: wage and hours data. Pay is one
--     division away from hours + rate, and this action is offered wherever
--     can_access_reports is held — not to Ben alone.
--   * calls.coaching_*: per-rep coaching grades are gated to can_access_coaching
--     (Ben only). Reaching them through SQL would be a side door around that
--     grant — the exact failure the August RPC lockdown fixed.
--   * every token/credential table: unreachable by construction, since the
--     allow-list is opt-in rather than deny-list.
--
-- ⚠ `select *` in a view is SNAPSHOTTED at creation — a column added to the
--   underlying table later does NOT appear here. Deliberate: a new column cannot
--   silently become readable. It also means surfacing a new column you DO want
--   requires recreating the view.
--
-- Reversible: drop function public.amber_query(uuid,text,int);
--             drop schema amber cascade; drop role amber_reader;

-- ---------------------------------------------------------------------------
-- 1. The low-privilege role the dynamic SQL executes as.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'amber_reader') then
    create role amber_reader nologin;
  end if;
  -- Needed so this role can hand amber_reader ownership of the executor.
  -- Membership lets postgres act as amber_reader; it grants amber_reader nothing.
  execute format('grant amber_reader to %I', current_user);
end
$$;

drop function if exists public.amber_query(uuid, text, int);
drop schema if exists amber cascade;
create schema amber;

-- CREATE is required for amber_reader to OWN the executor function below.
grant usage, create on schema amber to amber_reader;

-- ---------------------------------------------------------------------------
-- 2. Tenant scope + the allow-listed views.
-- ---------------------------------------------------------------------------
-- missing_ok = true: an unset setting returns NULL rather than raising, so every
-- view returns zero rows instead of leaking.
create or replace function amber.current_company() returns uuid
language sql stable as $$
  select nullif(current_setting('amber.company_id', true), '')::uuid
$$;

create view amber.clients as
  select * from public.clients
  where company_id = amber.current_company() and deleted_at is null;

create view amber.properties as
  select * from public.properties
  where company_id = amber.current_company() and deleted_at is null;

-- is_live: Jobber's job_status is a LABEL, not a fact. Only 11 Heroes jobs read
-- 'active' while 419 read 'upcoming' — filtering on 'active' under-reports ~40x.
-- Anything not archived is live.
create view amber.jobs as
  select t.*, (coalesce(t.job_status,'') <> 'archived') as is_live
  from public.jobs t
  where t.company_id = amber.current_company() and t.deleted_at is null;

create view amber.visits as
  select t.*, (t.completed_at is not null) as is_completed
  from public.visits t
  where t.company_id = amber.current_company() and t.deleted_at is null;

-- parent_type says what a line item hangs off ('job' | 'invoice' | 'quote').
-- Not filtering it double- or triple-counts revenue.
create view amber.line_items as
  select * from public.line_items
  where company_id = amber.current_company() and deleted_at is null;

create view amber.invoices as
  select * from public.invoices
  where company_id = amber.current_company() and deleted_at is null;

create view amber.quotes as
  select * from public.jobber_quotes
  where company_id = amber.current_company() and deleted_at is null;

create view amber.contacts as
  select * from public.txt_contacts
  where company_id = amber.current_company() and deleted_at is null;

create view amber.leads as
  select * from public.leads
  where company_id = amber.current_company();

create view amber.recurring_services as
  select * from public.recurring_services
  where company_id = amber.current_company();

-- Columns enumerated (NOT select *) so coaching_* stays out. See the note above.
create view amber.calls as
  select id, company_id, direction, from_number, to_number, status,
         duration_seconds, transcript, ai_summary, sentiment, topics, intents,
         action_items, handled_by, handled_by_ai, transferred_to_user_id,
         contact_id, conversation_id, disposition, disposition_at, agent_notes,
         call_type, created_at, answered_at, ended_at
  from public.calls
  where company_id = amber.current_company();

grant select on all tables in schema amber to amber_reader;
grant execute on function amber.current_company() to amber_reader;

-- ---------------------------------------------------------------------------
-- 3. The executor — owned by amber_reader, which is the privilege drop.
-- ---------------------------------------------------------------------------
create or replace function amber.run_query(
  p_company uuid,
  p_sql text,
  p_max_rows int default 500
) returns jsonb
language plpgsql
security definer
set search_path = amber, pg_temp   -- public is NOT on the path
as $$
declare
  v_sql text := btrim(coalesce(p_sql, ''));
  v_rows int := least(greatest(coalesce(p_max_rows, 500), 1), 2000);
  v_out jsonb;
begin
  if p_company is null then
    return jsonb_build_object('error', 'No company scope was provided.');
  end if;
  if v_sql = '' then
    return jsonb_build_object('error', 'No query was provided.');
  end if;
  if v_sql !~* '^(select|with)\s' then
    return jsonb_build_object('error',
      'Only SELECT / WITH queries are allowed. Nothing was run.');
  end if;
  if btrim(v_sql, ';') ~ ';' then
    return jsonb_build_object('error',
      'Run one statement at a time — remove the semicolon. Nothing was run.');
  end if;
  if v_sql ~* '(set_config|set\s+role|reset\s|pg_read_file|pg_ls_dir|dblink|lo_import)' then
    return jsonb_build_object('error',
      'That query uses a construct this tool does not allow. Query the amber.* views with plain SQL.');
  end if;

  set local transaction_read_only = on;
  set local statement_timeout = '15s';

  -- Tenant scope, from the resolved actor — never from model output.
  perform set_config('amber.company_id', p_company::text, true);

  begin
    execute format(
      'select coalesce(jsonb_agg(r), ''[]''::jsonb) from (select * from (%s) q limit %s) r',
      v_sql, v_rows
    ) into v_out;
  exception when others then
    -- Hand the model the real message so it can correct its own SQL.
    return jsonb_build_object('error', sqlerrm);
  end;

  return jsonb_build_object(
    'rows', v_out,
    'row_count', jsonb_array_length(v_out),
    'truncated', jsonb_array_length(v_out) >= v_rows
  );
end
$$;

alter function amber.run_query(uuid, text, int) owner to amber_reader;
revoke all on function amber.run_query(uuid, text, int) from public;

-- ---------------------------------------------------------------------------
-- 4. Public wrapper — PostgREST only exposes the public schema.
-- ---------------------------------------------------------------------------
create or replace function public.amber_query(
  p_company uuid,
  p_sql text,
  p_max_rows int default 500
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select amber.run_query(p_company, p_sql, p_max_rows)
$$;

-- ⚠ A freshly created function carries an implicit grant to PUBLIC. Revoke that
-- FIRST — revoking `authenticated` by name while PUBLIC still holds EXECUTE is a
-- no-op, which is how the scoreboard RPCs stayed callable for months.
revoke all on function public.amber_query(uuid, text, int) from public;
revoke all on function public.amber_query(uuid, text, int) from anon;
revoke all on function public.amber_query(uuid, text, int) from authenticated;
grant execute on function public.amber_query(uuid, text, int) to service_role;
