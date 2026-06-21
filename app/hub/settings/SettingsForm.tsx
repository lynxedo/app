'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { createClient } from '@/lib/supabase/client'
import NotificationDeviceControls from '@/components/hub/NotificationDeviceControls'
import { type RailPermissions } from '@/components/hub/railCatalog'
import TxtPersonalTemplates from './TxtPersonalTemplates'
import DialerPersonalSettings from './DialerPersonalSettings'
import DndScheduleEditor from '@/components/hub/DndScheduleEditor'
import type { DndSchedule } from '@/lib/dnd-schedule'
import { useToast, useConfirm } from '@/components/ui'

interface HubProfile {
  full_name: string | null
  display_name: string | null
  avatar_url: string | null
  phone: string | null
}

interface NotifPref {
  level: 'all' | 'mentions' | 'muted'
}

interface Props {
  email: string
  userId: string
  hubProfile: HubProfile
  jobberConnected: boolean
  landingPage: 'hub' | 'dashboard'
  notifPref: NotifPref
  railPermissions: RailPermissions
  txtSignature: string
  dialerGlobalRing: boolean
  initialMasterDndEnabled?: boolean
  initialMasterDndSchedule?: Record<string, unknown> | null
  initialHubDndEnabled?: boolean
  initialHubDndSchedule?: Record<string, unknown> | null
  initialDialerDndEnabled?: boolean
  initialDialerDndSchedule?: Record<string, unknown> | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type Tab = 'profile' | 'my-hub' | 'notifications' | 'integrations' | 'account'

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

export default function SettingsForm({ email, userId, hubProfile, jobberConnected, landingPage, notifPref, railPermissions, txtSignature, dialerGlobalRing, initialMasterDndEnabled = false, initialMasterDndSchedule = null, initialHubDndEnabled = false, initialHubDndSchedule = null, initialDialerDndEnabled = false, initialDialerDndSchedule = null }: Props) {
  const router = useRouter()
  const toast = useToast()
  const confirmDialog = useConfirm()
  // SET-deeplink — tabs are deep-linkable via ?tab= (so a link to a specific
  // settings tab lands there, and the browser back button moves between tabs),
  // mirroring the Help page.
  const searchParams = useSearchParams()
  const ALL_TABS: Tab[] = ['profile', 'my-hub', 'notifications', 'integrations', 'account']
  const initialTab = searchParams.get('tab') as Tab | null
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab && ALL_TABS.includes(initialTab) ? initialTab : 'profile'
  )

  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeTab === 'profile') url.searchParams.delete('tab')
    else url.searchParams.set('tab', activeTab)
    router.replace(url.pathname + url.search, { scroll: false })
  }, [activeTab, router])

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
  // Saved baseline for the "Unsaved changes" cue (updated on a successful save).
  const [profileBaseline, setProfileBaseline] = useState({
    fullName: hubProfile.full_name ?? '',
    hubName: hubProfile.display_name ?? '',
    phone: hubProfile.phone ?? '',
  })
  const profileDirty =
    fullName !== profileBaseline.fullName ||
    hubName !== profileBaseline.hubName ||
    phone !== profileBaseline.phone

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
  const [notifSave, setNotifSave] = useState<SaveState>('idle')
  const [notifErr, setNotifErr] = useState<string | null>(null)

  const saveNotifPrefs = async (overrides?: Partial<{ level: 'all' | 'mentions' | 'muted' }>) => {
    setNotifSave('saving')
    setNotifErr(null)
    const body = {
      room_id: null,
      level: overrides?.level ?? notifLevel,
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

  // ── Unified DND (Master / Hub / Dialer) ──────────────────────────────────
  const EMPTY_SCHED: DndSchedule = { tz: 'America/Chicago', days: {} }
  function toSchedule(raw: Record<string, unknown> | null | undefined): DndSchedule {
    if (!raw) return EMPTY_SCHED
    return raw as unknown as DndSchedule
  }

  const [masterDndOn, setMasterDndOn] = useState(initialMasterDndEnabled)
  const [masterScheduleEnabled, setMasterScheduleEnabled] = useState(
    Boolean((initialMasterDndSchedule as DndSchedule | null)?.enabled)
  )
  const [masterSchedule, setMasterSchedule] = useState<DndSchedule>(
    toSchedule(initialMasterDndSchedule as Record<string, unknown> | null)
  )

  const [hubDndOn, setHubDndOn] = useState(initialHubDndEnabled)
  const [hubScheduleEnabled, setHubScheduleEnabled] = useState(
    Boolean((initialHubDndSchedule as DndSchedule | null)?.enabled)
  )
  const [hubSchedule, setHubSchedule] = useState<DndSchedule>(
    toSchedule(initialHubDndSchedule as Record<string, unknown> | null)
  )

  const [dialerDndOn, setDialerDndOn] = useState(initialDialerDndEnabled)
  const [dialerScheduleEnabled, setDialerScheduleEnabled] = useState(
    Boolean((initialDialerDndSchedule as DndSchedule | null)?.enabled)
  )
  const [dialerSchedule, setDialerSchedule] = useState<DndSchedule>(
    toSchedule(initialDialerDndSchedule as Record<string, unknown> | null)
  )

  const [dndSave, setDndSave] = useState<SaveState>('idle')
  const [dndErr, setDndErr] = useState<string | null>(null)

  async function saveDndField(body: Record<string, unknown>) {
    setDndSave('saving')
    setDndErr(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setDndErr(d.error ?? 'Save failed')
        setDndSave('error')
        return
      }
      setDndSave('saved')
      setTimeout(() => setDndSave('idle'), 1500)
    } catch (e) {
      setDndErr(e instanceof Error ? e.message : 'Network error')
      setDndSave('error')
    }
  }

  // ── Text signature (Txt v2) ───────────────────────────────────────────────
  const [signature, setSignature] = useState(txtSignature)
  const [sigSave, setSigSave] = useState<SaveState>('idle')
  const [sigErr, setSigErr] = useState<string | null>(null)
  const [sigBaseline, setSigBaseline] = useState(txtSignature)
  const sigDirty = signature !== sigBaseline
  const saveSignature = async () => {
    setSigSave('saving')
    setSigErr(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txt_signature: signature.trim() || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSigErr(d.error ?? 'Save failed')
        setSigSave('error')
        return
      }
      setSigBaseline(signature)
      setSigSave('saved')
      setTimeout(() => setSigSave('idle'), 2000)
    } catch (e) {
      setSigErr(e instanceof Error ? e.message : 'Network error')
      setSigSave('error')
    }
  }

  // ── Dialer: ring on every Hub page (Session 58.5) ─────────────────────────
  const [globalRing, setGlobalRing] = useState(dialerGlobalRing)
  const [ringSave, setRingSave] = useState<SaveState>('idle')
  const [ringErr, setRingErr] = useState<string | null>(null)
  const toggleGlobalRing = async (next: boolean) => {
    const prev = globalRing
    setGlobalRing(next)
    setRingSave('saving')
    setRingErr(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialer_global_ring: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setRingErr(d.error ?? 'Save failed')
        setGlobalRing(prev)
        setRingSave('error')
        return
      }
      setRingSave('saved')
      setTimeout(() => setRingSave('idle'), 1500)
    } catch (e) {
      setRingErr(e instanceof Error ? e.message : 'Network error')
      setGlobalRing(prev)
      setRingSave('error')
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
      setProfileBaseline({ fullName, hubName, phone })
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
    if (!(await confirmDialog({ message: 'Disconnect Jobber? You will need to reconnect to load visits.', danger: true }))) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/jobber/disconnect', { method: 'POST' })
      if (res.ok) setConnected(false)
      else toast.error('Disconnect failed — try again.')
    } finally { setDisconnecting(false) }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  // SET-deeplink (save-model legibility) — text-field sections don't auto-save,
  // so an "● Unsaved changes" cue appears beside the button when the field
  // differs from what's saved, making it obvious a click is required (toggles
  // elsewhere auto-save and have their own Saved✓ state).
  const saveBtn = (label: string, state: SaveState, onClick: () => void, disabled = false, dirty = false) => (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={disabled || state === 'saving'}
        className="px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : label}
      </button>
      {dirty && state === 'idle' && (
        <span className="text-xs text-amber-400">● Unsaved changes</span>
      )}
    </div>
  )

  const inputCls = 'w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500'
  const numInputCls = 'bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 w-24 text-center'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile',       label: 'Profile' },
    { id: 'my-hub',        label: 'My Hub' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'integrations',  label: 'Integrations' },
    { id: 'account',       label: 'Account' },
  ]

  const initials = getInitials(hubName || null, email)

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-8 bg-gray-900 border border-gray-800 rounded-xl p-1 max-md:ml-12 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-none whitespace-nowrap md:flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
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
            {saveBtn('Save', hubSave, saveHubProfile, false, profileDirty)}
            <button onClick={handleSignOut} className="ml-auto text-sm text-gray-400 hover:text-white transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </section>
      )}

      {/* ── MY HUB TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'my-hub' && (
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">My Hub</h2>
        <p className="text-gray-400 text-sm mb-6">
          Make the icon rail (and the mobile bottom bar) your own — show only what you use, in the order you want.
          Add any app, a Do&nbsp;Not&nbsp;Disturb toggle, a room, or a custom link; drag to reorder; hide the rest.
          Your desktop and phone each keep their own layout, and both follow your account to every device.
        </p>

        <ul className="text-sm text-gray-300 space-y-1.5 mb-6 list-disc pl-5">
          <li><strong className="text-white">Add anything</strong> — every tool as its own icon, plus DND, rooms, and custom links.</li>
          <li><strong className="text-white">Drag to reorder</strong> and tap the ✕ to hide what you don&apos;t need.</li>
          <li><strong className="text-white">Separate desktop &amp; mobile</strong> layouts — lean phone, loaded desktop.</li>
          <li>The <strong className="text-white">Apps</strong> button is always there, so you can never lose your way back.</li>
        </ul>

        <button
          type="button"
          onClick={() => router.push('/hub?customize=1')}
          className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Open layout customizer
        </button>
        <p className="text-xs text-gray-500 mt-3">
          Tip: you can also open this any time from the <strong>Apps ▦</strong> button on the rail → <strong>Customize</strong>.
        </p>
      </section>
      )}

      {/* ── NOTIFICATIONS TAB ───────────────────────────────────────────── */}
      {activeTab === 'notifications' && (
      <div className="space-y-6">

        {/* Notification level */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold text-lg mb-1">Default notification level</h2>
          <p className="text-gray-400 text-sm mb-5">Controls which Hub messages trigger push and web notifications.</p>
          <div className="space-y-2">
            {([
              { value: 'all',      title: 'Everything',          desc: 'Notify me for all messages in rooms I belong to.' },
              { value: 'mentions', title: 'Mentions + DMs only', desc: "Only when I'm @mentioned or someone DMs me." },
              { value: 'muted',    title: 'Nothing',             desc: 'Mute everything. Mentions and DMs are still suppressed.' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => { setNotifLevel(opt.value); saveNotifPrefs({ level: opt.value }) }}
                disabled={notifSave === 'saving'}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  notifLevel === opt.value ? 'bg-blue-600/10 border-blue-500/50' : 'bg-gray-950 border-gray-800 hover:border-gray-700'
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
        </section>

        {/* Master DND */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <span className="text-red-400">
                  <svg className="w-5 h-5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                </span>
                Master Do Not Disturb
              </h2>
              <p className="text-xs font-semibold text-red-400 mt-0.5 uppercase tracking-wide">Overrides all other DND settings</p>
            </div>
            <label className="inline-flex items-center cursor-pointer flex-none">
              <input
                type="checkbox"
                checked={masterDndOn}
                onChange={e => {
                  setMasterDndOn(e.target.checked)
                  saveDndField({ master_dnd_enabled: e.target.checked })
                }}
                className="sr-only peer"
              />
              <span className="w-10 h-5 bg-gray-700 peer-checked:bg-red-500 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[#ffffff] after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>
          <p className="text-gray-400 text-sm mb-5">
            When on, <strong className="text-white">all notifications stop</strong> — no calls, no Hub messages, no push. Your unread counts still update. Use this for vacation, focus blocks, or off-hours silence.
          </p>
          <DndScheduleEditor
            scheduleEnabled={masterScheduleEnabled}
            schedule={masterSchedule}
            onToggleSchedule={on => {
              setMasterScheduleEnabled(on)
              const next: DndSchedule = { ...masterSchedule, enabled: on }
              setMasterSchedule(next)
              saveDndField({ master_dnd_schedule: next })
            }}
            onScheduleChange={s => setMasterSchedule(s)}
            onCommit={() => saveDndField({ master_dnd_schedule: { ...masterSchedule, enabled: masterScheduleEnabled } })}
          />
        </section>

        {/* Hub notifications DND */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <span className="text-orange-400">
                  <svg className="w-5 h-5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                </span>
                Hub Notifications DND
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Messages and mentions only — does not affect calls</p>
            </div>
            <label className="inline-flex items-center cursor-pointer flex-none">
              <input
                type="checkbox"
                checked={hubDndOn}
                onChange={e => {
                  setHubDndOn(e.target.checked)
                  saveDndField({ hub_dnd_enabled: e.target.checked })
                }}
                className="sr-only peer"
              />
              <span className="w-10 h-5 bg-gray-700 peer-checked:bg-orange-500 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[#ffffff] after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>
          <p className="text-gray-400 text-sm mb-5">
            Pauses Hub message push notifications without affecting your phone system. Still receive @mention and DM notifications regardless of the level picker above when this is off.
          </p>
          <DndScheduleEditor
            scheduleEnabled={hubScheduleEnabled}
            schedule={hubSchedule}
            onToggleSchedule={on => {
              setHubScheduleEnabled(on)
              const next: DndSchedule = { ...hubSchedule, enabled: on }
              setHubSchedule(next)
              saveDndField({ hub_dnd_schedule: next })
            }}
            onScheduleChange={s => setHubSchedule(s)}
            onCommit={() => saveDndField({ hub_dnd_schedule: { ...hubSchedule, enabled: hubScheduleEnabled } })}
          />
        </section>

        {/* Calls DND */}
        {railPermissions.canAccessDialer && (
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <span className="text-orange-400">
                  <svg className="w-5 h-5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                </span>
                Calls DND
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Calls only — does not affect Hub messages</p>
            </div>
            <label className="inline-flex items-center cursor-pointer flex-none">
              <input
                type="checkbox"
                checked={dialerDndOn}
                onChange={e => {
                  setDialerDndOn(e.target.checked)
                  saveDndField({ dialer_dnd_enabled: e.target.checked })
                }}
                className="sr-only peer"
              />
              <span className="w-10 h-5 bg-gray-700 peer-checked:bg-orange-500 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[#ffffff] after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>
          <p className="text-gray-400 text-sm mb-5">
            When on, inbound IVR transfers and ring groups skip you. Calls go to other group members (or to voicemail if no one is available). Does not affect Hub messages or push notifications.
          </p>
          <DndScheduleEditor
            scheduleEnabled={dialerScheduleEnabled}
            schedule={dialerSchedule}
            onToggleSchedule={on => {
              setDialerScheduleEnabled(on)
              const next: DndSchedule = { ...dialerSchedule, enabled: on }
              setDialerSchedule(next)
              saveDndField({ dialer_dnd_schedule: next })
            }}
            onScheduleChange={s => setDialerSchedule(s)}
            onCommit={() => saveDndField({ dialer_dnd_schedule: { ...dialerSchedule, enabled: dialerScheduleEnabled } })}
          />
        </section>
        )}

        {/* Push device controls */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold text-lg mb-1">Push devices</h2>
          <p className="text-gray-400 text-sm mb-4">Manage which browsers and devices receive push notifications.</p>
          <NotificationDeviceControls />
        </section>

        {dndErr && <p className="text-red-400 text-sm">{dndErr}</p>}
        {dndSave === 'saved' && <p className="text-green-400 text-sm">Saved.</p>}

      </div>
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
          Routing settings (depot, duration rules, drive speed) live in <a href="/hub/admin/routing" className="text-orange-400 hover:text-orange-300 underline">Admin → Routing</a>.
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

      {/* Communications */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Communications</h2>
        <p className="text-gray-400 text-sm mb-5">Per-user settings for customer texting (Txt).</p>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Text signature</label>
          <textarea
            value={signature}
            onChange={e => setSignature(e.target.value)}
            placeholder="— Ben, Heroes Lawn Care"
            rows={3}
            maxLength={500}
            className={inputCls + ' resize-none'}
          />
          <p className="text-xs text-gray-500 mt-1.5">
            Auto-appended (with a blank line above it) when you're the first to text a client, or when a different teammate jumps into a conversation. Won't repeat back-to-back from the same sender. Leave blank to disable.
          </p>
          {sigErr && <p className="text-red-400 text-sm mt-2">{sigErr}</p>}
          <div className="mt-3">
            {saveBtn('Save signature', sigSave, saveSignature, false, sigDirty)}
          </div>
        </div>

        <TxtPersonalTemplates />

        {railPermissions.canAccessDialer && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={globalRing}
                onChange={e => toggleGlobalRing(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Ring me on every Hub page</div>
                <p className="text-xs text-gray-500 mt-1">
                  When on, incoming calls pop a ringing overlay anywhere in Hub — even if you're not on the Dialer page. Turn off if you'd rather only receive calls while you're actively viewing the Dialer.
                </p>
                {ringErr && <p className="text-red-400 text-xs mt-1.5">{ringErr}</p>}
                {ringSave === 'saved' && <p className="text-green-400 text-xs mt-1.5">Saved.</p>}
              </div>
            </label>
          </div>
        )}

        {railPermissions.canAccessDialer && <DialerPersonalSettings />}
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

