import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import FinancialPinGate from '@/components/books/FinancialPinGate'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'

export const metadata = { title: 'Books' }

function getSecret() {
  return new TextEncoder().encode(process.env.COOKIE_SECRET!)
}

export default async function BooksLayout({ children }: { children: React.ReactNode }) {
  let defaultUnlocked = false

  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('books_unlocked')?.value
    if (token) {
      await jwtVerify(token, getSecret())
      defaultUnlocked = true
    }
  } catch {
    // invalid or expired cookie — show PIN gate
  }

  // Company name for the PIN screen branding (defaults to the current Heroes
  // value inside the resolver).
  let businessName = 'Heroes Lawn Care'
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles').select('company_id').eq('id', user.id).single()
      const bp = await getBusinessProfile(createAdminClient(), profile?.company_id ?? null)
      businessName = bp.businessName
    }
  } catch {
    // keep the Heroes fallback
  }

  return (
    <FinancialPinGate defaultUnlocked={defaultUnlocked} businessName={businessName}>
      {children}
    </FinancialPinGate>
  )
}
