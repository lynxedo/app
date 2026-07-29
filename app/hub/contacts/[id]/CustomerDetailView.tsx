'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatPhone, formatCurrency, formatDurationSec } from '@/lib/format'
import { contactDisplayName, nameIsAiGuessed } from '@/lib/contact-name'
import MergeContactModal from './MergeContactModal'
import type { CustomerDetailAccount, CustomerDetailProperty, AccountProgram, AccountVisit } from './types'

type Tag = { id: string; label: string; color: string }

type Contact = {
  id: string
  name: string
  name_source?: string | null
  archived_at?: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  is_company: boolean
  phone: string | null
  email: string | null
  email_status: string
  do_not_text: boolean
  notes: string | null
  jobber_client_id: string | null
  sources: string[]
  created_at: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  tags: Tag[]
}

type TimelineEvent = {
  kind: 'text' | 'call' | 'voicemail' | 'note'
  ts: string
  id: string
  direction: string | null
  body: string | null
  actor: string | null
  status: string | null
  duration_seconds: number | null
  summary: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  jobber: 'Jobber', manual: 'Manual', import: 'Imported', sms: 'Texted in', voice: 'Called in',
}

const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
  Lead: 'bg-sky-900/40 text-sky-300 border-sky-700/40',
  Archived: 'bg-white/10 text-white/50 border-white/15',
  Cancelled: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
}

function serviceAddress(c: Contact, properties: CustomerDetailProperty[]): string {
  const p = properties.find(pr => pr.address || pr.city)
  if (p && (p.address || p.city)) return [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')
  const parts = [c.address_line1, c.city, c.state, c.postal_code].filter(Boolean)
  return parts.join(', ')
}

export default function CustomerDetailView({
  contact: initialContact,
  allTags,
  account,
  properties,
  programs,
  currentYear,
  canAccessDialer,
  canSeeActivity,
}: {
  contact: Contact
  allTags: Tag[]
  account: CustomerDetailAccount | null
  properties: CustomerDetailProperty[]
  programs: AccountProgram[]
  currentYear: number
  canAccessDialer: boolean
  canSeeActivity: boolean
}) {
  const router = useRouter()
  const [contact, setContact] = useState<Contact>(initialContact)
  const [texting, setTexting] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const isArchived = !!contact.archived_at
  async function toggleArchive() {
    if (archiving) return
    setArchiving(true)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !isArchived }),
      })
      if (res.ok) setContact(c => ({ ...c, archived_at: isArchived ? null : new Date().toISOString() }))
    } finally {
      setArchiving(false)
    }
  }

  const status = account?.status ?? (contact.jobber_client_id ? 'Active' : 'Contact')
  const statusCls = STATUS_STYLES[status] ?? 'bg-white/10 text-white/50 border-white/15'
  const addr = serviceAddress(contact, properties)

  async function textContact() {
    if (texting || !contact.phone) return
    setTexting(true)
    try {
      const res = await fetch('/api/txt/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: contact.phone, name: contact.name }),
      })
      const data = await res.json()
      if (res.ok && data.conversation_id) router.push(`/hub/txt/${data.conversation_id}`)
      else setTexting(false)
    } catch { setTexting(false) }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--t-panel-deep)] text-white min-h-0">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--t-panel-deep)]/95 backdrop-blur border-b border-white/10 px-4 py-3 max-md:pl-14">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/hub/contacts" className="text-white/50 hover:text-white text-lg leading-none" aria-label="Back to contacts">←</Link>
          <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${statusCls}`}>{status}</span>
          {isArchived && (
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border bg-white/10 text-white/60 border-white/20">Archived</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {contact.is_company && <span className="text-xs">🏢</span>}
              <h1 className="text-lg font-semibold truncate">{contactDisplayName(contact.name, contact.phone)}</h1>
              {nameIsAiGuessed(contact.name_source) && (
                <span className="w-2 h-2 rounded-full bg-purple-400 flex-none" title="Name suggested by AI — Edit to confirm" />
              )}
              {contact.do_not_text && (
                <span className="text-[9px] uppercase tracking-wide text-orange-300 bg-orange-900/30 px-1.5 py-0.5 rounded">do not text</span>
              )}
            </div>
            {addr && <div className="text-[11px] text-white/40 truncate">{addr}</div>}
          </div>
          <div className="flex items-center gap-1.5">
            {canAccessDialer && contact.phone && (
              <button type="button" onClick={() => router.push(`/hub/dialer?number=${encodeURIComponent(contact.phone!)}`)}
                className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-medium">📞 Call</button>
            )}
            {contact.phone && (
              <button type="button" onClick={textContact} disabled={texting}
                className="px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium disabled:opacity-50">{texting ? '…' : '💬 Text'}</button>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium">✉️ Email</a>
            )}
            {account?.jobberWebUri && (
              <a href={account.jobberWebUri} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium">Jobber ↗</a>
            )}
            <button type="button" onClick={() => setShowMerge(true)} title="Merge this contact into another"
              className="px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium text-white/70">⧉ Merge</button>
            <button type="button" onClick={toggleArchive} disabled={archiving}
              title={isArchived ? 'Unarchive — show in the active directory again' : 'Archive — hide from the active directory (reversible)'}
              className="px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium text-white/70 disabled:opacity-50">
              {archiving ? '…' : isArchived ? '📤 Unarchive' : '🗄 Archive'}</button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-6xl">
        {/* Left column */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <CustomerInfoCard contact={contact} onUpdated={setContact} />
          {account && <BalanceCard account={account} />}
          <FlagsCard contact={contact} allTags={allTags} onUpdated={setContact} />
          <PropertyCard properties={properties} />
          {contact.jobber_client_id && <ProgramServicesCard programs={programs} currentYear={currentYear} />}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {account && <CustomerDetailsCard account={account} />}
          <NotesCard contact={contact} account={account} onUpdated={setContact} />
          {canSeeActivity && <ActivityCard contactId={contact.id} />}
        </div>
      </div>

      {showMerge && (
        <MergeContactModal
          sourceId={contact.id}
          sourceName={contact.name}
          onClose={() => setShowMerge(false)}
          onMerged={(winnerId) => { setShowMerge(false); router.push(`/hub/contacts/${winnerId}`) }}
        />
      )}
    </div>
  )
}

/* ---------- shared card shell ---------- */

function Card({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-[var(--t-panel)] border border-white/10 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-white/70">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-white/45 shrink-0">{label}</span>
      <span className="text-right text-white/85 min-w-0 break-words">{value}</span>
    </div>
  )
}

const inputCls = 'w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30'
const editBtnCls = 'text-xs text-sky-300 hover:text-sky-200'
const fromJobber = <span className="text-[10px] uppercase tracking-wide text-white/30">from Jobber</span>

/* ---------- customer info (editable) ---------- */

function CustomerInfoCard({ contact, onUpdated }: { contact: Contact; onUpdated: (c: Contact) => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [f, setF] = useState({
    name: contact.name, company_name: contact.company_name ?? '', is_company: contact.is_company,
    phone: contact.phone ?? '', email: contact.email ?? '', email_status: contact.email_status,
    address_line1: contact.address_line1 ?? '', city: contact.city ?? '', state: contact.state ?? '',
    postal_code: contact.postal_code ?? '', do_not_text: contact.do_not_text,
  })

  function reset() {
    setF({
      name: contact.name, company_name: contact.company_name ?? '', is_company: contact.is_company,
      phone: contact.phone ?? '', email: contact.email ?? '', email_status: contact.email_status,
      address_line1: contact.address_line1 ?? '', city: contact.city ?? '', state: contact.state ?? '',
      postal_code: contact.postal_code ?? '', do_not_text: contact.do_not_text,
    })
    setError('')
  }

  async function save() {
    setError(''); setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(), company_name: f.company_name.trim() || null, is_company: f.is_company,
        email: f.email.trim() || null, email_status: f.email_status, do_not_text: f.do_not_text,
        address_line1: f.address_line1.trim() || null, city: f.city.trim() || null,
        state: f.state.trim() || null, postal_code: f.postal_code.trim() || null,
      }
      if (f.phone.trim()) body.phone = f.phone.trim()
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }
      onUpdated({ ...contact, ...data.contact, tags: contact.tags })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setSaving(false) }
  }

  return (
    <Card
      title="Customer"
      action={editing
        ? <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); reset() }} disabled={saving} className="text-xs text-white/40 hover:text-white/70">Cancel</button>
          </div>
        : <button type="button" onClick={() => setEditing(true)} className={editBtnCls}>Edit</button>}
    >
      {editing ? (
        <div className="space-y-2">
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Name" className={inputCls} style={{ fontSize: 16 }} />
          <input value={f.company_name} onChange={e => setF({ ...f, company_name: e.target.value })} placeholder="Company" className={inputCls} style={{ fontSize: 16 }} />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={f.is_company} onChange={e => setF({ ...f, is_company: e.target.checked })} className="w-4 h-4 accent-sky-500" />
            This contact is a business
          </label>
          <input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="Phone" className={inputCls} style={{ fontSize: 16 }} />
          <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="Email" className={inputCls} style={{ fontSize: 16 }} />
          <input value={f.address_line1} onChange={e => setF({ ...f, address_line1: e.target.value })} placeholder="Street" className={inputCls} style={{ fontSize: 16 }} />
          <div className="grid grid-cols-3 gap-2">
            <input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} placeholder="City" className={inputCls} style={{ fontSize: 16 }} />
            <input value={f.state} onChange={e => setF({ ...f, state: e.target.value })} placeholder="State" className={inputCls} style={{ fontSize: 16 }} />
            <input value={f.postal_code} onChange={e => setF({ ...f, postal_code: e.target.value })} placeholder="ZIP" className={inputCls} style={{ fontSize: 16 }} />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
            <input type="checkbox" checked={f.do_not_text} onChange={e => setF({ ...f, do_not_text: e.target.checked })} className="w-4 h-4 accent-orange-500" />
            Do not text <span className="text-xs text-white/40">(blocks outbound)</span>
          </label>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      ) : (
        <div>
          {contact.company_name && <div className="text-sm text-white/60 mb-1">{contact.company_name}</div>}
          {contact.phone && <Row label="Phone" value={<span className="text-sky-300">{formatPhone(contact.phone)}</span>} />}
          {contact.email && (
            <Row label="Email" value={
              <span className="flex items-center gap-2 justify-end">
                <span className="text-sky-300 truncate">{contact.email}</span>
                {contact.email_status && contact.email_status !== 'subscribed' && (
                  <span className="text-[9px] uppercase text-amber-300 bg-amber-900/30 px-1.5 py-0.5 rounded">{contact.email_status}</span>
                )}
              </span>
            } />
          )}
          {serviceAddress(contact, []) && <Row label="Address" value={serviceAddress(contact, [])} />}
          {(contact.sources?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
              {contact.sources.map(s => (
                <span key={s} className="text-[9px] uppercase tracking-wide text-white/40 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">{SOURCE_LABELS[s] || s}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/* ---------- balance (read-only) ---------- */

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-md px-3 py-2">
      <div className="text-[11px] text-white/45">{label}</div>
      <div className="text-base font-medium">{value}</div>
    </div>
  )
}

function BalanceCard({ account }: { account: CustomerDetailAccount }) {
  const hasImported = account.saPrepay != null || account.saRemit != null || account.saBalance != null
  return (
    <Card title="Balance details" action={fromJobber}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Tile label="Net balance" value={formatCurrency(account.balance ?? 0, { decimals: 2 })} />
        {account.saPrepay != null && <Tile label="Prepay" value={formatCurrency(account.saPrepay, { decimals: 2 })} />}
        {account.saRemit != null && <Tile label="Remit" value={formatCurrency(account.saRemit, { decimals: 2 })} />}
      </div>
      {hasImported && <div className="text-[10px] text-white/30 mt-2">Prepay / Remit imported from Real Green</div>}
    </Card>
  )
}

/* ---------- flags = tags (editable) ---------- */

function FlagsCard({ contact, allTags, onUpdated }: { contact: Contact; allTags: Tag[]; onUpdated: (c: Contact) => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ids, setIds] = useState<Set<string>>(new Set(contact.tags.map(t => t.id)))

  function toggle(id: string) {
    setIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function save() {
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_ids: Array.from(ids) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }
      const finalIds = new Set<string>(data.tag_ids ?? Array.from(ids))
      onUpdated({ ...contact, tags: allTags.filter(t => finalIds.has(t.id)) })
      setIds(finalIds)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setSaving(false) }
  }

  return (
    <Card
      title="Flags"
      action={editing
        ? <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setIds(new Set(contact.tags.map(t => t.id))); setError('') }} disabled={saving} className="text-xs text-white/40 hover:text-white/70">Cancel</button>
          </div>
        : <button type="button" onClick={() => setEditing(true)} className={editBtnCls}>Edit</button>}
    >
      {editing ? (
        <>
          {allTags.length === 0 && <div className="text-xs text-white/40">No flags defined yet — an admin can create them in Admin → Contacts.</div>}
          <div className="flex flex-wrap gap-1.5">
            {allTags.map(t => {
              const on = ids.has(t.id)
              return (
                <button key={t.id} type="button" onClick={() => toggle(t.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition ${on ? 'border-white/40 text-white' : 'border-white/10 text-white/60 hover:border-white/30'}`}
                  style={on ? { backgroundColor: t.color + 'CC' } : { backgroundColor: t.color + '33' }}>{t.label}</button>
              )
            })}
          </div>
          {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
        </>
      ) : (
        contact.tags.length === 0
          ? <div className="text-xs text-white/40">No flags. Tap Edit to add.</div>
          : <div className="flex flex-wrap gap-1.5">
              {contact.tags.map(t => (
                <span key={t.id} className="text-xs px-2.5 py-1 rounded-full border border-white/10" style={{ backgroundColor: t.color + '33', color: t.color }}>{t.label}</span>
              ))}
            </div>
      )}
    </Card>
  )
}

/* ---------- property (read-only) ---------- */

function PropertyCard({ properties }: { properties: CustomerDetailProperty[] }) {
  if (properties.length === 0) {
    return (
      <Card title="Property details" action={fromJobber}>
        <div className="text-xs text-white/40">No property on file.</div>
      </Card>
    )
  }
  return (
    <Card title={properties.length > 1 ? `Property details (${properties.length})` : 'Property details'} action={fromJobber}>
      <div className="space-y-4">
        {properties.map((p, i) => {
          const lawn = p.lawnSqft != null ? `${p.lawnSqft.toLocaleString('en-US')} sq ft` : (p.lawnK != null ? `${p.lawnK}k sq ft` : '')
          return (
            <div key={p.id} className={i > 0 ? 'pt-3 border-t border-white/5' : ''}>
              {p.address && <div className="text-sm text-white/80 mb-1">{[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')}</div>}
              {lawn && <Row label="Lawn size" value={lawn} />}
              {p.irrigationZones !== '' && p.irrigationZones != null && <Row label="Irrigation zones" value={String(p.irrigationZones)} />}
              {p.sprinkler && <Row label="Sprinkler system" value={p.sprinkler} />}
              {p.neighborhood && <Row label="Neighborhood" value={p.neighborhood} />}
              {p.gateCode && <Row label="Gate code" value={p.gateCode} />}
              {p.directions && <Row label="Directions" value={<span className="text-white/60">{p.directions}</span>} />}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* ---------- program & services (read-only, from Jobber) ---------- */

const VISIT_STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-900/40 text-emerald-300',
  UPCOMING: 'bg-sky-900/40 text-sky-300',
  TODAY: 'bg-amber-900/40 text-amber-300',
  LATE: 'bg-orange-900/40 text-orange-300',
  UNSCHEDULED: 'bg-white/10 text-white/50',
}

function statusPill(status: string) {
  const key = status.toUpperCase()
  const cls = VISIT_STATUS_STYLES[key] ?? 'bg-white/10 text-white/50'
  return <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>{status.toLowerCase()}</span>
}

function shortDate(d: string | null): string {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  if (!y) return d
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CategoryChip({ prefix, name, color }: { prefix: string; name: string; color: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/60 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded shrink-0">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color || '#888' }} />
      {prefix || name}
    </span>
  )
}

function ProgramServicesCard({ programs, currentYear }: { programs: AccountProgram[]; currentYear: number }) {
  const [showPast, setShowPast] = useState(false)
  const [showAllServices, setShowAllServices] = useState(false)

  const recurring = programs.filter(p => p.isRecurring)
  const services = programs.filter(p => !p.isRecurring)
  const livePrograms = recurring.filter(p => p.live)
  const pastPrograms = recurring.filter(p => !p.live)

  const SERVICE_LIMIT = 6
  const shownServices = showAllServices ? services : services.slice(0, SERVICE_LIMIT)

  if (programs.length === 0) {
    return (
      <Card title="Programs & services" action={fromJobber}>
        <div className="text-xs text-white/40">No programs or services on file.</div>
      </Card>
    )
  }

  return (
    <Card title="Programs & services" action={fromJobber}>
      {/* Programs (recurring) */}
      {livePrograms.length > 0 && (
        <div className="space-y-2">
          {livePrograms.map(p => <ProgramRow key={p.id} p={p} currentYear={currentYear} />)}
        </div>
      )}

      {/* One-off services */}
      {services.length > 0 && (
        <div className={livePrograms.length > 0 ? 'mt-4 pt-3 border-t border-white/5' : ''}>
          <div className="text-[11px] uppercase tracking-wide text-white/35 mb-2">One-time services</div>
          <div className="space-y-1.5">
            {shownServices.map(s => <ServiceRow key={s.id} s={s} />)}
          </div>
          {services.length > SERVICE_LIMIT && (
            <button type="button" onClick={() => setShowAllServices(v => !v)} className="mt-2 text-xs text-sky-300 hover:text-sky-200">
              {showAllServices ? 'Show fewer' : `Show all ${services.length}`}
            </button>
          )}
        </div>
      )}

      {livePrograms.length === 0 && services.length === 0 && pastPrograms.length > 0 && (
        <div className="text-xs text-white/40">No active programs.</div>
      )}

      {/* Past / cancelled programs */}
      {pastPrograms.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <button type="button" onClick={() => setShowPast(v => !v)} className="text-xs text-white/45 hover:text-white/70">
            {showPast ? '▾' : '▸'} Past / cancelled programs ({pastPrograms.length})
          </button>
          {showPast && (
            <div className="space-y-2 mt-2 opacity-70">
              {pastPrograms.map(p => <ProgramRow key={p.id} p={p} currentYear={currentYear} />)}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function ProgramRow({ p, currentYear }: { p: AccountProgram; currentYear: number }) {
  const years = Array.from(new Set(p.visits.map(v => v.year).filter((y): y is number => y != null))).sort((a, b) => b - a)
  const defaultYear = years.includes(currentYear) ? currentYear : (years[0] ?? currentYear)
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(defaultYear)

  const yearVisits = p.visits.filter(v => v.year === year).sort((a, b) => a.round - b.round)
  const completed = yearVisits.filter(v => v.completed).length
  const target = p.visitsPerYear ?? yearVisits.length
  const aux = p.lineItems.filter(li => li.isAux)

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-md">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-start gap-2 p-2.5 text-left">
        <span className="text-white/30 text-xs mt-0.5 shrink-0">{open ? '▾' : '▸'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryChip prefix={p.category} name={p.categoryName} color={p.categoryColor} />
            <span className="text-sm font-medium text-white/90 truncate">{p.name}</span>
          </div>
          <div className="text-[11px] text-white/45 mt-0.5">
            {target > 0 ? `${completed} of ${target} visits · ${year}` : `${year}`}
            {aux.length > 0 && <span className="text-white/35"> · +{aux.length} add-on{aux.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
        {p.jobTotal != null && (
          <span className="text-sm text-white/70 shrink-0">
            {formatCurrency(p.jobTotal, { decimals: 2 })}<span className="text-[10px] text-white/35">/visit</span>
          </span>
        )}
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 pt-0 border-t border-white/5">
          {/* Line items */}
          <div className="mt-2 space-y-1">
            {p.lineItems.map((li, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-white/70 truncate">{li.isAux ? '+ ' : ''}{li.name}{li.quantity != null && li.quantity !== 1 ? ` ×${li.quantity}` : ''}</span>
                {li.total != null && <span className="text-white/50 shrink-0">{formatCurrency(li.total, { decimals: 2 })}</span>}
              </div>
            ))}
          </div>

          {/* Year selector */}
          {years.length > 1 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {years.map(y => (
                <button key={y} type="button" onClick={() => setYear(y)}
                  className={`text-[11px] px-2 py-0.5 rounded ${y === year ? 'bg-sky-600 text-[#fff]' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>{y}</button>
              ))}
            </div>
          )}

          {/* Rounds / visits */}
          <div className="mt-2.5">
            {yearVisits.length === 0
              ? <div className="text-[11px] text-white/35">No visits scheduled for {year}.</div>
              : (
                <div className="space-y-0.5">
                  {yearVisits.map(v => <VisitRow key={v.id} v={v} />)}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  )
}

function VisitRow({ v }: { v: AccountVisit }) {
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <span className="text-white/40 w-14 shrink-0">Round {v.round}</span>
      <span className="text-white/70 w-16 shrink-0">{shortDate(v.date) || '—'}</span>
      {statusPill(v.status || '—')}
      {v.total != null && v.total > 0 && <span className="text-white/45 ml-auto">{formatCurrency(v.total, { decimals: 2 })}</span>}
    </div>
  )
}

function ServiceRow({ s }: { s: AccountProgram }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <CategoryChip prefix={s.category} name={s.categoryName} color={s.categoryColor} />
      <span className="text-white/85 truncate min-w-0 flex-1">{s.name}</span>
      {s.latestDate && <span className="text-[11px] text-white/40 shrink-0">{shortDate(s.latestDate)}</span>}
      {s.jobTotal != null && <span className="text-sm text-white/60 shrink-0">{formatCurrency(s.jobTotal, { decimals: 2 })}</span>}
    </div>
  )
}

/* ---------- customer details (right, read-only) ---------- */

function CustomerDetailsCard({ account }: { account: CustomerDetailAccount }) {
  return (
    <Card title="Customer details" action={fromJobber}>
      <div>
        <Row label="Type" value={account.customerType || '—'} />
        {account.leadSource && <Row label="Lead source" value={account.leadSource} />}
        {account.marketingSource && <Row label="Marketing source" value={account.marketingSource} />}
        {account.salesPerson && <Row label="Sales person" value={account.salesPerson} />}
        {account.customerSince && <Row label="Customer since" value={account.customerSince} />}
        {account.callAhead && <Row label="Call ahead" value={account.callAhead} />}
        {account.irGold && <Row label="IR Gold" value={account.irGold} />}
        {account.status === 'Cancelled' && account.cancellationReason && <Row label="Cancel reason" value={account.cancellationReason} />}
      </div>
    </Card>
  )
}

/* ---------- notes (editable directory note + read-only imported note) ---------- */

function NotesCard({ contact, account, onUpdated }: { contact: Contact; account: CustomerDetailAccount | null; onUpdated: (c: Contact) => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState(contact.notes ?? '')

  async function save() {
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }
      onUpdated({ ...contact, notes: data.contact.notes ?? null })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setSaving(false) }
  }

  return (
    <Card
      title="Notes"
      action={editing
        ? <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setNotes(contact.notes ?? ''); setError('') }} disabled={saving} className="text-xs text-white/40 hover:text-white/70">Cancel</button>
          </div>
        : <button type="button" onClick={() => setEditing(true)} className={editBtnCls}>Edit</button>}
    >
      {editing ? (
        <>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className={`${inputCls} resize-none`} style={{ fontSize: 16 }} placeholder="Add a note…" />
          {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
        </>
      ) : (
        <>
          {contact.notes
            ? <div className="text-sm text-white/80 whitespace-pre-wrap">{contact.notes}</div>
            : <div className="text-xs text-white/40">No notes yet.</div>}
          {account?.importedNote && (
            <div className="mt-2 pt-2 border-t border-white/5 text-sm text-white/55 whitespace-pre-wrap">
              <span className="text-[10px] uppercase tracking-wide text-white/30 block mb-0.5">Imported note</span>
              {account.importedNote}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/* ---------- recent activity (read-only timeline) ---------- */

const KIND_ICON: Record<string, string> = { text: '💬', call: '📞', voicemail: '📩', note: '📝' }

function whenLabel(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function ActivityCard({ contactId }: { contactId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/txt/timeline?contact_id=${contactId}`)
        if (!res.ok) { if (alive) { setEvents([]); setLoading(false) } ; return }
        const data = await res.json()
        if (alive) { setEvents((data.events ?? []) as TimelineEvent[]); setLoading(false) }
      } catch { if (alive) { setEvents([]); setLoading(false) } }
    })()
    return () => { alive = false }
  }, [contactId])

  return (
    <Card title="Recent activity">
      {loading && <div className="text-xs text-white/40">Loading…</div>}
      {!loading && (events?.length ?? 0) === 0 && <div className="text-xs text-white/40">No texts, calls, or voicemails yet.</div>}
      {!loading && (events?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3">
          {events!.slice(0, 15).map(e => {
            const line = e.summary || e.body || (e.kind === 'call'
              ? `Call${e.direction ? ` · ${e.direction}` : ''}${e.duration_seconds ? ` · ${formatDurationSec(e.duration_seconds)}` : ''}`
              : e.kind === 'voicemail' ? 'Voicemail' : '')
            return (
              <div key={`${e.kind}-${e.id}`} className="flex gap-2.5 text-sm">
                <span className="shrink-0">{KIND_ICON[e.kind] ?? '•'}</span>
                <div className="min-w-0">
                  <div className="text-white/85 break-words">{line || e.kind}</div>
                  <div className="text-[11px] text-white/35">{[e.actor, whenLabel(e.ts)].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
