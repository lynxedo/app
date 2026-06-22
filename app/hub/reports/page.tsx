import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

const REPORTS = [
  { href: '/hub/reports/visits', title: 'Visit Report', desc: 'Completed visits by technician — counts, value, recurring vs one-off, drill-down per tech.' },
  { href: '/hub/reports/customers', title: 'Customer Report', desc: 'Every customer and property with a column-picker — toggle any field, including custom fields. Search, sort, export to CSV.' },
]

export default async function ReportsIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/hub')

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <div className="flex-none border-b border-white/10 px-4 py-3 max-md:pl-14">
        <h1 className="text-lg font-semibold">Reports</h1>
        <p className="text-sm text-white/50">Operational and customer reporting</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
          {REPORTS.map((r) => (
            <Link key={r.href} href={r.href}
              className="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors p-4">
              <div className="font-semibold mb-1">{r.title}</div>
              <div className="text-sm text-white/50">{r.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
