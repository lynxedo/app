'use client'

import { useState } from 'react'
import { TEMPLATE_FIELDS, renderTemplate } from '@/lib/txt-templates'
import { useToast } from '@/components/ui'

const MAX_SIG = 500

// Sample context for the live preview.
const PREVIEW_CTX = {
  contactName: 'Jordan Smith',
  senderName: 'Ben Simpson',
  companyName: 'Heroes Lawn Care',
}

export default function SignaturePanel({
  initialCompanyDefaultSignature,
  initialAllowUserSignatures,
  initialOptOutMessage,
  initialOptOutOnFirstMessage,
}: {
  initialCompanyDefaultSignature: string | null
  initialAllowUserSignatures: boolean
  initialOptOutMessage: string
  initialOptOutOnFirstMessage: boolean
}) {
  const [signature, setSignature] = useState(initialCompanyDefaultSignature ?? '')
  const [baseline, setBaseline] = useState(initialCompanyDefaultSignature ?? '')
  const [allowUser, setAllowUser] = useState(initialAllowUserSignatures)
  const [savingSig, setSavingSig] = useState(false)
  const [savingToggle, setSavingToggle] = useState(false)
  const [error, setError] = useState('')
  const [optOut, setOptOut] = useState(initialOptOutMessage ?? 'Reply STOP to opt out.')
  const [optOutBaseline, setOptOutBaseline] = useState(initialOptOutMessage ?? 'Reply STOP to opt out.')
  const [optOutEnabled, setOptOutEnabled] = useState(initialOptOutOnFirstMessage)
  const [savingOptOut, setSavingOptOut] = useState(false)
  const [savingOptOutToggle, setSavingOptOutToggle] = useState(false)
  const toast = useToast()

  const dirty = signature !== baseline
  const preview = signature.trim() ? renderTemplate(signature.trim(), PREVIEW_CTX) : ''

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setError('')
    const res = await fetch('/api/admin/txt/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Save failed')
      return false
    }
    return true
  }

  async function saveSignature() {
    setSavingSig(true)
    const ok = await post({ company_default_signature: signature.trim() })
    setSavingSig(false)
    if (ok) {
      setBaseline(signature)
      toast.success('Company signature saved')
    }
  }

  async function toggleAllow(next: boolean) {
    const prev = allowUser
    setAllowUser(next)
    setSavingToggle(true)
    const ok = await post({ allow_user_signatures: next })
    setSavingToggle(false)
    if (!ok) setAllowUser(prev)
  }

  const optOutDirty = optOut !== optOutBaseline

  async function saveOptOut() {
    setSavingOptOut(true)
    const ok = await post({ opt_out_message: optOut.trim() })
    setSavingOptOut(false)
    if (ok) {
      setOptOutBaseline(optOut)
      toast.success('Opt-out notice saved')
    }
  }

  async function toggleOptOut(next: boolean) {
    const prev = optOutEnabled
    setOptOutEnabled(next)
    setSavingOptOutToggle(true)
    const ok = await post({ opt_out_on_first_message: next })
    setSavingOptOutToggle(false)
    if (!ok) setOptOutEnabled(prev)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Txt — Signature</h1>
        <p className="text-sm text-gray-400 mt-1">
          Set the company signature that gets appended to outgoing texts, and choose
          whether teammates can use their own instead.
        </p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-xs text-gray-300 space-y-1">
        <div className="font-medium text-gray-100">Dynamic fields</div>
        <div>Use any of these — they get replaced when the message is sent.</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TEMPLATE_FIELDS.map((f) => (
            <code
              key={f}
              className="px-1.5 py-0.5 rounded bg-gray-800 text-emerald-300 text-[11px]"
            >
              {'{' + f + '}'}
            </code>
          ))}
        </div>
      </div>

      {/* Company default signature */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Company default signature</label>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="{first_name}, - Heroes Lawn Care"
            rows={3}
            maxLength={MAX_SIG}
            className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm resize-none"
          />
          <div className="text-[10px] text-gray-500 mt-1">
            {signature.length} / {MAX_SIG}. Appended (with a blank line above it) when the
            first message is sent in a thread, or when a different teammate jumps in. Leave
            blank for no company signature.
          </div>
        </div>

        {preview && (
          <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Preview</div>
            <div className="text-sm text-gray-200 whitespace-pre-wrap">{preview}</div>
          </div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}

        <button
          onClick={saveSignature}
          disabled={savingSig || !dirty}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
        >
          {savingSig ? 'Saving…' : 'Save signature'}
        </button>
      </div>

      {/* Allow per-user signatures */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowUser}
            disabled={savingToggle}
            onChange={(e) => toggleAllow(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="text-sm font-medium">Let users customize their own signature</span>
            <span className="block text-xs text-gray-400 mt-0.5">
              When on, a teammate who sets a personal signature (Settings → My Hub) uses it
              instead of the company default. When off, everyone uses the company default and
              the personal-signature field is hidden.
            </span>
          </span>
        </label>
      </div>

      {/* Opt-out notice (compliance) */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Opt-out notice</h2>
          <p className="text-sm text-gray-400 mt-1">
            Carriers require customers to be told how to opt out. This short line is added
            automatically to the <strong className="text-gray-200">first text</strong> a contact
            ever receives from you (right after the signature). Follow-up texts don&apos;t repeat it.
          </p>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <label className="flex items-start gap-3 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={optOutEnabled}
              disabled={savingOptOutToggle}
              onChange={(e) => toggleOptOut(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-sm font-medium">Add the opt-out notice to first texts</span>
              <span className="block text-xs text-gray-400 mt-0.5">
                Recommended on. Turning this off means new contacts aren&apos;t told how to opt
                out — only do this if you have another compliant process.
              </span>
            </span>
          </label>

          <label className="block text-xs text-gray-400 mb-1">Opt-out wording</label>
          <input
            type="text"
            value={optOut}
            onChange={(e) => setOptOut(e.target.value)}
            placeholder="Reply STOP to opt out."
            maxLength={200}
            disabled={!optOutEnabled}
            className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm disabled:opacity-50"
          />
          <div className="text-[10px] text-gray-500 mt-1">
            {optOut.length} / 200. Keep it short — it&apos;s tacked onto the end of the first message.
          </div>

          <button
            onClick={saveOptOut}
            disabled={savingOptOut || !optOutDirty || !optOutEnabled}
            className="mt-3 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
          >
            {savingOptOut ? 'Saving…' : 'Save opt-out notice'}
          </button>
        </div>
      </div>
    </div>
  )
}
