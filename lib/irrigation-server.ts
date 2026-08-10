import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'

// Server-only helpers for the irrigation API routes (auth gate, contact scope
// check, share-token minting). Kept out of lib/irrigation.ts because that module
// is imported by client components and must stay free of Node built-ins.

export type IrrigationAccess = { userId: string; companyId: string; canEdit: boolean }

/**
 * Resolve the caller's access. Any authenticated same-company user with
 * can_access_hub may read; canEdit (create/edit/finalize/text) requires
 * can_access_irrigation or admin.
 */
export async function resolveIrrigationAccess(): Promise<IrrigationAccess | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_hub, can_access_irrigation')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id || !profile.can_access_hub) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const canEdit = profile.role === 'admin' || profile.can_access_irrigation === true
  return { userId: user.id, companyId: profile.company_id as string, canEdit }
}

/** True when the contact exists and belongs to the caller's company. */
export async function contactInCompany(
  admin: ReturnType<typeof createAdminClient>,
  contactId: string,
  companyId: string,
): Promise<boolean> {
  const { data } = await admin.from('txt_contacts').select('id, company_id').eq('id', contactId).maybeSingle()
  return !!data && data.company_id === companyId
}

/** Unguessable share token for the customer-facing summary link. */
export function newShareToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}
