// Email block composer model + renderer. A template's `design` jsonb holds an
// ordered list of blocks + global settings; renderDesignToHtml() turns that into
// table-based, inline-styled HTML that survives Gmail/Outlook/Apple Mail (no
// <style>, no flexbox, no modern CSS). Dependency-free + importable on both the
// client (live preview) and server (send-time render), like lib/email-markdown.
import { renderMergeFields, type MergeContext } from '@/lib/email-markdown'

export type Align = 'left' | 'center' | 'right'

export type EmailBlock =
  | { id: string; type: 'header'; logoUrl: string; logoWidth: number; bg: string; align: Align; padding: number }
  | { id: string; type: 'text'; content: string; color: string; bg: string; fontSize: number; align: Align; padding: number }
  | { id: string; type: 'image'; url: string; alt: string; width: number; align: Align; linkUrl: string; bg: string; padding: number }
  | { id: string; type: 'button'; label: string; linkUrl: string; bg: string; color: string; radius: number; align: Align; padding: number }
  | { id: string; type: 'divider'; color: string; thickness: number; padding: number }
  | { id: string; type: 'spacer'; height: number }

export type BlockType = EmailBlock['type']

export type EmailDesign = {
  blocks: EmailBlock[]
  settings: {
    backgroundColor: string       // page background behind the email card
    contentBackgroundColor: string // the email card background
    contentWidth: number          // px, typically 600
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  header: 'Header / Logo', text: 'Text', image: 'Image', button: 'Button', divider: 'Divider', spacer: 'Spacer',
}

export function defaultSettings(): EmailDesign['settings'] {
  return { backgroundColor: '#f3f4f6', contentBackgroundColor: '#ffffff', contentWidth: 600 }
}

export function emptyDesign(): EmailDesign {
  return { blocks: [], settings: defaultSettings() }
}

// New-block factory. `id` is supplied by the caller (client) so we stay free of
// Math.random() here; the composer passes a unique id.
export function makeBlock(type: BlockType, id: string): EmailBlock {
  switch (type) {
    case 'header': return { id, type, logoUrl: '', logoWidth: 180, bg: '#ffffff', align: 'center', padding: 24 }
    case 'text': return { id, type, content: '<div>Hi {{first_name}},</div><div><br></div><div>Write your message here — use the toolbar to make text <b>bold</b>, add bullets, or drop in an emoji.</div>', color: '#222222', bg: '#ffffff', fontSize: 15, align: 'left', padding: 20 }
    case 'image': return { id, type, url: '', alt: '', width: 100, align: 'center', linkUrl: '', bg: '#ffffff', padding: 0 }
    case 'button': return { id, type, label: 'Book now', linkUrl: 'https://', bg: '#2563eb', color: '#ffffff', radius: 6, align: 'center', padding: 16 }
    case 'divider': return { id, type, color: '#e5e7eb', thickness: 1, padding: 12 }
    case 'spacer': return { id, type, height: 24 }
  }
}

// Coerce arbitrary jsonb back into a well-formed design (defensive: old/partial rows).
export function normalizeDesign(raw: unknown): EmailDesign {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>
  const blocks = Array.isArray(r.blocks) ? (r.blocks as EmailBlock[]).filter(b => b && typeof b === 'object' && 'type' in b) : []
  return {
    blocks,
    settings: {
      backgroundColor: typeof s.backgroundColor === 'string' ? s.backgroundColor : '#f3f4f6',
      contentBackgroundColor: typeof s.contentBackgroundColor === 'string' ? s.contentBackgroundColor : '#ffffff',
      contentWidth: typeof s.contentWidth === 'number' ? s.contentWidth : 600,
    },
  }
}

export function isEmptyDesign(d: EmailDesign): boolean {
  return !d.blocks || d.blocks.length === 0
}

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Sanitize + inline-style the WYSIWYG HTML from a Text block for email. Allowlist
// of formatting tags only; drops every other tag (keeping its text), strips all
// attributes except a safe href on <a>, and inlines list/link styles (email
// clients ignore <style>). Tolerant of the trusted-staff authoring model — the
// point is clean, client-safe email markup, not defending against hostile input.
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'br', 'div', 'p', 'span'])
export function sanitizeRichHtml(html: string): string {
  if (!html) return ''
  // Drop script/style blocks entirely (content included).
  let s = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (_m, slash: string, tag: string, attrs: string) => {
    const t = tag.toLowerCase()
    if (!ALLOWED_TAGS.has(t)) return ''
    if (slash) return `</${t}>`
    if (t === 'br') return '<br/>'
    if (t === 'a') {
      const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
      let url = (m ? (m[2] ?? m[3] ?? m[4] ?? '') : '').trim()
      if (!/^(https?:|mailto:)/i.test(url)) url = ''
      const href = url ? ` href="${url.replace(/"/g, '%22')}"` : ''
      return `<a${href} target="_blank" rel="noopener noreferrer" style="color:#2563eb">`
    }
    if (t === 'ul') return '<ul style="margin:0 0 12px;padding-left:22px">'
    if (t === 'ol') return '<ol style="margin:0 0 12px;padding-left:22px">'
    if (t === 'li') return '<li style="margin:0 0 4px">'
    return `<${t}>` // b/strong/i/em/u/span/div/p — strip all attributes
  })
  return s
}

// Make a possibly-relative media path absolute for email clients. Block image
// URLs are stored as app-relative paths (/api/hub/marketing/email/media/...);
// at send time we prefix the site origin so inboxes can fetch them.
function absolutize(url: string, baseUrl: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (!baseUrl) return url
  return baseUrl.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url)
}

type RenderOpts = { baseUrl?: string; merge?: MergeContext }

function renderBlock(b: EmailBlock, baseUrl: string): string {
  const pad = (n: number) => `${Math.max(0, n)}px`
  switch (b.type) {
    case 'header': {
      const inner = b.logoUrl
        ? `<img src="${esc(absolutize(b.logoUrl, baseUrl))}" width="${b.logoWidth}" alt="logo" style="display:block;border:0;max-width:100%;height:auto;${b.align === 'center' ? 'margin:0 auto' : b.align === 'right' ? 'margin-left:auto' : ''}"/>`
        : ''
      return `<tr><td align="${b.align}" style="background:${esc(b.bg)};padding:${pad(b.padding)}">${inner}</td></tr>`
    }
    case 'text': {
      const html = sanitizeRichHtml(b.content)
      return `<tr><td align="${b.align}" style="background:${esc(b.bg)};padding:${pad(b.padding)};color:${esc(b.color)};font-family:Arial,Helvetica,sans-serif;font-size:${b.fontSize}px;line-height:1.55;text-align:${b.align}">${html}</td></tr>`
    }
    case 'image': {
      if (!b.url) return ''
      const img = `<img src="${esc(absolutize(b.url, baseUrl))}" alt="${esc(b.alt)}" width="${Math.round((b.width / 100) * 560)}" style="display:block;border:0;width:${b.width}%;max-width:100%;height:auto;${b.align === 'center' ? 'margin:0 auto' : b.align === 'right' ? 'margin-left:auto' : ''}"/>`
      const wrapped = b.linkUrl ? `<a href="${esc(b.linkUrl)}" target="_blank">${img}</a>` : img
      return `<tr><td align="${b.align}" style="background:${esc(b.bg)};padding:${pad(b.padding)}">${wrapped}</td></tr>`
    }
    case 'button': {
      return `<tr><td align="${b.align}" style="padding:${pad(b.padding)}"><a href="${esc(b.linkUrl)}" target="_blank" style="display:inline-block;background:${esc(b.bg)};color:${esc(b.color)};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:${b.radius}px">${esc(b.label)}</a></td></tr>`
    }
    case 'divider':
      return `<tr><td style="padding:${pad(b.padding)}"><div style="border-top:${b.thickness}px solid ${esc(b.color)};font-size:0;line-height:0">&nbsp;</div></td></tr>`
    case 'spacer':
      return `<tr><td style="height:${pad(b.height)};line-height:${pad(b.height)};font-size:0">&nbsp;</td></tr>`
  }
}

/**
 * Render a design to a complete, email-safe HTML document. Merge fields are
 * applied LAST (so {{first_name}} etc. resolve in text/button/subject); pass
 * opts.merge at send time, omit (or pass sample values) for preview. opts.baseUrl
 * makes image/logo paths absolute for inbox delivery.
 */
export function renderDesignToHtml(design: EmailDesign, opts: RenderOpts = {}): string {
  const d = normalizeDesign(design)
  const baseUrl = opts.baseUrl || ''
  const rows = d.blocks.map(b => renderBlock(b, baseUrl)).join('\n')
  const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${esc(d.settings.backgroundColor)}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${esc(d.settings.backgroundColor)}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="${d.settings.contentWidth}" cellpadding="0" cellspacing="0" style="max-width:${d.settings.contentWidth}px;width:100%;background:${esc(d.settings.contentBackgroundColor)};border-radius:8px;overflow:hidden">
${rows}
</table>
</td></tr>
</table>
</body></html>`
  return opts.merge ? renderMergeFields(doc, opts.merge) : doc
}
