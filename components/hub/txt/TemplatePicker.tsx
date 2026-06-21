'use client'

import { useEffect, useMemo, useRef } from 'react'
import { buildFieldMap, renderTemplate } from '@/lib/txt-templates'

export type PickerTemplate = {
  id: string
  scope: 'org' | 'personal'
  title: string
  body: string
}

// Live preview that mirrors what /api/txt/conversations/[id]/send will render
// server-side. Kept here so the picker can show "Hi Sarah, ..." instead of
// "Hi {first_name}, ..." — gives the user confidence the substitution will work.
function previewBody(
  body: string,
  ctx: { contactName?: string | null; senderName?: string | null; companyName?: string | null }
): string {
  return renderTemplate(body, ctx)
}

export default function TemplatePicker({
  templates,
  query,
  contactName,
  senderName,
  companyName,
  selectedIndex,
  onIndexChange,
  onPick,
  onClose,
}: {
  templates: PickerTemplate[]
  query: string
  contactName: string | null
  senderName: string | null
  companyName: string | null
  selectedIndex: number
  onIndexChange: (i: number) => void
  onPick: (t: PickerTemplate) => void
  onClose: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items = q
      ? templates.filter(
          (t) =>
            t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)
        )
      : templates
    // Personal first (already sorted that way by GET), then org.
    return items
  }, [templates, query])

  // Keep the selected row scrolled into view when arrow-navigating.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-template-row="${selectedIndex}"]`
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Click-outside to dismiss
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-template-picker]')) onClose()
    }
    document.addEventListener('mousedown', handleDocClick)
    return () => document.removeEventListener('mousedown', handleDocClick)
  }, [onClose])

  if (filtered.length === 0) {
    return (
      <div
        data-template-picker
        className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 px-3 py-2 text-xs text-white/50"
      >
        {templates.length === 0
          ? 'No templates yet. Create one in Settings → Account → Communications, or admins can add org templates in /admin/txt.'
          : `No templates match "${query}".`}
      </div>
    )
  }

  // Quick verification that field substitution is configured for this context.
  // Hidden in the UI; used only as a no-op so the field map import isn't tree-shaken
  // out in dev when the picker first renders an empty preview.
  void buildFieldMap({ contactName, senderName, companyName })

  return (
    <div
      data-template-picker
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 max-h-72 overflow-y-auto"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-white/40 border-b border-white/5">
        Templates · ↑↓ navigate · Enter to insert · Esc to close
      </div>
      {filtered.map((t, i) => {
        const isSelected = i === selectedIndex
        const preview = previewBody(t.body, { contactName, senderName, companyName })
        return (
          <button
            key={t.id}
            data-template-row={i}
            type="button"
            onMouseEnter={() => onIndexChange(i)}
            onClick={() => onPick(t)}
            className={`block w-full text-left px-3 py-2 border-b border-white/5 last:border-b-0 ${
              isSelected ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium truncate">{t.title}</div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full flex-none ${
                  t.scope === 'personal'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-sky-500/20 text-sky-300'
                }`}
              >
                {t.scope === 'personal' ? 'Mine' : 'Org'}
              </span>
            </div>
            <div className="text-xs text-white/60 mt-0.5 line-clamp-2 whitespace-pre-wrap">
              {preview}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// Helper that filters templates the same way the picker does — useful for the
// keyboard handler in the composer to know which template Enter would select.
export function filterTemplates(
  templates: PickerTemplate[],
  query: string
): PickerTemplate[] {
  const q = query.trim().toLowerCase()
  if (!q) return templates
  return templates.filter(
    (t) => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)
  )
}
