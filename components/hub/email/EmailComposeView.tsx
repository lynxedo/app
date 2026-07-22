'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast, Spinner } from '@/components/ui'
import EmailRichTextEditor, { type EmailEditorHandle } from './EmailRichTextEditor'
import EmailAttachments from './EmailAttachments'
import ScheduleSendMenu from './ScheduleSendMenu'
import {
  parseRecipients,
  signatureToHtml,
  htmlToPlainText,
  extractDraftText,
  finalizeEmailHtml,
  formatRecipientList,
  LIGHT_SURFACE_STYLE,
  type InboxAccount,
  type OutgoingAttachment,
  type EmailDraft,
} from './emailFormat'

/**
 * Full-page "New email" composer (main window, light theme). To / Cc / Subject +
 * a TipTap rich body pre-loaded with the user's signature, plus attachments.
 *
 * Drafts (Step 2a): the composer AUTO-SAVES to /api/hub/email/drafts as you type
 * (debounced) so an unfinished email survives closing the window; opening
 * /hub/email/compose?draft=<id> restores it. A successful send deletes the draft.
 *
 * POSTs /api/hub/email/compose on send; navigates to the returned thread (when the
 * API gives one) or back to the inbox with a toast.
 */
export default function EmailComposeView({
  emailSignature = '',
  draftId,
}: {
  emailSignature?: string
  draftId?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const editorRef = useRef<EmailEditorHandle>(null)

  const sigHtml = signatureToHtml(emailSignature)
  const sigText = htmlToPlainText(sigHtml)
  // Empty typing area on top, then the (editable) signature after a blank line.
  const defaultInitialHtml = useMemo(
    () => (sigHtml ? `<p></p><p></p>${sigHtml}` : '<p></p>'),
    [sigHtml]
  )

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

  // Draft persistence.
  const [draftReady, setDraftReady] = useState(!draftId) // wait for the draft to load first
  const [restoredHtml, setRestoredHtml] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedDraftIdRef = useRef<string | null>(draftId || null)
  const savingRef = useRef(false)

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

  // Restore an existing draft (?draft=<id>) before mounting the editor.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    fetch(`/api/hub/email/drafts/${draftId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        const d = data.draft as EmailDraft | undefined
        if (d) {
          setAccountId(d.account_id)
          setTo(formatRecipientList(d.to_recipients))
          if (d.cc_recipients && d.cc_recipients.length > 0) {
            setCc(formatRecipientList(d.cc_recipients))
            setShowCc(true)
          }
          setSubject(d.subject || '')
          setAttachments(Array.isArray(d.attachments) ? d.attachments : [])
          setRestoredHtml(d.body_html || defaultInitialHtml)
          savedDraftIdRef.current = d.id
        }
      })
      .catch(() => {
        /* draft gone → start fresh */
      })
      .finally(() => {
        if (!cancelled) setDraftReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [draftId, defaultInitialHtml])

  const hasContent =
    to.trim().length > 0 ||
    (showCc && cc.trim().length > 0) ||
    subject.trim().length > 0 ||
    draftText.trim().length > 0 ||
    attachments.length > 0

  async function saveDraft() {
    if (savingRef.current || !accountId) return
    savingRef.current = true
    setDraftStatus('saving')
    try {
      const html = editorRef.current?.getHTML() || ''
      const res = await fetch('/api/hub/email/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: savedDraftIdRef.current,
          account: accountId,
          kind: 'new',
          to: parseRecipients(to),
          cc: showCc ? parseRecipients(cc) : [],
          subject: subject.trim(),
          bodyHtml: html,
          attachments,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.id) {
        savedDraftIdRef.current = data.id
        setDraftStatus('saved')
      } else {
        setDraftStatus('idle')
      }
    } catch {
      setDraftStatus('idle')
    } finally {
      savingRef.current = false
    }
  }

  // Debounced auto-save while there's meaningful content and we're not sending.
  useEffect(() => {
    if (!draftReady || sending || !accountId || !hasContent) return
    const t = setTimeout(() => {
      void saveDraft()
    }, 1800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, showCc, subject, draftText, attachments, accountId, draftReady, sending, hasContent])

  async function discardDraft() {
    const id = savedDraftIdRef.current
    if (!id) return
    savedDraftIdRef.current = null
    try {
      await fetch(`/api/hub/email/drafts/${id}`, { method: 'DELETE' })
    } catch {
      /* best-effort */
    }
  }

  // Send now, or schedule when scheduleAt (ISO) is given.
  async function submit(scheduleAt?: string) {
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
          scheduleAt,
          // The working draft becomes the scheduled row when scheduling.
          draftId: savedDraftIdRef.current,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || data.ok === false) {
        setError(data.error || 'Could not send — try again')
        setSending(false)
        return
      }
      if (data.scheduled) {
        savedDraftIdRef.current = null // converted to a scheduled row — don't re-save/delete it
        toast.success(
          `Scheduled — sends ${new Date(scheduleAt || data.scheduledAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}`
        )
        router.push('/hub/email')
        return
      }
      await discardDraft() // the message sent — drop the draft
      toast.success('Email sent')
      if (data.threadId) router.push(`/hub/email/${data.threadId}`)
      else router.push('/hub/email')
    } catch {
      setError('Could not send — try again')
      setSending(false)
    }
  }
  const send = () => submit()

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-white border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500'
  const labelCls = 'text-xs text-gray-500 block mb-1'

  return (
    <div
      className="email-light-surface flex-1 min-h-0 overflow-y-auto bg-gray-100 text-gray-900"
      style={LIGHT_SURFACE_STYLE}
    >
      <div className="max-w-3xl mx-auto w-full sm:px-6 sm:py-6">
        <div className="bg-white sm:rounded-xl sm:border sm:border-gray-200 sm:shadow-sm flex flex-col min-h-[100dvh] sm:min-h-0">
          {/* Header */}
          <div
            data-hide-on-keyboard
            className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2 max-md:pl-14"
          >
            <h1 className="font-semibold text-gray-900">New email</h1>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-gray-400" aria-live="polite">
                {draftStatus === 'saving' ? 'Saving…' : draftStatus === 'saved' ? 'Draft saved' : ''}
              </span>
              <button
                type="button"
                onClick={() => router.push('/hub/email')}
                disabled={sending}
                className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 disabled:opacity-50"
                title={savedDraftIdRef.current ? 'Your draft is saved' : undefined}
              >
                {savedDraftIdRef.current ? 'Close' : 'Cancel'}
              </button>
            </div>
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
              {draftReady ? (
                <EmailRichTextEditor
                  ref={editorRef}
                  initialHtml={restoredHtml ?? defaultInitialHtml}
                  onChange={(_html, text) => setDraftText(extractDraftText(text, sigText))}
                  disabled={sending}
                  minHeightClass="min-h-[220px]"
                  maxHeightClass="max-h-[52vh]"
                />
              ) : (
                <div className="min-h-[220px] flex items-center justify-center">
                  <Spinner size={6} />
                </div>
              )}
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
            <div className="flex items-center gap-2">
              <ScheduleSendMenu
                disabled={sending || !accountsLoaded || accounts.length === 0}
                onSchedule={(iso) => submit(iso)}
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !accountsLoaded || accounts.length === 0}
                className="text-sm px-5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[#fff] font-medium disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
