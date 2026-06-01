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
  const { products, categories, locations } = await loadProductsData(admin, profile.company_id)

  return (
    <ProductsAdminPanel
      initialProducts={products}
      initialCategories={categories}
      initialLocations={locations}
    />
  )
}
