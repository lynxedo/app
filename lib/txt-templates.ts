// Server-side dynamic field resolution for Txt v2 templates.
// Renders {placeholder} tokens against a sender + contact + company context.
// Unknown tokens are left as literal text so a typo is visible, not silent.

export type TemplateRenderContext = {
  contactName?: string | null
  senderName?: string | null
  companyName?: string | null
}

function splitName(full: string | null | undefined): { first: string; last: string } {
  const trimmed = (full || '').trim()
  if (!trimmed) return { first: '', last: '' }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export function buildFieldMap(ctx: TemplateRenderContext): Record<string, string> {
  const { first: contactFirst, last: contactLast } = splitName(ctx.contactName)
  const { first: senderFirst } = splitName(ctx.senderName)
  return {
    first_name: contactFirst,
    last_name: contactLast,
    full_name: (ctx.contactName || '').trim(),
    my_first_name: senderFirst,
    my_name: (ctx.senderName || '').trim(),
    company: (ctx.companyName || '').trim(),
  }
}

// Replaces {field} tokens. Unknown fields are preserved verbatim and warned.
export function renderTemplate(body: string, ctx: TemplateRenderContext): string {
  if (!body) return body
  const fields = buildFieldMap(ctx)
  return body.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (match, name: string) => {
    const key = name.toLowerCase()
    if (key in fields) return fields[key]
    console.warn(`[txt-templates] Unknown placeholder: {${name}}`)
    return match
  })
}

export const TEMPLATE_FIELDS = [
  'first_name',
  'last_name',
  'full_name',
  'my_first_name',
  'my_name',
  'company',
] as const

// On-My-Way default. Used when txt_settings.on_my_way_template is blank.
// {eta} is substituted client-side after renderTemplate (it's not a contact/
// sender field, so renderTemplate leaves it as a literal token to fill in).
export const DEFAULT_ON_MY_WAY_TEMPLATE =
  "Hi {first_name}, this is {my_name} from {company}. I'm on my way — should be there in about {eta} minutes."
