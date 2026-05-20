import { Suspense } from 'react'
import HelpContent from './HelpContent'

export const metadata = {
  title: 'Help — Lynxedo',
}

export default function HelpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <HelpContent />
    </Suspense>
  )
}
