-- Check deposits — "Posted": the office has applied the payment to the
-- customer's account in Jobber (Jobber's API can't, so a person does it and
-- says so here). Independent of deposited: Kathryn posts, Zac deposits, in
-- either order. Additive.

alter table public.check_deposits
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by uuid;
