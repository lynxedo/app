import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Pesticide Record' }
export const dynamic = 'force-dynamic'

type ChemicalApplied = {
  matched_line_item?: string
  matched_line_item_qty?: number | null
  matched_line_item_total?: number | null
  chemical_name?: string
  epa_registration_number?: string | null
  active_ingredients?: string | null
  target_pests?: string | null
  application_rate?: string | null
}

type WeatherSnap = {
  temperature_f?: number | null
  temperature_c?: number | null
  conditions?: string | null
  wind_mph?: number | null
  wind_direction?: number | null
  humidity_pct?: number | null
  observed_at?: string | null
  station_name?: string | null
} | null

type RecordRow = {
  id: string
  application_timestamp: string
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  customer_name: string | null
  technician_name: string | null
  jobber_visit_id: string | null
  jobber_client_id: string | null
  chemicals_applied: ChemicalApplied[] | null
  weather: WeatherSnap
  line_items: Array<{ name?: string; qty?: number; totalPrice?: number }> | null
  daily_log_entry_id: string | null
  stop_id: string | null
  created_at: string
  updated_at: string
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago',
  })
}

export default async function PesticideRecordDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) redirect('/dashboard')

  const { data: record } = await supabase
    .from('pesticide_records')
    .select('id, application_timestamp, location_address, location_lat, location_lng, customer_name, technician_name, jobber_visit_id, jobber_client_id, chemicals_applied, weather, line_items, daily_log_entry_id, stop_id, created_at, updated_at')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .maybeSingle<RecordRow>()

  if (!record) notFound()

  const chemicals = Array.isArray(record.chemicals_applied) ? record.chemicals_applied : []
  const lineItems = Array.isArray(record.line_items) ? record.line_items : []
  const w = record.weather

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-3 md:px-6 pt-4 pb-3 border-b border-gray-800">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <Link href="/hub/pesticide-records" className="text-sky-400 hover:underline text-sm">
              ← All records
            </Link>
            <div className="text-xs text-gray-500">
              Record {record.id.slice(0, 8)}
            </div>
          </div>
          <h1 className="text-xl md:text-2xl font-semibold text-white mt-2">
            {record.customer_name ?? 'Unknown customer'}
          </h1>
          <div className="text-sm text-gray-400 mt-0.5">{record.location_address ?? '—'}</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-3xl mx-auto px-3 md:px-6 py-4 space-y-4">
          {/* Application metadata */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Field label="Application date / time" value={formatDateTime(record.application_timestamp)} />
              <Field label="Applicator" value={record.technician_name ?? '—'} />
              {record.location_lat != null && record.location_lng != null && (
                <Field label="Coordinates" value={`${record.location_lat.toFixed(4)}, ${record.location_lng.toFixed(4)}`} />
              )}
              {record.jobber_visit_id && (
                <Field label="Jobber visit ID" value={record.jobber_visit_id} mono />
              )}
            </div>
          </section>

          {/* Chemicals applied */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-white">Chemicals applied</h2>
            {chemicals.length === 0 ? (
              <div className="text-sm text-gray-500">No chemicals recorded.</div>
            ) : (
              <div className="space-y-2">
                {chemicals.map((c, i) => (
                  <div key={i} className="border border-gray-800 rounded-lg p-3 bg-gray-950/50">
                    <div className="font-semibold text-emerald-300">🧪 {c.chemical_name}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1 mt-2 text-sm">
                      {c.epa_registration_number && (
                        <Field label="EPA reg #" value={c.epa_registration_number} mono />
                      )}
                      {c.active_ingredients && (
                        <Field label="Active ingredients" value={c.active_ingredients} />
                      )}
                      {c.target_pests && (
                        <Field label="Target pests" value={c.target_pests} />
                      )}
                      {c.application_rate && (
                        <Field label="Application rate" value={c.application_rate} />
                      )}
                      {c.matched_line_item && (
                        <Field label="Matched line item" value={c.matched_line_item} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Weather snapshot */}
          {w && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2 text-sm">
              <h2 className="font-semibold text-white">Weather at application</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {typeof w.temperature_f === 'number' && (
                  <Field label="Temperature" value={`${w.temperature_f}°F`} />
                )}
                {w.conditions && <Field label="Conditions" value={w.conditions} />}
                {typeof w.wind_mph === 'number' && (
                  <Field label="Wind" value={`${w.wind_mph} mph`} />
                )}
                {typeof w.humidity_pct === 'number' && (
                  <Field label="Humidity" value={`${w.humidity_pct}%`} />
                )}
                {w.station_name && <Field label="Source station" value={`NWS · ${w.station_name}`} />}
                {w.observed_at && <Field label="Observed at" value={formatDateTime(w.observed_at)} />}
              </div>
            </section>
          )}

          {/* All line items on the visit (context) */}
          {lineItems.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2 text-sm">
              <h2 className="font-semibold text-white">All line items on visit</h2>
              <div className="border border-gray-800 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} className="border-b border-gray-800 last:border-b-0">
                        <td className="px-2 py-1.5 text-gray-200">{li.name ?? ''}</td>
                        <td className="px-2 py-1.5 text-right text-gray-400 w-12">{li.qty ?? ''}×</td>
                        <td className="px-2 py-1.5 text-right text-gray-200 w-20">
                          {typeof li.totalPrice === 'number' ? `$${li.totalPrice.toFixed(2)}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="text-xs text-gray-500 text-center">
            Created {formatDateTime(record.created_at)}
            {record.updated_at !== record.created_at && (
              <> · Updated {formatDateTime(record.updated_at)}</>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-gray-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  )
}
