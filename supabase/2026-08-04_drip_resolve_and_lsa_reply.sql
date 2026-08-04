-- Drip: per-step conversation resolve + Google LSA reply target
-- Txt:  parsed Google Local Services relay threads
--
-- All additive with behavior-preserving defaults:
--   drip_steps.resolve      defaults 'archive'  = what every text step did before
--   drip_steps.sms_target   defaults 'direct'   = text the customer's own number
--   txt_conversations.lsa_* default false/null  = read by the Txt UI only
--   txt_messages.raw_body   nullable            = set only when we rewrite a body
--
-- Nothing here changes existing rows, so prod (which does not yet read these
-- columns) is unaffected until the code ships.

-- ── Drip: what happens to the Txt thread after a text step sends ──────────────
alter table drip_steps
  add column if not exists resolve text not null default 'archive',
  add column if not exists resolve_user_id uuid references hub_users(id) on delete set null,
  add column if not exists sms_target text not null default 'direct';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drip_steps_resolve_check') then
    alter table drip_steps
      add constraint drip_steps_resolve_check
      check (resolve in ('archive', 'unassigned', 'assign'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drip_steps_sms_target_check') then
    alter table drip_steps
      add constraint drip_steps_sms_target_check
      check (sms_target in ('direct', 'lsa', 'both'));
  end if;
  -- resolve='assign' is meaningless without somebody to assign to. The app also
  -- rejects it at save time; this keeps a bad row out of the table entirely.
  if not exists (select 1 from pg_constraint where conname = 'drip_steps_resolve_assignee_check') then
    alter table drip_steps
      add constraint drip_steps_resolve_assignee_check
      check (resolve <> 'assign' or resolve_user_id is not null);
  end if;
end $$;

comment on column drip_steps.resolve is
  'After a text step sends: archive (default, out of the active inbox) | unassigned (manager Queue) | assign (to resolve_user_id).';
comment on column drip_steps.sms_target is
  'Where a text step sends: direct (customer''s number) | lsa (reply in the lead''s Google Local Services conversation, so Google credits the response) | both.';

-- ── Txt: Google Local Services relay threads ─────────────────────────────────
-- Google forwards an LSA lead's messages to the business as SMS from a proxy
-- number that is unique per lead, wrapped in boilerplate:
--   "You have received a new message from a customer via Google Local Services
--    Ads. Customer Name: , Location: Conroe, Service: x, Message: <real text>"
-- Customer Name is always empty, so these land as anonymous "Unknown" threads.
-- We parse the wrapper: the real text becomes the message body, the original is
-- preserved in raw_body, and the thread is tagged so the UI can label it.
alter table txt_messages
  add column if not exists raw_body text;

alter table txt_conversations
  add column if not exists lsa_relay boolean not null default false,
  add column if not exists lsa_location text,
  add column if not exists lsa_service text;

comment on column txt_messages.raw_body is
  'Original provider text when body was rewritten (Google LSA relay unwrapping). Null = body is as received.';
comment on column txt_conversations.lsa_relay is
  'True when this thread is a Google Local Services relay (proxy number, one per lead) rather than the customer''s own number.';

create index if not exists txt_conversations_lsa_relay_idx
  on txt_conversations (company_id) where lsa_relay;
