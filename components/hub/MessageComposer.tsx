'use client'

import { useState, useRef } from 'react'

export default function MessageComposer({
  roomId,
  senderDisplayName,
}: {
  roomId: string
  senderDisplayName: string
}) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function send() {
    const trimmed = content.trim()
    if (!trimmed || sending) return

    setSending(true)
    setContent('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    await fetch('/api/hub/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, content: trimmed }),
    })

    setSending(false)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    // Auto-grow textarea up to ~6 lines
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 144) + 'px'
  }

  return (
    <div className="flex-none border-t border-gray-800 px-4 py-3">
      <div className="flex items-end gap-3 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 focus-within:border-[#2E7EB8] transition-colors">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${senderDisplayName}`}
          rows={1}
          disabled={sending}
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 resize-none outline-none leading-relaxed min-h-[24px] max-h-36"
        />
        <button
          onClick={send}
          disabled={!content.trim() || sending}
          className="flex-none w-8 h-8 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          title="Send (Enter)"
        >
          <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-gray-600 mt-1.5 px-1">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
