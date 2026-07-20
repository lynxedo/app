import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePlatformAdmin } from '@/lib/platform-auth'
import { listTenants, getBillingMode } from '@/lib/billing/catalog'
import { logPlatformAction } from '@/lib/billing/audit'
import { RESERVED_SUBDOMAINS } from '@/lib/tenant-host'

// Platform super-admin tenant console (cross-company). Lists every tenant with a
// compact billing snapshot for the current env's billing mode. Service-role admin
// client — this reads across all companies, which RLS would otherwise scope out.

export async function GET() {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const admin = createAdminClient()
  try {
    const tenants = await listTenants(admin, getBillingMode())
    return NextResponse.json({ tenants })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// ── "Add subscriber" — provision a brand-new tenant company + its owner in one shot,
// no manual DB editing. Platform-admin only.
//
// Flow (order matters for clean rollback):
//   1. Validate name / subdomain slug / owner email.
//   2. Reject a slug that is reserved OR already taken by another company.
//   3. Insert the company (is_active, no google_domain — it's a fresh tenant).
//   4. Invite the owner by email (same magic-link flow the per-company People invite
//      uses). If the email already has an account, or the invite otherwise fails, the
//      just-created company is best-effort deleted so no orphan tenant is left behind.
//   5. Provision + ELEVATE the owner to a full company admin scoped to the NEW company.
//   6. Audit-log the creation.

const SLUG_RE = /^[a-z0-9-]{2,40}$/
// A deliberately-loose email shape check (real validation happens when Supabase
// accepts the invite address).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The full set of per-area admin grants (lib/admin-auth.ts AREA_TO_FLAG) — the owner
// gets every one so they control their whole tenant's admin surface.
const CAN_ADMIN_FLAGS = [
  'can_admin_people',
  'can_admin_hub',
  'can_admin_guardian',
  'can_admin_ai',
  'can_admin_txt',
  'can_admin_announcements',
  'can_admin_file_tags',
  'can_admin_routing',
  'can_admin_timesheet',
  'can_admin_fleet',
  'can_admin_daily_log',
  'can_admin_zone_sizer',
  'can_admin_dialer',
  'can_admin_contacts',
  'can_admin_marketing',
  'can_admin_email',
  'can_admin_forms',
  'can_admin_products',
  'can_admin_integrations',
] as const

// Every per-module access grant read in app/hub/layout.tsx — the owner gets each so
// every feature their plan includes is reachable out of the box.
const CAN_ACCESS_FLAGS = [
  'can_access_tracker',
  'can_access_files',
  'can_access_pesticide_records',
  'can_access_hub',
  'can_access_call_log',
  'can_access_call_log2',
  'can_access_lawn',
  'can_access_timesheet',
  'can_access_routing',
  'can_access_books',
  'can_access_fleet',
  'can_access_zone_sizer',
  'can_access_dialer',
  'can_access_txt',
  'can_access_unified_inbox',
  'can_access_marketing',
  'can_access_email',
  'can_access_forms',
  'can_access_daily_log_v2',
  'can_access_pricer',
  'can_access_scoreboards',
  'can_access_beta',
] as const

export async function POST(request: Request) {
  const gate = await requirePlatformAdmin()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  let body: {
    name?: unknown
    subdomain_slug?: unknown
    owner_email?: unknown
    owner_name?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const slug = typeof body.subdomain_slug === 'string' ? body.subdomain_slug.trim().toLowerCase() : ''
  const ownerEmail = typeof body.owner_email === 'string' ? body.owner_email.trim() : ''
  const ownerName = typeof body.owner_name === 'string' ? body.owner_name.trim() : ''

  // ── validate ──
  if (!name) return NextResponse.json({ error: 'Company name is required.' }, { status: 400 })
  if (!slug) return NextResponse.json({ error: 'Subdomain is required.' }, { status: 400 })
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: 'Subdomain must be 2–40 characters using only lowercase letters, numbers, and hyphens.' },
      { status: 400 },
    )
  }
  if (RESERVED_SUBDOMAINS.has(slug)) {
    return NextResponse.json({ error: `"${slug}" is a reserved subdomain. Choose another.` }, { status: 400 })
  }
  if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
    return NextResponse.json({ error: 'A valid owner email is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ── slug uniqueness ──
  const { data: slugTaken, error: slugErr } = await admin
    .from('companies')
    .select('id')
    .eq('subdomain_slug', slug)
    .maybeSingle()
  if (slugErr) return NextResponse.json({ error: slugErr.message }, { status: 500 })
  if (slugTaken) {
    return NextResponse.json({ error: `The subdomain "${slug}" is already in use.` }, { status: 400 })
  }

  // ── create the company ──
  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({ name, subdomain_slug: slug, is_active: true })
    .select('id, name, subdomain_slug, is_active')
    .single()
  if (companyErr || !company) {
    return NextResponse.json({ error: companyErr?.message || 'Could not create the company.' }, { status: 500 })
  }

  // From here on, any failure must clean up the just-created company so we never
  // leave an orphan tenant with no owner.
  const rollbackCompany = async () => {
    await admin.from('companies').delete().eq('id', company.id)
  }

  // ── invite the owner (same magic-link flow as the per-company People invite) ──
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })
  if (inviteErr || !invited?.user) {
    await rollbackCompany()
    // A pre-existing account is the expected "soft" failure — surface it as a 400 and
    // never silently reattach that user to the new company.
    const msg = (inviteErr?.message || '').toLowerCase()
    const alreadyExists =
      (inviteErr as { code?: string } | null)?.code === 'email_exists' ||
      msg.includes('already been registered') ||
      msg.includes('already registered') ||
      msg.includes('already exists')
    if (alreadyExists) {
      return NextResponse.json({ error: 'That email already has an account.' }, { status: 400 })
    }
    return NextResponse.json(
      { error: inviteErr?.message || 'Could not invite the owner.' },
      { status: 500 },
    )
  }

  const ownerUserId = invited.user.id
  const displayName = ownerName || ownerEmail.split('@')[0]

  try {
    // Provision the owner's profile + Hub identity in the NEW company. The on-signup
    // trigger only auto-provisions domain-matched emails, so an invited owner would
    // otherwise land with no (or a wrong/default) company. ignoreDuplicates leaves any
    // trigger-created row in place; the authoritative UPDATE below then re-scopes it.
    await admin.from('user_profiles').upsert(
      {
        id: ownerUserId,
        company_id: company.id,
        role: 'user',
        can_access_routing: false,
        can_access_lawn: false,
        can_access_call_log: false,
        can_access_responder: false,
        can_access_timesheet: false,
        can_access_books: false,
        can_access_tracker: false,
        can_access_hub: true,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    await admin.from('hub_users').upsert(
      {
        id: ownerUserId,
        company_id: company.id,
        display_name: displayName,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )

    // Elevate to a full company admin, authoritative on company scope. company_id is set
    // here too (not just in the upsert) so a trigger row that inherited a DEFAULT company
    // can't leave the owner attached to the wrong tenant.
    const elevate: Record<string, unknown> = {
      company_id: company.id,
      role: 'admin',
      is_platform_admin: false,
      invite_sent_at: new Date().toISOString(),
    }
    if (ownerName) elevate.full_name = ownerName
    for (const f of CAN_ADMIN_FLAGS) elevate[f] = true
    for (const f of CAN_ACCESS_FLAGS) elevate[f] = true

    const { error: elevateErr } = await admin.from('user_profiles').update(elevate).eq('id', ownerUserId)
    if (elevateErr) throw new Error(elevateErr.message)

    // Keep the Hub identity's company + name in sync (in case a trigger created it first).
    await admin
      .from('hub_users')
      .update({ company_id: company.id, display_name: displayName })
      .eq('id', ownerUserId)
  } catch (e) {
    // Provision/elevate failed after the company + auth user were created. Roll the
    // company back so a retry with the same slug is clean; the auth user cannot be
    // silently reused for another company, so leave it for manual review.
    await rollbackCompany()
    return NextResponse.json(
      { error: `Owner setup failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }

  await logPlatformAction(admin, gate.userId, 'create_company', company.id, {
    owner_email: ownerEmail,
    subdomain_slug: slug,
  })

  return NextResponse.json({
    company: {
      id: company.id,
      name: company.name,
      subdomain_slug: company.subdomain_slug,
      is_active: company.is_active,
    },
    owner_user_id: ownerUserId,
    subdomain_slug: slug,
  })
}
