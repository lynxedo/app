'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui'

// Shared Hub error boundary (Phase 5, #35). Catches a render/data error in any Hub
// route and shows a friendly retry instead of Next's default error overlay (prod) or
// a blank screen. `reset()` re-renders the segment.
export default function HubError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[hub] route error', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center px-6 text-center">
      <p className="text-base font-medium text-gray-200">Something went wrong.</p>
      <p className="mt-1 text-sm text-gray-400">
        This part of the Hub hit an error. You can try again.
      </p>
      <Button onClick={reset} className="mt-4">
        Try again
      </Button>
    </div>
  )
}
