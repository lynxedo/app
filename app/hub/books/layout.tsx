import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import FinancialPinGate from '@/components/books/FinancialPinGate'

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

  return (
    <FinancialPinGate defaultUnlocked={defaultUnlocked}>
      {children}
    </FinancialPinGate>
  )
}
