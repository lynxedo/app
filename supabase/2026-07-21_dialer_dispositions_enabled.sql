-- 2026-07-21 — Company-wide on/off for the after-call disposition prompt.
-- Additive + default TRUE, so every existing company keeps today's behavior
-- (the "how did it go?" pill keeps showing) until an admin turns it off in
-- Admin → Dialer → Call dispositions.
ALTER TABLE public.dialer_settings
  ADD COLUMN IF NOT EXISTS dispositions_enabled boolean NOT NULL DEFAULT true;
