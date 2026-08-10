-- Jobber webhook durability queue — August 10, 2026
--
-- WHY. The webhook route acks Jobber with 200 BEFORE processing (Jobber wants a
-- fast ack), so any failure after the ack lost the event permanently — Jobber
-- never retries something it was told we accepted. Measured on prod: 242 events
-- silently dropped, all with "No usable Jobber token", caused by a refresh-token
-- rotation race (fixed separately in lib/jobber.ts). Only the nightly full
-- re-pull covered for the loss.
--
-- WHAT. Every inbound event is persisted here first; the ack means "durably
-- recorded", not "successfully processed". A worker then drains the queue with
-- retry + exponential backoff, and dead-letters (status='failed') with an alert
-- once attempts are exhausted. Rows carry company_id, so the drain is
-- multi-tenant from day one.
--
-- Additive only: no existing table or column is touched.

create table if not exists jobber_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  topic           text not null,
  item_id         text not null,
  occurred_at     timestamptz,
  -- Jobber can redeliver the same event. Deduped on this single plain-unique
  -- column rather than an expression/partial index — a PARTIAL unique index is
  -- not a usable PostgREST .upsert(onConflict) target and fails silently.
  -- Built app-side; when occurredAt is absent it falls back to a value that
  -- cannot collide, so the failure direction is "process twice" (harmless —
  -- every write is an idempotent upsert) rather than "drop".
  dedupe_key      text not null unique,
  status          text not null default 'pending',   -- pending | processing | done | failed
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Drain lookup: the only hot query.
create index if not exists jobber_webhook_events_claim_idx
  on jobber_webhook_events (next_attempt_at)
  where status = 'pending';

-- Operator views: recent activity + the dead-letter list.
create index if not exists jobber_webhook_events_company_idx
  on jobber_webhook_events (company_id, created_at desc);
create index if not exists jobber_webhook_events_failed_idx
  on jobber_webhook_events (status, created_at desc)
  where status = 'failed';

-- Service-role only: RLS on with NO policies. Nothing user-facing reads this.
alter table jobber_webhook_events enable row level security;

/*
 * Atomically claim a batch of due events.
 *
 * FOR UPDATE SKIP LOCKED so two concurrent drains (the post-ack kick and the
 * cron) can never hand the same event to both. Also recovers rows orphaned in
 * 'processing' by a crash/deploy mid-drain — without that they would sit
 * claimed forever, which is the same silent loss this table exists to prevent.
 */
create or replace function claim_jobber_webhook_events(p_limit int default 25)
returns setof jobber_webhook_events
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reclaim anything stuck in 'processing' for more than 10 minutes. A real
  -- drain batch finishes in seconds, so this only ever catches orphans.
  update jobber_webhook_events
     set status = 'pending', updated_at = now()
   where status = 'processing'
     and updated_at < now() - interval '10 minutes';

  return query
  update jobber_webhook_events e
     set status = 'processing',
         attempts = e.attempts + 1,
         updated_at = now()
   where e.id in (
     select id
       from jobber_webhook_events
      where status = 'pending'
        and next_attempt_at <= now()
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning e.*;
end;
$$;

-- ⚠ Supabase grants EXECUTE on a newly created function to PUBLIC by default,
-- and a bare "REVOKE ... FROM PUBLIC" has been observed to leave anon and
-- authenticated still holding it. Revoke each role BY NAME and verify.
revoke all on function claim_jobber_webhook_events(int) from public;
revoke all on function claim_jobber_webhook_events(int) from anon;
revoke all on function claim_jobber_webhook_events(int) from authenticated;
