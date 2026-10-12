-- Work Orders Phase 5 (Reference/PRDs/WORK_ORDERS_AND_QUOTES_PRD.md): reorder
-- stops at any time. A stop order set by hand — a tech on their own day, the
-- office on anyone's — survives the Jobber sync: hand-ranked stops keep their
-- order, a stop Jobber adds later slots in after them by time, removed stops
-- still sink to the bottom. NULL = ordered by scheduled time, as before. The
-- Route Optimizer's "Send to Daily Log" clears it (a re-sent route is a
-- deliberate new order). Applied via MCP 2026-10-12 (daily_log_stops_manual_rank_2026_10_12).
alter table public.daily_log_stops add column if not exists manual_rank integer;
