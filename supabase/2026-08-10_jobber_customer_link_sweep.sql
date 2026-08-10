-- Jobber "Lynxedo Customer File" link sweep — August 10, 2026
--
-- WHY. Jobber's link custom field puts a tappable "Open customer file" link on a
-- client (and, because the field is transferable, on their jobs) that lands a tech
-- on the matching Hub customer page. The value has to be written per client, so
-- ~1,600 clients need one write each, and every client added later needs one too.
--
-- WHAT. A marker column so the sweep is cheap and resumable. Jobber's sync cannot
-- tell us which clients already have the link: CUSTOM_FIELDS_FRAGMENT in
-- lib/jobber-sync.ts requests five of the six custom-field types and omits
-- CustomFieldLink, so link values arrive unlabelled and are skipped by
-- parseCustomFields. Rather than widen a fragment shared by clients, properties,
-- jobs and invoices — or re-read every client from Jobber on every run — we record
-- locally that we set it. The field is created readOnly, so nothing on the Jobber
-- side can clear a value we wrote.
--
-- Null means "not written yet", which is also the correct state for every existing
-- row, so no data migration is needed. Re-running the sweep after clearing this
-- column re-writes the links.

alter table txt_contacts
  add column if not exists jobber_link_set_at timestamptz;

comment on column txt_contacts.jobber_link_set_at is
  'When the Jobber "Lynxedo Customer File" link custom field was last written for this contact. Null = never written; the sweep picks those up.';

-- The sweep's only query: unwritten contacts that have a Jobber client to write to,
-- newest first. Partial, so it stays small as the backlog drains to zero.
create index if not exists txt_contacts_jobber_link_pending_idx
  on txt_contacts (company_id, created_at desc)
  where jobber_link_set_at is null and jobber_client_id is not null;
