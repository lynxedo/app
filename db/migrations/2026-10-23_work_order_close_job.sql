-- Work Orders: the tech's answer to Jobber's "Complete final visit and…" question.
-- Asked only when Jobber says the visit is the last on its job (one-off, or the
-- last visit of a recurring job). 'close' = close the job, invoice later
-- (the office invoices); 'leave_open' = complete the visit only.
alter table public.daily_log_stops
  add column if not exists jobber_close_choice text
    check (jobber_close_choice in ('close', 'leave_open')),
  add column if not exists jobber_job_closed_at timestamptz;
