import { redirect } from 'next/navigation'

// NAV-GlobalNavFate — the standalone pre-Hub timesheet page is retired; the
// Hub's /hub/timesheet is the live one. Old bookmarks funnel here.
export default function TimesheetRedirect() {
  redirect('/hub/timesheet')
}
