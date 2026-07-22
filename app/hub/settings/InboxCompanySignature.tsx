'use client'

import { useEffect, useState } from 'react'

/**
 * Company default email signature (managers/admins). Applied for anyone who hasn't
 * set their own signature. Template tokens {Name} / {Job Title} fill in per person.
 * Self-contained: GET/PUT /api/hub/email/company-settings (PUT is manager-gated).
 */
export default function InboxCompanySignature() {
  const [val, setVal] = useState('')
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/email/company-settings')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return
        setVal(d.defaultSignature || '')
        setBaseline(d.defaultSignature || '')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = val !== baseline
  async function save() {
    setState('saving')
    setErr(null)
    try {
      const res = await fetch('/api/hub/email/company-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSignature: val }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr(d.error || 'Save failed')
        setState('error')
        return
      }
      setBaseline(val)
      setState('saved')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setErr('Save failed')
      setState('error')
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-800">
      <label className="block text-xs text-gray-400 mb-1.5">Company default signature (everyone)</label>
      <p className="text-xs text-gray-500 mb-2">
        Used for anyone who hasn&apos;t set their own signature above. Type{' '}
        <code className="text-gray-300">{'{Name}'}</code> and{' '}
        <code className="text-gray-300">{'{Job Title}'}</code> where each person&apos;s name and title
        should fill in.
      </p>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        disabled={loading}
        rows={4}
        placeholder={'{Name}\n{Job Title}\nHeroes Lawn Care'}
        className="w-full px-3 py-2 rounded-md bg-gray-950 border border-gray-700 text-sm text-gray-100 placeholder-gray-600 font-mono"
      />
      {err && <p className="text-red-400 text-sm mt-2">{err}</p>}
      <div className="mt-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || loading || state === 'saving'}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save company default'}
        </button>
      </div>
    </div>
  )
}
