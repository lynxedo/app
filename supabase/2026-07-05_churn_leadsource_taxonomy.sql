-- Churn / Retention + Lead-Source Reporting — Phase A taxonomy tables + seeds
-- Source of truth: Lynxedo/Hub/HLC_Churn_and_LeadSource_Reporting_Master.xlsx (July 2026)
-- Additive only. Seeded for Heroes Lawn Care (company 00000000-0000-0000-0000-000000000002).
-- Reads: company-scoped SELECT for authenticated. Writes: service-role only (no policies).

-- ============================================================
-- 1. Master cancellation reasons (26) + churn classification
-- ============================================================
create table if not exists public.churn_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  master_reason text not null,
  category text not null,
  churn_type text not null check (churn_type in ('Controllable','Uncontrollable','Company-Initiated','Not Churn','Review')),
  in_gross_churn boolean not null,
  in_controllable_churn boolean not null,
  revenue_impact text,
  sort_order int,
  created_at timestamptz not null default now()
);
create unique index if not exists churn_reasons_company_reason_uq
  on public.churn_reasons (company_id, lower(master_reason));

-- Old-system spellings (Monday Recurring-Services board + legacy Jobber dropdowns) → master reason
create table if not exists public.churn_reason_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  alias text not null,
  master_reason text not null,
  source_system text, -- 'monday' | 'jobber'
  created_at timestamptz not null default now()
);
create unique index if not exists churn_reason_aliases_company_alias_uq
  on public.churn_reason_aliases (company_id, lower(alias));

-- ============================================================
-- 2. Master lead sources (23) + grouping / cost type
-- ============================================================
create table if not exists public.lead_sources_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  master_source text not null,
  source_group text not null,
  cost_type text not null check (cost_type in ('Paid','Free','Mixed','Unknown')),
  sort_order int,
  created_at timestamptz not null default now()
);
create unique index if not exists lead_sources_master_company_source_uq
  on public.lead_sources_master (company_id, lower(master_source));

create table if not exists public.lead_source_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  alias text not null,
  master_source text not null,
  source_system text, -- 'monday' | 'jobber'
  created_at timestamptz not null default now()
);
create unique index if not exists lead_source_aliases_company_alias_uq
  on public.lead_source_aliases (company_id, lower(alias));

-- ============================================================
-- 3. RLS — company-scoped read; writes are service-role only
-- ============================================================
alter table public.churn_reasons enable row level security;
alter table public.churn_reason_aliases enable row level security;
alter table public.lead_sources_master enable row level security;
alter table public.lead_source_aliases enable row level security;

drop policy if exists churn_reasons_select on public.churn_reasons;
create policy churn_reasons_select on public.churn_reasons for select to authenticated
  using (company_id = (select up.company_id from public.user_profiles up where up.id = (select auth.uid())));
drop policy if exists churn_reason_aliases_select on public.churn_reason_aliases;
create policy churn_reason_aliases_select on public.churn_reason_aliases for select to authenticated
  using (company_id = (select up.company_id from public.user_profiles up where up.id = (select auth.uid())));
drop policy if exists lead_sources_master_select on public.lead_sources_master;
create policy lead_sources_master_select on public.lead_sources_master for select to authenticated
  using (company_id = (select up.company_id from public.user_profiles up where up.id = (select auth.uid())));
drop policy if exists lead_source_aliases_select on public.lead_source_aliases;
create policy lead_source_aliases_select on public.lead_source_aliases for select to authenticated
  using (company_id = (select up.company_id from public.user_profiles up where up.id = (select auth.uid())));

-- ============================================================
-- 4. Seeds — Heroes Lawn Care
--    NOTE: master names use EN-DASH (–) exactly as in Jobber's dropdowns.
-- ============================================================
insert into public.churn_reasons
  (company_id, master_reason, category, churn_type, in_gross_churn, in_controllable_churn, revenue_impact, sort_order)
values
  ('00000000-0000-0000-0000-000000000002','Went to Competition – Price','Competition','Controllable',true,true,'Full loss',1),
  ('00000000-0000-0000-0000-000000000002','Went to Competition – Results/Quality','Competition','Controllable',true,true,'Full loss',2),
  ('00000000-0000-0000-0000-000000000002','Went to Competition – Other','Competition','Controllable',true,true,'Full loss',3),
  ('00000000-0000-0000-0000-000000000002','Price – Too Expensive','Price & Financial','Controllable',true,true,'Full loss',4),
  ('00000000-0000-0000-0000-000000000002','Price – Increase Too High','Price & Financial','Controllable',true,true,'Full loss',5),
  ('00000000-0000-0000-0000-000000000002','Financial Hardship','Price & Financial','Uncontrollable',true,false,'Full loss',6),
  ('00000000-0000-0000-0000-000000000002','Unhappy – Poor Results','Dissatisfaction','Controllable',true,true,'Full loss',7),
  ('00000000-0000-0000-0000-000000000002','Lawn Unresponsive','Dissatisfaction','Controllable',true,true,'Full loss',8),
  ('00000000-0000-0000-0000-000000000002','Unhappy – Poor Service/Communication','Dissatisfaction','Controllable',true,true,'Full loss',9),
  ('00000000-0000-0000-0000-000000000002','Doing It Themselves (DIY)','Customer Choice','Controllable',true,true,'Full loss',10),
  ('00000000-0000-0000-0000-000000000002','Changed Mind','Customer Choice','Controllable',true,true,'Full loss',11),
  ('00000000-0000-0000-0000-000000000002','Service Requested Not Offered','Customer Choice','Uncontrollable',true,false,'Full loss',12),
  ('00000000-0000-0000-0000-000000000002','Moved','Life Event','Uncontrollable',true,false,'Full loss',13),
  ('00000000-0000-0000-0000-000000000002','Death / Health','Life Event','Uncontrollable',true,false,'Full loss',14),
  ('00000000-0000-0000-0000-000000000002','Home Renovation','Life Event','Uncontrollable',true,false,'Full loss',15),
  ('00000000-0000-0000-0000-000000000002','Seasonal – Will Restart','Plan-Specific','Controllable',true,true,'Full loss',16),
  ('00000000-0000-0000-0000-000000000002','Irrigation Plan – Did Not Renew','Plan-Specific','Controllable',true,true,'Full loss',17),
  ('00000000-0000-0000-0000-000000000002','TARR – Did Not Upgrade','Plan-Specific','Controllable',true,true,'Full loss',18),
  ('00000000-0000-0000-0000-000000000002','Not Enough Dogs (Pet Waste)','Plan-Specific','Uncontrollable',true,false,'Full loss',19),
  ('00000000-0000-0000-0000-000000000002','Upgraded','Plan Change','Not Churn',false,false,'Expansion (revenue up)',20),
  ('00000000-0000-0000-0000-000000000002','Downgraded','Plan Change','Not Churn',false,false,'Partial revenue loss',21),
  ('00000000-0000-0000-0000-000000000002','Admin – Non-Payment / Balance','Company-Initiated','Company-Initiated',true,false,'Full loss',22),
  ('00000000-0000-0000-0000-000000000002','Admin – Difficult / Disruptive Customer','Company-Initiated','Company-Initiated',true,false,'Full loss',23),
  ('00000000-0000-0000-0000-000000000002','Admin – Too Difficult to Service','Company-Initiated','Company-Initiated',true,false,'Full loss',24),
  ('00000000-0000-0000-0000-000000000002','Admin – Office Error','Company-Initiated','Company-Initiated',true,false,'Full loss',25),
  ('00000000-0000-0000-0000-000000000002','Unknown','Fallback','Review',true,false,'Full loss',26)
on conflict do nothing;

-- Reason aliases (workbook "Monday → Master" + "Jobber → Master"; case-insensitive lookup;
-- duplicate spellings across systems collapsed to one row)
insert into public.churn_reason_aliases (company_id, alias, master_reason, source_system) values
  -- Monday (Recurring Services board)
  ('00000000-0000-0000-0000-000000000002','Went to Competition - Results','Went to Competition – Results/Quality','monday'),
  ('00000000-0000-0000-0000-000000000002','Went to Competition - Price','Went to Competition – Price','monday'),
  ('00000000-0000-0000-0000-000000000002','Went to Competition - Other','Went to Competition – Other','monday'),
  ('00000000-0000-0000-0000-000000000002','Moved out of area','Moved','monday'),
  ('00000000-0000-0000-0000-000000000002','Moved in area','Moved','monday'),
  ('00000000-0000-0000-0000-000000000002','Death/Health','Death / Health','monday'),
  ('00000000-0000-0000-0000-000000000002','DIY','Doing It Themselves (DIY)','monday'),
  ('00000000-0000-0000-0000-000000000002','Results - RRR','Lawn Unresponsive','monday'),
  ('00000000-0000-0000-0000-000000000002','Results - Other','Unhappy – Poor Results','monday'),
  ('00000000-0000-0000-0000-000000000002','TARR - Did not upgrade','TARR – Did Not Upgrade','monday'),
  ('00000000-0000-0000-0000-000000000002','Financial Reasons','Financial Hardship','monday'),
  ('00000000-0000-0000-0000-000000000002','Renovation','Home Renovation','monday'),
  ('00000000-0000-0000-0000-000000000002','Unhappy with service','Unhappy – Poor Service/Communication','monday'),
  ('00000000-0000-0000-0000-000000000002','Office - Disputive Customer','Admin – Difficult / Disruptive Customer','monday'),
  ('00000000-0000-0000-0000-000000000002','Office - Other','Admin – Office Error','monday'),
  ('00000000-0000-0000-0000-000000000002','Collections / Account Balance','Admin – Non-Payment / Balance','monday'),
  ('00000000-0000-0000-0000-000000000002','IR G - Did not renew','Irrigation Plan – Did Not Renew','monday'),
  ('00000000-0000-0000-0000-000000000002','not enough dogs','Not Enough Dogs (Pet Waste)','monday'),
  ('00000000-0000-0000-0000-000000000002','IR Plan did not renew','Irrigation Plan – Did Not Renew','monday'),
  ('00000000-0000-0000-0000-000000000002','Will restart','Seasonal – Will Restart','monday'),
  -- Jobber (legacy dropdown values)
  ('00000000-0000-0000-0000-000000000002','Price too High','Price – Too Expensive','jobber'),
  ('00000000-0000-0000-0000-000000000002','Doing It Themselves','Doing It Themselves (DIY)','jobber'),
  ('00000000-0000-0000-0000-000000000002','Poor Quality Service','Unhappy – Poor Service/Communication','jobber'),
  ('00000000-0000-0000-0000-000000000002','Customer Unemployed','Financial Hardship','jobber'),
  ('00000000-0000-0000-0000-000000000002','Declined to Provide','Service Requested Not Offered','jobber'),
  ('00000000-0000-0000-0000-000000000002','Lawn Was Unresponsive','Lawn Unresponsive','jobber'),
  ('00000000-0000-0000-0000-000000000002','Admin Cancelled - Office Error','Admin – Office Error','jobber'),
  ('00000000-0000-0000-0000-000000000002','Disputive Customer','Admin – Difficult / Disruptive Customer','jobber'),
  ('00000000-0000-0000-0000-000000000002','Too Difficult To Service','Admin – Too Difficult to Service','jobber'),
  ('00000000-0000-0000-0000-000000000002','Stopped Paying','Admin – Non-Payment / Balance','jobber'),
  ('00000000-0000-0000-0000-000000000002','Admin Cancelled - Balance','Admin – Non-Payment / Balance','jobber'),
  ('00000000-0000-0000-0000-000000000002','Admin Cancelled - Difficulty','Admin – Too Difficult to Service','jobber'),
  ('00000000-0000-0000-0000-000000000002','Admin Cancelled - Disruptive','Admin – Difficult / Disruptive Customer','jobber'),
  ('00000000-0000-0000-0000-000000000002','Price Increase too High','Price – Increase Too High','jobber'),
  ('00000000-0000-0000-0000-000000000002','Went To Competition - Quality','Went to Competition – Results/Quality','jobber'),
  ('00000000-0000-0000-0000-000000000002','Went to Competition - Unknown','Went to Competition – Other','jobber'),
  ('00000000-0000-0000-0000-000000000002','Went To Competition - Staff','Went to Competition – Other','jobber'),
  ('00000000-0000-0000-0000-000000000002','Schedule Conflict or Too Slow','Unhappy – Poor Service/Communication','jobber')
on conflict do nothing;

-- Master lead sources (23)
insert into public.lead_sources_master (company_id, master_source, source_group, cost_type, sort_order) values
  ('00000000-0000-0000-0000-000000000002','Angi Ads','Paid – Lead-Gen Platforms','Paid',1),
  ('00000000-0000-0000-0000-000000000002','Angi Leads','Paid – Lead-Gen Platforms','Paid',2),
  ('00000000-0000-0000-0000-000000000002','Thumbtack','Paid – Lead-Gen Platforms','Paid',3),
  ('00000000-0000-0000-0000-000000000002','Networx','Paid – Lead-Gen Platforms','Paid',4),
  ('00000000-0000-0000-0000-000000000002','SERV','Paid – Lead-Gen Platforms','Paid',5),
  ('00000000-0000-0000-0000-000000000002','Google Ads (PPC)','Paid – Lead-Gen Platforms','Paid',6),
  ('00000000-0000-0000-0000-000000000002','Meta / Facebook Ads','Paid – Advertising','Paid',7),
  ('00000000-0000-0000-0000-000000000002','Direct Mail / Postcards','Paid – Advertising','Paid',8),
  ('00000000-0000-0000-0000-000000000002','Other Paid Source','Paid – Advertising','Paid',9),
  ('00000000-0000-0000-0000-000000000002','Google (GBP / LSA)','Digital – Google','Mixed',10),
  ('00000000-0000-0000-0000-000000000002','Website (Organic)','Organic / Digital','Free',11),
  ('00000000-0000-0000-0000-000000000002','Facebook Page (Organic)','Organic / Digital','Free',12),
  ('00000000-0000-0000-0000-000000000002','Nextdoor','Organic / Digital','Free',13),
  ('00000000-0000-0000-0000-000000000002','Customer Referral','Referral / Relationship','Free',14),
  ('00000000-0000-0000-0000-000000000002','Repeat / Existing Customer','Referral / Relationship','Free',15),
  ('00000000-0000-0000-0000-000000000002','Friends & Family','Referral / Relationship','Free',16),
  ('00000000-0000-0000-0000-000000000002','Referral Partner / Business Referral','Referral / Relationship','Free',17),
  ('00000000-0000-0000-0000-000000000002','Networking','Referral / Relationship','Free',18),
  ('00000000-0000-0000-0000-000000000002','Door Hanger','Self-Generated / Field','Free',19),
  ('00000000-0000-0000-0000-000000000002','Yard Sign','Self-Generated / Field','Free',20),
  ('00000000-0000-0000-0000-000000000002','Vehicle Wrap','Self-Generated / Field','Free',21),
  ('00000000-0000-0000-0000-000000000002','Home Show / Tradeshow / Events','Self-Generated / Field','Free',22),
  ('00000000-0000-0000-0000-000000000002','Other / Unknown','Other','Unknown',23)
on conflict do nothing;

-- Lead-source aliases (workbook "LS Monday → Master" + "LS Jobber → Master";
-- "(NOT A LEAD SOURCE)" junk values deliberately NOT seeded — they resolve to nothing)
insert into public.lead_source_aliases (company_id, alias, master_source, source_system) values
  -- Monday Lead Tracker (2025/2026)
  ('00000000-0000-0000-0000-000000000002','Angi Lead','Angi Leads','monday'),
  ('00000000-0000-0000-0000-000000000002','GLSA','Google (GBP / LSA)','monday'),
  ('00000000-0000-0000-0000-000000000002','Google','Google (GBP / LSA)','monday'),
  ('00000000-0000-0000-0000-000000000002','Paid Source','Other Paid Source','monday'),
  ('00000000-0000-0000-0000-000000000002','Facebook','Facebook Page (Organic)','monday'),
  ('00000000-0000-0000-0000-000000000002','Organic','Website (Organic)','monday'),
  ('00000000-0000-0000-0000-000000000002','Website Visit','Website (Organic)','monday'),
  ('00000000-0000-0000-0000-000000000002','Repeat Customer','Repeat / Existing Customer','monday'),
  ('00000000-0000-0000-0000-000000000002','Existing Customer','Repeat / Existing Customer','monday'),
  ('00000000-0000-0000-0000-000000000002','Referral','Customer Referral','monday'),
  ('00000000-0000-0000-0000-000000000002','Neighbor Referral','Customer Referral','monday'),
  ('00000000-0000-0000-0000-000000000002','Friends and Family','Friends & Family','monday'),
  ('00000000-0000-0000-0000-000000000002','Networking- BNI','Networking','monday'),
  ('00000000-0000-0000-0000-000000000002','Networking-Other','Networking','monday'),
  ('00000000-0000-0000-0000-000000000002','Postcard/Mailer','Direct Mail / Postcards','monday'),
  ('00000000-0000-0000-0000-000000000002','Mailer','Direct Mail / Postcards','monday'),
  ('00000000-0000-0000-0000-000000000002','Post Card 1/27','Direct Mail / Postcards','monday'),
  ('00000000-0000-0000-0000-000000000002','Door Hanging','Door Hanger','monday'),
  ('00000000-0000-0000-0000-000000000002','Truck wrap','Vehicle Wrap','monday'),
  ('00000000-0000-0000-0000-000000000002','Events','Home Show / Tradeshow / Events','monday'),
  ('00000000-0000-0000-0000-000000000002','BS Marketing','Other / Unknown','monday'),
  ('00000000-0000-0000-0000-000000000002','BS Marketing Day','Other / Unknown','monday'),
  ('00000000-0000-0000-0000-000000000002','LSS','Other / Unknown','monday'),
  -- Jobber native leadSource values (title-cased exports)
  ('00000000-0000-0000-0000-000000000002','Paid Angi Ads','Angi Ads','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Angi Leads','Angi Leads','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Thumbtack','Thumbtack','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Networx Platform','Networx','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Google Ads Ppc','Google Ads (PPC)','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Gbp Website Organic Search','Google (GBP / LSA)','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Gpb Website Organic Search','Google (GBP / LSA)','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Glsa Google Local Service Ads','Google (GBP / LSA)','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Meta Ads Paid','Meta / Facebook Ads','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Facebook Page Organic','Facebook Page (Organic)','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Direct Mail Postcards','Direct Mail / Postcards','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Email Campaign','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Bing','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Yelp','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Tv Ctv Ott','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Magazine Newspaper','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Scorpion Booking Tool','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Scorpion Directory','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Home Solutions','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Howie','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Othe Lead Gen Portals','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Other Local Marketing','Other Paid Source','jobber'),
  ('00000000-0000-0000-0000-000000000002','Paid Zee Partnerships','Referral Partner / Business Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Landscaping Solutions','Referral Partner / Business Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Contractor','Referral Partner / Business Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Supplier Referral','Referral Partner / Business Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Referral Partner Client Referral','Referral Partner / Business Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Zee Partnerships','Referral Partner / Business Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Customer Referral','Customer Referral','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Repeat Customer','Repeat / Existing Customer','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Friends Family','Friends & Family','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Networking General','Networking','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Better Business Bureau','Networking','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Chamber Of Commerce','Networking','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Memberships','Networking','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Door Hanger','Door Hanger','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Yard Sign','Yard Sign','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Vehicle Wrap','Vehicle Wrap','jobber'),
  ('00000000-0000-0000-0000-000000000002','Self Gen Home Show Tradeshow','Home Show / Tradeshow / Events','jobber'),
  ('00000000-0000-0000-0000-000000000002','Angi Leads Integration','Angi Leads','jobber')
on conflict do nothing;
