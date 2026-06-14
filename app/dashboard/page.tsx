import { redirect } from 'next/navigation'

// NAV-GlobalNavFate — the standalone pre-Hub dashboard is retired. Everything
// (including the route builder, now at /hub/routing) lives in the Hub. Any old
// bookmark, the landing_page='dashboard' preference, and the legacy
// redirect('/dashboard') callers all funnel here and land in the Hub.
export default function DashboardPage() {
  redirect('/hub/home')
}
