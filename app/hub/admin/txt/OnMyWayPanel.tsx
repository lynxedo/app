'use client'

import { useState } from 'react'
import { renderTemplate, DEFAULT_ON_MY_WAY_TEMPLATE } from '@/lib/txt-templates'

// Admin editor for the company-wide On-My-Way text. Techs tap 🚗 in the Txt
// composer, pick an ETA, and this template (with {first_name}/{my_name}/
// {company}/{eta} filled in) drops into their composer to review + send.
export default function OnMyWayPanel({
  initialTemplate,
}: {
  initialTemplate: string | null
}) {
  const [template, setTemplate] = useState(initialTemplate ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const effective = template.trim() || DEFAULT_ON_MY_WAY_TEMPLATE
  const preview = renderTemplate(effective, {
    contactName: 'Sarah Johnson',
    senderName: 'Ben Simpson',
    companyName: 'Heroes Lawn Care',
  }).replace(/\{eta\}/g, '15')

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/admin/txt/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on_my_way_template: template.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Save failed')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">On-My-Way message</h2>
        <p className="text-xs text-gray-400 mt-1">
          The message techs send from the 🚗 button in the Txt composer. Pick an
          ETA and this drops into the composer (with the fields filled in) so they
          can review and send.
        </p>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Template</label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={3}
          placeholder={DEFAULT_ON_MY_WAY_TEMPLATE}
          maxLength={1000}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-600 resize-none outline-none focus:border-emerald-500"
          style={{ fontSize: 16 }}
        />
        <div className="text-[11px] text-gray-500 mt-1">
          Placeholders: <code className="text-gray-300">{'{first_name}'}</code>{' '}
          <code className="text-gray-300">{'{my_name}'}</code>{' '}
          <code className="text-gray-300">{'{company}'}</code>{' '}
          <code className="text-gray-300">{'{eta}'}</code> — leave blank to use the default.
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-400 mb-1">Preview (Sarah, tech Ben, 15 min)</div>
        <div className="px-3 py-2 rounded-md bg-emerald-600/15 border border-emerald-600/30 text-sm text-emerald-50 whitespace-pre-wrap">
          {preview}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved ✓</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
