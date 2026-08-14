// Bulk data action: query_data — read-only SQL over the Jobber mirror + Hub ops.
//
// WHY THIS EXISTS
// Every other read action here answers about ONE record (find_contact,
// get_customer_overview) or one narrow slice (get_schedule). Nothing answered
// "all the customers on service line X, with their addresses" — so the model
// fell back to paging an external API one call per turn and ran out of tool
// iterations before it finished. The data was already in our own Postgres.
//
// SAFETY LIVES IN THE DATABASE, NOT HERE.
// The SQL runs through public.amber_query -> amber.run_query, a SECURITY DEFINER
// function OWNED BY the `amber_reader` role, which holds SELECT on a hand-picked
// set of company-scoped views and nothing else. It cannot see wages, payroll,
// coaching grades, or any credential table; it cannot write, because the role has
// no write grant anywhere and the statement runs in a read-only transaction.
// See supabase/2026-08-14_amber_query_data.sql for the full model.
//
// ⚠ The company scope is passed from ctx.actor.companyId — the resolved actor —
// and NEVER from a model argument. There is no company parameter on this action
// on purpose: if the model could name the company, a prompt injected into tenant
// data could name someone else's.

import type { HubAction } from './types'
import { str } from './types'

/**
 * Reading the mirror means reading revenue, invoices and whole customer lists —
 * the same material the Reports module gates behind `can_access_reports`. Gating
 * this any looser would make the assistant a side door around that grant, which
 * is the exact hole the August RPC lockdown closed. Admins bypass, as everywhere.
 */
const DATA_GATE = { anyFlag: ['can_access_reports'] }

/** Kept in the description so the model never has to guess a table or column. */
const SCHEMA_HELP = `
Tables (all already filtered to this company and to non-deleted rows):
  clients(id, name, first_name, last_name, company_name, email, phone, balance,
          is_lead, is_archived, lead_source, customer_since, sales_person, tags?)
  properties(id, client_id, address_line1, address_line2, city, state, zip,
             gate_code, neighborhood, lawn_size_sqft, irrigation_zones, latitude, longitude)
  jobs(id, client_id, property_id, title, job_number, job_status, is_live,
       is_recurring, dept_prefix, total, start_at, end_at, completed_at, route_code)
  visits(id, job_id, client_id, title, scheduled_date, completed_at, is_completed,
         visit_status, total, tech_external_user_ids)
  line_items(id, parent_type, parent_id, name, dept_prefix, quantity, unit_price, total,
             is_recurring_program)
  invoices(id, client_id, job_id, invoice_number, total, outstanding_balance,
           invoice_status, issued_date, due_date, paid_at, payments_total)
  quotes(id, client_id, quote_number, title, quote_status, sent_at, approved_at, converted_at)
  contacts(id, name, phone, email, city, state, do_not_text, do_not_call, in_directory)
  leads(id, first_name, last_name, phone, email, service, lead_source, status, stage,
        lead_creation_date, sold_date, salesperson, annual_value, service_address)
  recurring_services(id, name, email, phone, service, status, cancelled_status,
                     cancellation_reason, cancel_date, annual_value, sold_date)
  calls(id, direction, from_number, to_number, status, duration_seconds, transcript,
        ai_summary, sentiment, handled_by_ai, disposition, created_at, answered_at)

Three things that WILL give wrong answers if you get them wrong:
  1. Live jobs: use "is_live" (already computed). Do NOT filter job_status='active'
     — that status covers only a handful of jobs; most live work reads 'upcoming'.
  2. Service line: line_items.dept_prefix is the department code — 'WF' weed & feed
     / fertilization, 'IR' irrigation, 'PW' pet waste, 'MO' mosquito. jobs.dept_prefix
     also exists. Prefer line_items when the question is "who buys service X".
  3. line_items.parent_type is 'job', 'invoice' or 'quote'. ALWAYS filter it, or you
     will count the same money two or three times.

Service address = properties joined on client_id. A customer can have several
properties, so count DISTINCT clients when you mean customers, and remember that
rows-per-property is not customers-per-service.`.trim()

export const queryDataAction: HubAction = {
  name: 'query_data',
  description:
    'Run one read-only SQL SELECT over this company\'s own operational database — the full Jobber ' +
    'mirror (customers, properties, jobs, visits, line items, invoices, quotes) plus leads, contacts ' +
    'and calls. USE THIS whenever a question covers MANY records rather than one: "all the customers ' +
    'on a service line", "every address in a city", "how many X", totals, rankings, cross-references, ' +
    'or anything you would otherwise answer by calling a lookup tool over and over. It is far faster ' +
    'and more complete than paging the Jobber API, and it is the right tool for any list or count.\n\n' +
    'Postgres syntax. One statement, SELECT or WITH only. Write plain table names (they resolve to ' +
    'this company automatically — do not add a company_id filter and do not schema-qualify). If a ' +
    'query errors you get the real Postgres message back, so read it and fix the SQL. If you need ' +
    'live, up-to-the-second Jobber state for ONE record, use the jobber_* tools instead; this mirror ' +
    'syncs continuously but is not the live API.\n\n' + SCHEMA_HELP,
  input_schema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description:
          'One Postgres SELECT (or WITH ... SELECT). Plain table names, no company_id filter, no semicolon.',
      },
      limit: {
        type: 'number',
        description: 'Max rows to return (default 500, max 2000). Use a smaller number when counting.',
      },
    },
    required: ['sql'],
  },
  kind: 'read',
  group: 'hub',
  gate: DATA_GATE,
  consentLabel: 'run read-only queries over your business data',
  run: async (ctx, args) => {
    const sql = str(args, 'sql').trim()
    if (!sql) return 'Provide a SQL SELECT in the "sql" argument.'

    const limit = Math.max(1, Math.min(2000, Math.round(Number(args.limit) || 500)))

    const { data, error } = await ctx.admin.rpc('amber_query', {
      p_company: ctx.actor.companyId,
      p_sql: sql,
      p_max_rows: limit,
    })

    if (error) {
      console.warn('[query_data] rpc failed', error.message)
      return `The query could not be run (${error.message}). Nothing was changed. Tell the user it failed rather than guessing at numbers.`
    }

    const result = (data ?? {}) as {
      error?: string
      rows?: unknown[]
      row_count?: number
      truncated?: boolean
    }

    // The function reports SQL problems as { error } so the model can self-correct
    // instead of treating a typo as "no data".
    if (result.error) {
      return `That query didn't run: ${result.error}\n\nFix the SQL and try again. Do not report this as "no results" — nothing was measured.`
    }

    const rows = Array.isArray(result.rows) ? result.rows : []
    if (rows.length === 0) {
      return 'The query ran and matched 0 rows. That is a real answer, not an error — but double-check your filters (especially is_live and parent_type) before telling the user there is nothing.'
    }

    // Keep a very wide result from swallowing the context window. The row cap is
    // enforced in the database; this is a character-level backstop.
    let body = JSON.stringify(rows)
    let charTrimmed = false
    if (body.length > 24_000) {
      const keep: unknown[] = []
      let used = 0
      for (const r of rows) {
        const s = JSON.stringify(r)
        if (used + s.length > 24_000) break
        keep.push(r)
        used += s.length
      }
      body = JSON.stringify(keep)
      charTrimmed = true
    }

    const notes: string[] = [`${rows.length} row(s).`]
    if (result.truncated) {
      notes.push(
        `Hit the ${limit}-row cap, so this is NOT the complete set — say so, or re-run with a narrower query or an aggregate.`,
      )
    }
    if (charTrimmed) {
      notes.push('Some rows were dropped to fit — select fewer columns for the full set.')
    }

    return `${notes.join(' ')}\n${body}`
  },
}
