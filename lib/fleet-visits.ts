// Fleet stops PRD sessions 2 + 3 — arrived / left per Work Order stop, and the
// custom arrival alerts. Pure module (no server imports): shared by the cron tick,
// the stops API and the Fleet page.
//
// Ben, Oct 8 2026:
//   Arrived = the tech taps Arrived in Work Orders. Backup: GPS sees the truck sit
//             at the stop for 2+ minutes.
//   Left    = the stop is completed (Work Orders or Jobber). Backup: GPS sees the
//             truck drive away.

export const ARRIVE_RADIUS_M = 150
export const ARRIVE_DWELL_MS = 2 * 60_000
// Wider than the arrive radius so a truck shuffling down the street isn't "gone".
export const LEAVE_RADIUS_M = 250
export const LEAVE_DWELL_MS = 60_000

export type ArrivedSource = 'tech' | 'gps'
export type LeftSource = 'tech' | 'jobber' | 'gps'

export type StopFacts = {
  status: string | null
  arrived_at: string | null // the tech's Arrived tap
  completed_at: string | null
  completed_by: string | null // set = completed in Work Orders; null = followed Jobber
}

export type GpsFacts = {
  gps_arrived_at: string | null
  gps_left_at: string | null
}

/** The arrived / left times shown on the map — the tech's own action wins, GPS fills in. */
export function visitTimes(stop: StopFacts, gps: GpsFacts | null) {
  let arrived_at: string | null = null
  let arrived_source: ArrivedSource | null = null
  if (stop.arrived_at) {
    arrived_at = stop.arrived_at
    arrived_source = 'tech'
  } else if (gps?.gps_arrived_at) {
    arrived_at = gps.gps_arrived_at
    arrived_source = 'gps'
  }

  let left_at: string | null = null
  let left_source: LeftSource | null = null
  if (stop.status === 'complete' && stop.completed_at) {
    left_at = stop.completed_at
    left_source = stop.completed_by ? 'tech' : 'jobber'
  } else if (gps?.gps_left_at) {
    left_at = gps.gps_left_at
    left_source = 'gps'
  }
  return { arrived_at, arrived_source, left_at, left_source }
}

export type AlertKind = 'arrive_stop' | 'leave_stop' | 'arrive_first' | 'arrive_last' | 'leave_last'

export const ALERT_KINDS: AlertKind[] = ['arrive_stop', 'leave_stop', 'arrive_first', 'arrive_last', 'leave_last']
export const STANDING_KINDS: AlertKind[] = ['arrive_first', 'arrive_last', 'leave_last']

/** "Mike arrives at stop 3" / "Any tech arrives at their last stop" — the alert's own label. */
export function alertLabel(kind: AlertKind, techName: string | null, stopLabel?: string | null): string {
  const who = techName ?? 'Any tech'
  switch (kind) {
    case 'arrive_stop': return `${who} arrives at ${stopLabel ?? 'a stop'}`
    case 'leave_stop': return `${who} leaves ${stopLabel ?? 'a stop'}`
    case 'arrive_first': return `${who} arrives at the first stop of the day`
    case 'arrive_last': return `${who} arrives at the last stop of the day`
    case 'leave_last': return `${who} leaves the last stop of the day`
  }
}

export function sourceLabel(source: ArrivedSource | LeftSource | null): string {
  switch (source) {
    case 'tech': return 'tech'
    case 'jobber': return 'Jobber'
    case 'gps': return 'GPS'
    default: return ''
  }
}
