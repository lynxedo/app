-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Creates the user_settings table with row-level security.
-- One row per Supabase user. Stores per-user defaults that drive route
-- optimization (depot, service time, drive speed) and basic profile.

create table if not exists user_settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  display_name            text,
  depot_address           text,
  depot_lat               numeric,
  depot_lng               numeric,
  default_service_minutes int  default 30,
  default_drive_mph       int  default 25,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- RLS: each user can only see/edit their own row
alter table user_settings enable row level security;

create policy "select own settings"
  on user_settings for select
  using (auth.uid() = user_id);

create policy "insert own settings"
  on user_settings for insert
  with check (auth.uid() = user_id);

create policy "update own settings"
  on user_settings for update
  using (auth.uid() = user_id);

create policy "delete own settings"
  on user_settings for delete
  using (auth.uid() = user_id);

-- Bump updated_at on every update
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_set_updated_at on user_settings;
create trigger user_settings_set_updated_at
  before update on user_settings
  for each row execute function set_updated_at();
