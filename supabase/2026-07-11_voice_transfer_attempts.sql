-- 2026-07-11_voice_transfer_attempts.sql  (applied to the shared DB 2026-07-11)
-- AI Receptionist Phase 2b — Hub-DM ("tap to take") transfer method.
--
-- Tracks one live transfer attempt while a caller is parked on hold waiting for
-- a teammate to accept via a Hub push/message. Read/written only by the
-- service-role admin client (the call-time hold/park routes + the session-gated
-- accept endpoint), so RLS is enabled with no authenticated policies.

create table if not exists public.voice_transfer_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  queue_name text not null,
  caller_call_sid text,
  caller_from text,
  topic text,
  status text not null default 'pending',   -- pending | accepted | timed_out | connected
  accepted_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists voice_transfer_attempts_queue_idx on public.voice_transfer_attempts (queue_name);
create index if not exists voice_transfer_attempts_status_idx on public.voice_transfer_attempts (company_id, status);

alter table public.voice_transfer_attempts enable row level security;
