-- Ben, Oct 15 2026: nothing from Gary reaches a real customer until the build is
-- done. Off = Approve & send is refused; Send me a test still works.
-- Additive; applied to the shared DB the same day.
alter table public.gary_settings
  add column if not exists customer_sending boolean not null default false;
