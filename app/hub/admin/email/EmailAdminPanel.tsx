'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Button, useToast, useConfirm } from '@/components/ui'

type ContactCounts = { total: number; subscribed: number; unsubscribed: number; bounced: number; suppressed: number; tags: number }
type ImportRow = {
  id: string; filename: string | null; source: string; list_type: string | null
  total_rows: number; created_count: number; updated_count: number; suppressed_count: number; skipped_count: number; created_at: string
}

type Identity = {
  id: string
  label: string
  from_name: string | null
  from_email: string
  reply_to: string | null
  sending_domain: string | null
  resend_domain_id: string | null
  domain_verified: boolean
  is_default: boolean
}

// The physical mailing address is company-level (CAN-SPAM footer), so it stays on
// email_settings — separate from the per-identity From/domain rows.
type Settings = { physical_address: string | null } | null

const inputCls =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-full'
const labelCls = 'block text-xs font-semibold text-gray-400 mb-1'

export default function EmailAdminPanel({ initialSettings }: { initialSettings: Settings }) {
  const toast = useToast()
  const confirm = useConfirm()

  // Sending identities.
  const [identities, setIdentities] = useState<Identity[]>([])
  const [loadingIds, setLoadingIds] = useState(true)
  const [editing, setEditing] = useState<Identity | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Company-level physical address.
  const [physical, setPhysical] = useState(initialSettings?.physical_address ?? '')
  const [savingPhysical, setSavingPhysical] = useState(false)

  // Contacts & import.
  const [counts, setCounts] = useState<ContactCounts | null>(null)
  const [imports, setImports] = useState<ImportRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadIdentities = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/email/identities')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setIdentities(data.identities ?? [])
      else toast.error(data.error || 'Could not load sending identities.')
    } catch { toast.error('Network error loading identities.') } finally { setLoadingIds(false) }
  }, [toast])

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/email/contacts-summary')
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setCounts(data.counts); setImports(data.imports ?? []) }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadIdentities(); loadSummary() }, [loadIdentities, loadSummary])

  async function savePhysical() {
    setSavingPhysical(true)
    try {
      const res = await fetch('/api/admin/email-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physical_address: physical }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save the address.'); return }
      toast.success('Mailing address saved.')
    } catch { toast.error('Network error saving the address.') } finally { setSavingPhysical(false) }
  }

  async function verifyIdentity(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/email/identities/${id}/verify`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not check domain status.'); return }
      toast.success(`Domain status: ${data.status}${data.domain_verified ? ' (verified)' : ''}`)
      loadIdentities()
    } catch { toast.error('Network error checking domain status.') } finally { setBusyId(null) }
  }

  async function makeDefault(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/email/identities/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Could not set default.'); return }
      toast.success('Default sending identity updated.')
      loadIdentities()
    } catch { toast.error('Network error.') } finally { setBusyId(null) }
  }

  async function removeIdentity(iden: Identity) {
    if (!(await confirm({
      message: `Delete “${iden.label}”? Campaigns and automations that used it will fall back to your default sending identity.`,
      confirmText: 'Delete', danger: true,
    }))) return
    setBusyId(iden.id)
    try {
      const res = await fetch(`/api/admin/email/identities/${iden.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Could not delete.'); return }
      toast.success('Identity deleted.')
      loadIdentities()
    } catch { toast.error('Network error.') } finally { setBusyId(null) }
  }

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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">Email Marketing — Settings</h1>
          <p className="text-sm text-gray-400 mt-1">
            Set up the domains your marketing emails send from. You can add more than one — for example your
            own brand domain for important mail and a secondary domain for everyday sends. When you build a
            campaign you pick which one to send from.
          </p>
        </div>

        {/* Sending identities */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Sending identities</h2>
              <p className="text-xs text-gray-500 mt-0.5">Each is a From address on a domain verified in Resend. The default is pre-selected on new campaigns.</p>
            </div>
            <Button onClick={() => setEditing('new')}>+ Add</Button>
          </div>

          {loadingIds ? (
            <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
          ) : identities.length === 0 ? (
            <p className="text-sm text-gray-500 rounded-lg border border-dashed border-gray-700 p-4 text-center">
              No sending identities yet. Add one — you&apos;ll need its domain verified in Resend to deliver.
            </p>
          ) : (
            <ul className="space-y-2">
              {identities.map((iden) => (
                <li key={iden.id} className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-100 truncate">{iden.label}</span>
                        {iden.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-500/10 border-blue-500/30 text-blue-300">Default</span>}
                        <span className={'text-[10px] px-1.5 py-0.5 rounded-full border ' + (iden.domain_verified ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400')}>
                          {iden.domain_verified ? '✓ Verified' : '⏳ Not verified'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {iden.from_name ? `${iden.from_name} · ` : ''}{iden.from_email}
                      </div>
                      <div className="text-[11px] text-gray-600 mt-0.5 truncate">
                        {iden.sending_domain || '(no domain)'}{iden.reply_to ? ` · replies → ${iden.reply_to}` : ''}
                      </div>
                    </div>
                    <div className="flex-none flex flex-col items-end gap-1 text-xs">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing(iden)} disabled={busyId === iden.id} className="text-gray-400 hover:text-white disabled:opacity-40">Edit</button>
                        <button onClick={() => verifyIdentity(iden.id)} disabled={busyId === iden.id} className="text-gray-400 hover:text-white disabled:opacity-40">{busyId === iden.id ? '…' : 'Refresh'}</button>
                      </div>
                      <div className="flex gap-2">
                        {!iden.is_default && <button onClick={() => makeDefault(iden.id)} disabled={busyId === iden.id} className="text-blue-400/90 hover:text-blue-300 disabled:opacity-40">Make default</button>}
                        <button onClick={() => removeIdentity(iden)} disabled={busyId === iden.id} className="text-red-400/80 hover:text-red-400 disabled:opacity-40">Delete</button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-xs text-gray-500 space-y-1">
            <div className="font-semibold text-gray-400">Adding a new domain</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Add the domain in the Resend dashboard and add the SPF/DKIM DNS records it shows.</li>
              <li>Add an identity here with that domain&apos;s <strong>Resend domain id</strong>.</li>
              <li>Click <strong>Refresh</strong> until it reads <em>Verified</em>, then send yourself a test from the Email page.</li>
            </ol>
          </div>
        </div>

        {/* Physical mailing address (company-level, CAN-SPAM) */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Physical mailing address</h2>
            <p className="text-xs text-gray-500 mt-0.5">Shown in every email&apos;s footer — required by CAN-SPAM. Applies to all sending identities.</p>
          </div>
          <textarea className={inputCls} rows={2} value={physical} onChange={(e) => setPhysical(e.target.value)} placeholder="27313 Dobbin Huffsmith Rd, Magnolia TX 77354" />
          <button onClick={savePhysical} disabled={savingPhysical} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50">
            {savingPhysical ? 'Saving…' : 'Save address'}
          </button>
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

      {editing && (
        <IdentityEditor
          identity={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadIdentities() }}
        />
      )}
    </div>
  )
}

function IdentityEditor({ identity, onClose, onSaved }: { identity: Identity | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(identity?.label ?? '')
  const [fromName, setFromName] = useState(identity?.from_name ?? '')
  const [fromEmail, setFromEmail] = useState(identity?.from_email ?? '')
  const [replyTo, setReplyTo] = useState(identity?.reply_to ?? '')
  const [domain, setDomain] = useState(identity?.sending_domain ?? '')
  const [resendId, setResendId] = useState(identity?.resend_domain_id ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!fromEmail.trim()) { toast.error('A From address is required.'); return }
    setSaving(true)
    try {
      const payload = {
        label: label.trim(), from_name: fromName.trim(), from_email: fromEmail.trim(),
        reply_to: replyTo.trim(), sending_domain: domain.trim(), resend_domain_id: resendId.trim(),
      }
      const res = identity
        ? await fetch(`/api/admin/email/identities/${identity.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/admin/email/identities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(identity ? 'Identity saved.' : 'Identity added.')
      onSaved()
    } finally { setSaving(false) }
  }

  const labelC = 'block text-xs font-semibold text-gray-400 mb-1'
  const inputC = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-full'

  return (
    <Modal open onClose={onClose} title={identity ? 'Edit sending identity' : 'Add sending identity'} maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end w-full gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelC}>Label <span className="text-gray-600">· shown in the “Send from” picker</span></label>
          <input className={inputC} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Heroes Lawn Care — heroeslawncare.com" />
        </div>
        <div>
          <label className={labelC}>Display name</label>
          <input className={inputC} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Heroes Lawn Care of The Woodlands" />
        </div>
        <div>
          <label className={labelC}>From address (must be on the verified domain)</label>
          <input className={inputC} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="hlc105@heroeslawncare.com" />
        </div>
        <div>
          <label className={labelC}>Reply-To (where replies land — no verification needed)</label>
          <input className={inputC} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="hlc105@heroeslawncare.com" />
        </div>
        <div>
          <label className={labelC}>Sending domain</label>
          <input className={inputC} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="heroeslawncare.com" />
        </div>
        <div>
          <label className={labelC}>Resend domain id</label>
          <input className={inputC} value={resendId} onChange={(e) => setResendId(e.target.value)} placeholder="from the Resend dashboard" />
          <p className="text-[11px] text-gray-500 mt-1">Changing this resets the verified status — click Refresh after saving.</p>
        </div>
      </div>
    </Modal>
  )
}
