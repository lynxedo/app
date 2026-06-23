'use client'

import { useEffect, useRef, useState } from 'react'
import EmojiPicker from '@/components/hub/EmojiPicker'
import { MERGE_FIELDS } from '@/lib/email-markdown'

// WYSIWYG editor for email Text blocks. A contentEditable surface + a toolbar:
// Bold/Italic/Underline (also ⌘B/⌘I/⌘U natively), bullet + numbered lists, link,
// emoji picker, and merge-field insert. Output is HTML (sanitized + inline-styled
// for email at render time by lib/email-blocks). We force tag-based formatting
// (styleWithCSS = false) so Bold → <b>, Italic → <i> etc., which the email
// sanitizer's allowlist keeps.
export default function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [active, setActive] = useState({ bold: false, italic: false, underline: false })

  // Initialize the editable content ONCE on mount. We never write innerHTML back
  // from props while editing — that would reset the caret on every keystroke.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value || ''
    try { document.execCommand('styleWithCSS', false, 'false') } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function emit() { if (ref.current) onChange(ref.current.innerHTML) }

  function saveSel() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && ref.current && ref.current.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }
  function restoreSel() {
    const sel = window.getSelection()
    if (sel && savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
  }
  function refreshActive() {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      })
    } catch { /* noop */ }
  }

  function exec(cmd: string, val?: string) {
    ref.current?.focus()
    restoreSel()
    try { document.execCommand('styleWithCSS', false, 'false') } catch { /* noop */ }
    document.execCommand(cmd, false, val)
    emit(); saveSel(); refreshActive()
  }

  function insertText(text: string) {
    ref.current?.focus()
    restoreSel()
    document.execCommand('insertText', false, text)
    emit(); saveSel()
  }

  function addLink() {
    saveSel()
    const url = window.prompt('Link URL', 'https://')
    if (!url) return
    exec('createLink', url)
  }

  const tbBtn = 'rounded px-2 py-1 text-sm text-gray-200 hover:bg-gray-700'
  const tbActive = 'bg-gray-700'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-gray-700 bg-gray-800 px-1.5 py-1">
        <button type="button" title="Bold (⌘B)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}
          className={tbBtn + ' font-bold ' + (active.bold ? tbActive : '')}>B</button>
        <button type="button" title="Italic (⌘I)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}
          className={tbBtn + ' italic ' + (active.italic ? tbActive : '')}>I</button>
        <button type="button" title="Underline (⌘U)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}
          className={tbBtn + ' underline ' + (active.underline ? tbActive : '')}>U</button>
        <span className="mx-1 h-5 w-px bg-gray-700" />
        <button type="button" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} className={tbBtn}>• List</button>
        <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} className={tbBtn}>1. List</button>
        <button type="button" title="Add link" onMouseDown={(e) => e.preventDefault()} onClick={addLink} className={tbBtn}>🔗</button>
        <span className="relative inline-flex">
          <button type="button" title="Emoji" onMouseDown={(e) => { e.preventDefault(); saveSel() }} onClick={() => setEmojiOpen((v) => !v)} className={tbBtn}>😊</button>
          {emojiOpen && (
            <EmojiPicker align="left" onClose={() => setEmojiOpen(false)} onSelect={(e) => insertText(e)} />
          )}
        </span>
        <span className="mx-1 h-5 w-px bg-gray-700" />
        <span className="text-[11px] text-gray-500 px-1">Insert:</span>
        {MERGE_FIELDS.map((f) => (
          <button key={f} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertText(`{{${f}}}`)}
            className="text-[11px] rounded bg-gray-700/60 border border-gray-600 px-1.5 py-0.5 text-gray-200 hover:bg-gray-700">{`{{${f}}}`}</button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onKeyUp={() => { saveSel(); refreshActive() }}
        onMouseUp={() => { saveSel(); refreshActive() }}
        onBlur={() => { saveSel(); emit() }}
        className="email-rte min-h-[140px] max-h-[320px] overflow-y-auto rounded-b-lg border border-t-0 border-gray-700 bg-white px-3 py-2 text-[15px] leading-relaxed text-gray-900 outline-none"
      />
      <style jsx global>{`
        .email-rte a { color: #2563eb; }
        .email-rte ul { list-style: disc; margin: 0 0 12px; padding-left: 22px; }
        .email-rte ol { list-style: decimal; margin: 0 0 12px; padding-left: 22px; }
        .email-rte li { margin: 0 0 4px; }
      `}</style>
    </div>
  )
}
