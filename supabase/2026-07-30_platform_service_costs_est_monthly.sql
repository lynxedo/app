-- Estimated fixed monthly total for the Service Costs tab (2026-07-30).
--
-- The `monthly` column is free text (ranges, annual, "+compute", one-time, free), so it
-- can't be summed. Add a structured numeric `est_monthly` (dollars/mo, nullable) that
-- feeds the "Estimated fixed monthly" total. Seeded with monthly-equivalents (annual ÷ 12)
-- for the FIXED recurring costs only; usage-based / one-time / free / unconfirmed rows
-- stay NULL and aren't counted. Editable per row in the tab.
ALTER TABLE public.platform_service_costs ADD COLUMN IF NOT EXISTS est_monthly numeric(10,2);

UPDATE public.platform_service_costs SET est_monthly = 11.00 WHERE service = 'Hetzner VPS';
UPDATE public.platform_service_costs SET est_monthly = 1.00  WHERE service = 'Domain — lynxedo.com';
UPDATE public.platform_service_costs SET est_monthly = 25.00 WHERE service = 'Supabase';
UPDATE public.platform_service_costs SET est_monthly = 1.15  WHERE service = 'Phone number — local (832)';
UPDATE public.platform_service_costs SET est_monthly = 2.15  WHERE service = 'Phone number — toll-free (888)';
UPDATE public.platform_service_costs SET est_monthly = 2.00  WHERE service = 'A2P 10DLC registration';
UPDATE public.platform_service_costs SET est_monthly = 15.00 WHERE service = 'Nylas';
UPDATE public.platform_service_costs SET est_monthly = 8.25  WHERE service = 'Apple Developer Program';
