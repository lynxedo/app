-- Amber 90% — Phase 1 foundation: Amber's own account + the approval queue.
--
-- Until now every Amber action ran AS the person talking to her (lib/hub-actions
-- actor = that user's permissions). Nothing could run when nobody asked. These
-- tables give her a narrow account of her own:
--
--   amber_action_modes — her permission list AND autonomy dial in one: for each
--     action she may take on her own, 'off' / 'approve' / 'auto'. No row = off.
--   amber_queue        — every action she proposes or runs on her own: the
--     approval queue (status 'pending') and the audit log (everything else).
--     Approval stats per action are counted from here.
--   hub_assistant_settings.amber_approver_ids — who may approve (Ben: "Both").
--
-- Additive + inert: nothing reads these until code that queues work ships, and
-- no Amber action defaults on. RLS enabled with NO policies → service-role only,
-- the same posture as voice_routing_directory / hub_assistant_pending_actions.

create table if not exists public.amber_action_modes (
  company_id  uuid not null references public.companies(id) on delete cascade,
  action      text not null,
  mode        text not null default 'off' check (mode in ('off', 'approve', 'auto')),
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (company_id, action)
);
alter table public.amber_action_modes enable row level security;

create table if not exists public.amber_queue (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  action       text not null,
  args         jsonb not null default '{}'::jsonb,
  -- What a person sees: the real recipient / record and the exact content.
  preview      text not null default '',
  -- Why Amber wants to do it, in a sentence.
  reason       text not null default '',
  -- What produced it: 'morning_run', 'lead_contact', 'test', …
  source       text not null default 'manual',
  -- pending  → waiting for a person
  -- running  → approved, and the action is being carried out right now
  -- approved → a person approved it and it ran (see result)
  -- rejected → a person said no
  -- auto     → ran on its own (mode 'auto'); logged, never waited
  -- failed   → approved / auto, but the action itself failed (see result)
  -- expired  → nobody decided before expires_at
  -- superseded → a newer proposal with the same dedupe_key replaced it
  status       text not null default 'pending'
                 check (status in ('pending', 'running', 'approved', 'rejected', 'auto', 'failed', 'expired', 'superseded')),
  edited       boolean not null default false,
  result       text,
  decided_by   uuid,
  decided_at   timestamptz,
  reject_note  text,
  -- One live proposal per thing: a re-run that would propose the same first-
  -- contact text again updates nothing and queues nothing (see the unique index).
  dedupe_key   text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.amber_queue enable row level security;

create index if not exists amber_queue_company_status_idx
  on public.amber_queue (company_id, status, created_at desc);
create index if not exists amber_queue_company_action_idx
  on public.amber_queue (company_id, action, created_at desc);
create unique index if not exists amber_queue_pending_dedupe_uniq
  on public.amber_queue (company_id, dedupe_key)
  where status = 'pending' and dedupe_key is not null;

alter table public.hub_assistant_settings
  add column if not exists amber_approver_ids uuid[] not null default '{}';

-- Belt and braces: no API-role access at all (RLS with no policies already denies).
revoke all on public.amber_action_modes from anon, authenticated;
revoke all on public.amber_queue from anon, authenticated;

-- Heroes: Ben + Kathryn approve (Ben, Oct 5 2026: "Both"). Applied as data.
-- update hub_assistant_settings set amber_approver_ids = array[<Ben>, <Kathryn>]
--   where company_id = '00000000-0000-0000-0000-000000000002';
