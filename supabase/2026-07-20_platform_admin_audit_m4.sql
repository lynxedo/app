-- Track 6 (M4) — audit trail for cross-company platform-admin actions.
-- Applied to the shared Supabase DB via MCP on 2026-07-20.
CREATE TABLE IF NOT EXISTS public.platform_admin_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     uuid REFERENCES auth.users(id),
  action            text NOT NULL,   -- suspend_company | activate_company | set_override | clear_override | sync_stripe | inspect_tenant
  target_company_id uuid REFERENCES public.companies(id),
  detail            jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admin_audit ENABLE ROW LEVEL SECURITY;
-- service-role only (platform console reads/writes via the admin client); no policies.
CREATE INDEX IF NOT EXISTS platform_admin_audit_company_idx ON public.platform_admin_audit (target_company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_admin_audit_actor_idx ON public.platform_admin_audit (actor_user_id, created_at DESC);
