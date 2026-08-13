'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui'

type Report = { slug: string; title: string; section: string; sensitive?: boolean }
type User = { id: string; name: string }

export default function ReportAccessPanel({
  reports,
  users,
  initialAccess,
}: {
  reports: Report[]
  users: User[]
  initialAccess: Record<string, string[]>
}) {
  const [access, setAccess] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {}
    for (const u of users) m[u.id] = new Set(initialAccess[u.id] ?? [])
    return m
  })
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const toast = useToast()

  // Auto-save on toggle (no separate Save button), matching the Scoreboards panel
  // and the house convention that an admin toggle persists on click.
  async function toggle(userId: string, slug: string) {
    const willGrant = !access[userId].has(slug)
    const key = `${userId}:${slug}`
    setSavingKey(key)
    const apply = (grant: boolean) =>
      setAccess(prev => {
        const s = new Set(prev[userId])
        if (grant) s.add(slug); else s.delete(slug)
        return { ...prev, [userId]: s }
      })
    apply(willGrant) // optimistic
    const res = await fetch('/api/admin/reports/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, report_slug: slug, granted: willGrant }),
    })
    if (!res.ok) {
      apply(!willGrant) // revert — never leave the UI claiming a grant that didn't save
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Failed to save — try again')
    }
    setSavingKey(null)
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Who can see each report</h1>
        <p className="text-gray-500 text-sm mt-1">
          Pick which reports each person can open. A user must first have <strong>Reports</strong> turned on in
          Admin&nbsp;&rarr;&nbsp;People to appear here, then sees only the reports you turn on below — nothing until
          granted. Admins always see every report. Changes save automatically.
        </p>
        <p className="text-sky-300/80 text-sm mt-2">
          <strong>People Performance</strong> works differently on purpose: everyone in the Hub can always open it to
          see their <em>own</em> numbers, whether or not they appear in this list. Turning it on here grants the
          <strong> team view</strong> &mdash; everyone else&rsquo;s rows &mdash; not entry to the report.
        </p>
        <p className="text-amber-300/80 text-sm mt-2">
          Two of these show pay information: <strong>Crew &amp; Labor Efficiency</strong> lists what each person earns
          per labour hour, and <strong>Service Line Profitability</strong> shows wage totals by service line. Grant
          them deliberately.
        </p>
      </div>

      {users.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-8 text-center text-sm text-gray-500">
          No users have Reports access yet. Turn on <strong>Reports</strong> for someone in
          Admin&nbsp;&rarr;&nbsp;People, then choose their reports here.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800">
          {users.map(u => (
            <div key={u.id} className="px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
              <div className="md:w-48 min-w-0 text-sm font-medium truncate md:pt-1.5">{u.name}</div>
              <div className="flex flex-wrap gap-2">
                {reports.map(r => {
                  const on = access[u.id]?.has(r.slug) ?? false
                  const key = `${u.id}:${r.slug}`
                  return (
                    <button
                      key={r.slug}
                      type="button"
                      aria-pressed={on}
                      disabled={savingKey === key}
                      onClick={() => toggle(u.id, r.slug)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                        on
                          ? r.sensitive
                            ? 'bg-amber-600 border-amber-500 text-[#fff]'
                            : 'bg-sky-600 border-sky-500 text-[#fff]'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                      } ${savingKey === key ? 'opacity-60' : ''}`}
                      title={
                        r.slug === 'people'
                          ? on
                            ? `Click to remove ${r.title} team view (they keep their own card)`
                            : `Click to grant ${r.title} team view`
                          : on
                            ? `Click to hide ${r.title}`
                            : `Click to show ${r.title}`
                      }
                    >
                      {r.title}
                      {r.sensitive && <span className="ml-1.5 opacity-80">$</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
