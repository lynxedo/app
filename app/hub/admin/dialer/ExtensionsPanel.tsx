'use client'

import { useState } from 'react'

export type ExtensionRow = {
  user_id: string
  display_name: string
  extension: string | null
}

export default function ExtensionsPanel({
  initial,
  onChange,
}: {
  initial: ExtensionRow[]
  onChange?: (rows: ExtensionRow[]) => void
}) {
  const [rows, setRows] = useState<ExtensionRow[]>(initial)
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((r) => [r.user_id, r.extension ?? '']))
  )
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function suggestNextExtension(): string {
    const taken = new Set(
      rows.map((r) => r.extension).filter((x): x is string => !!x)
    )
    for (let i = 101; i <= 999; i++) {
      const s = String(i)
      if (!taken.has(s)) return s
    }
    return ''
  }

  async function save(userId: string, raw: string) {
    setSavingUserId(userId)
    setError(null)
    const ext = raw.trim() === '' ? null : raw.trim()
    if (ext !== null && !/^[1-9][0-9]{2}$/.test(ext)) {
      setError('Extension must be 3 digits, 100–999.')
      setSavingUserId(null)
      return
    }
    try {
      const res = await fetch('/api/admin/dialer/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, extension: ext }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      const next = rows.map((r) =>
        r.user_id === userId ? { ...r, extension: ext } : r
      )
      setRows(next)
      onChange?.(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Roll the draft back so the input shows the saved value.
      const orig = rows.find((r) => r.user_id === userId)
      setDraft((d) => ({ ...d, [userId]: orig?.extension ?? '' }))
    } finally {
      setSavingUserId(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        Internal 3-digit shortcut so anyone in Hub can dial coworkers from the
        Dialpad. Type the extension (e.g. 101) and press Call. Leave blank to
        un-assign.
      </p>
      {error && (
        <div className="rounded-md border border-red-700/40 bg-red-900/30 text-red-200 px-2 py-1.5 text-xs">
          {error}
        </div>
      )}
      <ul className="space-y-1">
        {rows.map((r) => {
          const value = draft[r.user_id] ?? ''
          const dirty = (value || null) !== (r.extension || null)
          return (
            <li
              key={r.user_id}
              className="flex items-center gap-3 px-3 py-2 rounded border border-white/10 bg-white/5"
            >
              <span className="flex-1 text-sm truncate">{r.display_name}</span>
              <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [r.user_id]: e.target.value.replace(/\D/g, '').slice(0, 3),
                  }))
                }
                placeholder="—"
                className="w-20 bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm text-center font-mono"
              />
              {!r.extension && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, [r.user_id]: suggestNextExtension() }))
                  }
                  className="text-xs px-2 py-1 rounded border border-white/15 text-white/60 hover:bg-white/10"
                  title="Use next available extension"
                >
                  Suggest
                </button>
              )}
              <button
                type="button"
                onClick={() => save(r.user_id, value)}
                disabled={!dirty || savingUserId === r.user_id}
                className="text-xs px-3 py-1 rounded bg-[#2E7EB8] hover:bg-[#3a8dc9] disabled:opacity-30 disabled:bg-white/5"
              >
                {savingUserId === r.user_id ? 'Saving…' : dirty ? 'Save' : 'Saved'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
