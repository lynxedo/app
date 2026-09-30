// Lead Tracker at scale: review_leads, update_leads.
//
// list_leads/upsert_lead work one lead at a time, which made the most common
// office request impossible: "go through the open leads, check who we've texted
// and called, and update the Tracker". Checking 30 leads meant ~90 separate
// lookups against a 16-round ceiling, so the assistant ran out halfway.
//
// review_leads answers the whole question in ONE call — every lead with its
// contact attempts, last text each way, last call, last voicemail and last note,
// plus a plain "who's waiting on whom" signal. update_leads applies a whole batch
// of changes in ONE call, and when it touches more than one lead it is previewed
// and waits for a human "yes" (HubAction.confirmWhen) before anything moves.
//
// ⚠ update_leads follows the same rules as the Tracker screen, not a looser set:
//   • a status carries its stage with it (tracker_settings.status_stage_rules),
//     exactly like picking the status from the dropdown;
//   • a stage change stamps stage_changed_at AND runs the Drip hooks the Tracker
//     PATCH route runs — enroll on a stage-triggered campaign, exit on won/lost.
//     Skipping them would leave a lead marked Lost still receiving nurture texts;
//   • contact attempts are numbered 1–5, the same cap the screen enforces.
// Sales are deliberately NOT recordable here: a sale needs service codes and an
// annual value that upsert_lead validates one lead at a time.

import type { ActionContext, HubAction } from './types'
import { actorPassesGate, str, UUID_RE } from './types'
import { clip, lines, opsYmd, phone, stampLabel } from './format'
import { OPEN_STAGES, phoneDigits, runStageAutomations } from './actions-tracker'
import { CALL_VIEW_GATE, TXT_VIEW_GATE } from './actions-contacts'

const TRACKER_GATE = { anyFlag: ['can_access_tracker'] }

/** Hard ceiling on one batch — large enough for "all open leads", small enough to read in a preview. */
const MAX_BATCH = 60
/** The Tracker screen offers attempts 1–5 and the attempts API rejects anything else. */
const MAX_ATTEMPTS = 5
const CONTACT_TYPES = ['call', 'text', 'email'] as const
type ContactType = (typeof CONTACT_TYPES)[number]

// ── Shared company configuration ────────────────────────────────────────────

type StageRow = { key: string; label: string; system_role: string | null; counts_as_sale: boolean | null }
type ColumnDef = { id: string; name: string; type: string; options: unknown }
type TrackerConfig = {
  stages: StageRow[]
  statusOptions: string[]
  statusRules: Array<{ status: string; stage: string }>
  leadSourceOptions: string[]
  salespersonOptions: string[]
  columns: ColumnDef[]
}

async function loadTrackerConfig(ctx: ActionContext): Promise<TrackerConfig> {
  const [stagesRes, settingsRes, colsRes] = await Promise.all([
    ctx.admin
      .from('tracker_stages')
      .select('key, label, system_role, counts_as_sale, sort_order')
      .eq('company_id', ctx.actor.companyId)
      .order('sort_order', { ascending: true }),
    ctx.admin
      .from('tracker_settings')
      .select('status_options, status_stage_rules, lead_source_options, salesperson_options')
      .eq('company_id', ctx.actor.companyId)
      .maybeSingle(),
    ctx.admin
      .from('tracker_column_definitions')
      .select('id, name, type, options')
      .eq('company_id', ctx.actor.companyId)
      .order('sort_order', { ascending: true }),
  ])
  const s = (settingsRes.data || {}) as {
    status_options?: string[] | null
    status_stage_rules?: unknown
    lead_source_options?: string[] | null
    salesperson_options?: string[] | null
  }
  const rules = Array.isArray(s.status_stage_rules)
    ? (s.status_stage_rules as Array<{ status?: unknown; stage?: unknown }>)
        .filter((r) => typeof r?.status === 'string' && typeof r?.stage === 'string')
        .map((r) => ({ status: r.status as string, stage: r.stage as string }))
    : []
  return {
    stages: (stagesRes.data || []) as StageRow[],
    statusOptions: Array.isArray(s.status_options) ? s.status_options : [],
    statusRules: rules,
    leadSourceOptions: Array.isArray(s.lead_source_options) ? s.lead_source_options : [],
    salespersonOptions: Array.isArray(s.salesperson_options) ? s.salesperson_options : [],
    columns: (colsRes.data || []) as ColumnDef[],
  }
}

/** Match a model-supplied value against a pick-list, case/space-insensitively. */
function pick(options: string[], raw: string): string | null {
  const norm = (v: string) => v.toLowerCase().replace(/[\s—–-]+/g, ' ').trim()
  const want = norm(raw)
  return options.find((o) => norm(o) === want) ?? null
}

function stageFor(config: TrackerConfig, raw: string): StageRow | null {
  const want = raw.toLowerCase().trim()
  return (
    config.stages.find((s) => s.key.toLowerCase() === want) ??
    config.stages.find((s) => pick([s.label], raw) !== null) ??
    null
  )
}

/** A stage that means "sold" — those go through upsert_lead, which validates the sale. */
function isSaleStage(s: StageRow): boolean {
  return s.system_role === 'won' || s.counts_as_sale === true || s.key === 'closed_won'
}

function dropdownOptions(def: ColumnDef): string[] {
  const raw = Array.isArray(def.options)
    ? def.options
    : def.options && typeof def.options === 'object' && Array.isArray((def.options as { options?: unknown }).options)
      ? ((def.options as { options: unknown[] }).options)
      : []
  return raw
    .map((o) => (typeof o === 'string' ? o : o && typeof o === 'object' ? String((o as { label?: unknown; value?: unknown }).label ?? (o as { value?: unknown }).value ?? '') : ''))
    .filter(Boolean)
}

// ── review_leads ────────────────────────────────────────────────────────────

type ReviewLead = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  stage: string | null
  status: string | null
  lead_source: string | null
  salesperson: string | null
  created_at: string
  stage_changed_at: string | null
}

type Touch = { at: string; line: string }

/** Run async work over items with bounded concurrency — 60 leads must not open 240 sockets at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null
}

function later(a: Touch | null, b: Touch | null): Touch | null {
  if (!a) return b
  if (!b) return a
  return a.at >= b.at ? a : b
}

export const reviewLeadsAction: HubAction = {
  name: 'review_leads',
  description:
    'Review many Lead Tracker leads at once, each cross-referenced with its texts, calls, voicemails, ' +
    'logged contact attempts and latest note — in ONE call. Use this whenever a request spans several ' +
    'leads: "go through the open leads", "who haven\'t we contacted?", "which leads are waiting on us?", ' +
    '"clean up the Tracker". Each lead comes back with its lead_id and a signal: NO CONTACT YET, ' +
    'WAITING ON US (they replied last), GONE QUIET (we reached out, no reply for a while) or TALKING. ' +
    'Defaults to every OPEN lead (current, appointment set, follow-up) from the last 90 days. ' +
    'Do NOT call read_text_conversation or get_customer_overview lead-by-lead for this — that burns the ' +
    'whole turn. Use those only to dig into one specific lead afterwards. To change leads, pass the ' +
    'lead_ids to update_leads.',
  input_schema: {
    type: 'object',
    properties: {
      stages: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Stage keys or names to include, e.g. ["current"] or ["appointment_set"]. Omit for all open stages. ' +
          'Pass ["all"] for every stage.',
      },
      source: { type: 'string', description: 'Only leads from this lead source (partial match). Omit for all.' },
      days: { type: 'number', description: 'Only leads created in the last N days (default 90, max 365).' },
      only: {
        type: 'string',
        enum: ['all', 'no_contact', 'waiting_on_us', 'gone_quiet'],
        description: 'Narrow to one signal. Default all.',
      },
      quiet_days: {
        type: 'number',
        description: 'How many days without a reply counts as GONE QUIET (default 7).',
      },
      limit: { type: 'number', description: 'Max leads (default 30, max 60). Oldest-first within the window.' },
    },
    required: [],
  },
  kind: 'read',
  gate: TRACKER_GATE,
  consentLabel: 'review your sales leads against texts and calls',
  run: async (ctx, args) => {
    const config = await loadTrackerConfig(ctx)
    const days = Math.max(1, Math.min(365, Math.round(Number(args.days) || 90)))
    const limit = Math.max(1, Math.min(MAX_BATCH, Math.round(Number(args.limit) || 30)))
    const quietDays = Math.max(1, Math.min(90, Math.round(Number(args.quiet_days) || 7)))
    const onlyRaw = str(args, 'only')
    const only = ['no_contact', 'waiting_on_us', 'gone_quiet'].includes(onlyRaw) ? onlyRaw : 'all'
    const source = str(args, 'source')

    // Resolve the stage filter against THIS company's stages (they are editable).
    const stageArgs = Array.isArray(args.stages)
      ? (args.stages as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : typeof args.stages === 'string' && args.stages.trim()
        ? [args.stages]
        : []
    let stageKeys: string[] | null
    if (stageArgs.some((s) => s.toLowerCase() === 'all')) {
      stageKeys = null
    } else if (stageArgs.length) {
      const resolved = stageArgs.map((s) => ({ raw: s, row: stageFor(config, s) }))
      const unknown = resolved.filter((r) => !r.row).map((r) => r.raw)
      if (unknown.length) {
        return (
          `"${unknown.join('", "')}" ${unknown.length === 1 ? "isn't a stage" : "aren't stages"} on this Tracker. ` +
          `Stages: ${config.stages.map((s) => `${s.key} (${s.label})`).join(', ')}.`
        )
      }
      stageKeys = resolved.map((r) => (r.row as StageRow).key)
    } else {
      stageKeys = [...OPEN_STAGES]
    }

    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    let q = ctx.admin
      .from('leads')
      .select('id, first_name, last_name, phone, stage, status, lead_source, salesperson, created_at, stage_changed_at')
      .eq('company_id', ctx.actor.companyId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      // Fetch past the limit when narrowing by signal — the filter runs after the cross-reference.
      .limit(only === 'all' ? limit : MAX_BATCH * 3)
    if (stageKeys) q = q.in('stage', stageKeys)
    if (source) q = q.ilike('lead_source', `%${source.replace(/[%_]/g, '')}%`)
    const { data, error } = await q
    if (error) return `Couldn't read the Tracker just now (${error.message}). Nothing was changed.`
    const leads = (data || []) as ReviewLead[]
    if (leads.length === 0) {
      return `No leads in ${stageKeys ? `stage ${stageKeys.join(' / ')}` : 'any stage'} from the last ${days} days${source ? ` with source "${source}"` : ''}.`
    }

    const ids = leads.map((l) => l.id)
    const canTexts = actorPassesGate(ctx.actor, TXT_VIEW_GATE)
    const canCalls = actorPassesGate(ctx.actor, CALL_VIEW_GATE)

    // Batched: attempts + notes for every lead in two queries.
    const [attemptsRes, notesRes] = await Promise.all([
      ctx.admin
        .from('lead_attempts')
        .select('lead_id, attempt_number, attempted_date, contact_types, notes')
        .eq('company_id', ctx.actor.companyId)
        .in('lead_id', ids),
      ctx.admin
        .from('lead_notes')
        .select('lead_id, note, created_by, created_at')
        .eq('company_id', ctx.actor.companyId)
        .in('lead_id', ids)
        .order('created_at', { ascending: false })
        .limit(900),
    ])
    const attemptsBy = new Map<string, Array<{ attempt_number: number; attempted_date: string | null; contact_types: Record<string, boolean> | null }>>()
    for (const a of (attemptsRes.data || []) as Array<{ lead_id: string; attempt_number: number; attempted_date: string | null; contact_types: Record<string, boolean> | null }>) {
      const list = attemptsBy.get(a.lead_id) ?? []
      list.push(a)
      attemptsBy.set(a.lead_id, list)
    }
    const noteBy = new Map<string, { note: string; created_by: string | null; created_at: string }>()
    for (const n of (notesRes.data || []) as Array<{ lead_id: string; note: string; created_by: string | null; created_at: string }>) {
      if (!noteBy.has(n.lead_id)) noteBy.set(n.lead_id, n)
    }

    // Leads → directory contacts, by the phone digits both sides agree on.
    const digitsBy = new Map<string, string>()
    for (const l of leads) {
      const d = phoneDigits(l.phone || '')
      if (d.length === 10) digitsBy.set(l.id, d)
    }
    const allDigits = [...new Set(digitsBy.values())]
    const contactByDigits = new Map<string, string>()
    if (allDigits.length && (canTexts || canCalls)) {
      const { data: contacts } = await ctx.admin
        .from('txt_contacts')
        .select('id, phone_digits')
        .eq('company_id', ctx.actor.companyId)
        .is('deleted_at', null)
        .in('phone_digits', [...allDigits, ...allDigits.map((d) => `1${d}`)])
      for (const c of (contacts || []) as Array<{ id: string; phone_digits: string | null }>) {
        const d = phoneDigits(c.phone_digits || '')
        if (d && !contactByDigits.has(d)) contactByDigits.set(d, c.id)
      }
    }

    type Activity = {
      lastUsText: Touch | null
      lastThemText: Touch | null
      lastUsCall: Touch | null
      lastThemCall: Touch | null
      lastVm: Touch | null
    }

    const activity = await mapLimit(leads, 8, async (l): Promise<Activity> => {
      const act: Activity = { lastUsText: null, lastThemText: null, lastUsCall: null, lastThemCall: null, lastVm: null }
      const d = digitsBy.get(l.id)
      if (!d) return act
      const contactId = contactByDigits.get(d) ?? null
      const e164 = `+1${d}`
      const jobs: Promise<void>[] = []

      if (canTexts && contactId) {
        jobs.push(
          (async () => {
            const { data: msgs } = await ctx.admin
              .from('txt_messages')
              .select('direction, body, created_at')
              .eq('company_id', ctx.actor.companyId)
              .eq('contact_id', contactId)
              .order('created_at', { ascending: false })
              .limit(12)
            for (const m of (msgs || []) as Array<{ direction: string; body: string | null; created_at: string }>) {
              const t = { at: m.created_at, line: `${stampLabel(m.created_at)} "${clip((m.body || '(media)').replace(/\s+/g, ' '), 90)}"` }
              if (m.direction === 'inbound') act.lastThemText ??= t
              else act.lastUsText ??= t
              if (act.lastThemText && act.lastUsText) break
            }
          })(),
        )
      }

      if (canCalls) {
        jobs.push(
          (async () => {
            const ors = [`from_number.eq.${e164}`, `to_number.eq.${e164}`]
            if (contactId) ors.push(`contact_id.eq.${contactId}`)
            const { data: calls } = await ctx.admin
              .from('calls')
              .select('direction, status, duration_seconds, created_at')
              .eq('company_id', ctx.actor.companyId)
              .or(ors.join(','))
              .order('created_at', { ascending: false })
              .limit(8)
            for (const c of (calls || []) as Array<{ direction: string; status: string | null; duration_seconds: number | null; created_at: string }>) {
              const t = {
                at: c.created_at,
                line: `${stampLabel(c.created_at)} ${c.status || 'unknown'}${c.duration_seconds ? ` ${c.duration_seconds}s` : ''}`,
              }
              if (c.direction === 'inbound') act.lastThemCall ??= t
              else act.lastUsCall ??= t
              if (act.lastThemCall && act.lastUsCall) break
            }
          })(),
          (async () => {
            const { data: vms } = await ctx.admin
              .from('voicemails')
              .select('summary, transcript, follow_up_status, created_at')
              .eq('company_id', ctx.actor.companyId)
              .is('deleted_at', null)
              .eq('from_number', e164)
              .order('created_at', { ascending: false })
              .limit(1)
            const v = ((vms || []) as Array<{ summary: string | null; transcript: string | null; follow_up_status: string | null; created_at: string }>)[0]
            if (v) {
              act.lastVm = {
                at: v.created_at,
                line: `${stampLabel(v.created_at)}${v.follow_up_status === 'resolved' ? ' (resolved)' : ''} "${clip((v.summary || v.transcript || '').replace(/\s+/g, ' '), 90)}"`,
              }
            }
          })(),
        )
      }
      await Promise.all(jobs)
      return act
    })

    type Row = { lead: ReviewLead; signal: 'no_contact' | 'waiting_on_us' | 'gone_quiet' | 'talking'; text: string }
    const rows: Row[] = leads.map((l, i) => {
      const act = activity[i]
      const attempts = (attemptsBy.get(l.id) ?? []).sort((a, b) => a.attempt_number - b.attempt_number)
      const lastAttempt = attempts[attempts.length - 1]
      const attemptTouch: Touch | null = lastAttempt?.attempted_date
        ? { at: `${lastAttempt.attempted_date}T12:00:00Z`, line: lastAttempt.attempted_date }
        : null

      const lastUs = later(later(act.lastUsText, act.lastUsCall), attemptTouch)
      const lastThem = later(later(act.lastThemText, act.lastThemCall), act.lastVm)

      let signal: Row['signal']
      if (!lastUs && attempts.length === 0) signal = lastThem ? 'waiting_on_us' : 'no_contact'
      else if (lastThem && (!lastUs || lastThem.at > lastUs.at)) signal = 'waiting_on_us'
      else if ((daysAgo(lastUs?.at) ?? 0) >= quietDays) signal = 'gone_quiet'
      else signal = 'talking'

      const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'Unnamed lead'
      const stageLabel = config.stages.find((s) => s.key === l.stage)?.label || l.stage || 'no stage'
      const inStage = daysAgo(l.stage_changed_at)
      const signalText =
        signal === 'no_contact'
          ? 'NO CONTACT YET'
          : signal === 'waiting_on_us'
            ? `WAITING ON US — they reached out ${stampLabel(lastThem?.at)}`
            : signal === 'gone_quiet'
              ? `GONE QUIET — no reply in ${daysAgo(lastUs?.at)} days`
              : 'TALKING'

      const attemptText = attempts.length
        ? `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}` +
          (lastAttempt
            ? ` (last ${lastAttempt.attempted_date || 'undated'}${
                lastAttempt.contact_types
                  ? ` ${CONTACT_TYPES.filter((k) => lastAttempt.contact_types?.[k]).join('+')}`
                  : ''
              })`
            : '')
        : 'no attempts logged'

      const note = noteBy.get(l.id)
      const text = lines(
        `• ${name} · ${phone(l.phone)} · ${stageLabel}${l.status ? ` / ${l.status}` : ''}` +
          `${l.lead_source ? ` · ${l.lead_source}` : ''}` +
          ` · created ${daysAgo(l.created_at)}d ago${inStage !== null ? `, ${inStage}d in stage` : ''}` +
          ` · lead_id ${l.id}`,
        `  → ${signalText} · ${attemptText}`,
        canTexts
          ? `  Texts: ${act.lastThemText ? `them ${act.lastThemText.line}` : 'nothing from them'}; ${act.lastUsText ? `us ${act.lastUsText.line}` : 'nothing from us'}`
          : null,
        canCalls
          ? `  Calls: ${act.lastUsCall ? `we called ${act.lastUsCall.line}` : 'no outbound call'}; ${act.lastThemCall ? `they called ${act.lastThemCall.line}` : 'no inbound call'}` +
            `${act.lastVm ? ` · voicemail ${act.lastVm.line}` : ''}`
          : null,
        note ? `  Last note (${note.created_by || 'someone'}, ${stampLabel(note.created_at)}): ${clip(note.note.replace(/\s+/g, ' '), 140)}` : null,
        !digitsBy.has(l.id) ? '  ⚠ No usable phone on this lead, so texts and calls could not be matched.' : null,
      )
      return { lead: l, signal, text }
    })

    const filtered = (only === 'all' ? rows : rows.filter((r) => r.signal === only)).slice(0, limit)
    const count = (s: Row['signal']) => rows.filter((r) => r.signal === s).length
    const hidden = [!canTexts ? 'texts' : null, !canCalls ? 'calls' : null].filter(Boolean)

    return lines(
      `${rows.length} lead${rows.length === 1 ? '' : 's'} reviewed (${stageKeys ? stageKeys.join(' / ') : 'all stages'}, last ${days} days): ` +
        `${count('no_contact')} no contact yet, ${count('waiting_on_us')} waiting on us, ` +
        `${count('gone_quiet')} gone quiet (${quietDays}+ days), ${count('talking')} talking.`,
      only !== 'all' ? `Showing the ${filtered.length} "${only.replace(/_/g, ' ')}" lead${filtered.length === 1 ? '' : 's'}.` : null,
      hidden.length ? `(You don't have access to ${hidden.join(' or ')}, so ${hidden.length === 1 ? 'it is' : 'they are'} left out.)` : null,
      leads.length >= (only === 'all' ? limit : MAX_BATCH * 3)
        ? `There may be more leads than this — narrow by stage, source or days, or raise the limit (max ${MAX_BATCH}).`
        : null,
      ...filtered.map((r) => r.text),
      '',
      'To change any of these, call update_leads ONCE with every change in a single list.',
    )
  },
}

// ── update_leads ────────────────────────────────────────────────────────────

type UpdateInput = {
  lead_id: string
  stage?: string
  status?: string
  note?: string
  salesperson?: string
  lead_source?: string
  log_attempt?: { via?: unknown; date?: unknown; notes?: unknown }
  columns?: Record<string, unknown>
}

type PlannedChange = {
  leadId: string
  label: string
  patch: Record<string, unknown>
  newStage: string | null
  describe: string[]
  note: string | null
  attempt: { number: number; date: string; types: Record<ContactType, boolean>; notes: string | null } | null
  columns: Array<{ columnId: string; name: string; value: string | null }>
}

type Plan = { ok: true; changes: PlannedChange[] } | { ok: false; message: string }

function updatesArg(args: Record<string, unknown>): UpdateInput[] {
  const raw = args.updates
  return Array.isArray(raw) ? (raw.filter((u) => u && typeof u === 'object') as UpdateInput[]) : []
}

/**
 * Validate the whole batch against the live Tracker and turn it into concrete
 * changes. Runs twice — at preview and again at confirm — so a lead that moved,
 * a status that was renamed, or a sixth attempt that snuck in between is caught
 * against the data as it is when the change actually happens.
 *
 * All-or-nothing: one bad row refuses the batch. A half-applied bulk edit is the
 * worst outcome — nobody can tell which half landed.
 */
async function planLeadUpdates(ctx: ActionContext, args: Record<string, unknown>): Promise<Plan> {
  const updates = updatesArg(args)
  if (updates.length === 0) {
    return { ok: false, message: 'Pass `updates` — a list of { lead_id, …changes }. Get lead_ids from review_leads or list_leads.' }
  }
  if (updates.length > MAX_BATCH) {
    return { ok: false, message: `That's ${updates.length} leads; one batch takes at most ${MAX_BATCH}. Split it and do the first ${MAX_BATCH}.` }
  }
  const badIds = updates.filter((u) => typeof u.lead_id !== 'string' || !UUID_RE.test(u.lead_id))
  if (badIds.length) {
    return { ok: false, message: `${badIds.length} update${badIds.length === 1 ? ' has' : 's have'} no valid lead_id. Use the lead_id values from review_leads. Nothing was changed.` }
  }
  const ids = [...new Set(updates.map((u) => u.lead_id))]
  if (ids.length !== updates.length) {
    return { ok: false, message: 'The same lead appears more than once. Combine its changes into one entry. Nothing was changed.' }
  }

  const config = await loadTrackerConfig(ctx)
  const [leadsRes, attemptsRes] = await Promise.all([
    ctx.admin
      .from('leads')
      .select('id, first_name, last_name, phone, stage, status, salesperson, lead_source')
      .eq('company_id', ctx.actor.companyId)
      .in('id', ids),
    ctx.admin.from('lead_attempts').select('lead_id, attempt_number').eq('company_id', ctx.actor.companyId).in('lead_id', ids),
  ])
  const leadById = new Map(
    ((leadsRes.data || []) as Array<{ id: string; first_name: string | null; last_name: string | null; phone: string | null; stage: string | null; status: string | null; salesperson: string | null; lead_source: string | null }>).map((l) => [l.id, l]),
  )
  const maxAttempt = new Map<string, number>()
  for (const a of (attemptsRes.data || []) as Array<{ lead_id: string; attempt_number: number }>) {
    maxAttempt.set(a.lead_id, Math.max(maxAttempt.get(a.lead_id) ?? 0, a.attempt_number))
  }

  const problems: string[] = []
  const changes: PlannedChange[] = []
  const stageLabel = (key: string | null) => config.stages.find((s) => s.key === key)?.label || key || 'none'

  for (const u of updates) {
    const lead = leadById.get(u.lead_id)
    if (!lead) {
      problems.push(`lead_id ${u.lead_id} isn't on this company's Tracker.`)
      continue
    }
    const label = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || phone(lead.phone)
    const patch: Record<string, unknown> = {}
    const describe: string[] = []
    let newStage: string | null = null

    // Status first — on the Tracker a status carries its stage with it.
    const statusRaw = typeof u.status === 'string' ? u.status.trim() : ''
    if (statusRaw) {
      const status = config.statusOptions.length ? pick(config.statusOptions, statusRaw) : statusRaw
      if (!status) {
        problems.push(`${label}: "${statusRaw}" isn't a status. Statuses: ${config.statusOptions.join(', ')}.`)
        continue
      }
      if (status !== lead.status) {
        patch.status = status
        describe.push(`status ${lead.status || 'blank'} → ${status}`)
      }
      const rule = config.statusRules.find((r) => r.status === status)
      if (rule) newStage = rule.stage
    }

    const stageRaw = typeof u.stage === 'string' ? u.stage.trim() : ''
    if (stageRaw) {
      const row = stageFor(config, stageRaw)
      if (!row) {
        problems.push(`${label}: "${stageRaw}" isn't a stage. Stages: ${config.stages.map((s) => s.key).join(', ')}.`)
        continue
      }
      if (newStage && newStage !== row.key) {
        problems.push(`${label}: status "${patch.status ?? statusRaw}" always moves a lead to ${stageLabel(newStage)}, which contradicts stage "${row.key}". Pick one.`)
        continue
      }
      newStage = row.key
    }
    if (newStage) {
      const row = config.stages.find((s) => s.key === newStage)
      if (row && isSaleStage(row)) {
        problems.push(
          `${label}: moving a lead to ${row.label} records a SALE, which needs its service code and annual value — use upsert_lead for that one on its own.`,
        )
        continue
      }
      if (newStage !== lead.stage) {
        patch.stage = newStage
        describe.push(`stage ${stageLabel(lead.stage)} → ${stageLabel(newStage)}`)
      } else {
        newStage = null
      }
    }

    for (const [field, opts, word] of [
      ['salesperson', config.salespersonOptions, 'salesperson'],
      ['lead_source', config.leadSourceOptions, 'lead source'],
    ] as const) {
      const raw = typeof u[field] === 'string' ? (u[field] as string).trim() : ''
      if (!raw) continue
      const val = opts.length ? pick(opts, raw) : raw
      if (!val) {
        problems.push(`${label}: "${raw}" isn't a ${word} on the Tracker. Options: ${opts.join(', ')}.`)
        continue
      }
      if (val !== lead[field]) {
        patch[field] = val
        describe.push(`${word} → ${val}`)
      }
    }

    let attempt: PlannedChange['attempt'] = null
    if (u.log_attempt && typeof u.log_attempt === 'object') {
      const viaRaw = Array.isArray(u.log_attempt.via) ? u.log_attempt.via : [u.log_attempt.via]
      const via = viaRaw.filter((v): v is ContactType => typeof v === 'string' && (CONTACT_TYPES as readonly string[]).includes(v.toLowerCase().trim())).map((v) => v.toLowerCase().trim() as ContactType)
      if (via.length === 0) {
        problems.push(`${label}: log_attempt.via must list how they were contacted — any of call, text, email.`)
        continue
      }
      const dateRaw = typeof u.log_attempt.date === 'string' ? u.log_attempt.date.trim() : ''
      const date = !dateRaw || dateRaw === 'today' ? opsYmd() : /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null
      if (!date) {
        problems.push(`${label}: log_attempt.date must be "today" or YYYY-MM-DD.`)
        continue
      }
      const number = (maxAttempt.get(lead.id) ?? 0) + 1
      if (number > MAX_ATTEMPTS) {
        problems.push(`${label}: already has ${MAX_ATTEMPTS} attempts logged, the most the Tracker holds. Leave the attempt off (a note still works).`)
        continue
      }
      const types = { call: via.includes('call'), text: via.includes('text'), email: via.includes('email') }
      const notes = typeof u.log_attempt.notes === 'string' && u.log_attempt.notes.trim() ? clip(u.log_attempt.notes.trim(), 1000) : null
      attempt = { number, date, types, notes }
      describe.push(`attempt #${number} logged (${via.join('+')}, ${date})`)
    }

    const columns: PlannedChange['columns'] = []
    if (u.columns && typeof u.columns === 'object') {
      for (const [name, rawVal] of Object.entries(u.columns)) {
        const def = config.columns.find((c) => pick([c.name], name) !== null)
        if (!def) {
          problems.push(`${label}: there's no Tracker column called "${name}". Columns: ${config.columns.map((c) => c.name).join(', ') || 'none'}.`)
          continue
        }
        let value: string | null = rawVal === null || rawVal === undefined || rawVal === '' ? null : String(rawVal).trim()
        if (value !== null && def.type === 'dropdown') {
          const opts = dropdownOptions(def)
          const hit = opts.length ? pick(opts, value) : value
          if (!hit) {
            problems.push(`${label}: "${value}" isn't an option for ${def.name}. Options: ${opts.join(', ')}.`)
            continue
          }
          value = hit
        } else if (value !== null && def.type === 'number' && !Number.isFinite(Number(value))) {
          problems.push(`${label}: ${def.name} needs a number.`)
          continue
        } else if (value !== null && def.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          problems.push(`${label}: ${def.name} needs a YYYY-MM-DD date.`)
          continue
        } else if (value !== null && def.type === 'checkbox') {
          value = /^(true|yes|1|checked|on)$/i.test(value) ? 'true' : 'false'
        }
        columns.push({ columnId: def.id, name: def.name, value })
        describe.push(`${def.name} → ${value ?? '(cleared)'}`)
      }
    }

    const note = typeof u.note === 'string' && u.note.trim() ? clip(u.note.trim(), 4000) : null
    if (note) describe.push(`note: "${clip(note.replace(/\s+/g, ' '), 120)}"`)

    if (describe.length === 0) continue // nothing actually changes on this one
    changes.push({ leadId: lead.id, label, patch, newStage, describe, note, attempt, columns })
  }

  if (problems.length) {
    return {
      ok: false,
      message: lines(
        `Nothing was changed — ${problems.length} problem${problems.length === 1 ? '' : 's'} in that batch. Fix ${problems.length === 1 ? 'it' : 'them'} and send the whole list again:`,
        ...problems.map((p) => `• ${p}`),
      ),
    }
  }
  if (changes.length === 0) {
    return { ok: false, message: 'Every lead in that list already matches — there is nothing to change.' }
  }
  return { ok: true, changes }
}

export async function previewLeadUpdates(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; preview: string } | { ok: false; message: string }> {
  const plan = await planLeadUpdates(ctx, args)
  if (!plan.ok) return { ok: false, message: plan.message }
  const stageMoves = plan.changes.filter((c) => c.newStage).length
  return {
    ok: true,
    preview: lines(
      `Update ${plan.changes.length} Lead Tracker lead${plan.changes.length === 1 ? '' : 's'}:`,
      ...plan.changes.map((c) => `• ${c.label} — ${c.describe.join('; ')}`),
      stageMoves
        ? `Stage changes run the same automations as moving the card by hand (Drip campaigns may start or stop).`
        : null,
    ),
  }
}

export const updateLeadsAction: HubAction = {
  name: 'update_leads',
  description:
    'Change one or more Lead Tracker leads in ONE call: stage, status, salesperson, lead source, custom ' +
    'columns, a note, and/or log a contact attempt (call/text/email). Put EVERY change for the whole job ' +
    'in a single `updates` list (up to 60) — never call this repeatedly for one request, because each new ' +
    'batch replaces the one waiting for approval. When more than one lead is in the list, nothing happens ' +
    'yet: you get a preview to show the user, and it runs only after they say yes (confirm_action). ' +
    'A status moves the lead to its linked stage automatically, just like the Tracker screen, so usually ' +
    'set the status alone. Stage and status names must match the Tracker exactly — if a value is refused, ' +
    'the reply lists the valid ones. This does NOT record sales (Closed Won / Upsells) — use upsert_lead ' +
    'for a sale. Use review_leads first to get lead_ids and see who needs what.',
  input_schema: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: 'One entry per lead. Only include the fields that change.',
        items: {
          type: 'object',
          properties: {
            lead_id: { type: 'string', description: 'The lead_id from review_leads or list_leads.' },
            status: { type: 'string', description: 'New status, e.g. "Unreachable", "Follow Up", "Bad Lead".' },
            stage: { type: 'string', description: 'New stage key, e.g. "closed_lost", "follow_up_long_term". Usually implied by the status.' },
            salesperson: { type: 'string' },
            lead_source: { type: 'string' },
            note: { type: 'string', description: 'A note to add to the lead, e.g. why it changed.' },
            log_attempt: {
              type: 'object',
              description: 'Log a contact attempt (the next number, max 5).',
              properties: {
                via: { type: 'array', items: { type: 'string', enum: ['call', 'text', 'email'] } },
                date: { type: 'string', description: '"today" (default) or YYYY-MM-DD.' },
                notes: { type: 'string' },
              },
              required: ['via'],
            },
            columns: {
              type: 'object',
              description: 'Custom Tracker columns by name, e.g. {"Follow-up date": "2026-10-05"}.',
            },
          },
          required: ['lead_id'],
        },
      },
    },
    required: ['updates'],
  },
  kind: 'write',
  gate: TRACKER_GATE,
  defaultOn: false,
  confirmWhen: (args) => updatesArg(args).length > 1,
  consentLabel: 'update leads on your Lead Tracker',
  run: async (ctx, args) => {
    const plan = await planLeadUpdates(ctx, args)
    if (!plan.ok) return plan.message

    const now = new Date().toISOString()
    const done: string[] = []
    const failed: string[] = []

    for (const c of plan.changes) {
      const partial: string[] = []
      if (Object.keys(c.patch).length) {
        const patch = { ...c.patch, updated_at: now, ...(c.newStage ? { stage_changed_at: now } : {}) }
        const { error } = await ctx.admin
          .from('leads')
          .update(patch)
          .eq('id', c.leadId)
          .eq('company_id', ctx.actor.companyId)
        if (error) {
          failed.push(`• ${c.label} — not changed (${error.message})`)
          continue
        }
        if (c.newStage) await runStageAutomations(ctx, c.leadId, c.newStage)
      }
      if (c.attempt) {
        const { error } = await ctx.admin.from('lead_attempts').upsert(
          {
            lead_id: c.leadId,
            company_id: ctx.actor.companyId,
            attempt_number: c.attempt.number,
            attempted_date: c.attempt.date,
            notes: c.attempt.notes,
            contact_types: c.attempt.types,
            updated_at: now,
          },
          { onConflict: 'lead_id,attempt_number' },
        )
        if (error) partial.push(`attempt not logged (${error.message})`)
      }
      for (const col of c.columns) {
        const { error } = await ctx.admin.from('lead_column_values').upsert(
          { lead_id: c.leadId, company_id: ctx.actor.companyId, column_id: col.columnId, value: col.value, updated_at: now },
          { onConflict: 'lead_id,column_id' },
        )
        if (error) partial.push(`${col.name} not saved (${error.message})`)
      }
      if (c.note) {
        const { error } = await ctx.admin
          .from('lead_notes')
          .insert({ lead_id: c.leadId, company_id: ctx.actor.companyId, note: c.note, created_by: ctx.actor.displayName })
        if (error) partial.push(`note not saved (${error.message})`)
      }
      done.push(`• ${c.label} — ${c.describe.join('; ')}${partial.length ? ` ⚠ ${partial.join('; ')}` : ''}`)
    }

    return lines(
      `Updated ${done.length} of ${plan.changes.length} lead${plan.changes.length === 1 ? '' : 's'} on the Tracker.`,
      ...done,
      failed.length ? `${failed.length} could not be changed:` : null,
      ...failed,
    )
  },
}
