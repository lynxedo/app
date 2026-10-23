-- Work Orders office page (Oct 23 2026): let the office clear the Tech notes
-- and Ready to invoice lists.
--   notes_resolved_*  — "Resolved" on a Tech notes card. The card comes back
--                       when a note or photo lands after this time.
--   invoice_done_*    — "Done" on a Ready to invoice card, for visits settled
--                       without a Jobber invoice (no charge, billed with another
--                       visit…). Invoiced visits clear on their own.
-- Additive only.

alter table public.daily_log_stops
  add column if not exists notes_resolved_at timestamptz,
  add column if not exists notes_resolved_by uuid references public.hub_users(id) on delete set null,
  add column if not exists invoice_done_at timestamptz,
  add column if not exists invoice_done_by uuid references public.hub_users(id) on delete set null;
