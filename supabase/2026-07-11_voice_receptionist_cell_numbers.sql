-- AI Voice Receptionist — cell transfer method: per-recipient cell numbers.
--
-- The transfer-recipients multi-select (transfer_user_ids) says WHO can take a
-- business-hours transfer. For the 'cell' method we also need WHICH number to
-- ring for each of them. Stored as a jsonb map { "<hub_user_id>": "<E.164>" },
-- edited inline in Admin → AI → Receptionist (only shown when the method is
-- "Ring a cell + press 1"). Additive + defaulted, so existing rows and every
-- non-cell method are completely unaffected.
alter table public.voice_receptionist_settings
  add column if not exists transfer_cell_numbers jsonb not null default '{}'::jsonb;
