import { redirect } from 'next/navigation'

// Call Log 2 was merged into the unified Call Log. This route is kept so old
// bookmarks / deep links still resolve — it just forwards to /hub/call-log.
export default function CallLog2Redirect() {
  redirect('/hub/call-log')
}
