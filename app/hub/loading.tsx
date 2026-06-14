import { Spinner } from '@/components/ui'

// Shared Hub loading screen (Phase 5, #35). Shown via Suspense while a Hub route's
// server work resolves — replaces the blank white flash 64 pages had with nothing.
export default function HubLoading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Spinner size={8} label="Loading…" />
    </div>
  )
}
