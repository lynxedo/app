import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isValidLayoutShape } from '@/lib/hub-layout'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: hubUser } = await supabase
    .from('hub_users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('phone, hub_text_size, hub_pinned_ids, full_name, landing_page, hub_theme')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    email: user.email,
    full_name: profile?.full_name ?? null,
    display_name: hubUser?.display_name ?? null,
    avatar_url: hubUser?.avatar_url ?? null,
    phone: profile?.phone ?? null,
    hub_text_size: profile?.hub_text_size ?? 'default',
    hub_pinned_ids: profile?.hub_pinned_ids ?? [],
    landing_page: profile?.landing_page ?? 'hub',
    hub_theme: profile?.hub_theme ?? 'midnight',
  })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { display_name, full_name, phone, hub_text_size, hub_pinned_ids, landing_page, rail_config, hub_layout, txt_signature, dialer_global_ring, dialer_dnd_enabled, dialer_dnd_schedule, master_dnd_enabled, master_dnd_schedule, hub_dnd_enabled, hub_dnd_schedule, hub_theme } = await request.json()

  if (landing_page !== undefined && landing_page !== 'hub' && landing_page !== 'dashboard') {
    return NextResponse.json({ error: 'landing_page must be "hub" or "dashboard"' }, { status: 400 })
  }

  // Lightweight validation for rail_config — must be { desktop: [], mobile: [] }
  // with entries that are either string (catalog id / "url:..."), or null.
  if (rail_config !== undefined && rail_config !== null) {
    const isStringOrNull = (v: unknown) => v === null || typeof v === 'string'
    if (
      typeof rail_config !== 'object' ||
      !Array.isArray((rail_config as { desktop?: unknown }).desktop) ||
      !Array.isArray((rail_config as { mobile?: unknown }).mobile) ||
      !(rail_config as { desktop: unknown[] }).desktop.every(isStringOrNull) ||
      !(rail_config as { mobile: unknown[] }).mobile.every(isStringOrNull)
    ) {
      return NextResponse.json({ error: 'invalid rail_config shape' }, { status: 400 })
    }
  }

  if (display_name !== undefined) {
    const { error } = await supabase
      .from('hub_users')
      .update({ display_name: display_name || null })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const profileUpdates: Record<string, unknown> = {}
  if (full_name !== undefined) profileUpdates.full_name = full_name || null
  if (phone !== undefined) profileUpdates.phone = phone || null
  if (hub_text_size !== undefined) profileUpdates.hub_text_size = hub_text_size
  if (hub_theme !== undefined) {
    const validThemes = ['midnight','carbon','evergreen','slate','ember','mocha','daylight','linen','sage','arctic','blossom','graphite']
    if (!validThemes.includes(hub_theme)) {
      return NextResponse.json({ error: 'invalid hub_theme' }, { status: 400 })
    }
    profileUpdates.hub_theme = hub_theme
  }
  if (hub_pinned_ids !== undefined) profileUpdates.hub_pinned_ids = hub_pinned_ids
  if (landing_page !== undefined) profileUpdates.landing_page = landing_page
  if (rail_config !== undefined) profileUpdates.rail_config = rail_config
  if (hub_layout !== undefined) {
    if (hub_layout !== null && !isValidLayoutShape(hub_layout)) {
      return NextResponse.json({ error: 'invalid hub_layout shape' }, { status: 400 })
    }
    // Store a minimal, well-formed v3 object (one ordered list). Accept a
    // stray legacy v2 body too, flattening it to items.
    if (hub_layout === null) {
      profileUpdates.hub_layout = null
    } else {
      const hl = hub_layout as { items?: string[]; desktop?: string[]; mobile?: string[] }
      const items = Array.isArray(hl.items)
        ? hl.items
        : [...(hl.desktop ?? []), ...(hl.mobile ?? [])]
      profileUpdates.hub_layout = { version: 3, items }
    }
  }
  if (txt_signature !== undefined) {
    if (txt_signature !== null && typeof txt_signature !== 'string') {
      return NextResponse.json({ error: 'txt_signature must be a string or null' }, { status: 400 })
    }
    if (typeof txt_signature === 'string' && txt_signature.length > 500) {
      return NextResponse.json({ error: 'txt_signature too long (max 500 chars)' }, { status: 400 })
    }
    profileUpdates.txt_signature = txt_signature ? txt_signature : null
  }
  if (dialer_global_ring !== undefined) {
    if (typeof dialer_global_ring !== 'boolean') {
      return NextResponse.json({ error: 'dialer_global_ring must be a boolean' }, { status: 400 })
    }
    profileUpdates.dialer_global_ring = dialer_global_ring
  }
  if (dialer_dnd_enabled !== undefined) {
    if (typeof dialer_dnd_enabled !== 'boolean') {
      return NextResponse.json({ error: 'dialer_dnd_enabled must be a boolean' }, { status: 400 })
    }
    profileUpdates.dialer_dnd_enabled = dialer_dnd_enabled
  }
  if (dialer_dnd_schedule !== undefined) {
    if (dialer_dnd_schedule !== null && (typeof dialer_dnd_schedule !== 'object' || Array.isArray(dialer_dnd_schedule))) {
      return NextResponse.json({ error: 'dialer_dnd_schedule must be an object or null' }, { status: 400 })
    }
    profileUpdates.dialer_dnd_schedule = dialer_dnd_schedule ?? {}
  }
  if (master_dnd_enabled !== undefined) {
    if (typeof master_dnd_enabled !== 'boolean') {
      return NextResponse.json({ error: 'master_dnd_enabled must be a boolean' }, { status: 400 })
    }
    profileUpdates.master_dnd_enabled = master_dnd_enabled
  }
  if (master_dnd_schedule !== undefined) {
    if (master_dnd_schedule !== null && (typeof master_dnd_schedule !== 'object' || Array.isArray(master_dnd_schedule))) {
      return NextResponse.json({ error: 'master_dnd_schedule must be an object or null' }, { status: 400 })
    }
    profileUpdates.master_dnd_schedule = master_dnd_schedule ?? {}
  }
  if (hub_dnd_enabled !== undefined) {
    if (typeof hub_dnd_enabled !== 'boolean') {
      return NextResponse.json({ error: 'hub_dnd_enabled must be a boolean' }, { status: 400 })
    }
    profileUpdates.hub_dnd_enabled = hub_dnd_enabled
  }
  if (hub_dnd_schedule !== undefined) {
    if (hub_dnd_schedule !== null && (typeof hub_dnd_schedule !== 'object' || Array.isArray(hub_dnd_schedule))) {
      return NextResponse.json({ error: 'hub_dnd_schedule must be an object or null' }, { status: 400 })
    }
    profileUpdates.hub_dnd_schedule = hub_dnd_schedule ?? {}
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabase
      .from('user_profiles')
      .update(profileUpdates)
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
