'use client'

import { useState, useRef, useEffect } from 'react'

type Message = {
  id: string
  direction: 'outbound' | 'inbound'
  body: string
  status: string
  captivated_sent: boolean
  created_at: string
  sent_by: string | null
  sender?: { id: string; display_name: string } | null
}

type Contact = {
  id: string
  name: string
  phone: string
  email: string | null
  do_not_text: boolean
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function formatTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

const MAX_SMS_CHARS = 160

export default function ClientConversation({
  contact: initialContact,
  messages: initialMessages,
}: {
  contact: Contact
  messages: Message[]
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setSendError('')

    // Optimistic UI
    const tempId = `temp-${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      direction: 'outbound',
      body,
      status: 'sending',
      captivated_sent: false,
      created_at: new Date().toISOString(),
      sent_by: null,
      sender: null,
    }
    setMessages(prev => [...prev, optimistic])
    setText('')

    const res = await fetch(`/api/hub/clients/${initialContact.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: body }),
    })
    const data = await res.json()
    setSending(false)

    if (!res.ok) {
      setSendError(data.error ?? 'Failed to send')
      setMessages(prev => prev.filter(m => m.id !== tempId))
      return
    }

    // Replace optimistic with real message
    setMessages(prev => prev.map(m => m.id === tempId ? { ...data } : m))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const segmentCount = Math.ceil((text.length || 1) / MAX_SMS_CHARS)
  const charsInSegment = text.length % MAX_SMS_CHARS || (text.length > 0 ? MAX_SMS_CHARS : 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div data-hide-on-keyboard className="flex-none px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#1A3D5C] flex items-center justify-center text-sm font-bold text-white flex-none">
          {initialContact.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm truncate">{initialContact.name}</div>
          <div className="text-xs text-gray-400">{formatPhone(initialContact.phone)}</div>
        </div>
        {/* Call button placeholder — Phase 3 */}
        <a
          href={`tel:${initialContact.phone.replace(/\D/g, '')}`}
          className="flex-none p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          title="Call this number"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
          </svg>
        </a>
      </div>

      {/* Phase 1 limitation notice */}
      {!noticeDismissed && (
        <div className="flex-none mx-4 mt-3 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
          <span className="text-amber-400 text-sm flex-none mt-0.5">⚠</span>
          <p className="text-xs text-amber-200/80 flex-1">
            Replies will appear in <strong className="text-amber-200">Captivated</strong>, not here, until full SMS is set up.
          </p>
          <button
            onClick={() => setNoticeDismissed(true)}
            className="text-amber-400/50 hover:text-amber-400 transition-colors flex-none text-xs leading-none mt-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-500">No messages yet — send one below</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[75%] space-y-1">
              <div
                className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.direction === 'outbound'
                    ? 'bg-brand text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                } ${msg.status === 'sending' ? 'opacity-60' : ''}`}
              >
                {msg.body}
              </div>
              <div className={`flex items-center gap-1.5 text-xs text-gray-500 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <span>{formatTime(msg.created_at)}</span>
                {msg.direction === 'outbound' && (
                  <span>
                    {msg.status === 'sending' && '· Sending…'}
                    {msg.status === 'sent' && msg.captivated_sent && '· Sent'}
                    {msg.status === 'failed' && <span className="text-red-400">· Failed</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Send error */}
      {sendError && (
        <div className="flex-none mx-4 mb-2 text-xs text-red-400 text-center">{sendError}</div>
      )}

      {/* Do-not-text warning */}
      {initialContact.do_not_text && (
        <div className="flex-none mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-xs text-red-300 text-center">This contact is marked do-not-text</p>
        </div>
      )}

      {/* Composer */}
      <div className="flex-none border-t border-gray-800 px-3 py-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-gray-800 border border-gray-700 rounded-2xl px-4 py-2.5 focus-within:border-brand transition-colors">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              disabled={sending || initialContact.do_not_text}
              className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none resize-none max-h-32 disabled:opacity-40"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!text.trim() || sending || initialContact.do_not_text}
            className="flex-none w-9 h-9 rounded-full bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            title="Send (Enter)"
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
        {/* Character counter */}
        {text.length > 0 && (
          <div className="flex justify-end mt-1 pr-11">
            <span className={`text-xs ${text.length > MAX_SMS_CHARS ? 'text-amber-400' : 'text-gray-500'}`}>
              {charsInSegment}/{MAX_SMS_CHARS}
              {segmentCount > 1 && ` (${segmentCount} segments)`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
