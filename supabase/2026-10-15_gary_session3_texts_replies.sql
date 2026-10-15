-- Gary — session 3: texts (for people we've texted before) + noticing replies.
-- PRD: Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md (Drive).
--
-- gary_queue only holds Gary's own drafts so far (nothing has ever been sent to
-- a customer), so widening it is safe. Additive otherwise.

alter table public.gary_queue drop constraint if exists gary_queue_channel_check;
alter table public.gary_queue add constraint gary_queue_channel_check check (channel in ('email', 'text'));
alter table public.gary_queue alter column to_email drop not null;

alter table public.gary_queue
  add column if not exists to_phone text,
  add column if not exists contact_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists txt_message_id uuid,
  -- First reply after Gary's message (email: inbound mail on the thread; text:
  -- inbound text on the conversation). Set once; the alert goes out once.
  add column if not exists replied_at timestamptz,
  -- 'reply' (a person should answer) | 'opted_out' (unsubscribe / stop words).
  add column if not exists reply_kind text,
  add column if not exists reply_snippet text;

create index if not exists gary_queue_awaiting_reply_idx
  on public.gary_queue (company_id, sent_at)
  where status = 'sent' and replied_at is null;
