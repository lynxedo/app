-- Per-user phone-number access (multi-number scope for Txt2 + Dialer).
--
-- Purpose: keep a field tech's Txt2 / Dialer view simple by limiting them to
-- the number(s) they actually work, NOT a security boundary.
--
-- RESTRICTION MODEL (deliberately simple, one scope per user across BOTH tools):
--   * A user with ZERO rows here = UNRESTRICTED → sees ALL company numbers.
--   * A user with >=1 row = restricted to exactly those phone numbers.
--   * Admins / managers always bypass this entirely (enforced in app code).
--
-- Because the default is "no rows = see everything," deploying this changes
-- nothing for any existing user until an admin deliberately narrows someone.
--
-- Read exclusively via the service-role (admin) client in app code, so RLS is
-- enabled with no policies → no direct PostgREST access for anon/authenticated.

CREATE TABLE IF NOT EXISTS public.user_phone_number_access (
  user_id          uuid NOT NULL,
  phone_number_id  uuid NOT NULL REFERENCES public.txt_phone_numbers(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_user_phone_number_access_user
  ON public.user_phone_number_access (user_id);

ALTER TABLE public.user_phone_number_access ENABLE ROW LEVEL SECURITY;
