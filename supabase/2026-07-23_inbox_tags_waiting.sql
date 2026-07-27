-- Shared Inbox — Roadmap v2 Phase 2: two-kind tags + Waiting workflow states.
-- APPLIED to the shared staging+prod DB via Supabase MCP `inbox_tags_waiting_2026_07_23`.
-- 100% ADDITIVE (new table + nullable/defaulted columns + seed rows) → no existing data touched,
-- no prod behavior change until Phase 2 code deploys. See Hub/SHARED_INBOX_PRD.md Roadmap v2 Phase 2.

-- =====================================================================================================
-- 1. inbox_tags — admin-managed shared tag definitions. TWO kinds kept deliberately separate:
--    'type'    = what the email IS (set on arrival): Quote Request / Scheduling / Billing / …
--    'outcome' = what HAPPENED or what's NEXT (follow-up): Quoted / Booked / Needs Callback / …
--    Service-role only (read via a GET route behind a hasAccess gate, like inbox_rules).
-- =====================================================================================================
create table if not exists public.inbox_tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('type','outcome')),
  name text not null,
  color text not null default '#64748b',             -- hex chip color
  outlook_category text,                             -- Outlook category to mirror (Decision J); null → use name
  sort_order integer not null default 0,
  active boolean not null default true,              -- "delete" = deactivate (preserves history on tagged threads)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, name)
);
create index if not exists inbox_tags_company_idx on public.inbox_tags (company_id, kind, sort_order);
alter table public.inbox_tags enable row level security;
-- deliberately NO policies: service-role (admin client) only.

-- =====================================================================================================
-- 2. Tag associations — denormalized uuid[] on the thread for fast filter (.contains) + client render
--    (the small admin-managed tag list is loaded once by the UI to resolve id → name/color).
-- =====================================================================================================
alter table public.inbox_threads add column if not exists tags uuid[] not null default '{}';
create index if not exists inbox_threads_tags_gin on public.inbox_threads using gin (tags);

-- =====================================================================================================
-- 3. Waiting workflow state — ORTHOGONAL to status (NEVER a status enum value, which is filtered in
--    ~12 places). null = not waiting; otherwise who we're waiting on. Auto-cleared on inbound reply.
-- =====================================================================================================
alter table public.inbox_threads add column if not exists waiting_state text
  check (waiting_state is null or waiting_state in ('customer','tech','vendor','approval'));
alter table public.inbox_threads add column if not exists waiting_set_at timestamptz;
alter table public.inbox_threads add column if not exists waiting_set_by uuid references auth.users(id) on delete set null;
create index if not exists inbox_threads_waiting_idx on public.inbox_threads (company_id, waiting_state)
  where waiting_state is not null and deleted_at is null;

-- =====================================================================================================
-- 4. Seed Heroes' default tags (company …002). Admins edit/add/reorder in Admin → Manage tags.
--    NOTE: "waiting on X" is intentionally NOT an outcome tag — that's the waiting_state field above.
-- =====================================================================================================
insert into public.inbox_tags (company_id, kind, name, color, sort_order) values
  ('00000000-0000-0000-0000-000000000002','type','Quote Request','#2563eb',1),
  ('00000000-0000-0000-0000-000000000002','type','Scheduling','#0891b2',2),
  ('00000000-0000-0000-0000-000000000002','type','Billing','#7c3aed',3),
  ('00000000-0000-0000-0000-000000000002','type','Complaint','#dc2626',4),
  ('00000000-0000-0000-0000-000000000002','type','Vendor/Invoice','#a16207',5),
  ('00000000-0000-0000-0000-000000000002','type','Spam','#6b7280',6),
  ('00000000-0000-0000-0000-000000000002','outcome','Quoted','#2563eb',1),
  ('00000000-0000-0000-0000-000000000002','outcome','Booked','#16a34a',2),
  ('00000000-0000-0000-0000-000000000002','outcome','Needs Callback','#db2777',3),
  ('00000000-0000-0000-0000-000000000002','outcome','Refund Issued','#7c3aed',4),
  ('00000000-0000-0000-0000-000000000002','outcome','Resolved','#16a34a',5),
  ('00000000-0000-0000-0000-000000000002','outcome','Lost','#6b7280',6)
on conflict (company_id, kind, name) do nothing;
