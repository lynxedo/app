import { NextResponse } from 'next/server'
import { getAnthropic } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  authenticateExtensionRequest,
  EXTENSION_CORS_HEADERS,
  extensionPreflight,
} from '@/lib/extension-auth'

// POST /api/extension/extract-contacts  (token-gated)
// Body: { text: string, url?: string, title?: string }
// Returns: { contacts: [{ name, first_name, last_name, phone, email, company, context }] }
//
// Turns the visible text of the page the user chose to scan into structured
// contacts. Claude handles messy real-world layouts (LinkedIn, "About" pages,
// HOA directories) far better than a phone regex — it associates a name/role/
// company with each number. A cheap regex fallback runs only if the model call
// fails or no API key is set, so the extension is never fully dead.
//
// Privacy: only the text the user explicitly scans reaches this route; nothing
// is sent in the background (the extension has no background scanning).

// Cheap/fast model for a simple extraction task. Env-overridable so accuracy can
// be escalated without a deploy (Chrome Extension PRD open decision #4).
const EXTRACT_MODEL = process.env.EXTENSION_EXTRACT_MODEL || 'claude-haiku-4-5-20251001'
const MAX_INPUT_CHARS = 14_000

export type ExtractedContact = {
  name: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  company: string | null
  address: string | null
  context: string | null
  // Directory-match annotations (filled server-side after extraction):
  in_hub: boolean
  contact_id: string | null
  existing_conversation_id: string | null
  is_lead: boolean
}

function tenDigits(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  return d.length === 10 || d.length === 11 ? d.slice(-10) : null
}

// Annotate each extracted contact with whether it's already in the unified
// directory (and whether it's already a lead / has an open thread), so the
// extension can show "In Hub ✓" instead of a fresh "Add" button. Scoped to the
// token's company. Best-effort per contact — a lookup failure just leaves the
// contact as "not in Hub".
async function annotateMatches(
  companyId: string,
  contacts: ExtractedContact[]
): Promise<void> {
  const admin = createAdminClient()
  for (const c of contacts) {
    try {
      const ten = tenDigits(c.phone)
      let contactId: string | null = null
      if (ten) {
        const { data } = await admin
          .from('txt_contacts')
          .select('id')
          .eq('company_id', companyId)
          .in('phone_digits', [ten, '1' + ten])
          .limit(1)
          .maybeSingle()
        if (data) contactId = data.id as string
      }
      if (!contactId && c.email) {
        const { data } = await admin
          .from('txt_contacts')
          .select('id')
          .eq('company_id', companyId)
          .ilike('email', c.email)
          .limit(1)
          .maybeSingle()
        if (data) contactId = data.id as string
      }
      if (contactId) {
        c.in_hub = true
        c.contact_id = contactId
        const { data: conv } = await admin
          .from('txt_conversations')
          .select('id')
          .eq('company_id', companyId)
          .eq('contact_id', contactId)
          .eq('kind', 'direct')
          .maybeSingle()
        c.existing_conversation_id = conv?.id ?? null
      }
      // Lead match by email (most reliable field on the free-text leads table).
      if (c.email) {
        const { data: lead } = await admin
          .from('leads')
          .select('id')
          .eq('company_id', companyId)
          .ilike('email', c.email)
          .limit(1)
          .maybeSingle()
        if (lead) c.is_lead = true
      }
    } catch {
      /* leave as not-in-hub */
    }
  }
}

export function OPTIONS() {
  return extensionPreflight()
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: EXTENSION_CORS_HEADERS })
}

// Last-ditch fallback: pull raw phones/emails so the user still gets something
// if the model is unavailable. No name association — that's what Claude is for.
function regexFallback(text: string): ExtractedContact[] {
  const emails = [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [])]
  const phones = [...new Set(
    (text.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) ?? [])
      .map((p) => p.trim())
  )]
  const out: ExtractedContact[] = []
  const n = Math.max(emails.length, phones.length)
  for (let i = 0; i < n; i++) {
    out.push({
      name: null, first_name: null, last_name: null,
      phone: phones[i] ?? null, email: emails[i] ?? null,
      company: null, address: null, context: 'auto-detected (offline fallback)',
      in_hub: false, contact_id: null, existing_conversation_id: null, is_lead: false,
    })
  }
  return out
}

export async function POST(request: Request) {
  const auth = await authenticateExtensionRequest(request)
  if (!auth) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => ({}))
  const rawText: string = typeof body.text === 'string' ? body.text : ''
  const url: string | null = typeof body.url === 'string' ? body.url : null
  const title: string | null = typeof body.title === 'string' ? body.title : null

  const text = rawText.slice(0, MAX_INPUT_CHARS).trim()
  if (!text) return json({ contacts: [] })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const contacts = regexFallback(text)
    await annotateMatches(auth.companyId, contacts)
    return json({ contacts, degraded: true })
  }

  try {
    const anthropic = getAnthropic()
    const resp = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1500,
      tools: [
        {
          name: 'return_contacts',
          description:
            'Return every distinct real person or business contact found in the page text, with their phone and/or email when present. Do not invent data. Only include an entry if it has at least a phone or an email.',
          input_schema: {
            type: 'object',
            properties: {
              contacts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Full display name, or empty if unknown' },
                    first_name: { type: 'string' },
                    last_name: { type: 'string' },
                    phone: { type: 'string', description: 'Phone as written on the page' },
                    email: { type: 'string' },
                    company: { type: 'string', description: 'Company/org the person is associated with, if any' },
                    address: { type: 'string', description: 'Street/mailing/service address for this person, if present on the page' },
                    context: { type: 'string', description: 'Short note: their role or why they appear on this page' },
                  },
                },
              },
            },
            required: ['contacts'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'return_contacts' },
      messages: [
        {
          role: 'user',
          content:
            `Extract contacts from this web page.` +
            (title ? `\nPage title: ${title}` : '') +
            (url ? `\nURL: ${url}` : '') +
            `\n\nPage text:\n"""\n${text}\n"""`,
        },
      ],
    })

    const toolUse = resp.content.find((b) => b.type === 'tool_use') as
      | { type: 'tool_use'; input: { contacts?: unknown[] } }
      | undefined
    const rows = Array.isArray(toolUse?.input?.contacts) ? toolUse!.input!.contacts! : []

    const contacts: ExtractedContact[] = rows
      .map((r) => {
        const c = (r ?? {}) as Record<string, unknown>
        const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
        const first = s(c.first_name)
        const last = s(c.last_name)
        const name = s(c.name) || [first, last].filter(Boolean).join(' ') || null
        return {
          name, first_name: first, last_name: last,
          phone: s(c.phone), email: s(c.email),
          company: s(c.company), address: s(c.address), context: s(c.context),
          in_hub: false, contact_id: null, existing_conversation_id: null, is_lead: false,
        }
      })
      // A contact is only useful if we can act on it — needs a phone or email.
      .filter((c) => c.phone || c.email)

    await annotateMatches(auth.companyId, contacts)
    return json({ contacts })
  } catch (e) {
    console.error('[extension/extract] model call failed', e)
    const contacts = regexFallback(text)
    await annotateMatches(auth.companyId, contacts)
    return json({ contacts, degraded: true })
  }
}
