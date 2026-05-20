'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { createClient } from '@/lib/supabase/client'

interface HubProfile {
  full_name: string | null
  display_name: string | null
  avatar_url: string | null
  phone: string | null
}

interface NotifPref {
  level: 'all' | 'mentions' | 'muted'
  dnd_enabled: boolean
  dnd_start: string | null
  dnd_end: string | null
}

interface Props {
  email: string
  userId: string
  hubProfile: HubProfile
  jobberConnected: boolean
  landingPage: 'hub' | 'dashboard'
  notifPref: NotifPref
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type Tab = 'profile' | 'integrations' | 'account'

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0][0].toUpperCase()
  }
  return email[0].toUpperCase()
}

function centerAspectCrop(width: number, height: number) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, width, height),
    width,
    height,
  )
}

async function getCroppedBlob(
  image: HTMLImageElement,
  crop: Crop,
  mimeType: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height
  const size = 400
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0, 0, size, size,
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas empty')), mimeType, 0.92)
  })
}

export default function SettingsForm({ email, userId, hubProfile, jobberConnected, landingPage, notifPref }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  // ── Hub profile state ─────────────────────────────────────────────────────
  const [fullName, setFullName] = useState(hubProfile.full_name ?? '')
  const [hubName, setHubName] = useState(hubProfile.display_name ?? '')
  const [phone, setPhone] = useState(hubProfile.phone ?? '')
  const [hasAvatar, setHasAvatar] = useState(
    !!hubProfile.avatar_url && !hubProfile.avatar_url.startsWith('http')
  )
  const [avatarBust, setAvatarBust] = useState(Date.now())
  const [hubSave, setHubSave] = useState<SaveState>('idle')
  const [hubErr, setHubErr] = useState<string | null>(null)

  // Avatar crop state
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropMime, setCropMime] = useState('image/jpeg')
  const [crop, setCrop] = useState<Crop>()
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Jobber connection state (Integrations tab) ────────────────────────────
  const [connected, setConnected] = useState(jobberConnected)
  const [disconnecting, setDisconnecting] = useState(false)

  // ── Landing page preference ───────────────────────────────────────────────
  const [landing, setLanding] = useState<'hub' | 'dashboard'>(landingPage)
  const [landingSave, setLandingSave] = useState<SaveState>('idle')
  const [landingErr, setLandingErr] = useState<string | null>(null)
  const saveLanding = async (next: 'hub' | 'dashboard') => {
    const previous = landing
    setLanding(next)
    setLandingSave('saving')
    setLandingErr(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landing_page: next }),
      })
      if (!res.ok) {
        const d = await res.json()
        setLanding(previous)
        setLandingErr(d.error ?? 'Save failed')
        setLandingSave('error')
        return
      }
      setLandingSave('saved')
      setTimeout(() => setLandingSave('idle'), 2000)
    } catch (e) {
      setLanding(previous)
      setLandingErr(e instanceof Error ? e.message : 'Network error')
      setLandingSave('error')
    }
  }

  // ── Notification prefs (global) ────────────────────────────────────────────
  const [notifLevel, setNotifLevel] = useState<'all' | 'mentions' | 'muted'>(notifPref.level)
  const [dndEnabled, setDndEnabled] = useState(notifPref.dnd_enabled)
  // time inputs use HH:MM (no seconds); DB column is `time` so HH:MM:SS or HH:MM both store fine
  const trimSec = (t: string | null) => (t ? t.slice(0, 5) : '')
  const [dndStart, setDndStart] = useState(trimSec(notifPref.dnd_start))
  const [dndEnd, setDndEnd] = useState(trimSec(notifPref.dnd_end))
  const [notifSave, setNotifSave] = useState<SaveState>('idle')
  const [notifErr, setNotifErr] = useState<string | null>(null)

  const saveNotifPrefs = async (overrides?: Partial<{ level: 'all' | 'mentions' | 'muted'; dnd_enabled: boolean; dnd_start: string; dnd_end: string }>) => {
    setNotifSave('saving')
    setNotifErr(null)
    const body = {
      room_id: null,
      level: overrides?.level ?? notifLevel,
      dnd_enabled: overrides?.dnd_enabled ?? dndEnabled,
      dnd_start: (overrides?.dnd_start ?? dndStart) || null,
      dnd_end: (overrides?.dnd_end ?? dndEnd) || null,
    }
    try {
      const res = await fetch('/api/hub/notification-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        setNotifErr(d.error ?? 'Save failed')
        setNotifSave('error')
        return
      }
      setNotifSave('saved')
      setTimeout(() => setNotifSave('idle'), 2000)
    } catch (e) {
      setNotifErr(e instanceof Error ? e.message : 'Network error')
      setNotifSave('error')
    }
  }

  // ── Password change ────────────────────────────────────────────────────────
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSave, setPwSave] = useState<SaveState>('idle')
  const [pwErr, setPwErr] = useState<string | null>(null)
  const changePassword = async () => {
    setPwErr(null)
    if (pwNew.length < 8) {
      setPwErr('Password must be at least 8 characters.')
      return
    }
    if (pwNew !== pwConfirm) {
      setPwErr('Passwords do not match.')
      return
    }
    setPwSave('saving')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: pwNew })
    if (error) {
      setPwErr(error.message)
      setPwSave('error')
      return
    }
    setPwNew('')
    setPwConfirm('')
    setPwSave('saved')
    setTimeout(() => setPwSave('idle'), 2500)
  }

  // ── Hub profile save ──────────────────────────────────────────────────────
  const saveHubProfile = async () => {
    setHubSave('saving')
    setHubErr(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName || null,
          display_name: hubName || null,
          phone: phone || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setHubErr(d.error ?? 'Save failed')
        setHubSave('error')
        return
      }
      setHubSave('saved')
      setTimeout(() => setHubSave('idle'), 2000)
    } catch (e) {
      setHubErr(e instanceof Error ? e.message : 'Network error')
      setHubSave('error')
    }
  }

  // ── Avatar file pick ──────────────────────────────────────────────────────
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCropMime(file.type || 'image/jpeg')
    setUploadErr(null)
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop(centerAspectCrop(width, height))
  }, [])

  const uploadCrop = async () => {
    if (!crop || !imgRef.current) return
    setUploading(true)
    setUploadErr(null)
    try {
      const blob = await getCroppedBlob(imgRef.current, crop, cropMime)
      const ext = cropMime === 'image/jpeg' ? 'jpg' : cropMime.split('/')[1]
      const form = new FormData()
      form.append('file', blob, `avatar.${ext}`)
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json()
        setUploadErr(d.error ?? 'Upload failed')
        return
      }
      setCropSrc(null)
      setHasAvatar(true)
      setAvatarBust(Date.now())
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Jobber? You will need to reconnect to load visits.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/jobber/disconnect', { method: 'POST' })
      if (res.ok) setConnected(false)
      else alert('Disconnect failed — try again.')
    } finally { setDisconnecting(false) }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  const saveBtn = (label: string, state: SaveState, onClick: () => void, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled || state === 'saving'}
      className="px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : label}
    </button>
  )

  const inputCls = 'w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500'
  const numInputCls = 'bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 w-24 text-center'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile',      label: 'Profile' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'account',      label: 'Account' },
  ]

  const initials = getInitials(hubName || null, email)

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-8 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-6">

      {/* ── PROFILE TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Profile</h2>
        <p className="text-gray-400 text-sm mb-6">Your Hub identity — name and photo appear in messages, DMs, and the team roster.</p>

        {/* Avatar */}
        <div className="flex items-center gap-5 mb-6">
          <div className="relative">
            {hasAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={avatarBust}
                src={`/api/profile/avatar/${userId}?t=${avatarBust}`}
                alt="Profile photo"
                className="w-20 h-20 rounded-full object-cover border-2 border-gray-700"
                onError={() => setHasAvatar(false)}
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-orange-500/20 border-2 border-gray-700 flex items-center justify-center">
                <span className="text-2xl font-bold text-orange-400">{initials}</span>
              </div>
            )}
          </div>
          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm text-white rounded-lg border border-gray-700 transition-colors"
            >
              {hasAvatar ? 'Change photo' : 'Upload photo'}
            </button>
            <p className="text-xs text-gray-500 mt-1.5">JPG, PNG, WebP or GIF · Max 5 MB</p>
            {uploadErr && <p className="text-red-400 text-xs mt-1">{uploadErr}</p>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        {/* Crop modal */}
        {cropSrc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
              <h3 className="font-semibold text-lg mb-4">Crop your photo</h3>
              <div className="flex justify-center mb-5">
                <ReactCrop
                  crop={crop}
                  onChange={c => setCrop(c)}
                  aspect={1}
                  circularCrop
                  minWidth={50}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imgRef}
                    src={cropSrc}
                    alt="Crop preview"
                    onLoad={onImageLoad}
                    style={{ maxHeight: '60vh', maxWidth: '100%' }}
                  />
                </ReactCrop>
              </div>
              {uploadErr && <p className="text-red-400 text-sm mb-3">{uploadErr}</p>}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setCropSrc(null); setUploadErr(null) }}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={uploadCrop}
                  disabled={uploading || !crop}
                  className="px-5 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {uploading ? 'Uploading…' : 'Save photo'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <input value={email} disabled className={inputCls + ' text-gray-400'} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Full name</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your legal name (e.g. Ben Simpson)"
              className={inputCls}
            />
            <p className="text-xs text-gray-600 mt-1">Used for payroll and records. Not visible to teammates.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Display name</label>
            <input
              value={hubName}
              onChange={e => setHubName(e.target.value)}
              placeholder="Your name as it appears in Hub"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Phone number <span className="text-gray-600">(optional)</span></label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="e.g. (281) 555-0100"
              type="tel"
              className={inputCls}
            />
            <p className="text-xs text-gray-600 mt-1">Visible to team members in the staff directory.</p>
          </div>
          {hubErr && <p className="text-red-400 text-sm">{hubErr}</p>}
          <div className="flex items-center gap-3">
            {saveBtn('Save', hubSave, saveHubProfile)}
            <button onClick={handleSignOut} className="ml-auto text-sm text-gray-400 hover:text-white transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </section>
      )}

      {/* ── INTEGRATIONS TAB ────────────────────────────────────────────── */}
      {activeTab === 'integrations' && <>

      {/* Jobber Connection */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Jobber Connection</h2>
        <p className="text-gray-400 text-sm mb-5">
          Lynxedo reads your visits and writes appointment times via the Jobber API.
        </p>
        {connected ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-400 font-medium">● Connected</span>
            <button onClick={handleDisconnect} disabled={disconnecting}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-50 text-red-300 rounded-lg text-sm font-medium transition-colors">
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <a href="/api/auth/jobber"
            className="inline-block px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-sm font-medium transition-colors">
            Connect Jobber →
          </a>
        )}
        <p className="text-xs text-gray-500 mt-4">
          Routing settings (depot, duration rules, drive speed) live in <a href="/admin/routing" className="text-orange-400 hover:text-orange-300 underline">Admin → Routing</a>.
        </p>
      </section>

      </>}


      {/* ACCOUNT TAB */}
      {activeTab === 'account' && (
      <>
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Default landing page</h2>
        <p className="text-gray-400 text-sm mb-5">Where you land after signing in.</p>
        <div className="space-y-2">
          {([
            { value: 'hub' as const, title: 'Hub', desc: 'Open Hub Home — announcements and your rooms.' },
            { value: 'dashboard' as const, title: 'Dashboard', desc: 'Open the tool tile launcher.' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => saveLanding(opt.value)}
              disabled={landingSave === 'saving'}
              className={`w-full text-left p-4 rounded-xl border transition-colors ${
                landing === opt.value
                  ? 'bg-blue-600/10 border-blue-500/50'
                  : 'bg-gray-950 border-gray-800 hover:border-gray-700'
              } disabled:opacity-60`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-4 h-4 rounded-full border-2 flex-none ${landing === opt.value ? 'border-blue-400 bg-blue-400' : 'border-gray-600'}`} />
                <div>
                  <div className="font-medium text-white">{opt.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </div>
              </div>
            </button>
          ))}
          {landingErr && <p className="text-red-400 text-sm mt-2">{landingErr}</p>}
          {landingSave === 'saved' && <p className="text-green-400 text-xs mt-2">Saved.</p>}
        </div>
      </section>

      {/* Notifications */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Notifications</h2>
        <p className="text-gray-400 text-sm mb-5">Controls all Hub notifications — push, web, and native app.</p>

        <div className="mb-6">
          <label className="block text-xs text-gray-400 mb-2">When to notify me</label>
          <div className="space-y-2">
            {([
              { value: 'all',      title: 'Everything',  desc: 'Notify me for all messages in rooms I belong to.' },
              { value: 'mentions', title: 'Mentions + DMs only', desc: 'Only when I’m @mentioned or someone DMs me.' },
              { value: 'muted',    title: 'Nothing',     desc: 'Mute everything. Mentions and DMs are still suppressed.' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => { setNotifLevel(opt.value); saveNotifPrefs({ level: opt.value }) }}
                disabled={notifSave === 'saving'}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  notifLevel === opt.value
                    ? 'bg-blue-600/10 border-blue-500/50'
                    : 'bg-gray-950 border-gray-800 hover:border-gray-700'
                } disabled:opacity-60`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-4 h-4 rounded-full border-2 flex-none ${notifLevel === opt.value ? 'border-blue-400 bg-blue-400' : 'border-gray-600'}`} />
                  <div>
                    <div className="font-medium text-white">{opt.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Scheduled DND */}
        <div className="border-t border-gray-800 pt-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium text-white">Scheduled Do Not Disturb</h3>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={dndEnabled}
                onChange={e => { setDndEnabled(e.target.checked); saveNotifPrefs({ dnd_enabled: e.target.checked }) }}
                className="sr-only peer"
              />
              <span className="w-10 h-5 bg-gray-700 peer-checked:bg-orange-500 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>
          <p className="text-gray-400 text-sm mb-4">
            Automatically silence non-mention notifications during a recurring window every day. Mentions still come through.
          </p>
          <div className={`grid grid-cols-2 gap-4 ${dndEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Quiet hours start</label>
              <input
                type="time"
                value={dndStart}
                onChange={e => setDndStart(e.target.value)}
                onBlur={() => saveNotifPrefs()}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Quiet hours end</label>
              <input
                type="time"
                value={dndEnd}
                onChange={e => setDndEnd(e.target.value)}
                onBlur={() => saveNotifPrefs()}
                className={inputCls}
              />
            </div>
          </div>
          {dndEnabled && dndStart && dndEnd && (
            <p className="text-xs text-gray-500 mt-2">
              {dndStart > dndEnd ? `Quiet from ${dndStart} until ${dndEnd} the next morning (wraps midnight).` : `Quiet from ${dndStart} to ${dndEnd} each day.`}
            </p>
          )}
        </div>

        {notifErr && <p className="text-red-400 text-sm mt-3">{notifErr}</p>}
        {notifSave === 'saved' && <p className="text-green-400 text-xs mt-3">Saved.</p>}
      </section>

      {/* Change password */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Change password</h2>
        <p className="text-gray-400 text-sm mb-5">Use at least 8 characters. You’ll stay signed in on this device.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">New password</label>
            <input
              type="password"
              value={pwNew}
              onChange={e => setPwNew(e.target.value)}
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Confirm new password</label>
            <input
              type="password"
              value={pwConfirm}
              onChange={e => setPwConfirm(e.target.value)}
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
          {pwErr && <p className="text-red-400 text-sm">{pwErr}</p>}
          {pwSave === 'saved' && <p className="text-green-400 text-sm">Password updated.</p>}
          {saveBtn('Update password', pwSave, changePassword, !pwNew || !pwConfirm)}
        </div>
      </section>
      </>
      )}

    </div>
    </div>
  )
}
