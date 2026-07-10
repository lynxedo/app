-- 2026-07-10_voice_receptionist_level.sql  (applied to the shared DB 2026-07-10)
--
-- AI Receptionist capability levels (Ben's product ladder):
--   1 = Message taker   — voicemail replacement; collects info, deflects questions
--   2 = Conversational  — small talk + approved basics; never states pricing
--   3 = Soft sell       — + approved fixed pricing, qualifying Qs, soft commitment
--   4 = Full receptionist (coming soon) — live scheduling / Jobber writes
--
-- Admin picks the operating level in Admin -> Dialer -> AI Receptionist; at SaaS
-- time a subscription plan caps it (effective = min(chosen, plan cap) — see
-- lib/voice-receptionist-settings.ts). Level 4 clamps to 3 until implemented.

alter table public.voice_receptionist_settings
  add column if not exists level int not null default 2
  check (level between 1 and 4);
