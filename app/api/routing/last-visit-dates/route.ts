import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jobberGraphQL } from '@/lib/jobber'

// Fetch up to 50 visits per job. For most recurring lawn-care jobs this covers
// the full history; more than 50 means there will definitely be a completed one.
const LAST_VISIT_QUERY = `
  query LastVisitForJob($id: EncodedId!) {
    job(id: $id) {
      visits(first: 50) {
        nodes {
          completedAt
        }
      }
    }
  }
`

// Today as a YYYY-MM-DD string in US Central time (Heroes is in Texas).
function todayChicago(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

// Calendar days between two YYYY-MM-DD strings (positive = pastDate is before today).
function calendarDaysDiff(pastDate: string, today: string): number {
  const a = new Date(pastDate + 'T12:00:00')
  const b = new Date(today + 'T12:00:00')
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

// GET /api/routing/last-visit-dates?jobIds=id1,id2,...
// Returns { [jobId]: daysSince | null } — null = no prior completed visit found.
// Loads async after the Advanced map renders; failures resolve to missing keys
// (pin shows no label, not an error).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const jobIdsParam = searchParams.get('jobIds')
  if (!jobIdsParam) return NextResponse.json({ error: 'jobIds required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobIds = [...new Set(jobIdsParam.split(',').map(s => s.trim()).filter(Boolean))]
  if (jobIds.length === 0) return NextResponse.json({})

  const today = todayChicago()

  const results = await Promise.allSettled(
    jobIds.map(async (jobId) => {
      const res = await jobberGraphQL<{
        data: { job: { visits: { nodes: Array<{ completedAt: string | null }> } } | null }
        errors?: Array<{ message: string }>
      }>(user.id, LAST_VISIT_QUERY, { id: jobId })

      const nodes = res.data?.job?.visits?.nodes ?? []

      let latestDate: string | null = null
      for (const n of nodes) {
        if (!n.completedAt) continue
        // Convert the Jobber timestamp to a Chicago-tz calendar date
        const completedDate = new Date(n.completedAt)
          .toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
        // Exclude today — we want the last service BEFORE today's scheduled stop
        if (completedDate >= today) continue
        if (!latestDate || completedDate > latestDate) latestDate = completedDate
      }

      const daysSince = latestDate ? calendarDaysDiff(latestDate, today) : null
      return { jobId, daysSince }
    })
  )

  const out: Record<string, number | null> = {}
  for (const r of results) {
    if (r.status === 'fulfilled') out[r.value.jobId] = r.value.daysSince
  }

  return NextResponse.json(out)
}
