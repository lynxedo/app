-- Applied to the shared DB July 9, 2026 (migration: txt_broadcasts_phone_number_id).
-- Broadcast "Send from" picker: which of the company's Txt numbers this
-- broadcast sends from. NULL = resolver default (user default → company default).
ALTER TABLE txt_broadcasts ADD COLUMN IF NOT EXISTS phone_number_id uuid
  REFERENCES txt_phone_numbers(id) ON DELETE SET NULL;

-- Beta feature seed (same session): true Group MMS group texting, dark until
-- opted in via Settings → Beta Features.
-- insert into beta_features (key, label, description, is_available, default_on, company_id, sort_order)
-- values ('txt_groups', 'Txt Group Messages', '…', true, false, null, 2);
