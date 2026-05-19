'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Splash page in the native app (iOS/Android) redirects here first.
// Running on lynxedo.com domain, so localStorage.setItem works and is
// readable by the login page when the user needs to authenticate.
export default function NativeRedirect() {
  const router = useRouter()

  useEffect(() => {
    try {
      localStorage.setItem('lynxedo_native', '1')
    } catch {
      // ignore
    }
    router.replace('/hub')
  }, [router])

  return (
    <div style={{
      background: '#0f172a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      margin: 0,
    }}>
      <div style={{
        width: 40,
        height: 40,
        border: '3px solid #334155',
        borderTopColor: '#ff8624',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
