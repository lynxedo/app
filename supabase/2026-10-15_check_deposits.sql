-- Check deposits — a tech photographs a customer's paper check (front + back)
-- in Hub, the photos post to the "checks and cash" room, and Zac does mobile
-- deposit from there. This table is the list that stops a check going missing:
-- every check sent, and whether it has been deposited yet.
--
-- Photos live in R2 under the same hub/<company>/ keys as any Hub upload, so the
-- room post serves them through the existing file route.
--
-- Additive. RLS enabled with no policies → service-role only (the API scopes
-- every read/write by the caller's company).

create table if not exists public.check_deposits (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  -- The customer, when picked from the Contacts directory. Free text always kept
  -- so a check from someone not in the directory still files.
  contact_id      uuid references public.txt_contacts(id) on delete set null,
  customer_name   text not null,
  amount_cents    integer not null check (amount_cents > 0),
  check_number    text,
  memo            text,
  front_path      text not null,
  back_path       text not null,
  -- What the photo check said about each side, kept so a "sent anyway" can be
  -- read later: { ok, problems[], amount_read, check_number_read, endorsed }.
  front_review    jsonb,
  back_review     jsonb,
  sent_anyway     boolean not null default false,
  submitted_by    uuid not null,
  message_id      uuid,
  status          text not null default 'pending'
                    check (status in ('pending', 'deposited', 'void')),
  deposited_at    timestamptz,
  deposited_by    uuid,
  created_at      timestamptz not null default now()
);
alter table public.check_deposits enable row level security;
revoke all on public.check_deposits from anon, authenticated;

create index if not exists check_deposits_company_status_idx
  on public.check_deposits (company_id, status, created_at desc);
create index if not exists check_deposits_submitter_idx
  on public.check_deposits (company_id, submitted_by, created_at desc);
