-- 2026-07-11_voice_receptionist_transfer.sql  (applied to the shared DB 2026-07-11)
-- AI Receptionist Phase 2b — screened human transfer.
--
-- Admin picks HOW the receptionist reaches a live person (business hours only);
-- recipients are Hub users. Additive + non-destructive.
--   transfer_method   off | cell | softphone | dm   (only 'softphone' implemented so far)
--   transfer_user_ids Hub user ids that receive transfer attempts

alter table public.voice_receptionist_settings
  add column if not exists transfer_method   text   not null default 'off',
  add column if not exists transfer_user_ids uuid[] not null default '{}';

alter table public.voice_receptionist_settings
  drop constraint if exists voice_receptionist_settings_transfer_method_chk;
alter table public.voice_receptionist_settings
  add constraint voice_receptionist_settings_transfer_method_chk
  check (transfer_method in ('off','cell','softphone','dm'));
