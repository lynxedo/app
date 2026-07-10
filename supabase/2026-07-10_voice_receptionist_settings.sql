-- 2026-07-10_voice_receptionist_settings.sql
-- AI Voice Receptionist — per-company editable settings.
--
-- Moves the receptionist's greeting, behavior instructions (prompt), voice, and
-- on/off switch out of code/env (lib/voice-receptionist.ts +
-- VOICE_ELEVENLABS_VOICE_ID) and into a per-company row that Ben can edit in
-- Admin -> Dialer -> AI Receptionist. The call-time endpoints read this row and
-- fall back to the code constants / env whenever a field is blank.
--
-- One row per company (company_id is the PK). Additive + non-destructive.

create table if not exists public.voice_receptionist_settings (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  enabled      boolean not null default false,
  greeting     text,          -- null/blank -> buildWelcomeGreeting() code default
  instructions text,          -- null/blank -> VOICE_RECEPTIONIST_PROMPT code default
  voice_id     text,          -- null/blank -> env VOICE_ELEVENLABS_VOICE_ID
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

-- RLS mirrors the other Dialer/Responder settings: the app reads + writes this
-- table exclusively through the service-role admin client inside the
-- can_admin_dialer-gated /api/admin/voice-receptionist-settings route (and the
-- can_admin_dialer-gated Dialer admin page), and the service role bypasses RLS.
-- These policies are defense-in-depth so a normal authenticated client can only
-- ever see/edit its OWN company's row, and only when the user is a company admin
-- (role = 'admin' OR can_admin_dialer = true).
alter table public.voice_receptionist_settings enable row level security;

drop policy if exists voice_receptionist_settings_admin_select on public.voice_receptionist_settings;
create policy voice_receptionist_settings_admin_select
  on public.voice_receptionist_settings for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.company_id = voice_receptionist_settings.company_id
        and (up.role = 'admin' or up.can_admin_dialer = true)
    )
  );

drop policy if exists voice_receptionist_settings_admin_update on public.voice_receptionist_settings;
create policy voice_receptionist_settings_admin_update
  on public.voice_receptionist_settings for update to authenticated
  using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.company_id = voice_receptionist_settings.company_id
        and (up.role = 'admin' or up.can_admin_dialer = true)
    )
  )
  with check (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.company_id = voice_receptionist_settings.company_id
        and (up.role = 'admin' or up.can_admin_dialer = true)
    )
  );

-- ── Heroes seed (company 00000000-0000-0000-0000-000000000002) ───────────────
-- Enabled, with the current Kai ElevenLabs voice. greeting + instructions are
-- left NULL so the endpoints fall back to the code defaults
-- (buildWelcomeGreeting() + VOICE_RECEPTIONIST_PROMPT) until Ben customizes
-- them in Admin.
insert into public.voice_receptionist_settings (company_id, enabled, voice_id)
values ('00000000-0000-0000-0000-000000000002', true, 'GGRMgbKfr7QscdcrvWga')
on conflict (company_id) do nothing;
