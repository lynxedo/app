// Fleet ↔ Work Orders link: which truck (OneStepGPS device) each tech drives on
// a given day. Table `fleet_vehicle_assignments` — see
// supabase/2026-10-06_fleet_vehicle_assignments.sql for the row rules.
import type { SupabaseClient } from '@supabase/supabase-js'

export type VehicleAssignmentRow = {
  device_id: string
  user_id: string | null
  effective_date: string | null
}

/**
 * Resolve the rows into who drives what on `date` (YYYY-MM-DD, Chicago).
 * A day row beats the standing row for its truck, and a person on a day row is
 * taken off their usual truck that day (so a swap never shows one tech in two
 * trucks). Returns device → user and user → device.
 */
export function resolveAssignments(rows: VehicleAssignmentRow[], date: string) {
  const deviceToUser = new Map<string, string>()
  const userToDevice = new Map<string, string>()
  const dayDevices = new Set<string>()
  const dayUsers = new Set<string>()

  for (const r of rows) {
    if (r.effective_date !== date) continue
    dayDevices.add(r.device_id)
    if (!r.user_id) continue
    dayUsers.add(r.user_id)
    deviceToUser.set(r.device_id, r.user_id)
    userToDevice.set(r.user_id, r.device_id)
  }
  for (const r of rows) {
    if (r.effective_date !== null || !r.user_id) continue
    if (dayDevices.has(r.device_id) || dayUsers.has(r.user_id)) continue
    deviceToUser.set(r.device_id, r.user_id)
    userToDevice.set(r.user_id, r.device_id)
  }
  return { deviceToUser, userToDevice }
}

/** Standing rows + the rows for `date` — everything resolveAssignments needs. */
export async function loadAssignmentRows(
  admin: SupabaseClient,
  companyId: string,
  date: string,
): Promise<VehicleAssignmentRow[]> {
  const { data, error } = await admin
    .from('fleet_vehicle_assignments')
    .select('device_id, user_id, effective_date')
    .eq('company_id', companyId)
    .or(`effective_date.is.null,effective_date.eq.${date}`)
  if (error) throw new Error(error.message)
  return (data ?? []) as VehicleAssignmentRow[]
}

// Tech colours on the map — distinct from the truck status colours
// (green/amber/orange/grey) and from the grey of a finished stop.
export const TECH_COLORS = [
  '#2563eb', // blue
  '#db2777', // pink
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#65a30d', // lime
  '#c026d3', // fuchsia
  '#0d9488', // teal
  '#9f1239', // rose
  '#4f46e5', // indigo
]
