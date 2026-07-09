'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/ui'

// Settings → Beta Features. Lists the betas available to this user (from
// /api/hub/beta), each with a sticky on/off toggle and a per-feature feedback
// box. The tab itself only shows when the user has the can_access_beta grant
// (gated in SettingsForm); this component assumes access and renders the list.

type BetaItem = {
  key: string
  label: string
  description: string
  screenshot_url: string | null
  enabled: boolean
}

export default function BetaFeaturesTab() {
  const toast = useToast()
  const [items, setItems] = useState<BetaItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hub/beta')
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((d) => setItems(d.features ?? []))
      .catch(() => setItems([]))
  }, [])

  async function toggle(key: string, enabled: boolean) {
    setBusy(key)
    // Optimistic — flip immediately, revert on failure.
    setItems((prev) => prev?.map((i) => (i.key === key ? { ...i, enabled } : i)) ?? prev)
    const res = await fetch('/api/hub/beta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: key, enabled }),
    })
    setBusy(null)
    if (!res.ok) {
      setItems((prev) => prev?.map((i) => (i.key === key ? { ...i, enabled: !enabled } : i)) ?? prev)
      toast.error('Could not update — please try again.')
    }
  }

  if (items === null) return <div className="text-sm text-gray-500">Loading…</div>

  if (items.length === 0) {
    return (
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Beta Features</h2>
        <p className="text-gray-400 text-sm">
          No beta features are available right now. When one opens up, it’ll show here.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Beta Features</h2>
        <p className="text-gray-400 text-sm">
          Try new features early. They’re new and may change or have rough edges — turn any of them off any time, and
          use the feedback box to tell us how it’s going.
        </p>
      </section>
      {items.map((item) => (
        <BetaFeatureCard key={item.key} item={item} busy={busy === item.key} onToggle={toggle} />
      ))}
    </>
  )
}

function BetaFeatureCard({
  item,
  busy,
  onToggle,
}: {
  item: BetaItem
  busy: boolean
  onToggle: (key: string, enabled: boolean) => void
}) {
  const toast = useToast()
  const [feedback, setFeedback] = useState('')
  const [sending, setSending] = useState(false)

  async function submitFeedback() {
    const message = feedback.trim()
    if (!message) return
    setSending(true)
    const res = await fetch('/api/hub/beta/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: item.key, message }),
    })
    setSending(false)
    if (res.ok) {
      setFeedback('')
      toast.success('Thanks — your feedback was sent to the team.')
    } else {
      toast.error('Could not send — please try again.')
    }
  }

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold">{item.label}</h3>
          {item.description && <p className="text-gray-400 text-sm mt-1">{item.description}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={item.enabled}
          disabled={busy}
          onClick={() => onToggle(item.key, !item.enabled)}
          className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${
            item.enabled ? 'bg-orange-500' : 'bg-gray-700'
          }`}
          aria-label={item.enabled ? `Turn off ${item.label}` : `Turn on ${item.label}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              item.enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {item.screenshot_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/hub/beta/screenshot/${item.screenshot_url}`}
          alt={`${item.label} preview`}
          className="mt-4 max-h-56 rounded-lg border border-gray-800 object-contain"
        />
      )}

      <div className="mt-4">
        <label className="text-sm text-gray-400">Feedback</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder={`How is ${item.label} working for you? Anything broken or confusing?`}
          className="mt-1 w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={submitFeedback}
            disabled={!feedback.trim() || sending}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {sending ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>
    </section>
  )
}
