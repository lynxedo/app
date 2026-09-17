-- Offline clock punches (Sep 17, 2026)
--
-- A punch taken in a dead zone is held on the device and sent when signal
-- returns. The server used to stamp punched_at itself with now(), so a punch
-- that arrived two hours late was recorded two hours late — which is somebody's
-- pay. The API now accepts the time the button was actually tapped, and this
-- column marks the punches that came that way.
--
-- No backfill and no data change: every existing punch was taken online, which
-- is exactly what false means.

alter table time_punches
  add column if not exists queued_offline boolean not null default false;

comment on column time_punches.queued_offline is
  'True when this punch was taken on a device with no signal and sent later. punched_at is then the time the person actually tapped the button, and created_at is when it reached us — the gap between them is the dead-zone window, and it is why a punch can arrive out of order.';
