-- Servanto Starter Session 2 — Jobber disconnect + 30-day purge of copied Jobber data.
--
-- getservanto.com/privacy promises: on disconnect, Jobber tokens are deleted at once
-- and the data we copied from Jobber is deleted within 30 days. This adds:
--   1. jobber_disconnects — one row per disconnect (from Jobber's APP_DISCONNECT
--      webhook or our own Disconnect button), carrying the purge date.
--   2. purge_company_jobber_data() — deletes ONE company's copied Jobber data, with a
--      dry-run mode that only counts. Refuses Heroes outright.
--
-- Heroes is kept out (Ben, Oct 31): its rows get purge_after = NULL (never purged),
-- and the function itself raises on the Heroes company id as a second guard.

create table if not exists public.jobber_disconnects (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  jobber_app          text not null,                -- 'lynxedo' | 'servanto'
  account_id          text,                         -- Jobber account id, if known
  source              text not null,                -- 'jobber_webhook' | 'servanto_button'
  disconnected_at     timestamptz not null default now(),
  purge_after         timestamptz,                  -- NULL = never purge (Heroes / Lynxedo app)
  purge_cancelled_at  timestamptz,                  -- set when the company reconnects in time
  purged_at           timestamptz,
  purge_summary       jsonb
);

create index if not exists jobber_disconnects_due_idx
  on public.jobber_disconnects (purge_after)
  where purged_at is null and purge_cancelled_at is null and purge_after is not null;
create index if not exists jobber_disconnects_company_idx
  on public.jobber_disconnects (company_id, disconnected_at desc);

-- Service role only (webhook, cron, admin routes all use the admin client).
alter table public.jobber_disconnects enable row level security;
revoke all on public.jobber_disconnects from public, anon, authenticated;

-- ── The purge ────────────────────────────────────────────────────────────────
-- Deletes the tables the Jobber sync fills (lib/jobber-sync.ts) plus Jobber
-- bookkeeping tables, and unlinks (does not delete) the company's own directory
-- contacts. Leaves alone everything the company made in Servanto itself: chat,
-- boards, leads, contacts, and Lynxedo-authored quotes (`quotes`).
-- One transaction: either every table is purged or none is.
create or replace function public.purge_company_jobber_data(p_company_id uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  heroes constant uuid := '00000000-0000-0000-0000-000000000002';
  t text;
  n bigint;
  counts jsonb := '{}'::jsonb;
  -- Children before parents (FKs: visits/invoices/jobs/properties → clients are NO ACTION).
  tables text[] := array[
    'line_items', 'invoices', 'visits', 'jobber_quotes', 'jobs', 'properties',
    'clients', 'tags', 'jobber_users', 'jobber_report_links', 'jobber_job_link_writes',
    'jobber_webhook_events', 'jobber_backfill_jobs', 'sync_log'
  ];
begin
  if p_company_id is null then
    raise exception 'purge_company_jobber_data: company id required';
  end if;
  if p_company_id = heroes then
    raise exception 'purge_company_jobber_data: refusing to purge Heroes';
  end if;
  if exists (select 1 from jobber_tokens where company_id = p_company_id) then
    raise exception 'purge_company_jobber_data: company is connected to Jobber again';
  end if;

  set local statement_timeout = '5min';

  foreach t in array tables loop
    if p_dry_run then
      execute format('select count(*) from public.%I where company_id = $1', t) into n using p_company_id;
    else
      execute format('delete from public.%I where company_id = $1', t) using p_company_id;
      get diagnostics n = row_count;
    end if;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  -- Keep the company's contacts, drop their link to the (now deleted) Jobber client.
  if p_dry_run then
    select count(*) into n from txt_contacts where company_id = p_company_id and jobber_client_id is not null;
  else
    update txt_contacts set jobber_client_id = null, jobber_link_set_at = null
     where company_id = p_company_id and jobber_client_id is not null;
    get diagnostics n = row_count;
  end if;
  counts := counts || jsonb_build_object('txt_contacts_unlinked', n);

  return jsonb_build_object('dry_run', p_dry_run, 'company_id', p_company_id, 'counts', counts);
end;
$$;

revoke all on function public.purge_company_jobber_data(uuid, boolean) from public, anon, authenticated;
grant execute on function public.purge_company_jobber_data(uuid, boolean) to service_role;
