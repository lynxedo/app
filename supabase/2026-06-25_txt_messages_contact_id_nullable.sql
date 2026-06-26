-- 2026-06-25 — Group texting fix.
-- Group text messages belong to a group conversation, not a single contact,
-- so txt_messages.contact_id must allow NULL. The old NOT NULL constraint made
-- every group send fail at insert with an opaque "Insert failed". Direct and
-- broadcast messages continue to set contact_id as before.
-- Applied to the shared Supabase DB on 2026-06-25 (covers staging + prod).
ALTER TABLE txt_messages ALTER COLUMN contact_id DROP NOT NULL;
