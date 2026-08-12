import type { createClient } from '@/lib/supabase/server'

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * The report slugs a user is explicitly granted (Admin → Reports). Drives layer 2
 * of the §12 access model; `can_access_reports` is layer 1 and only opens the
 * section. Default is nothing-until-granted, so the section flag alone now shows
 * an empty index rather than every report.
 *
 * Read through the REQUEST-SCOPED (user) client on purpose: RLS on `report_access`
 * exposes only the caller's own rows, so this cannot be tricked into reporting
 * someone else's grants even if a caller-supplied id were ever threaded in here by
 * mistake. Admins bypass this entirely — see `canSeeReport` in ./registry.
 */
export async function getGrantedReportSlugs(
  supabase: ServerClient,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('report_access')
    .select('report_slug')
    .eq('user_id', userId)
  return (data ?? []).map(r => r.report_slug as string)
}
