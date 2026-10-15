-- Gary — session 5: commercial prospecting from FREE sources (Ben, Oct 15 2026).
-- PRD: Reference/PRDs/GARY_OUTBOUND_SALES_PRD.md (Drive), Phase 2.
--
-- gary_prospects: HOAs (the state's HOA management-certificate list, TREC) and
-- apartment complexes (Gary's web search). Property-management companies are not
-- rows of their own: they're whoever manages these places, rolled up on screen.
-- Finding only — nothing here contacts anyone.
--
-- Additive. RLS enabled with no policies → service-role only.

create table if not exists public.gary_prospects (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  kind                text not null check (kind in ('hoa', 'apartment')),
  name                text not null,
  -- Normalized name + ZIP: the same place found twice is one row.
  dedupe_key          text not null,
  hoa_type            text,                       -- POA / COA (state list)
  address             text,
  city                text,
  zip                 text,
  county              text,
  phone               text,
  email               text,
  website             text,
  -- Who manages it (from the certificate, or the apartment's listing).
  manager_company     text,
  manager_name        text,
  manager_phone       text,
  manager_email       text,
  manager_address     text,
  source              text not null check (source in ('trec_hoa', 'web_search')),
  source_url          text,                       -- certificate PDF / page Gary found it on
  -- new → researched (certificate read / details found) ; not_a_fit set by a person.
  status              text not null default 'new' check (status in ('new', 'researched', 'not_a_fit')),
  -- A Jobber client whose name matches (we already work there).
  matched_client_external_id text,
  matched_client_name text,
  researched_at       timestamptz,
  research_error      text,
  est_cost_usd        numeric(10, 4),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.gary_prospects enable row level security;
revoke all on public.gary_prospects from anon, authenticated;

create unique index if not exists gary_prospects_dedupe_uniq on public.gary_prospects (company_id, kind, dedupe_key);
create index if not exists gary_prospects_company_kind_idx on public.gary_prospects (company_id, kind, status);

-- Where Gary looks: ZIP codes. Heroes starts with every ZIP that has 3+ of its
-- customers with a Jobber job (Oct 15 2026: 23 ZIPs — The Woodlands, Spring,
-- Conroe, Magnolia, Montgomery, Tomball, Klein, Willis, Shenandoah, Pinehurst).
alter table public.gary_settings
  add column if not exists prospect_zips text[] not null default '{}';

update public.gary_settings g
set prospect_zips = z.zips
from (
  select array_agg(zip order by n desc) zips from (
    select left(p.zip, 5) zip, count(*) n
    from public.properties p
    where p.company_id = '00000000-0000-0000-0000-000000000002' and p.deleted_at is null
      and left(p.zip, 5) ~ '^\d{5}$'
      and exists (select 1 from public.jobs j where j.company_id = p.company_id and j.client_external_id = p.client_external_id and j.deleted_at is null)
    group by 1 having count(*) >= 3
  ) t
) z
where g.company_id = '00000000-0000-0000-0000-000000000002' and g.prospect_zips = '{}';
