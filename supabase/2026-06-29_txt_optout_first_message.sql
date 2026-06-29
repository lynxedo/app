-- 2026-06-29 — Txt: auto opt-out notice on the first outbound text to a contact.
-- Carrier/CTIA require opt-out language ("Reply STOP to opt out.") on the initial
-- message to a recipient. The send + broadcast routes read these and append the
-- notice only on the FIRST outbound to a given contact.
--
-- Already applied to the shared Supabase DB (staging + prod) on 2026-06-29 via the
-- Supabase MCP migration `add_txt_optout_first_message`. Kept here for record.

alter table public.txt_settings
  add column if not exists opt_out_message text not null default 'Reply STOP to opt out.',
  add column if not exists opt_out_on_first_message boolean not null default true;
