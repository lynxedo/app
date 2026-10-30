-- Servanto Starter Session 1 — which Jobber developer app a company connected through.
--
-- Heroes connected through the original "Lynxedo" Jobber app (client 39cd5aad…)
-- and stays there. Every other company connects through the "Servanto" app,
-- whose narrower scopes are what the Jobber Marketplace listing is built on.
-- A token is only valid with the client id/secret that issued it, so the token
-- refresh and the webhook signature check both have to know which app this is.
--
-- Additive: the one existing row (Heroes) takes the default, 'lynxedo'.
alter table public.jobber_tokens
  add column if not exists jobber_app text not null default 'lynxedo';

alter table public.jobber_tokens
  drop constraint if exists jobber_tokens_jobber_app_check;
alter table public.jobber_tokens
  add constraint jobber_tokens_jobber_app_check check (jobber_app in ('lynxedo', 'servanto'));
