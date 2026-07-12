-- AI Voice Receptionist — configurable Jobber-title → spoken-service map.
--
-- Amber looks up a caller's next visit LIVE from Jobber on request and reads the
-- visit title, which is internal ops shorthand ("Kenny/IR SVC ...", "…/RC1 RRR
-- …"). This column stores per-company rules mapping a title code to what the
-- assistant should say. Editable in Admin → AI → Receptionist; when NULL the
-- code default (lib/voice-receptionist.ts DEFAULT_TITLE_SERVICE_MAP) applies.
--
-- Additive + idempotent. Applied to the shared DB 2026-07-12.
alter table voice_receptionist_settings
  add column if not exists title_service_map jsonb;

-- Seed Heroes (00000000-0000-0000-0000-000000000002) with the default mapping
-- so it shows populated in the admin panel.
update voice_receptionist_settings
set title_service_map = '[
  {"match":"RC","say":"lawn treatment"},
  {"match":"BP","say":"lawn treatment"},
  {"match":"WF","say":"lawn treatment"},
  {"match":"IR","say":"sprinkler service call"},
  {"match":"PW","say":"pet waste pickup"}
]'::jsonb
where company_id = '00000000-0000-0000-0000-000000000002'
  and title_service_map is null;
