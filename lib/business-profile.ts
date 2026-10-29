import type { SupabaseClient } from '@supabase/supabase-js'

// Per-company "business profile" — the tenant's customer-facing identity
// (business name, city, phone, etc.). This is the abstraction that lets a future
// Lynxedo subscriber NOT be hardcoded as "Heroes Lawn Care" in the strings that
// go out to their customers (SMS signatures, the voice recap text, branding).
//
// Source of truth is the additive `business_profiles` table (one row per
// company; see supabase/2026-07-17_business_profile.sql). Every field falls back
// to HEROES_BUSINESS_PROFILE_FALLBACK when the row (or a field) is missing, so
// behavior is byte-identical to the pre-abstraction code for Heroes — and for
// any company that has not been given a row yet, or before the migration is
// applied at all.

export type BusinessProfile = {
  /** Full customer-facing business name, e.g. "Heroes Lawn Care". */
  businessName: string
  /** Short/casual form used as a bare fallback, e.g. "Heroes". */
  shortName: string
  city: string
  /** State / region, e.g. "TX". */
  region: string
  /** Human list of the areas served (marketing copy). */
  serviceArea: string
  phone: string
  /** Sign-off name for message signatures (may differ from the legal name). */
  signatureName: string
  website: string
}

// ── Heroes fallback = today's EXACT hardcoded values ─────────────────────────
// These are the literals that were hardcoded in the customer-facing strings
// before this abstraction. DO NOT change them: they are what preserves current
// Heroes behavior whenever a company has no business_profiles row. (`businessName`
// is the only field wired into a live customer message today; the rest are
// populated for completeness / future use and are Heroes' real details.)
export const HEROES_BUSINESS_PROFILE_FALLBACK: BusinessProfile = {
  businessName: 'Heroes Lawn Care',
  shortName: 'Heroes',
  city: 'The Woodlands',
  region: 'TX',
  serviceArea: 'The Woodlands, Spring, Magnolia, Conroe, and Tomball',
  phone: '(832) 220-8100',
  signatureName: 'Heroes Lawn Care',
  website: 'heroeslawncare.com',
}

// The company whose details HEROES_BUSINESS_PROFILE_FALLBACK are.
const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

/** Fallback for a non-Heroes company with no business_profiles row: its own
 *  company name, everything else blank. */
async function neutralProfile(admin: SupabaseClient, companyId: string): Promise<BusinessProfile> {
  let name = ''
  try {
    const { data } = await admin.from('companies').select('name').eq('id', companyId).maybeSingle()
    name = ((data?.name as string | undefined) ?? '').trim()
  } catch {
    name = ''
  }
  return {
    businessName: name,
    shortName: name,
    city: '',
    region: '',
    serviceArea: '',
    phone: '',
    signatureName: name,
    website: '',
  }
}

type BusinessProfileRow = {
  company_id: string
  business_name: string | null
  short_name: string | null
  city: string | null
  region: string | null
  service_area: string | null
  phone: string | null
  signature_name: string | null
  website: string | null
}

const COLUMNS =
  'company_id, business_name, short_name, city, region, service_area, phone, signature_name, website'

/**
 * Resolve the effective business profile for a company.
 *
 * Pass an admin (service-role) client — the callers that need this (SMS/voice
 * send paths, server pages) already create one, and it bypasses RLS so the
 * lookup never depends on the caller's session. For Heroes, any missing row /
 * missing field / query error resolves to the Heroes fallback, so this can never
 * throw and can never change Heroes' current output; any other company falls
 * back to its own name and blanks.
 */
export async function getBusinessProfile(
  admin: SupabaseClient,
  companyId: string | null | undefined,
): Promise<BusinessProfile> {
  if (!companyId) return { ...HEROES_BUSINESS_PROFILE_FALLBACK }
  // Heroes' own details are the fallback ONLY for Heroes (it has no row yet).
  // Any other company without a row gets its own name and blanks — never Heroes'
  // name, city, phone or website (SaaS Launch Gate Session 3).
  const fb = companyId === HEROES_COMPANY_ID
    ? HEROES_BUSINESS_PROFILE_FALLBACK
    : await neutralProfile(admin, companyId)

  let row: BusinessProfileRow | null = null
  try {
    const { data } = await admin
      .from('business_profiles')
      .select(COLUMNS)
      .eq('company_id', companyId)
      .maybeSingle()
    row = (data as BusinessProfileRow | null) ?? null
  } catch {
    // Table may not exist yet (migration not applied) — fall back cleanly.
    row = null
  }

  return {
    businessName: row?.business_name?.trim() || fb.businessName,
    shortName: row?.short_name?.trim() || fb.shortName,
    city: row?.city?.trim() || fb.city,
    region: row?.region?.trim() || fb.region,
    serviceArea: row?.service_area?.trim() || fb.serviceArea,
    phone: row?.phone?.trim() || fb.phone,
    signatureName: row?.signature_name?.trim() || fb.signatureName,
    website: row?.website?.trim() || fb.website,
  }
}
