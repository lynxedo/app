// "Export your data" — a CSV per kind from /api/admin/export (Servanto Starter
// Session 2: the 30-day export window after cancelling, usable any time).
// Full admins only; the route enforces the same.

const EXPORTS: { kind: string; label: string; note: string }[] = [
  { kind: 'contacts', label: 'Contacts', note: 'Your contacts directory' },
  { kind: 'leads', label: 'Leads', note: 'Every lead in the Lead Tracker' },
  { kind: 'lead_notes', label: 'Lead notes', note: 'Notes written on leads' },
  { kind: 'boards', label: 'Board tasks', note: 'Shared boards (not personal or private ones)' },
  { kind: 'messages', label: 'Chat messages', note: 'Public rooms only (no DMs or private rooms)' },
]

export default function DataExportSection() {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800">
        <h2 className="font-semibold text-lg">Export your data</h2>
        <p className="text-sm text-gray-400 mt-1">
          Download what your team has made here as spreadsheets (CSV). Your Jobber data isn&apos;t included — it&apos;s already in Jobber.
        </p>
      </div>
      <div className="divide-y divide-gray-800">
        {EXPORTS.map(e => (
          <div key={e.kind} className="px-6 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">{e.label}</div>
              <div className="text-xs text-gray-500">{e.note}</div>
            </div>
            <a
              href={`/api/admin/export?kind=${e.kind}`}
              download
              className="px-3 py-1.5 rounded-lg text-sm border bg-gray-800 hover:bg-gray-700 text-gray-200 border-gray-700 flex-none"
            >
              Download
            </a>
          </div>
        ))}
      </div>
    </section>
  )
}
