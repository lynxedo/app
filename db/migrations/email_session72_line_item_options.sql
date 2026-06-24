-- Email Session 7.2 (Line-item segments) — options source for the segment builder.
-- Applied to the shared Supabase DB via MCP (migration `email_session72_line_item_options`).
-- Recorded here for repo traceability. Additive, read-only function only.
--
-- Returns the distinct JOB line items (parent_type='job' — Ben's call, so the
-- same service listed under a job + visit + invoice is never triple-counted) for
-- a company, in two flavors:
--   kind='dept'  value=dept_prefix (WF/IR/PW/MO/LD)   uses=row count
--   kind='name'  value=line item name                 uses=row count
-- Mirrors service_mapping_line_item_names: SECURITY INVOKER (respects line_items
-- RLS), the email line-items route is the only caller; revoke public/anon, grant
-- authenticated (the admin/service-role client used by the route can execute).

create or replace function public.email_job_line_item_options(p_company_id uuid)
returns table(kind text, value text, uses bigint)
language sql
stable
as $function$
  select 'dept'::text as kind, dept_prefix as value, count(*) as uses
  from public.line_items
  where company_id = p_company_id and parent_type = 'job' and deleted_at is null
    and dept_prefix is not null and dept_prefix <> ''
  group by dept_prefix
  union all
  select 'name'::text as kind, name as value, count(*) as uses
  from public.line_items
  where company_id = p_company_id and parent_type = 'job' and deleted_at is null
    and name is not null and name <> ''
  group by name
  order by kind asc, uses desc, value asc
$function$;

revoke all on function public.email_job_line_item_options(uuid) from public, anon;
grant execute on function public.email_job_line_item_options(uuid) to authenticated;
