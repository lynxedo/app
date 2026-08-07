'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutoSave } from '@/components/admin'
import AssistantPanel from './AssistantPanel'

type Settings = {
  model: string
  web_search_daily_cap: number
}

type ModelOption = {
  id: string
  display_name: string
  family: 'opus' | 'sonnet' | 'haiku' | 'other'
  label: string
  flag: string | null
}

type Person = {
  id: string
  display_name: string
  /** hub_users.claude_allowed — may this person use the assistant at all? */
  claude_allowed: boolean
}

type Room = {
  id: string
  name: string
  is_private: boolean
  /** rooms.claude_enabled — does the assistant answer in this room? */
  claude_enabled: boolean
}

type AuditRow = {
  id: string
  created_at: string
  user_id: string | null
  user_display_name: string | null
  question: string
  answer: string | null
  model: string | null
  tools_called: string[]
  web_searches_used: number
  input_tokens: number | null
  output_tokens: number | null
  is_test: boolean
  guardian_tier: string | null
  room_id: string | null
  conversation_id: string | null
}

// One inner tab bar for the whole Assistant: Settings (identity + switches +
// model + web search + connected apps), Permissions (who may use it + what it
// may do), Rooms (where it answers), Audit. This is where the old two-panel
// stack — the tier ladder in one card, the action list in another — became one
// permission model.
type Tab = 'settings' | 'permissions' | 'rooms' | 'audit'

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

export default function GuardianPanel({
  initialSettings,
  initialPeople,
  initialRooms,
  isSuperAdmin,
  botId,
  initialBotName,
  initialBotAvatarUrl,
}: {
  initialSettings: Settings
  initialPeople: Person[]
  initialRooms: Room[]
  isSuperAdmin: boolean
  botId: string
  initialBotName: string
  initialBotAvatarUrl: string | null
}) {
  const [tab, setTab] = useState<Tab>('settings')
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [people, setPeople] = useState<Person[]>(initialPeople)
  const [rooms, setRooms] = useState<Room[]>(initialRooms)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [refreshingTools, setRefreshingTools] = useState(false)
  const [refreshToolsMsg, setRefreshToolsMsg] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSavedAt, setSettingsSavedAt] = useState<number | null>(null)
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditIncludeTest, setAuditIncludeTest] = useState(false)

  // Assistant identity (name + avatar) — shared by the Hub assistant and the AI
  // receptionist. The name is an explicit-save field (renaming is deliberate);
  // the avatar uploads immediately on file pick. `receptionistSynced` reports
  // whether the last save also reached the receptionist (it can't when the
  // company hasn't set one up yet); null = nothing saved this session.
  const [botName, setBotName] = useState(initialBotName)
  const [savedBotName, setSavedBotName] = useState(initialBotName)
  const [savingBotName, setSavingBotName] = useState(false)
  const [botNameSaved, setBotNameSaved] = useState(false)
  const [receptionistSynced, setReceptionistSynced] = useState<boolean | null>(null)
  // The avatar img URL is versioned by the stored R2 KEY (`?v=`), the same way
  // HubRail and ProfileSidebar do it — so a page load always reflects what's
  // stored instead of whatever the browser cached under a fixed URL. `?t=` is
  // only added right after an upload, to refresh this tab before any cached copy
  // of the new key could exist.
  const [botAvatarUrl, setBotAvatarUrl] = useState<string | null>(initialBotAvatarUrl)
  const [botAvatarBust, setBotAvatarBust] = useState(0)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)
  const botAvatarInputRef = useRef<HTMLInputElement>(null)

  async function saveBotName() {
    const name = botName.trim()
    if (!name || name === savedBotName) return
    setSavingBotName(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/guardian/bot-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      setSavedBotName(name)
      setBotName(name)
      setReceptionistSynced(b?.receptionist_synced === true)
      setBotNameSaved(true)
      setTimeout(() => setBotNameSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingBotName(false)
    }
  }

  async function onPickBotAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setUploadingAvatar(true)
    setAvatarErr(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/guardian/bot-identity', { method: 'POST', body: form })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Upload failed (${res.status})`)
      }
      const body = await res.json()
      setBotAvatarUrl(body.avatar_url ?? 'set')
      setBotAvatarBust(Date.now())
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Fetch models when Settings tab opens.
  useEffect(() => {
    if (tab !== 'settings' || models.length || modelsLoading) return
    setModelsLoading(true)
    setModelsError(null)
    fetch('/api/admin/guardian/models')
      .then(r => r.json().then(b => ({ ok: r.ok, body: b })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body?.error ?? 'Failed to load models')
        setModels(body.models ?? [])
      })
      .catch(e => setModelsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setModelsLoading(false))
  }, [tab, models.length, modelsLoading])

  // Fetch audit log when Audit tab opens or filter toggles.
  useEffect(() => {
    if (tab !== 'audit') return
    setAuditLoading(true)
    setAuditError(null)
    const params = new URLSearchParams()
    if (auditIncludeTest) params.set('is_test', 'true')
    fetch(`/api/admin/guardian/audit?${params.toString()}`)
      .then(r => r.json().then(b => ({ ok: r.ok, body: b })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body?.error ?? 'Failed to load audit log')
        setAuditRows(body.rows ?? [])
      })
      .catch(e => setAuditError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAuditLoading(false))
  }, [tab, auditIncludeTest])

  async function refreshTools() {
    setRefreshingTools(true)
    setRefreshToolsMsg(null)
    try {
      const res = await fetch('/api/admin/guardian/refresh-tools', { method: 'POST' })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Refresh failed (${res.status})`)
      }
      setRefreshToolsMsg('Tool list cache cleared ✓')
      setTimeout(() => setRefreshToolsMsg(null), 4000)
    } catch (e) {
      setRefreshToolsMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshingTools(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    try {
      const res = await fetch('/api/admin/guardian/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      const body = await res.json()
      setSettings({
        model: body.settings?.model ?? settings.model,
        web_search_daily_cap: body.settings?.web_search_daily_cap ?? settings.web_search_daily_cap,
      })
      setSettingsSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingSettings(false)
    }
  }

  // AD1 — debounced auto-save of Guardian settings so changes persist without a
  // manual Save. Now uses the shared AD-toolkit hook (same snapshot-guard +
  // skip-first-render behavior the inline version had).
  useAutoSave(settings, saveSettings)

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          Settings
        </TabButton>
        <TabButton active={tab === 'permissions'} onClick={() => setTab('permissions')}>
          Permissions
        </TabButton>
        <TabButton active={tab === 'rooms'} onClick={() => setTab('rooms')}>
          Rooms
        </TabButton>
        <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
          Audit
        </TabButton>
      </div>

      {error && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          {/* On/off + connection switches (hub_assistant_settings) — self-fetching. */}
          <AssistantPanel sections={['switches']} />

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
            <div>
              <h2 className="font-semibold">Assistant identity</h2>
              <p className="text-xs text-white/50 mt-1">
                One name and avatar for your whole AI assistant — in Hub chat, DMs,
                and notifications <em>and</em> the AI receptionist who answers calls and signs
                automated texts. Set it here and it applies everywhere.
              </p>
            </div>

            {/* Avatar */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-white/10 ring-1 ring-inset ring-white/15 flex-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={botAvatarBust}
                  src={botAvatarUrl ? `/api/profile/avatar/${botId}?v=${encodeURIComponent(botAvatarUrl)}${botAvatarBust ? `&t=${botAvatarBust}` : ''}` : '/bot-avatar.svg'}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => botAvatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-sm"
                >
                  {uploadingAvatar ? 'Uploading…' : botAvatarUrl ? 'Change avatar' : 'Upload avatar'}
                </button>
                <p className="text-xs text-white/40">
                  JPG, PNG, WebP, or GIF · under 5&nbsp;MB. Used by the assistant and the AI
                  receptionist.
                </p>
                {avatarErr && <p className="text-xs text-red-300">{avatarErr}</p>}
                <input
                  ref={botAvatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={onPickBotAvatar}
                />
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={botName}
                  onChange={e => setBotName(e.target.value)}
                  maxLength={40}
                  className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm min-w-[16rem]"
                />
                <button
                  onClick={saveBotName}
                  disabled={savingBotName || botName.trim() === '' || botName.trim() === savedBotName}
                  className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-sm"
                >
                  {savingBotName ? 'Saving…' : 'Save name'}
                </button>
                {botNameSaved && <span className="text-xs text-emerald-300">Saved ✓</span>}
                {botName.trim() !== savedBotName && !botNameSaved && (
                  <span className="text-xs text-amber-300">● Unsaved</span>
                )}
              </div>
              <p className="text-xs text-white/40 mt-1">
                Shown as the sender name in chat and notifications, spoken by the AI
                receptionist on calls, and signed on automated texts.
              </p>
              {receptionistSynced === false && !savingBotName && (
                <p className="text-xs text-amber-300/80 mt-1">
                  Saved. The AI receptionist will pick this name up as soon as
                  it&apos;s set up in the AI Receptionist tab.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
            <div>
              <h2 className="font-semibold">Assistant model</h2>
              <p className="text-xs text-white/50 mt-1">
                The Claude model the assistant uses for every reply. List is fetched live from Anthropic.
              </p>
            </div>

            {modelsLoading && <p className="text-sm text-white/50">Loading models…</p>}
            {modelsError && <p className="text-sm text-red-300">{modelsError}</p>}

            {!modelsLoading && !modelsError && (
              <div>
                <label className="block text-sm font-medium mb-1">Model</label>
                <select
                  value={settings.model}
                  onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}
                  className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm min-w-[20rem]"
                >
                  {/* If current model isn't in the list (e.g. retired or custom), still show it */}
                  {!models.some(m => m.id === settings.model) && (
                    <option value={settings.model}>{settings.model} (current)</option>
                  )}
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.display_name} — {m.label}
                      {m.flag ? ` · ⚠ ${m.flag}` : ''}
                    </option>
                  ))}
                </select>
                {(() => {
                  const current = models.find(m => m.id === settings.model)
                  if (current?.flag) {
                    return (
                      <p className="text-xs text-amber-300 mt-2">⚠ {current.flag}</p>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
            <div>
              <h2 className="font-semibold">Web search</h2>
              <p className="text-xs text-white/50 mt-1">
                Daily company-wide cap on live web searches. Web search runs only for{' '}
                <span className="text-emerald-300">managers and admins</span>. 0 disables web
                search entirely. Each search is ~$0.01.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Daily web search cap</label>
              <input
                type="number"
                min={0}
                value={settings.web_search_daily_cap}
                onChange={e => {
                  const n = parseInt(e.target.value, 10)
                  setSettings(s => ({ ...s, web_search_daily_cap: Number.isFinite(n) && n >= 0 ? n : 0 }))
                }}
                className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-28"
              />
              <span className="ml-2 text-sm text-white/60">searches/day</span>
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <h2 className="font-semibold">Tool list cache</h2>
              <p className="text-xs text-white/50 mt-1">
                The assistant caches the MCP tool list in memory for 1 hour. If you change the MCP server's tools, click here so the next reply picks them up.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshTools}
                disabled={refreshingTools}
                className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-sm"
              >
                {refreshingTools ? 'Refreshing…' : 'Refresh tool list'}
              </button>
              {refreshToolsMsg && (
                <span className="text-xs text-white/60">{refreshToolsMsg}</span>
              )}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="px-4 py-2 rounded bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-medium"
            >
              {savingSettings ? 'Saving…' : 'Save Settings'}
            </button>
            {settingsSavedAt && (
              <span className="text-xs text-emerald-300">Saved ✓</span>
            )}
          </div>

          {/* Connected outside Claude apps (claude.ai, Claude Code) — read + revoke. */}
          <AssistantPanel sections={['apps']} />
        </div>
      )}

      {tab === 'permissions' && (
        <div className="space-y-6">
          <PeopleTab
            people={people}
            setPeople={setPeople}
            isSuperAdmin={isSuperAdmin}
          />
          {/* Company-wide per-action toggles (hub_assistant_settings) — self-fetching. */}
          <AssistantPanel sections={['actions']} />
        </div>
      )}

      {tab === 'rooms' && (
        <RoomsTab
          rooms={rooms}
          setRooms={setRooms}
          isSuperAdmin={isSuperAdmin}
        />
      )}

      {tab === 'audit' && (
        <AuditTab
          rows={auditRows}
          loading={auditLoading}
          error={auditError}
          includeTest={auditIncludeTest}
          setIncludeTest={setAuditIncludeTest}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-brand text-white'
          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// People tab
// ---------------------------------------------------------------------------

function PeopleTab({
  people,
  setPeople,
  isSuperAdmin,
}: {
  people: Person[]
  setPeople: (next: Person[] | ((prev: Person[]) => Person[])) => void
  isSuperAdmin: boolean
}) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<{ id: string; msg: string } | null>(null)

  // hub_users.claude_allowed — the ONE per-person assistant switch. What an
  // allowed person can then DO is not per-person configuration: lookups for
  // everyone, changes + web search for managers/admins, each action further
  // gated by that person's own can_* permissions and the company toggles below.
  // (This replaced the basic/manager/full tier dropdowns — capability now
  // follows role, so there is nothing per-person left to rank.)
  async function setAllowed(userId: string, allowed: boolean) {
    setSavingId(userId)
    setErrorId(null)
    const prev = people.find(p => p.id === userId)?.claude_allowed ?? false
    setPeople(list => list.map(p => p.id === userId ? { ...p, claude_allowed: allowed } : p))
    try {
      const res = await fetch(`/api/hub/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claude_allowed: allowed }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
    } catch (e) {
      setPeople(list => list.map(p => p.id === userId ? { ...p, claude_allowed: prev } : p))
      setErrorId({ id: userId, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Who can use the assistant</h2>
        <p className="text-xs text-white/50 mt-1">
          One switch per person. Everyone allowed can ask it to look things up;{' '}
          <span className="text-white/70">managers and admins</span> can also have it make changes
          (Jobber schedule, notes) and use live web search. Each action additionally follows the
          person&apos;s own Hub permissions and the company-wide toggles below.
        </p>
        {!isSuperAdmin && (
          <p className="text-xs text-amber-300 mt-2">
            Only full admins can change who&apos;s allowed. You can view the current list here.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
        {people.length === 0 ? (
          <p className="px-4 py-6 text-sm text-white/50">No people in this company yet.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {people.map(p => (
              <li key={p.id} className="px-4 py-3 flex items-center gap-3">
                <span className="flex-1 text-sm">{p.display_name}</span>
                <button
                  onClick={() => setAllowed(p.id, !p.claude_allowed)}
                  disabled={!isSuperAdmin || savingId === p.id}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 ${
                    p.claude_allowed
                      ? 'bg-brand/20 text-[#6FB3E8] hover:bg-brand/30'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  <span>✦</span>
                  <span>{p.claude_allowed ? 'Allowed' : 'Blocked'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errorId && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {errorId.msg}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rooms tab
// ---------------------------------------------------------------------------

function RoomsTab({
  rooms,
  setRooms,
  isSuperAdmin,
}: {
  rooms: Room[]
  setRooms: (next: Room[] | ((prev: Room[]) => Room[])) => void
  isSuperAdmin: boolean
}) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // rooms.claude_enabled — does the assistant answer in this room at all? The
  // old toggle here was per-room "Full access" (a tier elevation); with the
  // tier ladder retired, capability follows the ASKER's role everywhere, so the
  // per-room question left is simply on/off. Same column the Admin → Hub room
  // list toggles.
  async function toggle(roomId: string, next: boolean) {
    setSavingId(roomId)
    setErrorMsg(null)
    const prev = rooms.find(r => r.id === roomId)?.claude_enabled ?? false
    setRooms(rs => rs.map(r => r.id === roomId ? { ...r, claude_enabled: next } : r))
    try {
      const res = await fetch(`/api/hub/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claude_enabled: next }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
    } catch (e) {
      setRooms(rs => rs.map(r => r.id === roomId ? { ...r, claude_enabled: prev } : r))
      setErrorMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Where the assistant answers</h2>
        <p className="text-xs text-white/50 mt-1">
          Turn the assistant on per room. In a room that&apos;s on, anyone allowed to use the
          assistant can @mention it; what it will do for them still follows their own role and
          permissions.
        </p>
        {!isSuperAdmin && (
          <p className="text-xs text-amber-300 mt-2">
            Only full admins can change rooms. You can view the current list here.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
        {rooms.length === 0 ? (
          <p className="px-4 py-6 text-sm text-white/50">No rooms in this company.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {rooms.map(r => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                <span className="flex-1 text-sm flex items-center gap-2">
                  <span className="text-white/40">{r.is_private ? '🔒' : '#'}</span>
                  {r.name}
                </span>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r.claude_enabled}
                    onChange={e => toggle(r.id, e.target.checked)}
                    disabled={!isSuperAdmin || savingId === r.id}
                    className="accent-emerald-500"
                  />
                  <span className="text-white/70">Assistant on</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {errorMsg}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Audit tab
// ---------------------------------------------------------------------------

function AuditTab({
  rows,
  loading,
  error,
  includeTest,
  setIncludeTest,
}: {
  rows: AuditRow[] | null
  loading: boolean
  error: string | null
  includeTest: boolean
  setIncludeTest: (v: boolean) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold">Audit log</h2>
          <p className="text-xs text-white/50 mt-1">
            Last 100 assistant replies. Click a row to expand and see the full question + answer.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeTest}
            onChange={e => setIncludeTest(e.target.checked)}
            className="accent-emerald-500"
          />
          <span>Include test runs</span>
        </label>
      </div>

      {loading && <p className="text-sm text-white/50">Loading…</p>}
      {error && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && rows && (
        <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-white/50">No entries yet.</p>
          ) : (
            <ul className="divide-y divide-white/10">
              {rows.map(r => {
                const isOpen = expandedId === r.id
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : r.id)}
                      className="w-full text-left px-4 py-3 hover:bg-white/5 flex items-center gap-3 text-sm"
                    >
                      <span className="text-xs text-white/40 w-32 shrink-0 hidden md:inline">
                        {formatTimestamp(r.created_at)}
                      </span>
                      <span className="text-xs text-white/60 w-20 shrink-0 hidden md:inline truncate">
                        {r.user_display_name ?? '—'}
                      </span>
                      {/* Capability chip. New rows log 'manage'/'read'; rows from
                          before Aug 2026 carry the old tier names and render as-is. */}
                      <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                        r.guardian_tier === 'manage' || r.guardian_tier === 'full'
                          ? 'bg-emerald-900/40 text-emerald-300'
                          : r.guardian_tier === 'manager'
                          ? 'bg-amber-900/40 text-amber-300'
                          : 'bg-white/10 text-white/60'
                      }`}>
                        {r.guardian_tier ?? '—'}
                      </span>
                      <span className="flex-1 truncate">{truncate(r.question, 60)}</span>
                      {r.is_test && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 shrink-0">
                          test
                        </span>
                      )}
                      {r.web_searches_used > 0 && (
                        <span className="text-xs text-white/50 shrink-0">🔍{r.web_searches_used}</span>
                      )}
                      <span className="text-xs text-white/40 shrink-0 hidden md:inline">
                        {(r.input_tokens ?? 0)} in · {(r.output_tokens ?? 0)} out
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-3 text-sm bg-black/20">
                        <div>
                          <div className="text-xs text-white/40 uppercase tracking-wide mb-1">Question</div>
                          <pre className="whitespace-pre-wrap font-sans text-white/80">{r.question}</pre>
                        </div>
                        {r.answer && (
                          <div>
                            <div className="text-xs text-white/40 uppercase tracking-wide mb-1">Answer</div>
                            <pre className="whitespace-pre-wrap font-sans text-white/80">{r.answer}</pre>
                          </div>
                        )}
                        {r.tools_called.length > 0 && (
                          <div>
                            <div className="text-xs text-white/40 uppercase tracking-wide mb-1">
                              Tools called ({r.tools_called.length})
                            </div>
                            <div className="text-xs text-white/70 font-mono">
                              {r.tools_called.join(', ')}
                            </div>
                          </div>
                        )}
                        <div className="text-xs text-white/40">
                          Model: {r.model ?? '—'} · Web searches: {r.web_searches_used}
                          {r.room_id ? ` · Room: ${r.room_id.slice(0, 8)}…` : ''}
                          {r.conversation_id ? ` · DM: ${r.conversation_id.slice(0, 8)}…` : ''}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
