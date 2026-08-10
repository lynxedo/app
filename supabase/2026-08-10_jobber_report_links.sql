-- Jobber per-job report links — August 10, 2026
--
-- WHY. A tech on an irrigation job should be able to tap straight into the
-- irrigation report. The obvious way to decide which jobs get that link is to look
-- at the job title or line-item codes — but "IR" and "WF" are Heroes' own shorthand.
-- Another subscriber words everything differently, so a hardcoded rule is a
-- Heroes-only feature wearing a product's clothes.
--
-- WHAT. An admin maps line items to a report. Any job carrying one of those line
-- items gets that report's link. Adding the WF report later is a row here, not a
-- code change.
--
-- One Jobber custom field PER REPORT, not one shared field: a job can carry both
-- irrigation and weed-feed line items, and a link field holds a single URL. Field
-- ids are recorded rather than created automatically — an app-owned custom field
-- may not be removable from the Jobber side, so stamping one into a subscriber's
-- account has to be a deliberate act.

create table if not exists jobber_report_links (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  -- Stable key the code refers to ('irrigation', 'wf', …). Label is what admins see.
  report_key      text not null,
  label           text not null,
  -- The Jobber link custom field this report writes into (appliesTo ALL_JOBS).
  jobber_field_id text not null,
  -- Text shown as the link in Jobber, e.g. "Start irrigation inspection".
  link_text       text not null,
  -- Appended to the resolver URL, e.g. '?irrigation=new'. Empty = plain customer file.
  url_suffix      text not null default '',
  -- Jobber line-item NAMES that qualify a job. Matched case-insensitively.
  line_items      text[] not null default '{}',
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, report_key)
);

alter table jobber_report_links enable row level security;
-- Service-role only: reached from webhooks and admin routes that carry their own gate.

-- Which (job, report) pairs have already been written, so a JOB_UPDATE storm doesn't
-- re-write the same link over and over. Jobber's abuse filter blocks the whole
-- credential when written to too fast, so "don't write what's already there" is a
-- reliability requirement, not an optimisation.
create table if not exists jobber_job_link_writes (
  company_id     uuid not null references companies(id),
  jobber_job_id  text not null,
  report_key     text not null,
  url            text not null,
  written_at     timestamptz not null default now(),
  primary key (company_id, jobber_job_id, report_key)
);

alter table jobber_job_link_writes enable row level security;
