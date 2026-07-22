// Shared Inbox — effective signature resolution.
//
// The signature a user sends with is: their OWN saved signature if set; otherwise
// the company default template (inbox_settings.default_signature) rendered with
// their name + job title; otherwise empty. Tokens: {Name}, {Job Title} (also
// {Title}). A token line that resolves to nothing (e.g. no job title on file) is
// dropped so the signature has no blank gap.

import type { SupabaseClient } from '@supabase/supabase-js'

function renderTemplate(tpl: string, name: string, jobTitle: string): string {
  return tpl
    .replace(/\{\s*name\s*\}/gi, name)
    .replace(/\{\s*job\s*title\s*\}/gi, jobTitle)
    .replace(/\{\s*title\s*\}/gi, jobTitle)
}

export async function resolveEffectiveSignature(
  admin: SupabaseClient,
  companyId: string,
  userId: string
): Promise<string> {
  const [{ data: prof }, { data: hu }, { data: emp }, { data: settings }] = await Promise.all([
    admin.from('user_profiles').select('full_name, email_signature').eq('id', userId).maybeSingle(),
    admin.from('hub_users').select('display_name').eq('id', userId).maybeSingle(),
    admin.from('employees').select('job_title').eq('user_id', userId).maybeSingle(),
    admin.from('inbox_settings').select('default_signature').eq('company_id', companyId).maybeSingle(),
  ])

  const own = ((prof?.email_signature as string | undefined) || '').trim()
  if (own) return own

  const tpl = ((settings?.default_signature as string | undefined) || '').trim()
  if (!tpl) return ''

  const name =
    (hu?.display_name as string | undefined)?.trim() ||
    (prof?.full_name as string | undefined)?.trim() ||
    ''
  const jobTitle = (emp?.job_title as string | undefined)?.trim() || ''

  // Drop a whole line that is only an empty token (so no blank line is left behind).
  let t = tpl
  if (!jobTitle) t = t.replace(/^[^\S\n]*\{\s*(job\s*title|title)\s*\}[^\S\n]*\n?/gim, '')
  if (!name) t = t.replace(/^[^\S\n]*\{\s*name\s*\}[^\S\n]*\n?/gim, '')

  return renderTemplate(t, name, jobTitle).trim()
}
