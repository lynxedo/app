'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export default function RefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleRefresh() {
    // startTransition keeps isPending true until the server components have
    // actually re-rendered — so the button reflects the real refresh, not a
    // fixed timer.
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={isPending}
      className="text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-4 py-2 rounded-lg transition-colors"
    >
      {isPending ? 'Refreshing…' : 'Refresh Data'}
    </button>
  )
}
