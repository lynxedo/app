'use client'

// SB-retry — shared failure state for the scoreboard views. Shows the error
// plus a "Try again" button that re-runs the load (wired to useScoreboardData's
// reload()). One component so all four boards behave identically.
export default function ScoreboardError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <div className="text-sm text-red-400">Couldn&apos;t load scoreboard: {error}</div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-[#fff] transition-colors hover:bg-sky-400"
      >
        Try again
      </button>
    </div>
  )
}
