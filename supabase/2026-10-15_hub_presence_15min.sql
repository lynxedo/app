-- Smart presence: the 15-minute rule (Ben, Oct 15 2026).
--
-- Salaried / unlinked people were green for 2 hours after their last Hub page
-- load or chat send, so the dot stayed green long after they walked away. The
-- app now bumps last_active_at on any real interaction (POST /api/hub/active,
-- throttled to once a minute, plus every minute on a call), so the window can
-- drop to 15 minutes. Only the interval changes; columns and security_invoker
-- are as before. hub_status_sample() reads this view, so the Admin → Status
-- Time report follows automatically from the moment this runs.
--
-- ⚠ ORDER: staging and prod share this database. Apply ONLY after the
-- HubActivityPinger code is live on PROD — otherwise prod users with no pinger
-- go gray 15 minutes after their last page load.
-- ⚠ The window is also HUB_ACTIVE_WINDOW_MIN in lib/hub-idle.ts. Change both.

create or replace view public.hub_users_with_presence
with (security_invoker = on) as
 SELECT hu.id,
    hu.company_id,
    hu.display_name,
    hu.avatar_url,
    hu.is_bot,
    hu.status,
    hu.status_text,
    hu.status_emoji,
    hu.status_until,
    hu.last_active_at,
    hu.created_at,
    hu.claude_allowed,
    e.id AS employee_id,
    e.pay_type,
    e.is_active AS employee_is_active,
    is_employee_clocked_in(e.id) AS is_clocked_in,
        CASE
            WHEN hu.status = 'dnd'::text THEN 'dnd'::text
            WHEN hu.status = 'busy'::text THEN 'busy'::text
            WHEN hu.is_bot THEN 'available'::text
            WHEN lower(COALESCE(e.pay_type, ''::text)) = 'hourly'::text THEN
            CASE
                WHEN is_employee_clocked_in(e.id) THEN 'available'::text
                ELSE 'offline'::text
            END
            ELSE
            CASE
                WHEN hu.last_active_at >= (now() - '00:15:00'::interval) THEN 'available'::text
                ELSE 'offline'::text
            END
        END AS effective_status
   FROM hub_users hu
     LEFT JOIN employees e ON e.user_id = hu.id;
