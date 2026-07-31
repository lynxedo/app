-- Dialer: allow an inbound call to ring a RING GROUP directly (no IVR required).
--
-- Until now the only direct inbound destination was a single user
-- (dialer_settings.inbound_route_user_id). Ring groups existed but could only be
-- reached through an IVR menu action. This adds a nullable ring-group target so
-- an admin can point the inbound number straight at a group.
--
-- Additive + safe: existing rows get NULL, so single-user routing is unchanged.
-- The webhook prefers the ring group when set; the admin UI keeps the two
-- mutually exclusive (picking a group nulls the user, and vice versa).
-- ON DELETE SET NULL so deleting a ring group can never strand the inbound route.

ALTER TABLE public.dialer_settings
  ADD COLUMN IF NOT EXISTS inbound_route_ring_group_id uuid
  REFERENCES public.dialer_ring_groups(id) ON DELETE SET NULL;
