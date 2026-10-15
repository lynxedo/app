-- Amber 90% — Phase 1 session 3: the first text to a new lead.
--
-- hub_assistant_settings.amber_lead_text: per-source settings for the text a new
-- lead gets the moment it arrives (Admin → AI → Amber's account → New leads).
--   { "enabled": true,
--     "sources": { "angi":   { "mode": "canned", "when": "any" },
--                  "google": { "mode": "off",    "when": "any" } } }
-- mode: 'off' | 'canned' (the fixed text) | 'amber' (she writes it from what they asked for)
-- when: 'any' | 'after_hours' | 'office_hours'
-- NULL = today's behaviour: Angi gets the canned text at any hour, Google is left
-- to the Drip campaign (lib/amber-lead-text.ts DEFAULT_LEAD_TEXT).
--
-- amber_lead_texts: one row per new lead the feature looked at — sent, skipped
-- (and why), or failed — with what was sent and what it cost. A 'pending'/'sent'
-- row also tells the Drip engine Amber has this lead, so a Drip campaign on the
-- same lead source never sends a second first text. Test rows (the "Send me a
-- test" button) have no lead_id.
--
-- Additive + inert. RLS enabled with no policies → service-role only.

alter table public.hub_assistant_settings
  add column if not exists amber_lead_text jsonb;

create table if not exists public.amber_lead_texts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete set null,
  source          text not null check (source in ('angi', 'google')),
  mode            text not null check (mode in ('off', 'canned', 'amber')),
  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'skipped', 'failed', 'test')),
  reason          text,
  body            text,
  -- Amber's text couldn't be written, so the canned text went instead.
  fell_back       boolean not null default false,
  sms_sent        boolean not null default false,
  google_sent     boolean not null default false,
  conversation_id uuid,
  model           text,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  est_cost_usd    numeric(10, 4),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
alter table public.amber_lead_texts enable row level security;
revoke all on public.amber_lead_texts from anon, authenticated;

create unique index if not exists amber_lead_texts_lead_uniq
  on public.amber_lead_texts (lead_id)
  where lead_id is not null;
create index if not exists amber_lead_texts_company_created_idx
  on public.amber_lead_texts (company_id, created_at desc);
