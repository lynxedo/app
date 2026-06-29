-- 2026-06-29 — Txt: per-message line tracking + reactive toll-free reroute.
-- phone_number_id  = which of our numbers this specific message used (outbound:
--                    the line we sent from; inbound: the line the customer texted).
--                    Powers the per-message "via Main / on Toll-Free" labels.
-- rerouted         = true when an outbound was auto-resent from the toll-free
--                    line after the main line was blocked (AT&T 30003). Drives
--                    the in-thread "Rerouted" alert.
--
-- Already applied to the shared Supabase DB (staging + prod) on 2026-06-29 via
-- the Supabase MCP migration `add_txt_message_phone_number_and_rerouted`.

alter table public.txt_messages
  add column if not exists phone_number_id uuid references public.txt_phone_numbers(id),
  add column if not exists rerouted boolean not null default false;
