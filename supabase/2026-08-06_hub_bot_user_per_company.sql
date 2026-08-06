-- Per-company Hub bot user, replacing the single hardcoded GUARDIAN_HUB_USER_ID.
-- APPLIED to the shared DB on 2026-08-06 (this file is the record).
--
-- One uuid ('00000000-0000-0000-0001-000000000001') was shared by every tenant, so
-- for a second company:
--   • every automated Hub post (LSA lead alerts, overdue-task DMs, fleet alerts,
--     voicemail alerts, feedback tickets, automation rules, assistant replies) would
--     carry a sender_id belonging to HEROES' bot row. The FK is satisfied, so the
--     insert SUCCEEDS — their room shows Heroes' bot posting, looking legitimate.
--   • the assistant-identity endpoint 409s, because that row never matches their
--     company filter, so the persona resolves to zero rows to name or give a face.
--
-- Nullable on purpose: null means "this company has no Hub bot", which
-- lib/guardian-post.ts getHubBotUserId() treats as "skip posting" rather than
-- falling back to another tenant's identity.
--
-- Tenant onboarding must create a bot hub_users row and set this column
-- (see Reference/MULTI_TENANT_PLAN_37.md, Track 4).

alter table companies
  add column if not exists hub_bot_user_id uuid
  references hub_users(id) on delete set null;

comment on column companies.hub_bot_user_id is
  'The hub_users row automated Hub posts are sent as for this company (the Hub bot / AI assistant). Null = no bot configured; automated posts are skipped rather than attributed to another company''s bot. Set during tenant onboarding.';

-- Backfill Heroes to the existing constant so nothing changes for them. Guarded on
-- the row actually being one of their bots, so this can never point at a stranger.
update companies
set hub_bot_user_id = '00000000-0000-0000-0001-000000000001'
where id = '00000000-0000-0000-0000-000000000002'
  and hub_bot_user_id is null
  and exists (
    select 1 from hub_users
    where id = '00000000-0000-0000-0001-000000000001'
      and company_id = '00000000-0000-0000-0000-000000000002'
      and is_bot
  );
