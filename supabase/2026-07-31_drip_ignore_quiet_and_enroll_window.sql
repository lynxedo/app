-- Drip: per-step "ignore quiet hours" + per-campaign enrollment window.
-- Both additive + defaulted so existing campaigns behave exactly as before.
--
-- ignore_quiet_hours: when true, a step sends even during the company quiet-hours
--   window (used for the instant speed-to-lead first touch, esp. after-hours).
-- enroll_window: gates WHEN a lead may ENTER the campaign, evaluated against the
--   company's Responder business hours (responder_settings). 'always' = today's
--   behavior; 'business_hours' = only enroll while the office is open;
--   'after_hours' = only enroll when closed (nights/weekends) — the "let the drip
--   handle leads nobody's in the office for" case.

alter table public.drip_steps
  add column if not exists ignore_quiet_hours boolean not null default false;

alter table public.drip_campaigns
  add column if not exists enroll_window text not null default 'always';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drip_campaigns_enroll_window_check'
  ) then
    alter table public.drip_campaigns
      add constraint drip_campaigns_enroll_window_check
      check (enroll_window in ('always', 'business_hours', 'after_hours'));
  end if;
end $$;
