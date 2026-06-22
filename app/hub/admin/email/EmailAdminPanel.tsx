'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui'

type Settings = {
  from_name: string | null
  from_email: string | null
  reply_to: string | null
  sending_domain: string | null
  domain_verified: boolean
  resend_domain_id: string | null
  physical_address: string | null
} | null

const inputCls =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-full'
const labelCls = 'block text-xs font-semibold text-gray-400 mb-1'

export default function EmailAdminPanel({ initialSettings }: { initialSettings: Settings }) {
  const toast = useToast()
  const [s, setS] = useState<Settings>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Controlled field values (default to '')
  const [fromName, setFromName] = useState(initialSettings?.from_name ?? '')
  const [fromEmail, setFromEmail] = useState(initialSettings?.from_email ?? '')
  const [replyTo, setReplyTo] = useState(initialSettings?.reply_to ?? '')
  const [domain, setDomain] = useState(initialSettings?.sending_domain ?? '')
  const [resendDomainId, setResendDomainId] = useState(initialSettings?.resend_domain_id ?? '')
  const [physical, setPhysical] = useState(initialSettings?.physical_address ?? '')

  const verified = !!s?.domain_verified

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_name: fromName,
          from_email: fromEmail,
          reply_to: replyTo,
          sending_domain: domain,
          resend_domain_id: resendDomainId,
          physical_address: physical,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save settings.'); return }
      setS(data.settings)
      toast.success('Email settings saved.')
    } catch {
      toast.error('Network error saving settings.')
    } finally {
      setSaving(false)
    }
  }

  async function refreshDomain() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/email-settings/refresh-domain', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not check domain status.'); return }
      setS((prev) => (prev ? { ...prev, domain_verified: !!data.domain_verified } : prev))
      toast.success(`Domain status: ${data.status}${data.domain_verified ? ' (verified)' : ''}`)
    } catch {
      toast.error('Network error checking domain status.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">Email Marketing — Settings</h1>
          <p className="text-sm text-gray-400 mt-1">
            Configure the address your marketing emails are sent from. This is per-company, so each
            business sets its own. To land in inboxes, the sending domain must be verified in Resend.
          </p>
        </div>

        {/* Setup checklist */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300 space-y-2">
          <h2 className="text-sm font-semibold text-gray-200">Setup checklist</h2>
          <ol className="list-decimal list-inside space-y-1 text-gray-400">
            <li>Add the sending domain in the Resend dashboard and copy its <strong>domain id</strong> here.</li>
            <li>Add the SPF / DKIM / DMARC DNS records Resend shows to the domain&apos;s DNS.</li>
            <li>Set <code className="text-gray-300">RESEND_API_KEY</code> on the server (staging + prod).</li>
            <li>Click <strong>Refresh domain status</strong> below until it reads <em>verified</em>, then send a test from the Email page.</li>
          </ol>
        </div>

        {/* Sending identity form */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200">Sending identity</h2>
            <span
              className={
                'text-xs px-2 py-0.5 rounded-full border ' +
                (verified
                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400')
              }
            >
              {verified ? '✓ Domain verified' : '⏳ Not verified'}
            </span>
          </div>

          <div>
            <label className={labelCls}>Display name</label>
            <input className={inputCls} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Heroes Lawn Care of The Woodlands" />
          </div>
          <div>
            <label className={labelCls}>From address (must be on the verified domain)</label>
            <input className={inputCls} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="heroes@send.lynxedo.com" />
          </div>
          <div>
            <label className={labelCls}>Reply-To (where replies land — no verification needed)</label>
            <input className={inputCls} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="hlc105@heroeslawncare.com" />
          </div>
          <div>
            <label className={labelCls}>Sending domain</label>
            <input className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="send.lynxedo.com" />
          </div>
          <div>
            <label className={labelCls}>Resend domain id</label>
            <input className={inputCls} value={resendDomainId} onChange={(e) => setResendDomainId(e.target.value)} placeholder="d_xxxxxxxx (from the Resend dashboard)" />
          </div>
          <div>
            <label className={labelCls}>Physical mailing address (CAN-SPAM footer)</label>
            <textarea className={inputCls} rows={2} value={physical} onChange={(e) => setPhysical(e.target.value)} placeholder="123 Main St, The Woodlands, TX 77380" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={refreshDomain} disabled={refreshing} className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm hover:bg-gray-700 disabled:opacity-50">
              {refreshing ? 'Checking…' : 'Refresh domain status'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
