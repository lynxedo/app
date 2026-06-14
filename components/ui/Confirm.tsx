'use client'
// Shared confirm dialog (audit #38). Replaces raw browser confirm(), which
// renders as an ugly OS popup inside the app. Promise-based on purpose: callers
// `await confirm(...)` exactly where they used to call `confirm(...)`, so the
// control flow is IDENTICAL — the destructive action still runs only after the
// user clicks Confirm, nothing happens early. (A naive onClick-modal would NOT
// preserve that ordering.)
import React, { createContext, useCallback, useContext, useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

export type ConfirmOptions = {
  title?: string
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  /** Red confirm button for destructive actions (delete, remove). */
  danger?: boolean
}

type ConfirmFn = (optsOrMessage: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

type Pending = { opts: ConfirmOptions; resolve: (v: boolean) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<ConfirmFn>((optsOrMessage) => {
    const opts: ConfirmOptions =
      typeof optsOrMessage === 'string' ? { message: optsOrMessage } : optsOrMessage
    return new Promise<boolean>(resolve => setPending({ opts, resolve }))
  }, [])

  const settle = useCallback((value: boolean) => {
    setPending(prev => {
      prev?.resolve(value)
      return null
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.opts.title ?? 'Are you sure?'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => settle(false)}>
              {pending?.opts.cancelText ?? 'Cancel'}
            </Button>
            <Button
              variant={pending?.opts.danger ? 'danger' : 'primary'}
              onClick={() => settle(true)}
            >
              {pending?.opts.confirmText ?? 'Confirm'}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-gray-300">{pending?.opts.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  )
}

/** Returns an async confirm(): `if (!(await confirm('Delete this?'))) return`. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
