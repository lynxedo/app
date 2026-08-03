-- Amber (AI receptionist) call attribution — data backfill. APPLIED to the shared
-- DB 2026-08-03 (record only; no schema change).
--
-- The 832 inbound webhook stamps calls.handled_by with dialer_settings.
-- inbound_route_user_id (a HUMAN — Kathryn at Heroes) BEFORE the call is handed
-- to the AI receptionist, and nothing cleared it. So every call Amber answered
-- was credited to Kathryn in the Call Log, fed to the coaching rubric as
-- "Rep on this call: Kathryn", and counted on her Call Coaching scoreboard.
--
-- app/api/voice/brain now stamps handled_by with the company's receptionist bot
-- user (voice_receptionist_settings.text_bot_user_id) when she answers, so she is
-- treated like any other agent. This repoints the rows written before that.
-- 45 rows updated at Heroes (18 carrying a real letter grade).

create table if not exists _backfill_amber_handled_by_2026_08_03 (
  call_id uuid primary key,
  old_handled_by uuid,
  backed_up_at timestamptz default now()
);

insert into _backfill_amber_handled_by_2026_08_03 (call_id, old_handled_by)
select c.id, c.handled_by
from calls c
join voice_receptionist_settings v on v.company_id = c.company_id
where c.handled_by_ai = true
  and v.text_bot_user_id is not null
  and c.handled_by is distinct from v.text_bot_user_id
on conflict (call_id) do nothing;

update calls c
set handled_by = v.text_bot_user_id
from voice_receptionist_settings v
where v.company_id = c.company_id
  and c.handled_by_ai = true
  and v.text_bot_user_id is not null
  and c.handled_by is distinct from v.text_bot_user_id;

-- Rollback:
--   update calls c set handled_by = b.old_handled_by
--   from _backfill_amber_handled_by_2026_08_03 b where b.call_id = c.id;
