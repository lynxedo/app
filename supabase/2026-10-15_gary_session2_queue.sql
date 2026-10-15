-- Gary — session 2: his emails, the approval queue, sending from the team mailbox.
-- PRD: Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md (Drive).
--
-- gary_queue = every email Gary writes. Nothing goes out until an approver taps
-- Approve; the row then records what was sent (or why it wasn't). It is also
-- Gary's memory of who he has already written to — the win-back list skips
-- anyone with a waiting, sent, or turned-down email here.
--
-- Additive. RLS enabled with no policies → service-role only.

create table if not exists public.gary_queue (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  -- The win-back list's person key (p:<phone10> / e:<email> / c:<jobber client>).
  person_key          text not null,
  channel             text not null default 'email' check (channel in ('email')),
  to_email            text not null,
  to_name             text,
  subject             text not null,
  body                text not null,
  -- What Gary was looking at when he wrote it (sources, services) — shown on the card.
  context             jsonb not null default '{}'::jsonb,
  status              text not null default 'pending'
                        check (status in ('pending', 'sending', 'sent', 'rejected', 'failed', 'expired', 'withdrawn')),
  edited              boolean not null default false,
  model               text,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  est_cost_usd        numeric(10, 4),
  decided_by          uuid,
  decided_at          timestamptz,
  reject_note         text,
  -- Why a waiting email was withdrawn at approval time (opted out, became a customer…).
  withdrawn_reason    text,
  sent_at             timestamptz,
  inbox_thread_id     uuid,
  provider_message_id text,
  error               text,
  expires_at          timestamptz not null default (now() + interval '7 days'),
  created_at          timestamptz not null default now()
);
alter table public.gary_queue enable row level security;
revoke all on public.gary_queue from anon, authenticated;

-- One open email per person at a time — drafting twice can never queue two.
create unique index if not exists gary_queue_one_open_per_person
  on public.gary_queue (company_id, person_key)
  where status in ('pending', 'sending');
create index if not exists gary_queue_company_created_idx
  on public.gary_queue (company_id, created_at desc);

alter table public.gary_settings
  add column if not exists approver_ids uuid[] not null default '{}',
  add column if not exists daily_email_cap integer not null default 20
    check (daily_email_cap between 1 and 200);

-- Heroes starts with Amber's approvers (Ben + Kathryn).
update public.gary_settings g
set approver_ids = coalesce(h.amber_approver_ids, '{}')
from public.hub_assistant_settings h
where h.company_id = g.company_id
  and g.company_id = '00000000-0000-0000-0000-000000000002'
  and g.approver_ids = '{}';
