'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function RefreshButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  function handleRefresh() {
    setLoading(true)
    router.refresh()
    setTimeout(() => setLoading(false), 1500)
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={loading}
      className="text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-4 py-2 rounded-lg transition-colors"
    >
      {loading ? 'Refreshing…' : 'Refresh Data'}
    </button>
  )
}
