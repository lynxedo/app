'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui'
import TemplatesTab from '@/components/hub/marketing/email/TemplatesTab'
import SegmentsTab from '@/components/hub/marketing/email/SegmentsTab'

type EmailSettings = {
  from_name: string | null
  from_email: string | null
  reply_to: string | null
  sending_domain: string | null
  domain_verified: boolean
} | null

type Tab = 'overview' | 'templates' | 'segments'

export default function EmailView({ settings, canAdmin }: { settings: EmailSettings; canAdmin: boolean }) {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('overview')
  const [sending, setSending] = useState(false)

  const verified = !!settings?.domain_verified
  const fromLabel = settings?.from_email
    ? (settings.from_name ? `${settings.from_name} <${settings.from_email}>` : settings.from_email)
    : 'Not configured yet'

  async function sendTest() {
    setSending(true)
    try {
      const res = await fetch('/api/hub/marketing/email/test', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not send the test email.')
      else toast.success(`Test email sent to ${data.sent_to}. Check your inbox.`)
    } catch {
      toast.error('Network error sending the test email.')
    } finally {
      setSending(false)
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'templates', label: 'Templates' },
    { id: 'segments', label: 'Segments' },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Email Marketing</h1>
            <p className="text-sm text-gray-400 mt-1">
              Build reusable templates and customer segments, then send campaigns and automated
              sequences — pulled live from the contacts already synced from Jobber.
            </p>
          </div>
          {canAdmin && (
            <Link
              href="/hub/admin/email"
              className="flex-none rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-700"
            >
              ⚙ Settings
            </Link>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'px-3 py-2 text-sm font-medium border-b-2 -mb-px ' +
                (tab === t.id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-5">
            {/* Sending identity */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
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
                  {verified ? '✓ Domain verified' : '⏳ Domain not verified'}
                </span>
              </div>
              <dl className="text-sm grid grid-cols-[120px_1fr] gap-y-1.5 gap-x-3">
                <dt className="text-gray-500">From</dt>
                <dd className="text-gray-200">{fromLabel}</dd>
                <dt className="text-gray-500">Reply-To</dt>
                <dd className="text-gray-200">{settings?.reply_to || '—'}</dd>
                <dt className="text-gray-500">Domain</dt>
                <dd className="text-gray-200">{settings?.sending_domain || '—'}</dd>
              </dl>
              {!verified && (
                <p className="text-xs text-amber-400/80">
                  Emails won&apos;t deliver until the sending domain is verified in Resend (SPF/DKIM/DMARC DNS records).
                  {canAdmin && ' Configure it in Settings.'}
                </p>
              )}
              <div>
                <button
                  onClick={sendTest}
                  disabled={sending}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send a test email to myself'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <h2 className="text-sm font-semibold text-gray-200 mb-2">How it fits together</h2>
              <ul className="space-y-1.5 text-sm text-gray-400">
                <li>• <strong className="text-gray-300">Templates</strong> — reusable email content with <code className="text-gray-300">{'{{first_name}}'}</code> merge fields.</li>
                <li>• <strong className="text-gray-300">Segments</strong> — saved filters over your contacts (by tag) that decide who gets an email.</li>
                <li>• <strong className="text-gray-300">Campaigns &amp; automations</strong> (coming next) — pair a template with a segment to send.</li>
              </ul>
            </div>
          </div>
        )}

        {tab === 'templates' && <TemplatesTab />}
        {tab === 'segments' && <SegmentsTab />}
      </div>
    </div>
  )
}
