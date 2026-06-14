import Link from 'next/link'
import { EmptyState } from '@/components/ui'

// Shared Hub not-found screen (Phase 5, #35). Handles notFound() calls and unmatched
// /hub/* routes with a friendly message + a way back, instead of a bare 404.
export default function HubNotFound() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6">
      <EmptyState
        title="Page not found."
        hint="That page doesn’t exist or may have moved."
        size="lg"
        action={
          <Link
            href="/hub/home"
            className="text-sm font-medium text-brand hover:underline"
          >
            Back to Hub
          </Link>
        }
      />
    </div>
  )
}
