import bcrypt from 'bcrypt'
import { createAdminClient } from '@/lib/supabase/admin'

export type HubApiKeyContext = {
  keyId: string
  companyId: string
  name: string
  botUserId: string | null
}

// Verifies the Authorization: Bearer <key> header against hub_api_keys.
// Returns { context } on success or { error, status } on failure.
export async function verifyHubApiKey(request: Request): Promise<
  { context: HubApiKeyContext } | { error: string; status: number }
> {
  const authHeader = request.headers.get('authorization') ?? ''
  const plainKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (plainKey.length < 8) return { error: 'Missing or invalid API key', status: 401 }

  const keyPrefix = plainKey.slice(0, 8)
  const admin = createAdminClient()

  const { data: candidates } = await admin
    .from('hub_api_keys')
    .select('id, company_id, name, key_hash, bot_user_id')
    .eq('key_prefix', keyPrefix)
    .is('revoked_at', null)

  if (!candidates || candidates.length === 0) {
    return { error: 'Invalid API key', status: 401 }
  }

  type Candidate = { id: string; company_id: string; name: string; key_hash: string; bot_user_id: string | null }
  for (const c of candidates as Candidate[]) {
    if (await bcrypt.compare(plainKey, c.key_hash)) {
      return {
        context: {
          keyId: c.id,
          companyId: c.company_id,
          name: c.name,
          botUserId: c.bot_user_id,
        },
      }
    }
  }
  return { error: 'Invalid API key', status: 401 }
}
