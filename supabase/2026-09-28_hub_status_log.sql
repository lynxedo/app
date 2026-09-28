-- Hub status log — how long each person's dot was Green / Yellow / Red / Offline.
--
-- The dot colour is DERIVED (hub_users_with_presence.effective_status): a saved
-- 'busy'/'dnd' wins, otherwise an hourly person is Green only while clocked in
-- and everyone else only while active in the last 2 hours. That means the dot
-- changes with no write to hub_users at all (a clock-out, two quiet hours), so a
-- trigger on hub_users would miss most changes. Instead a once-a-minute cron
-- calls hub_status_sample(), which reads the view and opens a new interval
-- whenever someone's colour differs from their open one. Accurate to ~1 minute.
--
-- Additive only: one new table + two functions. Service-role only (RLS on, no
-- policies, EXECUTE revoked from anon/authenticated).

create table if not exists public.hub_status_intervals (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  user_id     uuid not null references public.hub_users(id) on delete cascade,
  status      text not null check (status in ('available', 'busy', 'dnd', 'offline')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

-- One open interval per person.
create unique index if not exists hub_status_intervals_open_uniq
  on public.hub_status_intervals (user_id) where ended_at is null;
create index if not exists hub_status_intervals_company_started
  on public.hub_status_intervals (company_id, started_at);

alter table public.hub_status_intervals enable row level security;
revoke all on public.hub_status_intervals from anon, authenticated;

-- Called every minute by POST /api/hub/status-log/tick.
create or replace function public.hub_status_sample()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  -- Overlapping cron runs must not both open an interval.
  perform pg_advisory_xact_lock(hashtext('hub_status_sample'));

  drop table if exists _cur;
  create temp table _cur on commit drop as
    select id, company_id, effective_status as status
      from hub_users_with_presence
     where not coalesce(is_bot, false) and company_id is not null;

  update hub_status_intervals i
     set ended_at = now()
    from _cur c
   where i.user_id = c.id and i.ended_at is null and i.status <> c.status;

  insert into hub_status_intervals (company_id, user_id, status)
  select c.company_id, c.id, c.status
    from _cur c
   where not exists (
     select 1 from hub_status_intervals i where i.user_id = c.id and i.ended_at is null
   );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- Seconds per person per colour inside [from_date 00:00, to_date 24:00) in tz.
create or replace function public.hub_status_totals(
  p_company_id uuid,
  p_from_date date,
  p_to_date date,
  p_tz text default 'America/Chicago'
)
returns table (user_id uuid, status text, seconds bigint)
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select (p_from_date::timestamp at time zone p_tz) as lo,
           least(((p_to_date + 1)::timestamp at time zone p_tz), now()) as hi
  )
  select i.user_id, i.status,
         sum(extract(epoch from (least(coalesce(i.ended_at, now()), win.hi) - greatest(i.started_at, win.lo))))::bigint
    from hub_status_intervals i, win
   where i.company_id = p_company_id
     and i.started_at < win.hi
     and coalesce(i.ended_at, now()) > win.lo
   group by i.user_id, i.status
$$;

revoke all on function public.hub_status_sample() from public, anon, authenticated;
revoke all on function public.hub_status_totals(uuid, date, date, text) from public, anon, authenticated;
grant execute on function public.hub_status_sample() to service_role;
grant execute on function public.hub_status_totals(uuid, date, date, text) to service_role;
