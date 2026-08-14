-- Split the single "let connected Claude apps do consequential things" switch in
-- two, so texting over MCP and changing the Jobber schedule over MCP are
-- separate decisions.
--
-- WHY. `allow_outward_over_mcp` gated BOTH kinds at once: outward (texting a
-- customer) and jobber_write (reschedule / assign / complete / schedule / set a
-- recurring schedule / add a note). Turning on the one thing an owner asked for —
-- "let Claude read and send our texts" — therefore also handed a connected
-- Claude app the crew calendar, silently, with no separate control anywhere.
--
-- The two risks are not alike, which is the whole argument for two switches:
--   • a customer text is visible to the customer immediately, and goes out under
--     the asking user's own name and signature — a mistake announces itself;
--   • a wrong schedule change is QUIET. Nobody sees it until a truck shows up on
--     the wrong day. That is the failure mode that already bit us on 2026-08-07,
--     when a legacy MCP tool moved a real visit while every admin control said
--     that write was off.
--
-- BEHAVIOUR-PRESERVING. Existing rows are seeded from the old flag, so whatever a
-- company had before the split it still has after it: the bundled `true` becomes
-- true-for-both, and `false` stays false-for-both. New companies get false, the
-- same fail-closed default the rest of these switches use.

alter table hub_assistant_settings
  add column if not exists allow_jobber_writes_over_mcp boolean not null default false;

-- Carry the pre-split meaning forward. Written unconditionally rather than only
-- where the old flag is true: the value being copied IS the old behaviour either
-- way, and this way re-running the migration is a no-op instead of a surprise.
update hub_assistant_settings
   set allow_jobber_writes_over_mcp = coalesce(allow_outward_over_mcp, false)
 where allow_jobber_writes_over_mcp is distinct from coalesce(allow_outward_over_mcp, false);

comment on column hub_assistant_settings.allow_jobber_writes_over_mcp is
  'May a connected Claude app (MCP) change the Jobber schedule? Separate from allow_outward_over_mcp, which covers texting customers. Both default false — the in-Hub assistant is unaffected by either.';
