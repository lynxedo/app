'use client'

import { forwardRef, useEffect, useImperativeHandle } from 'react'
import {
  useEditor,
  EditorContent,
  Mark,
  mergeAttributes,
  type Editor as TiptapEditor,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TipTapLink from '@tiptap/extension-link'

/**
 * Rich-text email body editor (TipTap) shared by the full-page composer, the
 * thread reply box, and the Settings signature editor. Light-themed on purpose —
 * email is authored on white regardless of the user's Hub theme.
 *
 * Only @tiptap/{react,starter-kit,extension-link,pm} are in package.json, so
 * Underline + font family/size are implemented as tiny local marks (inline
 * styles — exactly what outgoing email needs) instead of pulling in the
 * uninstalled @tiptap/extension-* packages.
 */

// <u> underline — StarterKit doesn't ship one.
const UnderlineMark = Mark.create({
  name: 'underline',
  parseHTML() {
    return [{ tag: 'u' }]
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['u', mergeAttributes(HTMLAttributes), 0]
  },
})

// A minimal TextStyle-style span mark carrying font-family / font-size inline
// styles (safe for email — recipients see the inline styles verbatim).
const FontStyleMark = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return {
      fontFamily: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.fontFamily || null,
        renderHTML: (attrs: { fontFamily?: string | null }) =>
          attrs.fontFamily ? { style: `font-family: ${attrs.fontFamily}` } : {},
      },
      fontSize: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.fontSize || null,
        renderHTML: (attrs: { fontSize?: string | null }) =>
          attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (el: HTMLElement | string) => {
          if (typeof el === 'string') return false
          return el.style?.fontFamily || el.style?.fontSize ? {} : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

// Email-safe font choices (system fonts every mail client has).
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
]

const FONT_SIZES: { label: string; value: string }[] = [
  { label: 'Small', value: '12px' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '18px' },
  { label: 'Huge', value: '24px' },
]

export type EmailEditorHandle = {
  getHTML: () => string
  getText: () => string
  /** Replace the whole document. Fires onChange. */
  setContent: (html: string, opts?: { focusStart?: boolean }) => void
  focusStart: () => void
}

export type EmailRichTextEditorProps = {
  /** Initial document HTML (used ONCE at mount — use the ref to replace later). */
  initialHtml?: string
  onChange?: (html: string, text: string) => void
  disabled?: boolean
  /** 'full' = the whole email toolbar; 'mini' = B/I/U + link (signature editor). */
  variant?: 'full' | 'mini'
  /** Tailwind min-height class for the editing surface. */
  minHeightClass?: string
  /** Tailwind max-height class for the scrolling surface. */
  maxHeightClass?: string
  /** Put the caret at the start once the editor is ready. */
  autoFocusStart?: boolean
}

const EmailRichTextEditor = forwardRef<EmailEditorHandle, EmailRichTextEditorProps>(
  function EmailRichTextEditor(
    {
      initialHtml = '',
      onChange,
      disabled = false,
      variant = 'full',
      minHeightClass = 'min-h-[140px]',
      maxHeightClass = 'max-h-[40vh]',
      autoFocusStart = false,
    },
    ref
  ) {
    const editor = useEditor({
      extensions: [
        StarterKit,
        TipTapLink.configure({ openOnClick: false, autolink: true }),
        UnderlineMark,
        FontStyleMark,
      ],
      content: initialHtml || '<p></p>',
      editable: !disabled,
      // Next renders this on the server first; without this TipTap warns about
      // a hydration mismatch (same as the admin AI knowledge editor).
      immediatelyRender: false,
      onUpdate: ({ editor }: { editor: TiptapEditor }) => {
        onChange?.(editor.getHTML(), editor.getText())
      },
      editorProps: {
        attributes: {
          class: `focus:outline-none ${minHeightClass} text-[16px] md:text-[15px] leading-relaxed text-gray-900`,
        },
      },
    })

    useEffect(() => {
      editor?.setEditable(!disabled)
    }, [editor, disabled])

    useEffect(() => {
      if (editor && autoFocusStart) {
        // Next tick so the surrounding layout has settled before we scroll/focus.
        const t = setTimeout(() => editor.commands.focus('start'), 0)
        return () => clearTimeout(t)
      }
    }, [editor, autoFocusStart])

    useImperativeHandle(
      ref,
      () => ({
        getHTML: () => editor?.getHTML() ?? '',
        getText: () => editor?.getText() ?? '',
        setContent: (html: string, opts?: { focusStart?: boolean }) => {
          if (!editor) return
          editor.commands.setContent(html || '<p></p>', true)
          if (opts?.focusStart) editor.commands.focus('start')
        },
        focusStart: () => {
          editor?.commands.focus('start')
        },
      }),
      [editor]
    )

    function addLink() {
      if (!editor) return
      const prev = (editor.getAttributes('link')?.href as string | undefined) || ''
      const url = window.prompt('Link URL', prev || 'https://')
      if (url === null) return
      const trimmed = url.trim()
      if (!trimmed || trimmed === 'https://') {
        editor.chain().focus().extendMarkRange('link').unsetMark('link').run()
        return
      }
      const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      editor.chain().focus().extendMarkRange('link').setMark('link', { href }).run()
    }

    const curFont = (editor?.getAttributes('textStyle')?.fontFamily as string | undefined) || ''
    const curSize = (editor?.getAttributes('textStyle')?.fontSize as string | undefined) || ''

    const btn =
      'px-2 py-1 rounded text-[13px] leading-none text-gray-600 hover:bg-gray-200/70 hover:text-gray-900 disabled:opacity-40'
    const btnActive = 'bg-gray-200 text-gray-900'
    const sel =
      'rounded border border-gray-300 bg-white px-1 py-[3px] text-[12px] text-gray-700 focus:outline-none'

    return (
      <div className="hub-email-rte">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-gray-200 bg-gray-50 px-1.5 py-1">
          <button
            type="button"
            title="Bold (⌘B)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleMark('bold').run()}
            disabled={!editor || disabled}
            className={`${btn} font-bold ${editor?.isActive('bold') ? btnActive : ''}`}
          >
            B
          </button>
          <button
            type="button"
            title="Italic (⌘I)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleMark('italic').run()}
            disabled={!editor || disabled}
            className={`${btn} italic ${editor?.isActive('italic') ? btnActive : ''}`}
          >
            I
          </button>
          <button
            type="button"
            title="Underline (⌘U)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleMark('underline').run()}
            disabled={!editor || disabled}
            className={`${btn} underline ${editor?.isActive('underline') ? btnActive : ''}`}
          >
            U
          </button>

          {variant === 'full' && (
            <>
              <span className="mx-1 h-5 w-px bg-gray-200" />
              <button
                type="button"
                title="Bulleted list"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                disabled={!editor || disabled}
                className={`${btn} ${editor?.isActive('bulletList') ? btnActive : ''}`}
              >
                • List
              </button>
              <button
                type="button"
                title="Numbered list"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                disabled={!editor || disabled}
                className={`${btn} ${editor?.isActive('orderedList') ? btnActive : ''}`}
              >
                1. List
              </button>
              <span className="mx-1 h-5 w-px bg-gray-200" />
              <select
                title="Font"
                value={curFont}
                onChange={(e) => {
                  const v = e.target.value
                  editor
                    ?.chain()
                    .focus()
                    .setMark('textStyle', { fontFamily: v || null })
                    .run()
                }}
                disabled={!editor || disabled}
                className={sel}
              >
                <option value="">Font</option>
                {FONT_FAMILIES.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                title="Text size"
                value={curSize}
                onChange={(e) => {
                  const v = e.target.value
                  editor
                    ?.chain()
                    .focus()
                    .setMark('textStyle', { fontSize: v || null })
                    .run()
                }}
                disabled={!editor || disabled}
                className={sel}
              >
                {FONT_SIZES.map((s) => (
                  <option key={s.label} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}

          <span className="mx-1 h-5 w-px bg-gray-200" />
          <button
            type="button"
            title="Add link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addLink}
            disabled={!editor || disabled}
            className={`${btn} ${editor?.isActive('link') ? btnActive : ''}`}
          >
            🔗
          </button>
          {variant === 'full' && (
            <button
              type="button"
              title="Clear formatting"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
              disabled={!editor || disabled}
              className={btn}
            >
              ⌫ Aa
            </button>
          )}
        </div>

        {/* Editing surface */}
        <div
          className={`rounded-b-lg border border-t-0 border-gray-200 bg-white px-3 py-2 overflow-y-auto ${maxHeightClass} ${
            disabled ? 'opacity-60' : ''
          }`}
        >
          <EditorContent editor={editor} />
        </div>

        <style jsx global>{`
          .hub-email-rte a {
            color: #2563eb;
            text-decoration: underline;
          }
          .hub-email-rte .ProseMirror p {
            margin: 0 0 8px;
          }
          .hub-email-rte .ProseMirror p:last-child {
            margin-bottom: 0;
          }
          .hub-email-rte .ProseMirror ul {
            list-style: disc;
            margin: 0 0 10px;
            padding-left: 22px;
          }
          .hub-email-rte .ProseMirror ol {
            list-style: decimal;
            margin: 0 0 10px;
            padding-left: 22px;
          }
          .hub-email-rte .ProseMirror li {
            margin: 0 0 4px;
          }
          .hub-email-rte .ProseMirror blockquote {
            border-left: 3px solid #d1d5db;
            margin: 8px 0 8px 4px;
            padding-left: 12px;
            color: #6b7280;
          }
          .hub-email-rte .ProseMirror h1,
          .hub-email-rte .ProseMirror h2,
          .hub-email-rte .ProseMirror h3 {
            font-weight: 600;
            margin: 10px 0 6px;
          }
        `}</style>
      </div>
    )
  }
)

export default EmailRichTextEditor
