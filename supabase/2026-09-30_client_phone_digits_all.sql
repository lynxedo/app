-- Every phone on a Jobber client / contact person, not just the primary.
--
-- The receptionist and the Dialer screen-pop match a caller by phone against the
-- Jobber mirror. The sync only ever stored each client's PRIMARY phone (and each
-- contact person's first phone), so a customer calling from the second number on
-- their own account was "not found". Additive: a text[] of 10-digit forms, GIN
-- indexed for the overlap match, backfilled from the existing phone_digits so the
-- overlap match works immediately; the nightly Jobber sync fills in the rest.
alter table public.clients  add column if not exists phone_digits_all text[];
alter table public.contacts add column if not exists phone_digits_all text[];

create index if not exists idx_clients_phone_digits_all  on public.clients  using gin (phone_digits_all);
create index if not exists idx_contacts_phone_digits_all on public.contacts using gin (phone_digits_all);

update public.clients
   set phone_digits_all = array[right(phone_digits, 10)]
 where phone_digits_all is null and phone_digits is not null and length(phone_digits) >= 10;

update public.contacts
   set phone_digits_all = array[right(phone_digits, 10)]
 where phone_digits_all is null and phone_digits is not null and length(phone_digits) >= 10;
