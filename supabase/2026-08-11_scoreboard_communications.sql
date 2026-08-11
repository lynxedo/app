-- Communications report (REPORTS_PRD.md §8.10) — Dialer + Txt responsiveness.
-- APPLIED to the shared DB 2026-08-11.
--
-- Definitions that are decisions, not details:
--
-- MISSED keys off `answered_at`, never `status`. 955 inbound calls carry
-- status='completed' but only 605 have `answered_at`: "completed" means the call
-- ended, not that anyone picked up. Same trap as `invoice_status` on §8.3 — in
-- this data a status is a label and the timestamp is the fact.
--
-- ANSWERED counts the AI receptionist. She IS the receptionist; a call she
-- handled was not missed, and all 106 AI-handled calls have `answered_at` set.
--
-- MISSED IS RETURNED BROKEN DOWN, never as one number. Of 385 unanswered calls,
-- 132 left a voicemail (recoverable — you have the number and the message) and 56
-- hung up within five seconds (wrong number / abandoned; nobody could have
-- reached the phone). Publishing a bare 37.8% would present three different
-- situations as one failure.
--
-- NO CLAMPING, unlike scoreboard_crew_labor. Every ratio here divides calls by
-- calls or texts by texts, so a window predating the data stays internally
-- consistent — just emptier. The earliest call/text dates are returned instead so
-- a widget can say the history doesn't reach that far back.
--
-- ⚠ COACHING GRADES ARE DELIBERATELY ABSENT even though §8.10 lists them. Call
-- Coaching is gated to `can_access_coaching` (Ben only); surfacing per-rep grades
-- behind `can_access_reports` would widen that audience by a side door. If
-- coaching belongs on a Report, it needs its own grant first.
--
-- Authorization: guarded by scoreboard_reports_allowed() like every other widget
-- source — company_id is a parameter, so the function must verify the caller
-- belongs to that company (see 2026-08-11_scoreboard_crew_labor.sql).

create or replace function public.scoreboard_communications(
  p_company_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with allowed as (select public.scoreboard_reports_allowed(p_company_id) ok),
  inbound as (
    select c.id, c.created_at, c.answered_at, c.duration_seconds, c.handled_by_ai,
      (c.answered_at is not null and not c.handled_by_ai) as human_answered,
      c.handled_by_ai as ai_answered,
      (c.answered_at is null and not c.handled_by_ai) as missed,
      exists (select 1 from voicemails v where v.call_id = c.id) as left_voicemail
    from calls c
    where c.company_id = p_company_id
      and c.direction = 'inbound'
      and (c.created_at at time zone 'America/Chicago')::date between p_start and p_end
  ),
  outbound as (
    select c.id from calls c
    where c.company_id = p_company_id and c.direction = 'outbound'
      and (c.created_at at time zone 'America/Chicago')::date between p_start and p_end
  ),
  -- Speed to answer, human pickups only. Bounded to 10 minutes: a handful of rows
  -- carry a stale answered_at from a stuck leg, and one 4-hour outlier would move
  -- an average that is otherwise measured in seconds.
  answer_times as (
    select extract(epoch from (answered_at - created_at)) secs
    from inbound
    where human_answered and answered_at >= created_at
      and answered_at - created_at < interval '10 minutes'
  ),
  texts as (
    select m.direction, m.created_at, m.status, m.conversation_id
    from txt_messages m
    where m.company_id = p_company_id
      and (m.created_at at time zone 'America/Chicago')::date between p_start and p_end
  ),
  -- Reply time = an inbound text followed by an outbound one in the same thread.
  -- Capped at 24h so an answer three days later doesn't masquerade as responsiveness.
  reply_seq as (
    select direction, created_at,
      lead(created_at) over (partition by conversation_id order by created_at) nxt_at,
      lead(direction)  over (partition by conversation_id order by created_at) nxt_dir
    from texts
  ),
  replies as (
    select extract(epoch from (nxt_at - created_at)) secs
    from reply_seq
    where direction = 'inbound' and nxt_dir = 'outbound'
      and nxt_at - created_at between interval '0' and interval '24 hours'
  ),
  vm as (
    select v.id, v.heard_at, v.deleted_at
    from voicemails v
    where v.company_id = p_company_id
      and (v.created_at at time zone 'America/Chicago')::date between p_start and p_end
  )
  select case when not (select ok from allowed) then null else jsonb_build_object(
    'coverage', jsonb_build_object(
      'first_call', (select (min(created_at) at time zone 'America/Chicago')::date from calls where company_id = p_company_id),
      'first_text', (select (min(created_at) at time zone 'America/Chicago')::date from txt_messages where company_id = p_company_id),
      'requested_start', p_start,
      'requested_end', p_end
    ),
    'inbound_calls',   (select count(*) from inbound),
    'outbound_calls',  (select count(*) from outbound),
    'answered_human',  (select count(*) filter (where human_answered) from inbound),
    'answered_ai',     (select count(*) filter (where ai_answered) from inbound),
    'missed',          (select count(*) filter (where missed) from inbound),
    'missed_pct',      (select case when count(*) > 0
                          then round(100.0 * count(*) filter (where missed) / count(*), 1) end from inbound),
    'missed_with_voicemail', (select count(*) filter (where missed and left_voicemail) from inbound),
    'missed_no_message',     (select count(*) filter (where missed and not left_voicemail) from inbound),
    -- Under 5 seconds nobody could realistically have answered; counting these as
    -- service failures would overstate the problem.
    'missed_quick_hangup',   (select count(*) filter (where missed and coalesce(duration_seconds,0) <= 5) from inbound),
    'median_answer_sec', (select percentile_disc(0.5) within group (order by secs) from answer_times),
    'avg_answer_sec',    (select round(avg(secs)::numeric, 1) from answer_times),
    'answer_sample',     (select count(*) from answer_times),

    'texts_in',      (select count(*) filter (where direction='inbound') from texts),
    'texts_out',     (select count(*) filter (where direction='outbound') from texts),
    'texts_failed',  (select count(*) filter (where direction='outbound' and status in ('failed','undelivered')) from texts),
    'median_reply_sec', (select percentile_disc(0.5) within group (order by secs) from replies),
    'p90_reply_sec',    (select percentile_disc(0.9) within group (order by secs) from replies),
    'reply_sample',     (select count(*) from replies),

    'voicemails',        (select count(*) from vm),
    'voicemails_unheard',(select count(*) from vm where heard_at is null and deleted_at is null),

    'by_hour', coalesce((
      select jsonb_agg(h order by (h->>'hour')::int)
      from (
        select jsonb_build_object(
          'hour',    extract(hour from (created_at at time zone 'America/Chicago'))::int,
          'inbound', count(*),
          'missed',  count(*) filter (where missed)
        ) h
        from inbound
        group by extract(hour from (created_at at time zone 'America/Chicago'))::int
      ) x
    ), '[]'::jsonb),

    'by_weekday', coalesce((
      select jsonb_agg(d order by (d->>'dow')::int)
      from (
        select jsonb_build_object(
          'dow',     extract(dow from (created_at at time zone 'America/Chicago'))::int,
          'label',   trim(to_char((created_at at time zone 'America/Chicago'), 'Dy')),
          'inbound', count(*),
          'missed',  count(*) filter (where missed)
        ) d
        from inbound
        group by extract(dow from (created_at at time zone 'America/Chicago'))::int,
                 trim(to_char((created_at at time zone 'America/Chicago'), 'Dy'))
      ) y
    ), '[]'::jsonb)
  ) end;
$$;

comment on function public.scoreboard_communications(uuid, date, date) is
  'Communications report 8.10 - Dialer + Txt responsiveness. Missed keys off answered_at, NOT status (completed means ended, not answered). Amber-handled calls count as answered. Coaching grades deliberately excluded: they are gated to can_access_coaching.';

revoke all on function public.scoreboard_communications(uuid, date, date) from public, anon;
grant execute on function public.scoreboard_communications(uuid, date, date) to authenticated, service_role;

create index if not exists idx_calls_company_created_dir
  on calls (company_id, created_at, direction);

create index if not exists idx_txt_messages_company_created
  on txt_messages (company_id, created_at);
