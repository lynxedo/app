-- Gary — session 4: follow-ups (touches 2 and 3) + the scorecard.
-- PRD: Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md (Drive). Additive.

-- Which message in the 3-message sequence this is, and the first message it
-- follows up (null on the first message itself).
alter table public.gary_queue
  add column if not exists touch smallint not null default 1 check (touch between 1 and 3),
  add column if not exists first_id uuid references public.gary_queue(id) on delete set null;
create index if not exists gary_queue_first_idx on public.gary_queue (first_id) where first_id is not null;

-- Days after the FIRST message that follow-up 2 and the last try (3) become due.
-- Ben, Oct 15 2026: 3 touches over about 3 weeks.
alter table public.gary_settings
  add column if not exists follow_up_days smallint[] not null default '{7,21}';
