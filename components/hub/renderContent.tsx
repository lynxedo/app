import type { ReactNode } from 'react'
import type { HubUser } from './MessageFeed'

// Slack-flavored inline markdown:
//   *bold*  _italic_  ~strike~  `code`
// Plus line-leading `> ` for blockquote, and @mention / @room highlighting.
// URLs (http/https) are protected from underscore parsing so e.g.
// https://example.com/foo_bar_baz doesn't render with italics in the middle.

const INLINE_RE =
  /(https?:\/\/\S+)|(`[^`\n]+`)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)|(@\w+)/g

function renderMention(raw: string, hubUsers: HubUser[], key: string): ReactNode {
  const name = raw.slice(1).toLowerCase()
  if (name === 'room') {
    return (
      <span key={key} className="bg-yellow-500/20 text-yellow-300 rounded px-0.5 font-medium">
        {raw}
      </span>
    )
  }
  const isUser = hubUsers.some(u => u.display_name.split(' ')[0].toLowerCase() === name)
  if (isUser) {
    return (
      <span key={key} className="bg-[#2E7EB8]/20 text-[#6FB3E8] rounded px-0.5">
        {raw}
      </span>
    )
  }
  return raw
}

function renderInline(text: string, hubUsers: HubUser[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let lastIndex = 0
  let i = 0
  // Fresh regex each call — INLINE_RE has /g state we don't want to share.
  const re = new RegExp(INLINE_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      out.push(text.slice(lastIndex, m.index))
    }
    const [whole, url, code, bold, italic, strike, mention] = m
    const key = `${keyPrefix}-${i++}`

    if (url) {
      out.push(url)
    } else if (code) {
      out.push(
        <code
          key={key}
          className="bg-gray-700/80 text-gray-100 rounded px-1 py-0.5 text-[0.9em] font-mono"
        >
          {code.slice(1, -1)}
        </code>,
      )
    } else if (bold) {
      out.push(
        <strong key={key} className="font-semibold">
          {renderInline(bold.slice(1, -1), hubUsers, key)}
        </strong>,
      )
    } else if (italic) {
      out.push(
        <em key={key} className="italic">
          {renderInline(italic.slice(1, -1), hubUsers, key)}
        </em>,
      )
    } else if (strike) {
      out.push(
        <span key={key} className="line-through">
          {renderInline(strike.slice(1, -1), hubUsers, key)}
        </span>,
      )
    } else if (mention) {
      out.push(renderMention(mention, hubUsers, key))
    }

    lastIndex = m.index + whole.length
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex))
  }
  return out
}

export function renderContent(content: string, hubUsers: HubUser[]): ReactNode {
  const lines = content.split('\n')
  const out: ReactNode[] = []

  lines.forEach((line, lineIdx) => {
    const isQuote = line.startsWith('> ')
    const text = isQuote ? line.slice(2) : line
    const inline = renderInline(text, hubUsers, `l${lineIdx}`)

    if (isQuote) {
      out.push(
        <span
          key={`l${lineIdx}`}
          className="border-l-2 border-gray-500 pl-2 text-gray-400 inline-block"
        >
          {inline.length > 0 ? inline : ' '}
        </span>,
      )
    } else {
      out.push(<span key={`l${lineIdx}`}>{inline}</span>)
    }

    if (lineIdx < lines.length - 1) {
      out.push('\n')
    }
  })

  return out
}
