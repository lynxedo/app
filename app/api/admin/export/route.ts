import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/admin/export?kind=contacts|leads|lead_notes|boards|messages
 *
 * "Export your data" — one CSV per kind, for the company's full admins
 * (role = admin). Servanto Starter Session 2: getservanto.com/privacy promises a
 * 30-day export window after cancelling, and it is useful any time.
 *
 * Exports what the company made in Servanto. Jobber data isn't included — the
 * customer already has it in Jobber. Privacy limits on purpose: chat is the
 * messages of NON-private rooms only (no DMs, no private rooms), and boards skip
 * personal and private boards.
 */

type Kind = 'contacts' | 'leads' | 'lead_notes' | 'boards' | 'messages'
const KINDS: Kind[] = ['contacts', 'leads', 'lead_notes', 'boards', 'messages']

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = Array.isArray(v) ? v.join('; ') : String(v)
  // A cell starting with = + - @ is run as a formula by Excel; neutralise it.
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

type Row = Record<string, unknown>

/** Every row, past Supabase's 1000-row page cap. */
async function fetchAll(
  build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

function toCsv(headers: string[], rows: Row[]): string {
  const lines = [headers.map(escapeCsv).join(',')]
  for (const r of rows) lines.push(headers.map(h => escapeCsv(r[h])).join(','))
  return lines.join('\r\n') + '\r\n'
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = profile.company_id as string

  const kind = new URL(request.url).searchParams.get('kind') as Kind
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown export' }, { status: 400 })

  const admin = createAdminClient()
  let headers: string[]
  let rows: Row[]

  if (kind === 'contacts') {
    headers = ['name', 'first_name', 'last_name', 'company_name', 'phone', 'email', 'address_line1', 'address_line2',
      'city', 'state', 'postal_code', 'notes', 'do_not_text', 'do_not_call', 'archived_at', 'created_at']
    rows = await fetchAll((f, t) => admin.from('txt_contacts').select(headers.join(','))
      .eq('company_id', companyId).is('deleted_at', null).order('created_at').range(f, t) as never)
  } else if (kind === 'leads') {
    headers = ['first_name', 'last_name', 'phone', 'email', 'service', 'lead_source', 'status', 'stage',
      'lead_creation_date', 'sold_date', 'salesperson', 'base_program_sold', 'auxiliary_services', 'annual_value',
      'service_address', 'created_at']
    rows = await fetchAll((f, t) => admin.from('leads').select(headers.join(','))
      .eq('company_id', companyId).order('created_at').range(f, t) as never)
  } else if (kind === 'lead_notes') {
    headers = ['lead_name', 'lead_phone', 'note', 'created_at']
    const notes = await fetchAll((f, t) => admin.from('lead_notes')
      .select('note, created_at, leads(first_name, last_name, phone)')
      .eq('company_id', companyId).order('created_at').range(f, t) as never)
    rows = notes.map(n => {
      const l = (n.leads ?? {}) as Row
      return { lead_name: [l.first_name, l.last_name].filter(Boolean).join(' '), lead_phone: l.phone, note: n.note, created_at: n.created_at }
    })
  } else if (kind === 'boards') {
    headers = ['board', 'task', 'done', 'done_at', 'priority', 'due_date', 'due_time', 'assignee', 'created_at']
    const [items, people] = await Promise.all([
      fetchAll((f, t) => admin.from('board_items')
        .select('content, done, done_at, priority, due_date, due_time, assignee_id, created_at, boards!inner(name, is_private, is_personal)')
        .eq('company_id', companyId).eq('boards.is_private', false).eq('boards.is_personal', false)
        .order('created_at').range(f, t) as never),
      peopleById(admin, companyId),
    ])
    rows = items.map(i => ({
      ...i,
      board: (i.boards as Row | null)?.name,
      task: i.content,
      assignee: i.assignee_id ? people.get(i.assignee_id as string) ?? '' : '',
    }))
  } else {
    headers = ['room', 'sender', 'message', 'created_at', 'edited_at']
    const [msgs, people] = await Promise.all([
      fetchAll((f, t) => admin.from('messages')
        .select('content, sender_id, created_at, edited_at, rooms!inner(name, is_private)')
        .eq('company_id', companyId).eq('rooms.is_private', false).is('deleted_at', null)
        .order('created_at').range(f, t) as never),
      peopleById(admin, companyId),
    ])
    rows = msgs.map(m => ({
      room: (m.rooms as Row | null)?.name,
      sender: m.sender_id ? people.get(m.sender_id as string) ?? '' : '',
      message: m.content,
      created_at: m.created_at,
      edited_at: m.edited_at,
    }))
  }

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${kind.replace('_', '-')}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

async function peopleById(admin: ReturnType<typeof createAdminClient>, companyId: string): Promise<Map<string, string>> {
  const { data } = await admin.from('user_profiles').select('id, full_name').eq('company_id', companyId)
  return new Map((data ?? []).map(p => [p.id as string, (p.full_name as string) ?? '']))
}
