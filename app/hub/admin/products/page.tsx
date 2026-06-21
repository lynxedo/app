import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadProductsData } from '@/lib/products-server'
import ProductsAdminPanel from './ProductsAdminPanel'

export const metadata = { title: 'Products' }
export const dynamic = 'force-dynamic'

export default async function ProductsAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id, can_admin_products')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'admin'
  if (!isSuperAdmin && !profile?.can_admin_products) redirect('/hub/home')
  if (!profile?.company_id) redirect('/hub/home')

  const admin = createAdminClient()
  const companyId = profile.company_id
  const [{ products, categories, locations }, { data: hubUsersRaw }, { data: roomsRaw }, { data: settingsRow }] = await Promise.all([
    loadProductsData(admin, companyId),
    admin.from('hub_users').select('id, display_name').eq('company_id', companyId).order('display_name'),
    admin.from('rooms').select('id, name').eq('company_id', companyId).is('archived_at', null).order('name'),
    admin.from('inventory_settings').select('*').eq('company_id', companyId).maybeSingle(),
  ])

  const inventorySettings = {
    deduct_location_id: settingsRow?.deduct_location_id ?? null,
    low_stock_alerts_enabled: settingsRow?.low_stock_alerts_enabled ?? true,
    alert_recipient_user_ids: settingsRow?.alert_recipient_user_ids ?? [],
    alert_recipient_room_ids: settingsRow?.alert_recipient_room_ids ?? [],
  }

  return (
    <ProductsAdminPanel
      initialProducts={products}
      initialCategories={categories}
      initialLocations={locations}
      hubUsers={(hubUsersRaw ?? []).filter(u => u.display_name)}
      rooms={roomsRaw ?? []}
      initialSettings={inventorySettings}
    />
  )
}
