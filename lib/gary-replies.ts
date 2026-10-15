// Gary — session 3: noticing replies to what Gary sent.
//
// Every 5 minutes (from the prod tick, app/api/amber/run/tick) and whenever
// Gary's page loads, each sent email/text with no reply yet is checked for the
// first message back from the customer after it went out:
//   • email → an inbound message on the Inbox thread Gary started (the reply has
//             already reopened that thread into the team Queue)
//   • text  → an inbound text on the Txt conversation he texted into (it lands
//             in Txt as usual; Amber stays out — lib/amber-text.ts gary_outreach)
// Then, once per message (replied_at is claimed atomically):
//   • "stop" / "unsubscribe" / "remove me" → opted out (an email address goes on
//     the suppression list; Txt's own STOP handling already covers texts)
//   • "no thanks" / "not interested"       → declined; Gary simply never writes again
//   • anything else → "Gary needs a human" in Office Alerts, with what they said
//     and a link to the thread (Ben, Oct 15 2026 — D10).
// Gary never answers a reply himself. One reply ends the person's whole sequence
// (every sent message in it is marked), so follow-ups stop and nobody is alerted twice.

import type { SupabaseClient } from '@supabase/supabase-js'
import { postOfficeAlert } from '@/lib/office-alerts'
import { suppressEmail } from '@/lib/email-contacts'
import { GARY_SERVICE_LABEL, type GaryService } from '@/lib/gary'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

const LOOKBACK_DAYS = 60
// Carrier keywords count only as the whole reply ("Cancel" alone, not "Cancel
// Tuesday, can you come Friday?"); the phrases count at the start.
const OPT_OUT =
  /^\W*(stop|stopall|unsubscribe|cancel|end|quit)\W*$|^\W*(unsubscribe|remove me|take me off|do not (contact|email|text|message)|don'?t (contact|email|text|message))\b/i
const DECLINE = /^\W*(no thanks?|no thank you|not interested|nope|we'?re good|i'?m good|all set|no,? (we|i) (went|found|hired|are good|am good))\b/i

type SentRow = {
  id: string
  first_id: string | null
  channel: 'email' | 'text'
  to_name: string | null
  to_email: string | null
  to_phone: string | null
  subject: string
  context: { services?: GaryService[] } | null
  sent_at: string
  inbox_thread_id: string | null
  conversation_id: string | null
}

/** The customer's own words: drop quoted history ("On … wrote:", "> …") and clip. */
function ownWords(text: string): string {
  const cut = text.split(/\n\s*On .{3,120}wrote:|\n-{2,}\s*Original Message|\nFrom:\s/i)[0]
  return cut
    .split('\n')
    .filter((l) => !l.trim().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

export type ReplyCheck = { checked: number; replies: number; alerts: number }

export async function checkGaryReplies(admin: Admin, companyId: string): Promise<ReplyCheck> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data } = await admin
    .from('gary_queue')
    .select('id, first_id, channel, to_name, to_email, to_phone, subject, context, sent_at, inbox_thread_id, conversation_id')
    .eq('company_id', companyId)
    .eq('status', 'sent')
    .is('replied_at', null)
    .gte('sent_at', since)
    .limit(500)
  const rows = (data ?? []) as SentRow[]
  const out: ReplyCheck = { checked: rows.length, replies: 0, alerts: 0 }
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://lynxedo.com'

  for (const r of rows) {
    try {
      let words = ''
      let at = ''
      let link = ''
      if (r.channel === 'email') {
        if (!r.inbox_thread_id) continue
        const { data: m } = await admin
          .from('inbox_messages')
          .select('body_text, snippet, message_date')
          .eq('thread_id', r.inbox_thread_id)
          .eq('direction', 'inbound')
          .is('deleted_at', null)
          .gt('message_date', r.sent_at)
          .order('message_date', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (!m) continue
        words = ownWords((m.body_text as string) || (m.snippet as string) || '')
        at = m.message_date as string
        link = `${base}/hub/email/${r.inbox_thread_id}`
      } else {
        if (!r.conversation_id) continue
        const { data: m } = await admin
          .from('txt_messages')
          .select('body, created_at')
          .eq('conversation_id', r.conversation_id)
          .eq('direction', 'inbound')
          .gt('created_at', r.sent_at)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (!m) continue
        words = ownWords((m.body as string) || '(a picture)')
        at = m.created_at as string
        link = `${base}/hub/txt/${r.conversation_id}`
      }

      const kind = OPT_OUT.test(words) ? 'opted_out' : DECLINE.test(words) ? 'declined' : 'reply'
      // Claim the reply — exactly one checker acts on it.
      const { data: claimed } = await admin
        .from('gary_queue')
        .update({ replied_at: at, reply_kind: kind, reply_snippet: words.slice(0, 300) || null })
        .eq('id', r.id)
        .is('replied_at', null)
        .select('id')
        .maybeSingle()
      if (!claimed) continue
      out.replies++
      // One reply ends the whole sequence: mark Gary's other sent messages to them
      // too, so the same reply never raises a second alert and no follow-up goes.
      const chainId = r.first_id ?? r.id
      await admin
        .from('gary_queue')
        .update({ replied_at: at, reply_kind: kind, reply_snippet: words.slice(0, 300) || null })
        .eq('company_id', companyId)
        .or(`id.eq.${chainId},first_id.eq.${chainId}`)
        .is('replied_at', null)

      if (kind === 'opted_out' && r.channel === 'email' && r.to_email) {
        await suppressEmail(admin, companyId, r.to_email, 'unsubscribe')
      }
      if (kind !== 'reply') continue

      const who = r.to_name || r.to_email || r.to_phone || 'A customer'
      const about = (r.context?.services ?? []).map((s) => GARY_SERVICE_LABEL[s]).filter(Boolean).join(', ')
      const posted = await postOfficeAlert(admin, companyId, {
        title: `🧑‍💼 Gary needs a human: ${who} replied to Gary's ${r.channel === 'text' ? 'text' : 'email'}`,
        details: [
          words ? `They said: “${words}”` : null,
          about ? `Gary wrote to them about: ${about}` : null,
          r.channel === 'email' ? `It's in the Inbox Queue: ${link}` : `It's in Txt: ${link}`,
          'Gary won’t answer it. Please take it from here.',
        ],
      })
      if (posted) out.alerts++
    } catch (e) {
      console.error('[gary-replies] check failed', r.id, e)
    }
  }
  return out
}

/** Every company with Gary set up (prod tick). */
export async function checkGaryRepliesAllCompanies(admin: Admin): Promise<void> {
  const { data } = await admin.from('gary_settings').select('company_id')
  for (const row of (data ?? []) as { company_id: string }[]) {
    const res = await checkGaryReplies(admin, row.company_id)
    if (res.replies) console.log('[gary-replies]', row.company_id, res)
  }
}
