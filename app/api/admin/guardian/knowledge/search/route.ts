import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { ilikeSearchPattern } from '@/lib/search'

export const dynamic = 'force-dynamic'

const TERM_MIN = 2
const TERM_MAX = 120
const MAX_DOCS = 50
const MAX_SNIPPETS = 3
const SNIPPET_LEN = 120
const MAX_COUNTED = 500 // safety cap on the per-doc occurrence scan

type SearchHit = {
  id: string
  slug: string
  title: string
  audiences: string[]
  occurrences: number
  title_match: boolean
  snippets: string[]
}

type DocRow = {
  id: string
  slug: string
  title: string
  body: string | null
  audiences: string[] | null
}

/**
 * Regex for counting the term inside a body in TypeScript.
 *
 * Mirrors `ilikeSearchPattern`: that helper turns the PostgREST `.or()` grammar
 * characters into the single-character LIKE wildcard, so a term containing them
 * matches loosely in the DB. Doing the same here keeps the counts/snippets
 * consistent with the rows the query returned.
 */
function buildTermRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(/\\?[,():]/g, '.')
  return new RegExp(pattern, 'gi')
}

/** Count occurrences of the term in a body and pull up to 3 short snippets. */
function scanBody(body: string, term: string): { occurrences: number; snippets: string[] } {
  const re = buildTermRegex(term)
  const snippets: string[] = []
  let occurrences = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(body)) !== null) {
    occurrences++

    if (snippets.length < MAX_SNIPPETS) {
      const matchLen = match[0].length
      const pad = Math.max(0, Math.floor((SNIPPET_LEN - matchLen) / 2))
      const start = Math.max(0, match.index - pad)
      const end = Math.min(body.length, match.index + matchLen + pad)
      let snippet = body.slice(start, end).replace(/\s+/g, ' ').trim()
      if (start > 0) snippet = `…${snippet}`
      if (end < body.length) snippet = `${snippet}…`
      snippets.push(snippet)
    }

    // A zero-width match would loop forever; nudge the cursor.
    if (match[0].length === 0) re.lastIndex++
    if (occurrences >= MAX_COUNTED) break
  }

  return { occurrences, snippets }
}

export async function GET(request: Request) {
  const check = await requireAdminArea('ai')
  if (!check.ok || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const companyId = check.company_id

  const { searchParams } = new URL(request.url)
  const term = (searchParams.get('q') ?? '').trim()

  if (term.length < TERM_MIN) {
    return NextResponse.json(
      { error: `Type at least ${TERM_MIN} characters to search` },
      { status: 400 }
    )
  }
  if (term.length > TERM_MAX) {
    return NextResponse.json(
      { error: `Search term must be ${TERM_MAX} characters or fewer` },
      { status: 400 }
    )
  }

  const pattern = ilikeSearchPattern(term)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('guardian_knowledge_docs')
    .select('id, slug, title, body, audiences')
    .eq('company_id', companyId)
    .or(`title.ilike.${pattern},body.ilike.${pattern}`)
    .order('slug', { ascending: true })
    .limit(MAX_DOCS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const titleRe = buildTermRegex(term)
  const hits: SearchHit[] = ((data ?? []) as DocRow[]).map(row => {
    const body = row.body ?? ''
    const { occurrences, snippets } = scanBody(body, term)
    titleRe.lastIndex = 0
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      audiences: row.audiences ?? [],
      occurrences,
      title_match: titleRe.test(row.title),
      snippets,
    }
  })

  // Docs with the most mentions first — that's usually where the fact really lives.
  hits.sort((a, b) => b.occurrences - a.occurrences || a.title.localeCompare(b.title))

  return NextResponse.json({
    term,
    hits,
    doc_count: hits.length,
    truncated: hits.length >= MAX_DOCS,
  })
}
