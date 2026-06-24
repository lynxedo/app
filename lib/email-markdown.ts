// Minimal, dependency-free Markdown → HTML renderer for the email template editor,
// plus merge-field substitution ({{first_name}} etc.). We author this content
// ourselves (it's not user-generated content displayed to other users), so the
// goal is "predictable, safe-by-escaping" rather than full CommonMark. Supports:
// headings, bold/italic, links, unordered/ordered lists, paragraphs, line breaks.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Inline: escape first, then re-introduce a small, fixed set of tags.
// Exported as renderInline for reuse by the block composer's text blocks.
export function renderInline(s: string): string { return inline(s) }
function inline(s: string): string {
  let out = escapeHtml(s)
  // links [text](url) — only http(s)/mailto, rendered as a plain anchor.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}" style="color:#2563eb">${text}</a>`)
  // bold **x** then italic *x* / _x_
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  return out
}

/** Render a small Markdown subset to HTML. */
export function markdownToHtml(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let para: string[] = []

  const flushPara = () => {
    if (para.length) {
      html.push(`<p style="margin:0 0 14px">${para.map(inline).join('<br/>')}</p>`)
      para = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // blank line ends a paragraph
    if (line.trim() === '') { flushPara(); i++; continue }

    // headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      const level = h[1].length
      const size = level === 1 ? 22 : level === 2 ? 18 : 16
      html.push(`<h${level} style="margin:0 0 10px;font-size:${size}px;font-weight:700">${inline(h[2])}</h${level}>`)
      i++; continue
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li style="margin:0 0 4px">${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`)
        i++
      }
      html.push(`<ul style="margin:0 0 14px;padding-left:22px">${items.join('')}</ul>`)
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li style="margin:0 0 4px">${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`)
        i++
      }
      html.push(`<ol style="margin:0 0 14px;padding-left:22px">${items.join('')}</ol>`)
      continue
    }

    para.push(line)
    i++
  }
  flushPara()
  return html.join('\n')
}

export type MergeContext = { first_name?: string | null; last_name?: string | null; email?: string | null }

/**
 * Replace {{first_name}} / {{last_name}} / {{email}} merge fields. Unknown fields
 * are left as-is. first_name falls back to "there" when blank so greetings read
 * naturally ("Hi there,"). Applied to subject + body at send time.
 */
export function renderMergeFields(text: string, ctx: MergeContext): string {
  if (!text) return text
  const map: Record<string, string> = {
    first_name: (ctx.first_name || '').trim() || 'there',
    last_name: (ctx.last_name || '').trim(),
    email: (ctx.email || '').trim(),
  }
  return text.replace(/\{\{\s*(first_name|last_name|email)\s*\}\}/g, (_m, key) => map[key] ?? _m)
}

export const MERGE_FIELDS = ['first_name', 'last_name', 'email'] as const
