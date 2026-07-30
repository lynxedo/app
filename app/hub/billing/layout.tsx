// The Hub shell renders each page into a bare, overflow-hidden flex slot with no padding
// or scroll of its own — every section is expected to provide its own scroll container.
// Billing is a single scrollable page, so — mirroring app/hub/admin/layout.tsx — wrap it
// in a padded, vertically-scrollable container. Without this, BillingView bled to the
// edge (into the sidebar) and couldn't scroll when taller than the viewport.
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10">{children}</main>
    </div>
  )
}
