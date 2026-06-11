'use client'

import Link from 'next/link'
import type { Form, FormField } from '@/lib/forms'

export default function FormsView({
  initialForms,
  canAdmin,
}: {
  initialForms: Form[]
  canAdmin: boolean
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-3 border-b border-white/10 flex items-center justify-between max-md:pl-14">
        <h1 className="text-xl font-bold">Forms</h1>
        {canAdmin && (
          <Link
            href="/hub/admin/forms"
            className="text-sm text-[#2E7EB8] hover:text-[#5ba3d0]"
          >
            Form Builder →
          </Link>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        {initialForms.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-gray-400">No forms available yet.</p>
            {canAdmin && (
              <p className="text-gray-500 text-sm">
                Go to <Link href="/hub/admin/forms" className="text-[#2E7EB8] hover:underline">Form Builder</Link> to create your first form.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {initialForms.map(form => {
              const fieldCount = (form.fields as FormField[]).filter(f => f.type !== 'section_title').length
              return (
                <Link
                  key={form.id}
                  href={`/hub/forms/${form.id}`}
                  className="block bg-gray-900 border border-white/10 rounded-lg p-4 hover:border-[#2E7EB8]/50 hover:bg-gray-900/80 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-white">{form.name}</h3>
                      {form.description && (
                        <p className="text-sm text-gray-400 mt-0.5">{form.description}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {fieldCount} field{fieldCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="text-sm text-[#2E7EB8] flex-shrink-0 mt-0.5">Fill out →</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
