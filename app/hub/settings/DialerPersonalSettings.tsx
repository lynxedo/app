'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ui'

export default function DialerPersonalSettings() {
  const supabase = createClient()
  const confirmDialog = useConfirm()
  const [loaded, setLoaded] = useState(false)
  const [greetingUrl, setGreetingUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('user_profiles')
        .select('voicemail_greeting_url')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      setGreetingUrl(data?.voicemail_greeting_url ?? null)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [supabase])

  async function uploadGreeting(file: File) {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/dialer/user-greeting', { method: 'POST', body: fd })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setGreetingUrl(data.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function clearGreeting() {
    if (!(await confirmDialog({ message: 'Remove your custom voicemail greeting?', danger: true }))) return
    setUploading(true)
    setErr(null)
    try {
      const res = await fetch('/api/dialer/user-greeting', { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Clear failed (${res.status})`)
      }
      setGreetingUrl(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="mt-6 pt-6 border-t border-gray-800 space-y-6">
      {/* Per-user voicemail greeting */}
      <div>
        <div className="text-sm font-medium">My voicemail greeting</div>
        <p className="text-xs text-gray-500 mt-1">
          MP3 or WAV, 2 MB max. Plays when callers reach your personal voicemail
          (after a direct ring or an IVR transfer). Without one, callers hear a
          spoken default that names you.
        </p>
        <div className="mt-3 space-y-2">
          {greetingUrl ? (
            <div className="flex items-center gap-3 flex-wrap">
              <audio src={greetingUrl} controls preload="metadata" className="h-8 max-w-xs" />
              <button
                type="button"
                onClick={clearGreeting}
                disabled={uploading}
                className="px-3 py-1.5 rounded text-xs border border-red-700/40 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
              >
                Remove greeting
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No custom greeting uploaded.</p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadGreeting(f)
            }}
            disabled={uploading}
            className="text-xs text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-orange-600 file:text-[#fff] file:text-sm hover:file:bg-orange-500 file:cursor-pointer"
          />
          {uploading && <span className="ml-2 text-xs text-gray-400">Uploading…</span>}
        </div>
      </div>

      {err && <p className="text-red-400 text-xs">{err}</p>}
    </div>
  )
}
