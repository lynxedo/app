'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { createClient } from '@/lib/supabase/client'
import type { DurationRulesConfig, DurationRule } from '@/app/api/settings/types'
import { DEFAULT_DURATION_RULES } from '@/app/api/settings/types'

interface Settings {
  display_name: string | null
  depot_address: string | null
  depot_lat: number | null
  depot_lng: number | null
  default_service_minutes: number
  default_drive_mph: number
  duration_method: string
  duration_rules: DurationRulesConfig
}

interface HubProfile {
  full_name: string | null
  display_name: string | null
  avatar_url: string | null
  phone: string | null
}

interface Props {
  email: string
  userId: string
  initial: Settings
  hubProfile: HubProfile
  jobberConnected: boolean
  landingPage: 'hub' | 'dashboard'
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type Tab = 'profile' | 'routing' | 'account'

const METHOD_OPTIONS = [
  { value: 'formula',      label: 'Formula (Line Items)',          desc: 'Sum line item times + lawn size + padding' },
  { value: 'default',      label: 'Default Time',                  desc: 'Same time for every stop' },
  { value: 'custom_field', label: 'Jobber Custom Field',           desc: 'Use "Onsite Time" field on each job — coming soon', disabled: true },
  { value: 'historical',   label: 'Historical Average (last 3)',   desc: 'Average of last 3 timed visits — coming soon', disabled: true },
]

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

export default function SettingsForm({ email, userId, initial, hubProfile, jobberConnected, landingPage }: Props) {
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

  // ── Routing / settings state ──────────────────────────────────────────────
  const [profileName, setProfileName] = useState(initial.display_name ?? '')
  const [profileSave, setProfileSave] = useState<SaveState>('idle')
  const [profileErr, setProfileErr] = useState<string | null>(null)

  const [serviceMin, setServiceMin] = useState<number>(initial.default_service_minutes)
  const [driveMph, setDriveMph] = useState<number>(initial.default_drive_mph)
  const [routingSave, setRoutingSave] = useState<SaveState>('idle')
  const [routingErr, setRoutingErr] = useState<string | null>(null)

  const [depotAddr, setDepotAddr] = useState(initial.depot_address ?? '')
  const [depotLat, setDepotLat] = useState(initial.depot_lat)
  const [depotLng, setDepotLng] = useState(initial.depot_lng)
  const [depotSave, setDepotSave] = useState<SaveState>('idle')
  const [depotErr, setDepotErr] = useState<string | null>(null)

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

  const [durationMethod, setDurationMethod] = useState(initial.duration_method)
  const [rules, setRules] = useState<DurationRulesConfig>({ ...DEFAULT_DURATION_RULES, ...(initial.duration_rules ?? {}) })
  const [durationSave, setDurationSave] = useState<SaveState>('idle')
  const [durationErr, setDurationErr] = useState<string | null>(null)
  const [loadingLineItems, setLoadingLineItems] = useState(false)
  const [lineItemsErr, setLineItemsErr] = useState<string | null>(null)

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

  // ── Routing settings helpers ──────────────────────────────────────────────
  async function patchSettings(
    body: Partial<Settings & { duration_method: string; duration_rules: DurationRulesConfig }>,
    setSave: (s: SaveState) => void,
    setErr: (e: string | null) => void,
  ): Promise<Settings | null> {
    setSave('saving')
    setErr(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Save failed'); setSave('error'); return null }
      setSave('saved')
      setTimeout(() => setSave('idle'), 2000)
      return data.settings as Settings
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error')
      setSave('error')
      return null
    }
  }

  const saveProfile = () => patchSettings({ display_name: profileName || null }, setProfileSave, setProfileErr)
  const saveRouting = () => patchSettings({ default_service_minutes: serviceMin, default_drive_mph: driveMph }, setRoutingSave, setRoutingErr)
  const saveDepot = async () => {
    const s = await patchSettings({ depot_address: depotAddr || null }, setDepotSave, setDepotErr)
    if (s) { setDepotLat(s.depot_lat); setDepotLng(s.depot_lng) }
  }
  const saveDuration = () =>
    patchSettings({ duration_method: durationMethod, duration_rules: rules }, setDurationSave, setDurationErr)

  const refreshLineItems = async () => {
    setLoadingLineItems(true)
    setLineItemsErr(null)
    try {
      const res = await fetch('/api/jobber/line-items')
      const data = await res.json()
      if (!res.ok || data.error) { setLineItemsErr(data.error ?? 'Failed to load'); return }
      setRules(r => ({ ...r, cachedLineItems: data.lineItems as string[] }))
    } catch (e) {
      setLineItemsErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoadingLineItems(false)
    }
  }

  const updateCode = (idx: number, field: keyof DurationRule, value: string | number) => {
    setRules(r => {
      const codes = [...r.codes]
      codes[idx] = { ...codes[idx], [field]: value }
      return { ...r, codes }
    })
  }
  const addCode = () => {
    if (rules.codes.length >= 15) return
    setRules(r => ({ ...r, codes: [...r.codes, { lineItemName: '', minutes: 0 }] }))
  }
  const removeCode = (idx: number) => {
    setRules(r => ({ ...r, codes: r.codes.filter((_, i) => i !== idx) }))
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
    { id: 'profile',   label: 'Profile' },
    { id: 'routing',   label: 'Routing' },
    { id: 'account',   label: 'Account' },
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

      {/* ── ROUTING TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'routing' && <>

      {/* Duration Rules */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">On-Site Duration</h2>
        <p className="text-gray-400 text-sm mb-5">
          How the optimizer estimates time spent at each stop.
        </p>

        <div className="mb-6">
          <label className="block text-xs text-gray-400 mb-2">Method</label>
          <div className="space-y-2">
            {METHOD_OPTIONS.map(opt => (
              <label key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  opt.disabled ? 'border-gray-800 opacity-40 cursor-not-allowed' :
                  durationMethod === opt.value ? 'border-orange-500 bg-orange-500/10' : 'border-gray-800 hover:border-gray-600'
                }`}>
                <input type="radio" name="duration_method" value={opt.value}
                  checked={durationMethod === opt.value}
                  disabled={opt.disabled}
                  onChange={() => !opt.disabled && setDurationMethod(opt.value)}
                  className="mt-0.5 accent-orange-500" />
                <div>
                  <div className="text-sm font-medium text-white">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {durationMethod === 'formula' && (
          <div className="space-y-6 border-t border-gray-800 pt-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-white">Line Item → Time</p>
                  <p className="text-xs text-gray-400 mt-0.5">All matching line items on a visit are summed.</p>
                </div>
                <button onClick={refreshLineItems} disabled={loadingLineItems || !connected}
                  title={!connected ? 'Connect Jobber first' : 'Pull all line items from your Jobber account'}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium transition-colors">
                  {loadingLineItems ? 'Loading…' : '↻ Refresh from Jobber'}
                </button>
              </div>
              {lineItemsErr && <p className="text-red-400 text-xs mb-2">{lineItemsErr}</p>}
              {rules.cachedLineItems.length > 0 && (
                <p className="text-xs text-green-400 mb-3">✓ {rules.cachedLineItems.length} line items loaded from Jobber</p>
              )}
              {rules.codes.length === 0 && (
                <p className="text-xs text-gray-500 mb-3">No line items configured yet. Add one below.</p>
              )}
              <div className="space-y-2">
                {rules.codes.map((code, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {rules.cachedLineItems.length > 0 ? (
                      <select
                        value={code.lineItemName}
                        onChange={e => updateCode(idx, 'lineItemName', e.target.value)}
                        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                        <option value="">— select line item —</option>
                        {rules.cachedLineItems.map(li => (
                          <option key={li} value={li}>{li}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={code.lineItemName}
                        onChange={e => updateCode(idx, 'lineItemName', e.target.value)}
                        placeholder="Line item name (exact match)"
                        className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500" />
                    )}
                    <input type="number" min={0} max={480}
                      value={code.minutes}
                      onChange={e => updateCode(idx, 'minutes', Number(e.target.value))}
                      className={numInputCls} />
                    <span className="text-xs text-gray-500 whitespace-nowrap">min</span>
                    <button onClick={() => removeCode(idx)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none px-1">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {rules.codes.length < 15 && (
                <button onClick={addCode} className="mt-3 text-xs text-orange-400 hover:text-orange-300 transition-colors">
                  + Add line item
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <input type="checkbox" id="useLawnSize" checked={rules.useLawnSize}
                onChange={e => setRules(r => ({ ...r, useLawnSize: e.target.checked }))}
                className="w-4 h-4 accent-orange-500" />
              <label htmlFor="useLawnSize" className="text-sm text-white cursor-pointer">
                Add lawn size (K = minutes) — e.g. 6K adds 6 min
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Padding per stop (min)</label>
                <input type="number" min={0} max={60} value={rules.padMinutes}
                  onChange={e => setRules(r => ({ ...r, padMinutes: Number(e.target.value) }))}
                  className={inputCls} />
                <p className="text-xs text-gray-500 mt-1">Added to every stop regardless of services</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Minimum per stop (min)</label>
                <input type="number" min={1} max={120} value={rules.minMinutes}
                  onChange={e => setRules(r => ({ ...r, minMinutes: Number(e.target.value) }))}
                  className={inputCls} />
                <p className="text-xs text-gray-500 mt-1">Floor — no stop goes below this</p>
              </div>
            </div>

            <div className="border-t border-gray-800 pt-5">
              <label className="block text-xs text-gray-400 mb-1.5">Requests / Assessments (min)</label>
              <input type="number" min={1} max={240} value={rules.assessmentMinutes}
                onChange={e => setRules(r => ({ ...r, assessmentMinutes: Number(e.target.value) }))}
                className={inputCls} />
              <p className="text-xs text-gray-500 mt-1">
                Fixed duration for assessment stops — they have no line items to calculate from
              </p>
            </div>
          </div>
        )}

        {durationMethod === 'default' && (
          <div className="border-t border-gray-800 pt-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Minimum per stop (min)</label>
              <input type="number" min={1} max={120} value={rules.minMinutes}
                onChange={e => setRules(r => ({ ...r, minMinutes: Number(e.target.value) }))}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Requests / Assessments (min)</label>
              <input type="number" min={1} max={240} value={rules.assessmentMinutes}
                onChange={e => setRules(r => ({ ...r, assessmentMinutes: Number(e.target.value) }))}
                className={inputCls} />
            </div>
          </div>
        )}

        {durationErr && <p className="text-red-400 text-sm mt-4">{durationErr}</p>}
        <div className="mt-5">{saveBtn('Save', durationSave, saveDuration)}</div>
      </section>

      {/* Routing Defaults */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Routing Defaults</h2>
        <p className="text-gray-400 text-sm mb-5">Used by the optimizer for drive time estimates.</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Default service time per stop (min)</label>
            <input type="number" min={5} max={180} value={serviceMin}
              onChange={e => setServiceMin(Number(e.target.value))} className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">Used when formula can&apos;t calculate a stop</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Avg drive speed (mph)</label>
            <input type="number" min={10} max={70} value={driveMph}
              onChange={e => setDriveMph(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
        {routingErr && <p className="text-red-400 text-sm mb-3">{routingErr}</p>}
        {saveBtn('Save', routingSave, saveRouting)}
      </section>

      {/* Routing — Profile name */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Routing Profile Name</h2>
        <p className="text-gray-400 text-sm mb-5">Company or team name shown in the route optimizer.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Name</label>
            <input value={profileName} onChange={e => setProfileName(e.target.value)}
              placeholder="e.g. Heroes Lawn Care" className={inputCls} />
          </div>
          {profileErr && <p className="text-red-400 text-sm">{profileErr}</p>}
          {saveBtn('Save', profileSave, saveProfile)}
        </div>
      </section>

      {/* Depot */}
      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Depot</h2>
        <p className="text-gray-400 text-sm mb-5">Starting and ending point for every optimized route.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Address</label>
            <input value={depotAddr} onChange={e => setDepotAddr(e.target.value)}
              placeholder="123 Main St, City ST 12345" className={inputCls} />
          </div>
          {depotLat !== null && depotLng !== null && (
            <p className="text-xs text-green-400">✓ Geocoded to {depotLat.toFixed(4)}, {depotLng.toFixed(4)}</p>
          )}
          {depotErr && <p className="text-red-400 text-sm">{depotErr}</p>}
          {saveBtn('Save', depotSave, saveDepot)}
        </div>
      </section>

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

      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center py-12">
        <div className="text-3xl mb-3">🏢</div>
        <p className="text-gray-500 text-sm">Company name, plan details, and user management will live here.</p>
        <p className="text-gray-600 text-xs mt-2">Coming in an upcoming session.</p>
      </section>
      </>
      )}

    </div>
    </div>
  )
}
