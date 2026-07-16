-- Drip Marketing — ringless-voicemail (RVM) channel (PRD §5, Phase 2 groundwork).
-- Additive only. NOT APPLIED from this build — the integrator applies all
-- migrations centrally. Mirrors the company-scoped RLS pattern in
-- supabase/2026-07-16_drip_engine.sql.
--
-- RVM audio is a bring-your-own-API-key VoiceDrop integration: an admin uploads a
-- short MP3/WAV, it's stored in R2 (drip/<company_id>/rvm/<uuid>.<ext>) and
-- registered with VoiceDrop, which returns a provider voicemail id used at send
-- time. drip_audio_assets links the R2 object to that provider id. Consent +
-- caller-ID knobs are added to drip_settings, and delivery/consent columns to the
-- drip_sends ledger, so the engine's RVM send branch (wired separately) has
-- somewhere to record consent basis + delivery for the TCPA audit trail.

-- ── Uploaded RVM audio, mapped to its VoiceDrop voicemail id ──────────────────
create table if not exists public.drip_audio_assets (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  campaign_id           uuid references public.drip_campaigns(id) on delete set null,
  label                 text,
  r2_key                text,
  mime                  text,
  duration_sec          integer,
  provider              text not null default 'voicedrop',
  provider_voicemail_id text,
  caller_id_number      text,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now()
);
create index if not exists idx_drip_audio_company  on public.drip_audio_assets(company_id, created_at desc);
create index if not exists idx_drip_audio_campaign on public.drip_audio_assets(campaign_id);

-- ── RVM knobs on the per-company drip settings ───────────────────────────────
alter table public.drip_settings
  add column if not exists rvm_caller_id            text,
  add column if not exists rvm_consent_confirmed_by uuid,
  add column if not exists rvm_consent_confirmed_at timestamptz,
  add column if not exists rvm_allowed_sources      jsonb;

-- ── Delivery + consent audit on the unified send ledger ──────────────────────
alter table public.drip_sends
  add column if not exists delivered_at   timestamptz,
  add column if not exists consent_basis  text,
  add column if not exists consent_source text;

-- ── RLS (company-scoped SELECT; writes via the service role) ─────────────────
alter table public.drip_audio_assets enable row level security;

create policy drip_audio_assets_select_company on public.drip_audio_assets
  for select to authenticated
  using (company_id in (select up.company_id from public.user_profiles up where up.id = auth.uid()));
