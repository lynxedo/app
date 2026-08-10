'use client'

import { useCallback, useEffect, useState } from 'react'

// Which Jobber line items put a report link on a job.
//
// The line items are pulled live from Jobber rather than typed, so a saved name
// always matches what a job actually carries — a typo here would silently mean
// "no job ever qualifies", which looks identical to the feature being broken.

type Report = {
  report_key: string
  label: string
  link_text: string
  url_suffix: string
  line_items: string[]
  enabled: boolean
}

export default function JobberReportLinks() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  // 162 checkboxes is not a list anyone reads. Filter per report.
  const [filter, setFilter] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/jobber/report-links')
      if (!res.ok) { setReports([]); return }
      const j = await res.json()
      setReports(j.reports ?? [])
      setCatalog(j.catalog ?? [])
    } catch { setReports([]) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(report: Report, lineItems: string[]) {
    setSaving(report.report_key); setToast('')
    try {
      const res = await fetch('/api/admin/jobber/report-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_key: report.report_key, line_items: lineItems }),
      })
      setToast(res.ok ? '✓ Saved' : 'Could not save')
      if (res.ok) {
        setReports((prev) => prev?.map((r) =>
          r.report_key === report.report_key ? { ...r, line_items: lineItems } : r) ?? null)
      }
    } catch { setToast('Could not save') } finally { setSaving(null) }
  }

  if (!reports) return null
  if (!reports.length) return null

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="text-sm font-semibold text-white">Report links on Jobber jobs</h3>
      <p className="mt-1 text-xs text-white/50">
        Pick the Jobber line items that should put a report link on a job. A job carrying
        one of these shows the link in Jobber, and tapping it opens that report for the
        customer. Jobs already in Jobber pick the link up as they&apos;re created or edited.
      </p>

      {catalog.length === 0 && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          Couldn&apos;t load your line items from Jobber just now, so there&apos;s nothing to pick from.
          Reload in a minute — Jobber rate-limits bursts of requests and recovers on its own.
        </p>
      )}

      <div className="mt-4 space-y-5">
        {reports.map((r) => {
          const selected = new Set(r.line_items.map((n) => n.toLowerCase()))
          return (
            <div key={r.report_key}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-medium text-white">{r.label}</div>
                <div className="text-[11px] text-white/40">
                  {r.line_items.length === 0 ? 'No line items — link is off' : `${r.line_items.length} selected`}
                </div>
              </div>
              <input
                type="search"
                value={filter[r.report_key] ?? ''}
                onChange={(e) => setFilter((f) => ({ ...f, [r.report_key]: e.target.value }))}
                placeholder={`Search ${catalog.length} line items…`}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-white/30"
              />
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-white/10 p-2">
                {catalog
                  .filter((item) => {
                    const q = (filter[r.report_key] ?? '').trim().toLowerCase()
                    // A selected item always stays visible, so filtering can never
                    // hide something that is switched on.
                    return !q || item.name.toLowerCase().includes(q) || selected.has(item.name.toLowerCase())
                  })
                  .map((item) => {
                  const on = selected.has(item.name.toLowerCase())
                  return (
                    <label key={item.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-xs text-white/80 hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={saving === r.report_key}
                        onChange={() => {
                          const next = on
                            ? r.line_items.filter((n) => n.toLowerCase() !== item.name.toLowerCase())
                            : [...r.line_items, item.name]
                          void save(r, next)
                        }}
                      />
                      {item.name}
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {toast && <div className="mt-3 text-xs text-white/60">{toast}</div>}
    </div>
  )
}
