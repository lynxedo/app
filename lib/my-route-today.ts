import type { SupabaseClient } from '@supabase/supabase-js'
import { centralDate } from '@/lib/timezone'

/**
 * The stops this person still has to drive to today — the ONE rule behind the
 * home-screen Next stop widget and the car screens (CarPlay / Android Auto).
 *
 * Mirrors what the Work Orders screen treats as "still to do":
 *  - today in Central, on days where this user is the tech or a secondary tech
 *  - ⚠ scoped to their company, and soft-deleted days stay hidden (the office
 *    deleted them, or Jobber emptied a fed day)
 *  - complete AND skipped are both done (Work Orders' isDone). The widget used
 *    to count a skipped stop as next, sending the truck back to a house the tech
 *    had already given up on.
 *  - ⚠ a visit Jobber moved off their day (removed_from_jobber_at) is left out:
 *    Work Orders keeps it only as a warning, and the car must never route to it.
 *
 * Route order is the day's own order: days by when they were created, stops by
 * ord within a day.
 */
export type MyStop = {
  id: string
  client_name: string | null
  address: string | null
  lat: number | null
  lng: number | null
  scheduled_start_at: string | null
  status: string | null
  client_phone: string | null
  on_my_way_sent_at: string | null
  on_my_way_eta_minutes: number | null
}

export async function myStopsToday(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<{ open: MyStop[]; total: number; error: string | null }> {
  const { data: entries, error } = await admin
    .from('daily_log_entries')
    .select(`id, created_at, daily_log_stops(
      id, ord, client_name, address, lat, lng, scheduled_start_at, status,
      client_phone, on_my_way_sent_at, on_my_way_eta_minutes, removed_from_jobber_at
    )`)
    .eq('company_id', companyId)
    .eq('log_date', centralDate(new Date()))
    .is('deleted_at', null)
    .or(`tech_user_id.eq.${userId},secondary_tech_user_ids.cs.{${userId}}`)
    .order('created_at', { ascending: true })

  if (error) return { open: [], total: 0, error: error.message }

  type Row = MyStop & { ord: number | null; removed_from_jobber_at: string | null }
  const all = (entries ?? []).flatMap((e) =>
    [...((e.daily_log_stops as unknown as Row[] | null) ?? [])]
      .filter((s) => !s.removed_from_jobber_at)
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)),
  )
  const open = all
    .filter((s) => s.status !== 'complete' && s.status !== 'skipped')
    .map(({ ord: _ord, removed_from_jobber_at: _r, ...s }) => s)

  return { open, total: all.length, error: null }
}
