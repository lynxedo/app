'use client'

import { useState } from 'react'
import { Modal, Button, useToast } from '@/components/ui'
import { parseRecipients, plainToHtml, type InboxAccount } from './emailFormat'

/**
 * New-email composer. Pick the sending account (shared / personal), enter
 * recipients + subject + body, and POST /api/hub/email/compose. Body is plain
 * text converted to minimal HTML on send. Closes on success.
 */
export default function EmailComposeModal({
  accounts,
  onClose,
  onSent,
}: {
  accounts: InboxAccount[]
  onClose: () => void
  onSent?: () => void
}) {
  const toast = useToast()
  const sendable = accounts.filter((a) => a.active)
  const [accountId, setAccountId] = useState<string>(sendable[0]?.id || '')
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setError('')
    const toList = parseRecipients(to)
    if (!accountId) {
      setError('Pick an account to send from')
      return
    }
    if (toList.length === 0) {
      setError('Add at least one recipient')
      return
    }
    if (!subject.trim()) {
      setError('Add a subject')
      return
    }
    if (!body.trim()) {
      setError('Write a message')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/hub/email/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: accountId,
          to: toList,
          cc: showCc ? parseRecipients(cc) : undefined,
          subject: subject.trim(),
          bodyHtml: plainToHtml(body),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || data.ok === false) {
        setError(data.error || 'Could not send — try again')
        return
      }
      toast.success('Email sent')
      onSent?.()
      onClose()
    } catch {
      setError('Could not send — try again')
    } finally {
      setSending(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/25'

  return (
    <Modal
      open
      onClose={onClose}
      title="New email"
      maxWidth="max-w-2xl"
      fullScreenOnMobile
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} loading={sending}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {sendable.length > 1 && (
          <div>
            <label className="text-xs text-white/50 block mb-1">From</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={inputCls}
            >
              {sendable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name ? `${a.display_name} · ` : ''}
                  {a.email_address}
                  {a.account_type === 'shared' ? ' (shared)' : ' (personal)'}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-white/50">To</label>
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="text-[11px] text-white/50 hover:text-white"
              >
                + Cc
              </button>
            )}
          </div>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com, another@example.com"
            className={inputCls}
            autoFocus
          />
        </div>
        {showCc && (
          <div>
            <label className="text-xs text-white/50 block mb-1">Cc</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label className="text-xs text-white/50 block mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-xs text-white/50 block mb-1">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
            rows={10}
            className={`${inputCls} resize-none min-h-[180px]`}
          />
        </div>
        {error && <div className="text-xs text-[var(--t-tint-danger)]">{error}</div>}
      </div>
    </Modal>
  )
}
