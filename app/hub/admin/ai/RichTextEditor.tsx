'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { useEffect } from 'react'

// A Word-style rich-text editor for knowledge docs. The human sees formatted
// text (headings, bold, bullet lists) with a toolbar — never raw Markdown — but
// the value in/out is Markdown, so the AI keeps reading the same clean Markdown
// it always has. `value` is Markdown; `onChange` receives Markdown.
export default function RichTextEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (markdown: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Markdown.configure({ html: false, linkify: true, breaks: true }),
    ],
    content: value,
    // Next renders this on the server first; without this TipTap warns about a
    // hydration mismatch.
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown())
    },
    editorProps: {
      attributes: {
        class:
          'ProseMirror focus:outline-none min-h-[280px] [&_h1]:text-xl [&_h1]:font-medium [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_a]:text-brand [&_a]:underline [&_strong]:font-semibold [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-white/70',
      },
    },
  })

  // Re-sync when the doc being edited changes from the outside (switching docs,
  // "Load default", toggling back from Markdown-source mode). Guard against loops
  // by only replacing content when it actually differs from what's shown.
  useEffect(() => {
    if (!editor) return
    const current = editor.storage.markdown.getMarkdown()
    if (value !== current) {
      editor.commands.setContent(value, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  return (
    <div className="bg-gray-900 border border-white/15 rounded">
      <Toolbar editor={editor} />
      <div className="max-h-[520px] overflow-y-auto px-3 py-2 text-sm leading-relaxed">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const Btn = ({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void
    active?: boolean
    title: string
    children: React.ReactNode
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2 py-1 rounded text-sm min-w-[28px] ${
        active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-white/10 px-2 py-1">
      <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-bold">B</span>
      </Btn>
      <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic">I</span>
      </Btn>
      <span className="w-px h-5 bg-white/10 mx-1" />
      <Btn title="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        H2
      </Btn>
      <Btn title="Subheading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        H3
      </Btn>
      <span className="w-px h-5 bg-white/10 mx-1" />
      <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        • List
      </Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1. List
      </Btn>
      <span className="w-px h-5 bg-white/10 mx-1" />
      <Btn
        title="Link"
        active={editor.isActive('link')}
        onClick={() => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run()
            return
          }
          const url = window.prompt('Link URL')
          if (url) editor.chain().focus().setLink({ href: url }).run()
        }}
      >
        Link
      </Btn>
      <span className="w-px h-5 bg-white/10 mx-1" />
      <Btn title="Undo" onClick={() => editor.chain().focus().undo().run()}>
        ↶
      </Btn>
      <Btn title="Redo" onClick={() => editor.chain().focus().redo().run()}>
        ↷
      </Btn>
    </div>
  )
}
