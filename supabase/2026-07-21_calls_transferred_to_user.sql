-- AI Receptionist (Amber) transfer attribution.
--
-- When Amber answers a call (call_type='ai_receptionist') and then hands it off
-- to a live person who ACTUALLY takes it, record that person here so the Call Log
-- can attribute the call to the human who handled it ("{Name} · via Amber")
-- instead of just "Amber". NULL = Amber handled it herself, or no one picked up
-- (the transfer rang out to voicemail).
--
-- Written by the transfer-completion paths only, on a CONFIRMED human takeover:
--   • /api/voice/twiml/transfer-result  — on DialCallStatus completed/answered for
--     a single known-user target (softphone / route_call user / extension), keyed
--     by the ?u= user id passed on the <Dial action> URL.
--   • /api/voice/transfer/cell-accept   — when a recipient presses 1 to accept.
-- Multi-party rings (ring groups / multi-user softphone) don't set this — we can't
-- know which recipient answered — so those stay attributed to Amber.
--
-- Additive + nullable → no behavior change for any existing call. handled_by is
-- left untouched (Recent-tab / coaching attribution unchanged).

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS transferred_to_user_id uuid;

COMMENT ON COLUMN public.calls.transferred_to_user_id IS
  'AI-receptionist calls: the hub_users id of the live person who took the call after Amber transferred it (confirmed answer only). NULL = Amber handled it / no one picked up.';
