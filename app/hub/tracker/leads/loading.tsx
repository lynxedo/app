// Instant navigation skeleton for the Lead Tracker. Next renders this the moment
// you click into the board, while the server component prefetches the leads —
// so navigation feels instant and the table arrives already populated (no
// client round-trip, no in-table spinner).
export default function LeadTrackerLoading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar skeleton — mirrors the real header so the swap isn't jarring */}
      <div className="sticky top-0 z-30 bg-gray-950 border-b border-gray-800">
        <div className="px-4 pt-2.5 pb-1.5 flex items-center gap-2 max-md:pl-14">
          <span className="text-gray-600 text-sm">← Trackers</span>
          <span className="text-gray-700">/</span>
          <span className="text-base font-semibold text-white">Lead Tracker</span>
        </div>
        <div className="px-4 pb-2.5 flex items-center gap-2">
          <div className="h-8 w-64 rounded-lg bg-gray-800 animate-pulse" />
          <div className="h-8 w-32 rounded-lg bg-gray-800/70 animate-pulse" />
          <div className="h-8 w-32 rounded-lg bg-gray-800/70 animate-pulse" />
        </div>
      </div>
      {/* Shimmer rows */}
      <div className="p-3 space-y-3">
        {[0, 1, 2].map(g => (
          <div key={g} className="rounded-lg overflow-hidden">
            <div className="h-9 bg-gray-800/60 animate-pulse rounded-t-lg" />
            <div className="divide-y divide-gray-800/40">
              {[0, 1, 2, 3].map(r => (
                <div key={r} className="h-9 bg-gray-900/40 animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
