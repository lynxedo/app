'use client'
// Shared toast system (audit #21). Replaces the scattered window.alert() calls
// and one-off inline status strings with a single, non-blocking notifier.
//
// Usage:
//   1. Mount <ToastProvider> once high in the tree (done in app/hub/layout).
//   2. In any descendant client component:  const toast = useToast()
//      toast.success('Saved'); toast.error('Could not save'); toast.show('…')
import React, { createContext, useCallback, useContext, useRef, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; message: string; kind: ToastKind }

type ToastApi = {
  show: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const KIND_STYLE: Record<ToastKind, string> = {
  success: 'border-success/40 bg-gray-900 text-success',
  error: 'border-danger/40 bg-gray-900 text-red-300',
  info: 'border-gray-700 bg-gray-900 text-gray-200',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId.current++
      setToasts(prev => [...prev, { id, message, kind }])
      // Auto-dismiss; errors linger a bit longer.
      const ttl = kind === 'error' ? 5000 : 3000
      setTimeout(() => remove(id), ttl)
    },
    [remove],
  )

  const api: ToastApi = {
    show,
    success: useCallback((m: string) => show(m, 'success'), [show]),
    error: useCallback((m: string) => show(m, 'error'), [show]),
    info: useCallback((m: string) => show(m, 'info'), [show]),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => remove(t.id)}
            className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-2.5 text-sm shadow-2xl transition-opacity ${KIND_STYLE[t.kind]}`}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Returns the toast API. Falls back to window.alert if no provider is mounted
 * (so a stray caller never crashes), but the provider should always be present
 * inside /hub.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  const fallback = (m: string) => {
    if (typeof window !== 'undefined') window.alert(m)
  }
  return { show: fallback, success: fallback, error: fallback, info: fallback }
}

export default ToastProvider
