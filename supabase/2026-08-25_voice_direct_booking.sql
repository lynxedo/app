-- AI Voice Receptionist — Level 4 DIRECT booking (jobCreate), not just a Request.
--
-- Ben, after testing the live line: "I have it set so that she books the appointment
-- versus putting in a request, but my test, she put in a request."
--
-- He was right and the setting was not. voice_scheduling_services.commitment has had
-- 'direct' as a selectable value since the feature shipped, but app/api/voice/book only
-- ever called requestCreate — it read `commitment` solely to echo it back in the JSON.
-- The route header said so outright ("Request-mode only... Direct auto-book (jobCreate)
-- ... are the documented fast-follow"), so no admin change could ever have worked.
--
-- Creating a real JOB needs two things a Request never did, because a Request is a
-- to-do for a human and a Job is the thing a truck drives to:
--
--   1. A TITLE in the company's own convention. Heroes' is `IR SVC $125 Woodlands West`
--      — service code, price, neighborhood — and it is load-bearing: the office reads
--      the route off it. There is no generic default that would be correct, so it is
--      configured per schedulable service rather than guessed.
--
--   2. The NEIGHBORHOOD that title ends with. Heroes' own knowledge doc is emphatic:
--      "Never infer a neighborhood from a zip code, a city name, or memory. These names
--      are polygons on a map, not cities — several of them overlap the same zip codes,
--      and guessing has produced wrong-neighborhood job titles before." So we never
--      derive one from the address. We match the CUSTOMER'S OWN prior job titles
--      against this canonical list (same client, same property — evidence, not
--      inference) and, failing that, leave it off and flag the job for the office.
--      ~70% of Heroes' existing customers resolve this way.
--
-- Price and line-item description are deliberately NOT stored here — they are read live
-- from the Jobber product catalog at booking time, so they cannot drift from what is
-- actually in Jobber.

alter table voice_scheduling_services
  add column if not exists job_title_template text;

comment on column voice_scheduling_services.job_title_template is
  'Direct-booking job title pattern. Placeholders: [PRICE] [NEIGHBORHOOD] [SERVICE] [LASTNAME]. NULL falls back to the line item name (the pre-direct-booking behaviour).';

alter table voice_receptionist_settings
  add column if not exists neighborhoods text[];

comment on column voice_receptionist_settings.neighborhoods is
  'Canonical neighborhood names for job titles, spelled exactly as the office spells them. Matched against a customer''s existing job titles; never inferred from an address.';

-- What the receptionist actually booked. Written mid-call by /api/voice/book; read
-- after the call by /api/voice/wrapup so the booked job shows up on the Office Alert
-- (and on the Lead Tracker row when the call produced one).
--
-- ⚠ The wrap-up does NOT always create a lead: it returns early for 'scheduling',
-- 'existing_customer', 'complaint' and 'billing' calls and posts an Office Alert
-- instead. A booking call is almost always one of those (direct booking requires an
-- EXISTING Jobber customer), so a booking must not depend on a lead existing.
create table if not exists voice_bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  call_sid text,
  jobber_job_id text,
  job_number text,
  job_title text,
  service_line_item text,
  booked_date date,
  start_hhmm text,
  end_hhmm text,
  jobber_client_id text,
  neighborhood text,
  needs_office_attention boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists voice_bookings_call_sid_idx on voice_bookings (call_sid);
create index if not exists voice_bookings_company_created_idx on voice_bookings (company_id, created_at desc);

-- Service-role only. A table created in `public` grants anon ALL by default, and this
-- one carries customer job detail.
alter table voice_bookings enable row level security;
revoke all on voice_bookings from anon, authenticated;

-- ── Heroes seed ────────────────────────────────────────────────────────────────
-- Title shape and the neighborhood list both come from the company's own knowledge
-- docs (job_catalog / neighborhoods), and are verified against jobs actually created
-- in the last week: `IR SVC $125 Woodforest PTF`, `IR SVC $125 Honea Egypt`.
update voice_scheduling_services
   set job_title_template = 'IR SVC $[PRICE] [NEIGHBORHOOD]'
 where company_id = '00000000-0000-0000-0000-000000000002'
   and line_item = 'IR - Irrigation Service Call - T1';

update voice_receptionist_settings
   set neighborhoods = ARRAY[
     '105 Area','Bender''s Landing','Bentwater','Conroe','Creekside','Dobbin Huffsmith',
     'Grand Lakes Estates','HarpersArtavia','Honea Egypt','Imperial Oaks','Jacob''s Reserve',
     'Klein','Magnolia','Montgomery','NorthPointe','Old Hempstead','Rosehill','Spring',
     'Tomball','Walden','White Oaks','Willis','Willow Creek','Windcrest','WoodForest',
     'Woodlands East','Woodlands South','Woodlands West'
   ]
 where company_id = '00000000-0000-0000-0000-000000000002';
