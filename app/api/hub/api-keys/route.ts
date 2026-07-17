import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// Inbound Hub automation keys (hub_api_keys). Managed from Admin → Integrations,
// so this gate must match that page: super-admin OR the can_admin_integrations
// grant (via requireAdminArea('integrations')). Previously super-admin-only,
// which 403'd a delegated Integrations admin on save.
export async function GET() {
  const check = await requireAdminArea('integrations')
  if (!check.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_api_keys')
    .select(`
      id, name, key_prefix, created_at, last_used_at, revoked_at,
      created_by_user:hub_users!created_by (display_name)
    `)
    .eq('company_id', check.company_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const keys = (data ?? []).map((k: {
    id: string; name: string; key_prefix: string; created_at: string;
    last_used_at: string | null; revoked_at: string | null;
    created_by_user: { display_name: string } | { display_name: string }[] | null
  }) => ({
    ...k,
    created_by_user: Array.isArray(k.created_by_user) ? k.created_by_user[0] : k.created_by_user,
  }))

  return NextResponse.json({ keys })
}

export async function POST(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const admin = createAdminClient()

  // Create a bot auth user so hub_users FK is satisfied
  const botEmail = `bot-${randomBytes(6).toString('hex')}@lynxedo.internal`
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email: botEmail,
    email_confirm: true,
    user_metadata: { is_bot: true, display_name: name },
  })
  if (authErr || !authUser?.user) {
    return NextResponse.json({ error: 'Failed to create bot identity' }, { status: 500 })
  }

  // Create hub_users row for the bot
  const { error: hubErr } = await admin.from('hub_users').insert({
    id: authUser.user.id,
    company_id: check.company_id,
    display_name: name,
    is_bot: true,
    status: 'available',
  })
  if (hubErr) {
    await admin.auth.admin.deleteUser(authUser.user.id)
    return NextResponse.json({ error: 'Failed to create bot user' }, { status: 500 })
  }

  // Generate key: 32 random bytes hex = 64 chars
  const plainKey = randomBytes(32).toString('hex')
  const keyPrefix = plainKey.slice(0, 8)
  const keyHash = await bcrypt.hash(plainKey, 10)

  const { data: key, error: keyErr } = await admin
    .from('hub_api_keys')
    .insert({
      company_id: check.company_id,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_by: check.user.id,
      bot_user_id: authUser.user.id,
    })
    .select('id, name, key_prefix, created_at')
    .single()

  if (keyErr) return NextResponse.json({ error: keyErr.message }, { status: 500 })

  // Return plain key once — never stored
  return NextResponse.json({ ...key, plain_key: plainKey }, { status: 201 })
}
