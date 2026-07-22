'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui'
import EmailRichTextEditor, { type EmailEditorHandle } from './EmailRichTextEditor'
import EmailAttachments from './EmailAttachments'
import ScheduleSendMenu from './ScheduleSendMenu'
import {
  messageTime,
  signatureToHtml,
  htmlToPlainText,
  textToHtmlParagraphs,
  extractDraftText,
  finalizeEmailHtml,
  parseRecipients,
  formatWho,
  formatRecipientList,
  buildForwardQuoteHeaderHtml,
  fwdSubject,
  reSubjectDisplay,
  type EmailThread,
  type EmailMessage,
  type EmailDraft,
  type OutgoingAttachment,
  type InboxAccount,
  type MailRecipient,
} from './emailFormat'

export type ComposerMode = 'reply' | 'reply-all' | 'forward'

type SuggestTone = 'professional' | 'friendly' | 'brief'
const SUGGEST_TONES: { value: SuggestTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'brief', label: 'Brief' },
]

/**
 * Action-driven, Outlook-style composer for Reply / Reply All / Forward.
 * Replaces the thread reader for the main pane (not a split view) — mounted
 * only while EmailThreadView has a composerMode set.
 *
 * Reply/Reply All post to POST /threads/{id}/send, which always replies to a
 * single server-computed recipient (the latest inbound message's sender) and
 * only accepts an explicit `cc` — there is no `to` override. So "To" here is
 * DISPLAY-ONLY for those two modes (editing it would silently do nothing);
 * "Cc" is a real editable field wired into the payload. Forward has no existing
 * thread to reply onto, so it goes through POST /compose instead, with a real
 * editable To.
 */
export default function EmailReplyComposer({
  mode,
  threadId,
  thread,
  messages,
  emailSignature,
  existingDraft,
  onCancel,
  onReplySent,
}: {
  mode: ComposerMode
  threadId: string
  thread: EmailThread
  messages: EmailMessage[]
  emailSignature: string
  existingDraft?: EmailDraft | null
  onCancel: () => void
  onReplySent: () => Promise<void> | void
}) {
  const router = useRouter()
  const toast = useToast()
  const editorRef = useRef<EmailEditorHandle>(null)
  // True while WE are rewriting the document (prefill / AI apply) — so onChange
  // knows the edit didn't come from the user's keyboard.
  const programmatic = useRef(false)

  const sigHtml = signatureToHtml(emailSignature)
  const sigText = htmlToPlainText(sigHtml)
  // A saved draft for THIS thread whose mode matches → restore its content on mount.
  const restore = existingDraft && existingDraft.kind === mode ? existingDraft : null
  // One draft row per (thread, user): seed the id from any existing draft so
  // auto-saves update it in place (kept even if the opened mode differs).
  const draftIdRef = useRef<string | null>(existingDraft?.id ?? null)
  const savingRef = useRef(false)
  const [initialHtml] = useState(() =>
    restore?.body_html ? restore.body_html : sigHtml ? `<p></p><p></p>${sigHtml}` : '<p></p>'
  )

  // The message this composer quotes + acts on: for reply/reply-all, the latest
  // INBOUND message with a real sender — matching sendInboxReply's own recipient
  // resolution server-side exactly, so "To" always shows the truth. For forward,
  // just the thread's latest message (no per-message "forward this one" picker
  // in v1 — keeps scope tight).
  const replyTarget: EmailMessage | null =
    [...messages].reverse().find((m) => m.direction === 'inbound' && m.from_email) || null
  const forwardTarget: EmailMessage | null = messages.length > 0 ? messages[messages.length - 1] : null
  const referenceMessage = mode === 'forward' ? forwardTarget : replyTarget

  // Sendable accounts — used for Forward's From picker, to resolve a real
  // "Sends as {address}" label when possible, and to filter our own mailbox out
  // of the Reply All Cc prefill.
  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountId, setAccountId] = useState('')

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
        setAccountId((prev) => prev || thread.account_id || list[0]?.id || '')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendAsAccount = accounts.find((a) => a.id === (thread.account_id || '')) || null

  // To: reply/reply-all show the single recipient the send WILL actually use
  // (display only — see the module comment above); forward is a real input.
  const toDisplay = replyTarget
    ? formatWho(replyTarget.from_name, replyTarget.from_email)
    : formatWho(thread.from_name, thread.from_email)

  const [to, setTo] = useState(() => (restore ? formatRecipientList(restore.to_recipients) : '')) // forward only
  const [ccShown, setCcShown] = useState(mode === 'reply-all' || (!!restore && restore.cc_recipients.length > 0))
  const [cc, setCc] = useState(() => (restore ? formatRecipientList(restore.cc_recipients) : ''))
  // Distinguishes the auto-seeded Reply All Cc from something the user actually
  // typed — so backing out of a freshly-opened Reply All without touching
  // anything doesn't trigger a spurious "discard this draft?" confirm.
  const [ccTouched, setCcTouched] = useState(false)

  // Reply All's Cc prefill: everyone on the reply-target message's To + Cc,
  // minus that message's own sender (already the "To") and minus our own
  // mailbox address(es) — seeded ONCE, the render after `accounts` finishes
  // loading (adjusted during render, React's recommended pattern for "derive
  // state once an async condition becomes true," rather than a useEffect that
  // would set state synchronously in its body and cost an extra render pass).
  // The `ccSeeded` guard means the user's own edits afterward are never clobbered.
  const [ccSeeded, setCcSeeded] = useState(false)
  if (mode === 'reply-all' && replyTarget && accountsLoaded && !ccSeeded && !restore) {
    setCcSeeded(true)
    const selfAddresses = new Set(accounts.map((a) => (a.email_address || '').toLowerCase()))
    const primary = (replyTarget.from_email || '').toLowerCase()
    const pool = [...(replyTarget.to_recipients || []), ...(replyTarget.cc_recipients || [])]
    const seen = new Set<string>()
    const extras: MailRecipient[] = []
    for (const r of pool) {
      const e = (r.email || '').toLowerCase()
      if (!e || e === primary || seen.has(e) || selfAddresses.has(e)) continue
      seen.add(e)
      extras.push(r)
    }
    setCc(formatRecipientList(extras))
  }

  const [subject, setSubject] = useState(() =>
    restore?.subject != null
      ? restore.subject
      : mode === 'forward'
      ? fwdSubject(thread.subject)
      : reSubjectDisplay(thread.subject)
  )

  const [draftText, setDraftText] = useState('')
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>(() =>
    restore && Array.isArray(restore.attachments) ? restore.attachments : []
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // AI helpers — operate ONLY on the top reply editor content. Unlike the old
  // inline ReplyComposer, there's no quoted tail living inside the editor
  // anymore (the quote is a separate block below, never edited), so rebuilding
  // the top is just "new text + signature" — no tail to preserve.
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [polishLoading, setPolishLoading] = useState(false)
  const [polishUndo, setPolishUndo] = useState<string | null>(null)

  function applyContent(html: string, focusStart = true) {
    programmatic.current = true
    editorRef.current?.setContent(html, { focusStart })
    programmatic.current = false
  }

  function onEditorChange(_html: string, text: string) {
    setDraftText(extractDraftText(text, sigText))
    if (!programmatic.current) setPolishUndo(null)
  }

  function rebuildTop(topHtml: string) {
    const sig = sigHtml ? `<p></p>${sigHtml}` : ''
    applyContent(`${topHtml}${sig}`)
  }

  async function runSuggestReply(tone: SuggestTone) {
    setSuggestOpen(false)
    if (suggestLoading) return
    setSuggestLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/suggest-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.reply) {
        setError(data.error || "Couldn't generate a suggestion — try again")
        return
      }
      const reply: string = data.reply
      if (draftText.trim().length > 5) {
        const ok =
          typeof window !== 'undefined' &&
          window.confirm('Replace your current draft with the suggestion?')
        if (!ok) return
      }
      setPolishUndo(null)
      rebuildTop(textToHtmlParagraphs(reply))
    } catch {
      setError("Couldn't generate a suggestion — try again")
    } finally {
      setSuggestLoading(false)
    }
  }

  async function runPolish() {
    const draft = draftText.trim()
    if (polishLoading || !draft) return
    setPolishLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/refine-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error || !data.refined) {
        setError(data.error || "Couldn't polish the draft — try again")
        return
      }
      const refined: string = data.refined
      if (refined.trim() === draft) return
      const previous = editorRef.current?.getHTML() || ''
      rebuildTop(textToHtmlParagraphs(refined))
      setPolishUndo(previous)
    } catch {
      setError("Couldn't polish the draft — try again")
    } finally {
      setPolishLoading(false)
    }
  }

  function undoPolish() {
    if (polishUndo === null) return
    applyContent(polishUndo)
    setPolishUndo(null)
  }

  function isDirty(): boolean {
    if (draftText.trim().length > 0 || attachments.length > 0) return true
    if (mode === 'forward' && to.trim().length > 0) return true
    if (ccTouched && cc.trim().length > 0) return true
    return false
  }

  // Persist the in-progress reply so it survives closing the composer (resumes
  // when the thread is reopened). Best-effort; one draft row per thread+user.
  async function saveDraft() {
    if (savingRef.current) return
    savingRef.current = true
    try {
      const html = editorRef.current?.getHTML() || ''
      const res = await fetch('/api/hub/email/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftIdRef.current,
          account: thread.account_id || 'shared',
          threadId,
          kind: mode,
          to: mode === 'forward' ? parseRecipients(to) : [],
          cc: ccShown ? parseRecipients(cc) : [],
          subject: mode === 'forward' ? subject.trim() : null,
          bodyHtml: html,
          attachments,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.id) draftIdRef.current = data.id
    } catch {
      /* best-effort */
    } finally {
      savingRef.current = false
    }
  }

  async function discardDraftRow() {
    const id = draftIdRef.current
    if (!id) return
    draftIdRef.current = null
    try {
      await fetch(`/api/hub/email/drafts/${id}`, { method: 'DELETE' })
    } catch {
      /* best-effort */
    }
  }

  // Debounced auto-save while there's content and we're not mid-send.
  useEffect(() => {
    if (sending || !isDirty()) return
    const t = setTimeout(() => {
      void saveDraft()
    }, 1800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText, cc, ccShown, to, subject, attachments, sending])

  async function handleBack() {
    // The reply auto-saves as a draft — keep it (a fresh save catches the last edit).
    if (isDirty()) await saveDraft()
    onCancel()
  }

  async function discardDraft() {
    if (typeof window !== 'undefined' && isDirty() && !window.confirm('Discard this draft?')) return
    await discardDraftRow()
    onCancel()
  }

  // Outbound HTML: our reply on top (finalizeEmailHtml — same wrapping the old
  // composer used), then the Outlook-style From/Date/To/Subject quote header,
  // then an <hr>, then the ORIGINAL message's body_html VERBATIM. The original
  // is never passed through TipTap or any sanitizer here — it's outbound-only
  // bytes, never rendered in our own DOM (the on-screen preview below renders
  // it in the same sandboxed iframe MessageCard uses instead).
  // KNOWN LIMITATION (v1, accepted): cid: inline images in the original aren't
  // re-attached, so they won't render for the recipient after reply/forward;
  // remote https images survive since the <img src> is preserved verbatim.
  function buildOutboundHtml(topHtml: string): string {
    if (!referenceMessage) return finalizeEmailHtml(topHtml)
    const header = buildForwardQuoteHeaderHtml(referenceMessage)
    const hr = '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />'
    const originalHtml =
      referenceMessage.body_html ||
      textToHtmlParagraphs(referenceMessage.body_text || referenceMessage.snippet || '')
    return `${finalizeEmailHtml(topHtml)}${header}${hr}${originalHtml}`
  }

  function buildOutboundText(topText: string): string {
    if (!referenceMessage) return topText
    const header = buildForwardQuoteHeaderHtml(referenceMessage)
    const originalText = htmlToPlainText(
      referenceMessage.body_html || referenceMessage.body_text || referenceMessage.snippet || ''
    )
    return `${topText}\n\n${htmlToPlainText(header)}\n\n${originalText}`
  }

  const canSend =
    !sending &&
    (draftText.trim().length > 0 || attachments.length > 0) &&
    (mode !== 'forward' || (to.trim().length > 0 && subject.trim().length > 0 && accountsLoaded && accounts.length > 0))

  function scheduledToast(scheduleAt: string | undefined, scheduledAt?: string) {
    toast.success(
      `Scheduled — sends ${new Date(scheduleAt || scheduledAt || '').toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    )
  }

  // Send now, or schedule when scheduleAt (ISO) is given.
  async function submit(scheduleAt?: string) {
    if (!canSend) return
    const html = editorRef.current?.getHTML() || ''
    const text = editorRef.current?.getText() || ''
    setSending(true)
    setError('')
    try {
      if (mode === 'forward') {
        const toList = parseRecipients(to)
        if (toList.length === 0) {
          setError('Add at least one recipient')
          return
        }
        const res = await fetch('/api/hub/email/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: accountId || 'shared',
            to: toList,
            cc: ccShown ? parseRecipients(cc) : undefined,
            subject: subject.trim() || fwdSubject(thread.subject),
            bodyHtml: buildOutboundHtml(html),
            body: buildOutboundText(text),
            attachments,
            scheduleAt,
            draftId: draftIdRef.current,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error || data.ok === false) {
          setError(data.error || 'Could not send — try again')
          return
        }
        if (data.scheduled) {
          draftIdRef.current = null // converted to a scheduled row
          scheduledToast(scheduleAt, data.scheduledAt)
          await onReplySent()
          return
        }
        await discardDraftRow() // sent — drop the saved draft
        toast.success('Email forwarded')
        if (data.threadId) router.push(`/hub/email/${data.threadId}`)
        else router.push('/hub/email')
        return
      }

      // reply / reply-all — always lands on the thread's own participants
      // server-side; only `cc` travels from this composer.
      const res = await fetch(`/api/hub/email/threads/${threadId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyHtml: buildOutboundHtml(html),
          body: buildOutboundText(text),
          attachments,
          cc: ccShown ? parseRecipients(cc) : undefined,
          scheduleAt,
          draftId: draftIdRef.current,
          kind: mode,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false || data.error) {
        setError(data.error || 'Send failed — try again')
        return
      }
      if (data.scheduled) {
        draftIdRef.current = null // converted to a scheduled row
        scheduledToast(scheduleAt, data.scheduledAt)
        await onReplySent()
        return
      }
      await discardDraftRow() // sent — drop the saved draft
      toast.success('Reply sent')
      await onReplySent()
    } catch {
      setError(mode === 'forward' ? 'Could not send — try again' : 'Send failed — try again')
    } finally {
      setSending(false)
    }
  }
  const send = () => submit()

  const modeLabel = mode === 'forward' ? 'Forward' : mode === 'reply-all' ? 'Reply All' : 'Reply'
  const inputCls =
    'w-full px-3 py-2 rounded-md bg-white border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500'
  const labelCls = 'text-xs text-gray-500 block mb-1'
  const displayCls = 'w-full px-3 py-2 rounded-md bg-gray-50 border border-gray-200 text-sm text-gray-600 truncate'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div
        data-hide-on-keyboard
        className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between gap-2 max-md:pl-14"
      >
        <h1 className="font-semibold text-gray-900">{modeLabel}</h1>
        <div className="flex items-center gap-2">
          {(isDirty() || draftIdRef.current) && (
            <button
              type="button"
              onClick={discardDraft}
              disabled={sending}
              className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-red-50 text-red-600 disabled:opacity-50"
              title="Delete this draft"
            >
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleBack}
            disabled={sending}
            className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            title="Keeps your draft"
          >
            ← Back
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto w-full space-y-3">
          <div>
            <label className={labelCls}>From</label>
            {mode === 'forward' && accounts.length > 1 ? (
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
            ) : (
              <div className={displayCls}>
                {sendAsAccount ? `Sends as ${sendAsAccount.email_address}` : 'Sends as the shared mailbox'}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">To</label>
              {mode === 'forward' && !ccShown && (
                <button
                  type="button"
                  onClick={() => setCcShown(true)}
                  className="text-[11px] text-gray-400 hover:text-gray-700"
                >
                  + Cc
                </button>
              )}
            </div>
            {mode === 'forward' ? (
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="name@example.com, another@example.com"
                className={inputCls}
                autoFocus
                disabled={sending}
              />
            ) : (
              <div className={displayCls} title="Replies always go to the original sender">
                {toDisplay}
              </div>
            )}
          </div>

          {mode === 'reply' && !ccShown && (
            <button
              type="button"
              onClick={() => setCcShown(true)}
              className="text-[11px] text-gray-400 hover:text-gray-700 -mt-1"
            >
              + Cc
            </button>
          )}
          {ccShown && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelCls}>Cc</label>
                {mode !== 'forward' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCcShown(false)
                      setCc('')
                    }}
                    className="text-[11px] text-gray-400 hover:text-gray-700"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                type="text"
                value={cc}
                onChange={(e) => {
                  setCc(e.target.value)
                  setCcTouched(true)
                }}
                placeholder="cc@example.com"
                className={inputCls}
                disabled={sending}
              />
            </div>
          )}

          <div>
            <label className={labelCls}>Subject</label>
            {mode === 'forward' ? (
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
                disabled={sending}
              />
            ) : (
              <div className={displayCls}>{subject}</div>
            )}
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}

          {polishUndo !== null && (
            <div className="text-[11px] text-gray-400 text-right">
              ✨ Polished ·{' '}
              <button type="button" onClick={undoPolish} className="underline hover:text-gray-700">
                undo
              </button>
            </div>
          )}

          <EmailRichTextEditor
            ref={editorRef}
            initialHtml={initialHtml}
            onChange={onEditorChange}
            disabled={sending}
            autoFocusStart={mode !== 'forward'}
            minHeightClass="min-h-[160px]"
            maxHeightClass="max-h-[38vh]"
          />

          <div className="flex items-center gap-1.5 flex-wrap">
            <EmailAttachments
              attachments={attachments}
              onAdd={(a) => setAttachments((prev) => [...prev, a])}
              onRemove={(id) => setAttachments((prev) => prev.filter((x) => x.id !== id))}
              disabled={sending}
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => setSuggestOpen((v) => !v)}
                disabled={suggestLoading || messages.length === 0}
                className="text-xs px-2 py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60 inline-flex items-center gap-1"
                title="Suggest a reply"
              >
                {suggestLoading ? (
                  <span className="inline-block w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span aria-hidden>✨</span>
                )}
                <span className="hidden sm:inline">Suggest</span>
              </button>
              {suggestOpen && !suggestLoading && (
                <div className="absolute left-0 bottom-full mb-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    Tone
                  </div>
                  {SUGGEST_TONES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => runSuggestReply(t.value)}
                      className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={runPolish}
              disabled={polishLoading || !draftText.trim()}
              className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
              title="Polish the wording of your draft"
            >
              {polishLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span aria-hidden>✨</span>
              )}
              <span className="hidden sm:inline">Polish</span>
            </button>
          </div>

          {/* Quoted original — Outlook-style header + hr + the ORIGINAL message
              rendered in the same locked-down sandboxed iframe MessageCard uses.
              Read-only context; included verbatim in the outbound send above. */}
          {referenceMessage && (
            <div className="pt-2">
              <div className="text-[11px] text-gray-400 space-y-0.5 px-0.5">
                <div>From: {formatWho(referenceMessage.from_name, referenceMessage.from_email)}</div>
                <div>Date: {messageTime(referenceMessage.message_date) || 'Unknown'}</div>
                {formatRecipientList(referenceMessage.to_recipients) && (
                  <div>To: {formatRecipientList(referenceMessage.to_recipients)}</div>
                )}
                <div>Subject: {referenceMessage.subject || '(no subject)'}</div>
              </div>
              <hr className="my-2 border-gray-200" />
              {referenceMessage.body_html ? (
                <div className="rounded-md bg-white border border-gray-200 overflow-hidden">
                  <iframe
                    title="Quoted message"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={referenceMessage.body_html}
                    className="w-full h-[360px] bg-white"
                  />
                </div>
              ) : (
                <div className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                  {referenceMessage.body_text || referenceMessage.snippet || '(no content)'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-200 px-4 py-3 bg-white flex items-center justify-end gap-2">
        <ScheduleSendMenu disabled={!canSend} onSchedule={(iso) => submit(iso)} />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="text-sm px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
