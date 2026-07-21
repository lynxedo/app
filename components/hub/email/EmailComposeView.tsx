'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui'
import EmailRichTextEditor, { type EmailEditorHandle } from './EmailRichTextEditor'
import EmailAttachments from './EmailAttachments'
import {
  parseRecipients,
  signatureToHtml,
  htmlToPlainText,
  extractDraftText,
  finalizeEmailHtml,
  type InboxAccount,
  type OutgoingAttachment,
} from './emailFormat'

/**
 * Full-page "New email" composer (main window, light theme) — replaces the old
 * sidebar modal. To / Cc / Subject + a TipTap rich body pre-loaded with the
 * user's signature, plus attachments. POSTs /api/hub/email/compose with
 * { account, to, cc?, subject, bodyHtml, body, attachments }; on success
 * navigates to the returned thread (when the API gives one) or back to the
 * inbox with a toast.
 */
export default function EmailComposeView({ emailSignature = '' }: { emailSignature?: string }) {
  const router = useRouter()
  const toast = useToast()
  const editorRef = useRef<EmailEditorHandle>(null)

  const sigHtml = signatureToHtml(emailSignature)
  const sigText = htmlToPlainText(sigHtml)
  // Empty typing area on top, then the (editable) signature after a blank line.
  const [initialHtml] = useState(() => (sigHtml ? `<p></p><p></p>${sigHtml}` : '<p></p>'))

  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountId, setAccountId] = useState('')

  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [draftText, setDraftText] = useState('')
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Load sendable accounts (same source as the sidebar).
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/email/accounts')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        const canCompose = !!data.flags?.canCompose
        const list: InboxAccount[] = ((data.accounts || []) as InboxAccount[]).filter(
          (a) => a.active && (a.account_type === 'personal' || canCompose)
        )
        setAccounts(list)
        setAccountId((prev) => prev || list[0]?.id || '')
      })
      .catch(() => {
        if (!cancelled) setAccounts([])
      })
      .finally(() => {
        if (!cancelled) setAccountsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
    if (!draftText.trim() && attachments.length === 0) {
      setError('Write a message')
      return
    }
    const html = editorRef.current?.getHTML() || ''
    const text = editorRef.current?.getText() || ''
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
          bodyHtml: finalizeEmailHtml(html),
          // Legacy plain-text fallback for the API.
          body: text,
          attachments,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || data.ok === false) {
        setError(data.error || 'Could not send — try again')
        return
      }
      toast.success('Email sent')
      if (data.threadId) router.push(`/hub/email/${data.threadId}`)
      else router.push('/hub/email')
    } catch {
      setError('Could not send — try again')
    } finally {
      setSending(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-white border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500'
  const labelCls = 'text-xs text-gray-500 block mb-1'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-100 text-gray-900">
      <div className="max-w-3xl mx-auto w-full sm:px-6 sm:py-6">
        <div className="bg-white sm:rounded-xl sm:border sm:border-gray-200 sm:shadow-sm flex flex-col min-h-[100dvh] sm:min-h-0">
          {/* Header */}
          <div
            data-hide-on-keyboard
            className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2 max-md:pl-14"
          >
            <h1 className="font-semibold text-gray-900">New email</h1>
            <button
              type="button"
              onClick={() => router.push('/hub/email')}
              disabled={sending}
              className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          <div className="px-4 py-4 space-y-3 flex-1">
            {accountsLoaded && accounts.length === 0 && (
              <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
                No connected mailbox to send from. Ask an admin to connect the shared inbox, or
                connect your personal work email in Settings.
              </div>
            )}

            {accounts.length > 1 && (
              <div>
                <label className={labelCls}>From</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={inputCls}
                  disabled={sending}
                >
                  {accounts.map((a) => (
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
                <label className="text-xs text-gray-500">To</label>
                {!showCc && (
                  <button
                    type="button"
                    onClick={() => setShowCc(true)}
                    className="text-[11px] text-gray-400 hover:text-gray-700"
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
                disabled={sending}
              />
            </div>

            {showCc && (
              <div>
                <label className={labelCls}>Cc</label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  className={inputCls}
                  disabled={sending}
                />
              </div>
            )}

            <div>
              <label className={labelCls}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className={inputCls}
                disabled={sending}
              />
            </div>

            <div>
              <label className={labelCls}>Message</label>
              <EmailRichTextEditor
                ref={editorRef}
                initialHtml={initialHtml}
                onChange={(_html, text) => setDraftText(extractDraftText(text, sigText))}
                disabled={sending}
                minHeightClass="min-h-[220px]"
                maxHeightClass="max-h-[52vh]"
              />
              {sigHtml && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Your signature is pre-filled below the message — edit it freely for this email.
                </p>
              )}
            </div>

            {error && <div className="text-xs text-red-600">{error}</div>}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-2 flex-wrap">
            <EmailAttachments
              attachments={attachments}
              onAdd={(a) => setAttachments((prev) => [...prev, a])}
              onRemove={(id) => setAttachments((prev) => prev.filter((x) => x.id !== id))}
              disabled={sending}
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !accountsLoaded || accounts.length === 0}
              className="text-sm px-5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
