import type { SupabaseClient } from '@supabase/supabase-js'

export type KnowledgeDoc = {
  id: string
  company_id: string
  slug: string
  title: string
  body: string
  always_include: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

export type KnowledgeDocVersion = {
  id: string
  doc_id: string
  company_id: string
  body: string
  title: string
  saved_by: string | null
  saved_at: string
}

export type ReadKnowledgeResult =
  | { found: true; slug: string; title: string; body: string }
  | { found: false; available_slugs: string[]; requested_slug: string }

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const VERSION_KEEP = 10

export function isRouterSlug(slug: string): boolean {
  return slug === 'router'
}

// Rough estimate: Anthropic averages ~4 chars per token for English text.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function getKnowledgeDocs(
  supabase: SupabaseClient,
  companyId: string
): Promise<KnowledgeDoc[]> {
  const { data, error } = await supabase
    .from('guardian_knowledge_docs')
    .select('*')
    .eq('company_id', companyId)
    .order('slug', { ascending: true })

  if (error) throw error
  return (data ?? []) as KnowledgeDoc[]
}

export async function getKnowledgeDoc(
  supabase: SupabaseClient,
  companyId: string,
  slug: string
): Promise<KnowledgeDoc | null> {
  const { data, error } = await supabase
    .from('guardian_knowledge_docs')
    .select('*')
    .eq('company_id', companyId)
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as KnowledgeDoc | null
}

export async function getKnowledgeDocById(
  supabase: SupabaseClient,
  companyId: string,
  id: string
): Promise<KnowledgeDoc | null> {
  const { data, error } = await supabase
    .from('guardian_knowledge_docs')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as KnowledgeDoc | null
}

export async function getAlwaysIncludedDocs(
  supabase: SupabaseClient,
  companyId: string
): Promise<KnowledgeDoc[]> {
  const { data, error } = await supabase
    .from('guardian_knowledge_docs')
    .select('*')
    .eq('company_id', companyId)
    .eq('always_include', true)
    .order('slug', { ascending: true })

  if (error) throw error
  return (data ?? []) as KnowledgeDoc[]
}

/**
 * Insert a version snapshot for a doc, then prune versions beyond the last 10
 * (by saved_at DESC) for that doc. company_id is denormalized for RLS.
 * Pass the admin client — versions are admin-write.
 */
export async function saveVersion(
  adminClient: SupabaseClient,
  docId: string,
  companyId: string,
  body: string,
  title: string,
  savedBy: string | null
): Promise<void> {
  const { error: insertError } = await adminClient
    .from('guardian_knowledge_doc_versions')
    .insert({
      doc_id: docId,
      company_id: companyId,
      body,
      title,
      saved_by: savedBy,
    })

  if (insertError) throw insertError

  // Prune to last 10 for this doc.
  const { data: keep, error: selectError } = await adminClient
    .from('guardian_knowledge_doc_versions')
    .select('id')
    .eq('doc_id', docId)
    .order('saved_at', { ascending: false })
    .limit(VERSION_KEEP)

  if (selectError) throw selectError

  const keepIds = (keep ?? []).map((r: { id: string }) => r.id)
  if (keepIds.length === 0) return

  const { error: deleteError } = await adminClient
    .from('guardian_knowledge_doc_versions')
    .delete()
    .eq('doc_id', docId)
    .not('id', 'in', `(${keepIds.map(id => `"${id}"`).join(',')})`)

  if (deleteError) throw deleteError
}

export async function getVersionsForDoc(
  supabase: SupabaseClient,
  docId: string,
  limit = 10
): Promise<KnowledgeDocVersion[]> {
  const { data, error } = await supabase
    .from('guardian_knowledge_doc_versions')
    .select('*')
    .eq('doc_id', docId)
    .order('saved_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as KnowledgeDocVersion[]
}

/**
 * Local implementation of the read_knowledge_doc tool. Called from the
 * hub-claude.ts agentic loop — never routed through MCP. Returns the doc body
 * if found, or the list of available slugs if the requested slug is missing
 * (so Guardian can self-correct on a wrong slug guess).
 */
export async function resolveReadKnowledgeDoc(
  adminClient: SupabaseClient,
  companyId: string,
  slug: string
): Promise<ReadKnowledgeResult> {
  const trimmed = typeof slug === 'string' ? slug.trim() : ''
  if (!trimmed) {
    const all = await getKnowledgeDocs(adminClient, companyId)
    return {
      found: false,
      requested_slug: '',
      available_slugs: all.map(d => d.slug),
    }
  }

  const doc = await getKnowledgeDoc(adminClient, companyId, trimmed)
  if (doc) {
    return { found: true, slug: doc.slug, title: doc.title, body: doc.body }
  }

  const all = await getKnowledgeDocs(adminClient, companyId)
  return {
    found: false,
    requested_slug: trimmed,
    available_slugs: all.map(d => d.slug),
  }
}

/**
 * Returns the configured Claude model for a company. Falls back to the default
 * if no guardian_settings row exists.
 */
export async function getGuardianModel(
  supabase: SupabaseClient,
  companyId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('guardian_settings')
    .select('model')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error || !data) return DEFAULT_MODEL
  const model = (data as { model: string | null }).model
  return model && model.trim() ? model.trim() : DEFAULT_MODEL
}

export async function getGuardianSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ model: string; web_search_daily_cap: number }> {
  const { data, error } = await supabase
    .from('guardian_settings')
    .select('model, web_search_daily_cap')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error || !data) return { model: DEFAULT_MODEL, web_search_daily_cap: 30 }
  const row = data as { model: string | null; web_search_daily_cap: number | null }
  return {
    model: row.model && row.model.trim() ? row.model.trim() : DEFAULT_MODEL,
    web_search_daily_cap: typeof row.web_search_daily_cap === 'number' ? row.web_search_daily_cap : 30,
  }
}
