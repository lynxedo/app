'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from '@/components/ui'

type ContactCounts = { total: number; subscribed: number; unsubscribed: number; bounced: number; suppressed: number; tags: number }
type ImportRow = {
  id: string; filename: string | null; source: string; list_type: string | null
  total_rows: number; created_count: number; updated_count: number; suppressed_count: number; skipped_count: number; created_at: string
}

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

  // Contacts & import
  const [counts, setCounts] = useState<ContactCounts | null>(null)
  const [imports, setImports] = useState<ImportRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/email/contacts-summary')
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setCounts(data.counts); setImports(data.imports ?? []) }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  async function syncJobber() {
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/email/sync-jobber', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Sync failed.'); return }
      toast.success(`Jobber sync: ${data.created} added, ${data.updated} matched, ${data.tags_added} tags.`)
      loadSummary()
    } catch { toast.error('Network error during sync.') } finally { setSyncing(false) }
  }

  async function uploadCsv(file: File) {
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/email/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Import failed.'); return }
      toast.success(
        `Imported ${data.list_type}: ${data.created} new, ${data.updated} merged, ${data.suppressed} suppressed, ${data.skipped} skipped.`,
      )
      loadSummary()
    } catch { toast.error('Network error during import.') } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

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

        {/* Contacts & import */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Contacts &amp; import</h2>
            <p className="text-xs text-gray-500 mt-0.5">Your master audience. Jobber clients sync in automatically; import your Mailchimp export for the rest.</p>
          </div>

          {counts && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
              {[
                { label: 'Total', value: counts.total },
                { label: 'Subscribed', value: counts.subscribed },
                { label: 'Unsubscribed', value: counts.unsubscribed },
                { label: 'Bounced', value: counts.bounced },
                { label: 'Suppressed', value: counts.suppressed },
                { label: 'Tags', value: counts.tags },
              ].map((c) => (
                <div key={c.label} className="rounded-lg bg-gray-800/60 border border-gray-700 py-2">
                  <div className="text-lg font-bold text-white">{c.value.toLocaleString()}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{c.label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={syncJobber} disabled={syncing} className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm hover:bg-gray-700 disabled:opacity-50">
              {syncing ? 'Syncing…' : '↻ Sync from Jobber'}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={importing} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50">
              {importing ? 'Importing…' : '⬆ Import Mailchimp CSV'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCsv(f) }}
            />
            <span className="text-xs text-gray-500">Upload each export file (subscribed / unsubscribed / cleaned) — type is auto-detected.</span>
          </div>

          {imports.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 mb-1">Recent imports</h3>
              <div className="space-y-1">
                {imports.map((im) => (
                  <div key={im.id} className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5 border-b border-gray-800/60 pb-1">
                    <span className="text-gray-300">{im.filename || '(file)'}</span>
                    {im.list_type && <span className="text-gray-500">[{im.list_type}]</span>}
                    <span>{im.total_rows} rows</span>
                    <span className="text-green-400">+{im.created_count} new</span>
                    <span className="text-blue-400">{im.updated_count} merged</span>
                    <span className="text-amber-400">{im.suppressed_count} suppressed</span>
                    {im.skipped_count > 0 && <span className="text-gray-500">{im.skipped_count} skipped</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
