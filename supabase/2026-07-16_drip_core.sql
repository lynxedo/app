-- Drip Core spine (Phase 2 email + stage-triggers + per-lead no-calls) — all additive.
-- Applied with the drip v2 deploy, alongside 2026-07-16_drip_rvm.sql /
-- 2026-07-16_amber_text.sql / 2026-07-16_tracker_board.sql.

-- Email send-ledger fields (the RVM migration adds consent_basis/consent_source/delivered_at).
alter table drip_sends add column if not exists to_email text;
alter table drip_sends add column if not exists subject text;

-- Per-lead "no calls" preference. RVM is legally a call (FCC 22-85), so this gates
-- RVM steps — honors e.g. a Google LSA lead that chose "messages only".
alter table txt_contacts add column if not exists do_not_call boolean not null default false;
