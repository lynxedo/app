-- Gary — session 6: cold emails to commercial prospects, from the team mailbox,
-- at low volume, watching bounces and complaints (Ben, Oct 16 2026).
-- PRD: Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md (Drive). Additive.

-- Who a message is for: a win-back person, or a prospect's manager contact.
alter table public.gary_queue
  add column if not exists audience text not null default 'winback' check (audience in ('winback', 'prospect')),
  -- A bounce notice ("Undeliverable: …") came back for this email.
  add column if not exists bounced_at timestamptz;

alter table public.gary_settings
  -- "A handful a day": its own limit, inside the overall daily limit.
  add column if not exists cold_daily_cap integer not null default 5 check (cold_daily_cap between 1 and 25),
  -- Set automatically on a complaint or too many bounces; a person clears it.
  add column if not exists cold_paused_at timestamptz,
  add column if not exists cold_paused_reason text;
