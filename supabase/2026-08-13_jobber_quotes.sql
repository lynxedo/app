-- Jobber quote mirror — the source behind the Sales report's quote widgets (§8.2).
--
-- ⚠⚠ THERE ARE DELIBERATELY NO MONEY COLUMNS ON THIS TABLE, AND THAT IS A DECISION,
-- NOT AN OMISSION. Heroes quotes with OPTIONAL line items, and often marks every
-- option optional, so `Quote.amounts.total` counts only the required lines: on the
-- live book 2026-08-13 quote #5659 reported a total of $0.00 while carrying $14,175
-- of line items (Peak Season $9,100 OR Off Season $4,200, Irrigreen $2,750 OR
-- Traditional $2,900 — the customer picks). Summing `total` reports the entire
-- irrigation-install pipeline as ZERO; summing line items double-counts every option
-- and inflates it. Ben's call: "It isn't worth anything till the customer clicks what
-- he wants and approves. So maybe we don't deal with dollars." So this report counts
-- QUOTES, never dollars.
--
-- If a future session wants a dollar figure here, it has to add the column AND decide
-- what an option quote is worth (lowest option? highest? a range?). Do not "fix" this
-- by mirroring `amounts.total` — that is the wrong number, quietly.

CREATE TABLE IF NOT EXISTS public.jobber_quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,

  client_id uuid,
  client_external_id text,
  quote_number text,
  title text,
  -- draft | awaiting_response | approved | archived | converted | changes_requested
  quote_status text,
  salesperson_external_id text,

  -- The funnel, entirely from Jobber's own timestamps so nothing here is inferred:
  --   created → sent_at → client_viewed_at → approved_at → converted_at
  -- `client_viewed_at` is Jobber's clientHubViewedAt and is what separates
  -- "sent but never opened" from "opened and ignored" — two different problems that
  -- a bare awaiting-response count flattens into one.
  sent_at timestamp with time zone,
  client_viewed_at timestamp with time zone,
  approved_at timestamp with time zone,
  changes_requested_at timestamp with time zone,
  converted_at timestamp with time zone,
  transitioned_at timestamp with time zone,

  -- Count of jobs Jobber reports as converted FROM this quote. Kept as a count
  -- rather than a join table because the report only ever asks "did it become work",
  -- and an approved quote with zero jobs is exactly the follow-through gap we surface.
  converted_job_count integer NOT NULL DEFAULT 0,

  -- Service-line codes derived from line-item names ('IR', 'WF', 'PW', 'MO').
  -- Grouping is by these, NEVER by `title`: Heroes has no quote-title protocol and
  -- the live book holds "Untitled", "Irrigation Install", "RRR" and "Backflow options"
  -- for overlapping work. Same rule as §8.8 Service Lines.
  service_codes text[],

  jobber_web_uri text,
  custom_fields jsonb,

  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  -- Jobber's own updatedAt. Quotes are the one entity whose filter DOES expose
  -- updatedAt (jobs and visits do not), so the delta pull can be exact and light
  -- instead of a trailing-window re-pull.
  external_updated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.jobber_quotes
  DROP CONSTRAINT IF EXISTS jobber_quotes_pkey;
ALTER TABLE public.jobber_quotes
  ADD CONSTRAINT jobber_quotes_pkey PRIMARY KEY (id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobber_quotes_company_id_fkey'
  ) THEN
    ALTER TABLE public.jobber_quotes
      ADD CONSTRAINT jobber_quotes_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobber_quotes_client_id_fkey'
  ) THEN
    ALTER TABLE public.jobber_quotes
      ADD CONSTRAINT jobber_quotes_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id);
  END IF;
END $$;

-- Upsert key, matching the rest of the Jobber mirror.
CREATE UNIQUE INDEX IF NOT EXISTS jobber_quotes_external_id_source_idx
  ON public.jobber_quotes USING btree (external_id, source);

-- The cohort is "quotes SENT in the window", so that is the hot filter.
CREATE INDEX IF NOT EXISTS jobber_quotes_company_sent_idx
  ON public.jobber_quotes USING btree (company_id, sent_at);
CREATE INDEX IF NOT EXISTS jobber_quotes_company_status_idx
  ON public.jobber_quotes USING btree (company_id, quote_status);
CREATE INDEX IF NOT EXISTS jobber_quotes_client_idx
  ON public.jobber_quotes USING btree (client_id);

-- RLS mirrors `invoices` exactly (the closest analogue in the mirror) rather than
-- inventing a new shape. ⚠ The real gate for the report is NOT here: per the Aug-12
-- lesson, the reporting RPC is service-role only and the route checks the caller's
-- per-report grant. There is no second net below the routes.
ALTER TABLE public.jobber_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobber_quotes_admin_all ON public.jobber_quotes;
CREATE POLICY jobber_quotes_admin_all
  ON public.jobber_quotes AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
     FROM user_profiles up
    WHERE ((up.id = auth.uid()) AND (up.role = 'admin'::text)))));

DROP POLICY IF EXISTS jobber_quotes_select ON public.jobber_quotes;
CREATE POLICY jobber_quotes_select
  ON public.jobber_quotes AS PERMISSIVE FOR SELECT TO public
  USING (((company_id = get_my_company_id()) AND (deleted_at IS NULL)));

-- Applied as a second step (jobber_quotes_revoke_anon_2026_08_13).
-- Defense in depth: RLS already returns anon zero rows, but `public` grants anon ALL
-- by default and the Aug-12 exposure came from exactly that habit going unnoticed.
-- ⚠ `authenticated` is deliberately KEPT — drill-down queries run through the CALLER'S
-- client rather than service-role, so a future quote drill-down needs SELECT, and RLS
-- scopes it to the caller's own company.
REVOKE ALL ON public.jobber_quotes FROM PUBLIC;
REVOKE ALL ON public.jobber_quotes FROM anon;
GRANT SELECT ON public.jobber_quotes TO authenticated;
