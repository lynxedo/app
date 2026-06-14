// Shared admin section card (audit AD-toolkit). The
// `rounded-lg border border-white/10 bg-white/5 p-4` section wrapper with a
// title + description header was hand-repeated across every admin panel.
import React from 'react'

type AdminCardProps = {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned header slot (e.g. a save-status chip or a Save button). */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function AdminCard({ title, description, actions, children, className }: AdminCardProps) {
  const hasHeader = title || description || actions
  return (
    <section className={`space-y-4 rounded-lg border border-white/10 bg-white/5 p-4 ${className ?? ''}`}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-xs text-white/50">{description}</p>}
          </div>
          {actions && <div className="flex-none">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export default AdminCard
