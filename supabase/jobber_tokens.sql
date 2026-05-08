-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Creates the jobber_tokens table with row-level security

create table if not exists jobber_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null unique,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- RLS: each user can only see/edit their own row
alter table jobber_tokens enable row level security;

create policy "select own tokens"
  on jobber_tokens for select
  using (auth.uid() = user_id);

create policy "insert own tokens"
  on jobber_tokens for insert
  with check (auth.uid() = user_id);

create policy "update own tokens"
  on jobber_tokens for update
  using (auth.uid() = user_id);
