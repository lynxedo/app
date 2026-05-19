'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import EmojiPicker from '@/components/hub/EmojiPicker'

type Room = { id: string; name: string; description: string | null; is_private: boolean; archived_at: string | null; claude_enabled: boolean }
type HubUser = { id: string; display_name: string; claude_allowed?: boolean }
type Announcement = { id: string; content: string; created_at: string; expires_at: string } | null
type ApiKey = {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  created_by_user: { display_name: string } | null
}

type AutomationRule = {
  id: string
  trigger_source: string
  keyword: string
  action_type: 'post_room' | 'dm_user' | 'create_board_task'
  message_template: string
  active: boolean
  created_at: string
  trigger_room: { id: string; name: string } | null
  target_room: { id: string; name: string } | null
  target_user: { id: string; display_name: string } | null
  target_board: { id: string; name: string } | null
}

type Board = { id: string; name: string; is_private: boolean; is_personal: boolean }

const DURATION_OPTIONS = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
]

export default function HubAdminPanel({
  initialRooms,
  hubUsers,
  allowMemberRoomCreation,
  activeAnnouncement,
}: {
  initialRooms: Room[]
  hubUsers: HubUser[]
  allowMemberRoomCreation: boolean
  activeAnnouncement: Announcement
}) {
  const router = useRouter()
  const [rooms, setRooms] = useState<Room[]>(initialRooms)
  const [allowCreate, setAllowCreate] = useState(allowMemberRoomCreation)
  const [announcement, setAnnouncement] = useState<Announcement>(activeAnnouncement)

  // New room form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPrivate, setNewPrivate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  // Members
  const [membersRoomId, setMembersRoomId] = useState<string | null>(null)
  const [members, setMembers] = useState<{ user_id: string; display_name: string; role: string }[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [addUserId, setAddUserId] = useState('')

  // Announcement
  const [annContent, setAnnContent] = useState('')
  const [annDuration, setAnnDuration] = useState<number | 'custom'>(24)
  const [annCustomDate, setAnnCustomDate] = useState('')
  const [postingAnn, setPostingAnn] = useState(false)
  const [annError, setAnnError] = useState('')
  const [showAnnEmojiPicker, setShowAnnEmojiPicker] = useState(false)
  const annTextareaRef = useRef<HTMLTextAreaElement>(null)

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [revealedKey, setRevealedKey] = useState<{ name: string; plain_key: string } | null>(null)

  // Automation rules
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([])
  const [automationLoaded, setAutomationLoaded] = useState(false)
  const [boards, setBoards] = useState<Board[]>([])
  const [newRuleTriggerRoom, setNewRuleTriggerRoom] = useState('')
  const [newRuleKeyword, setNewRuleKeyword] = useState('')
  const [newRuleActionType, setNewRuleActionType] = useState<'post_room' | 'dm_user' | 'create_board_task'>('post_room')
  const [newRuleTargetRoom, setNewRuleTargetRoom] = useState('')
  const [newRuleTargetUser, setNewRuleTargetUser] = useState('')
  const [newRuleTargetBoard, setNewRuleTargetBoard] = useState('')
  const [newRuleTemplate, setNewRuleTemplate] = useState('')
  const [savingRule, setSavingRule] = useState(false)
  const [ruleError, setRuleError] = useState('')

  // Section tabs
  const [tab, setTab] = useState<'rooms' | 'members' | 'settings' | 'announcements' | 'api-keys' | 'automation'>('rooms')

  async function createRoom() {
    if (!newName.trim() || creating) return
    setCreating(true)
    setCreateError('')
    const res = await fetch('/api/hub/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null, is_private: newPrivate }),
    })
    const data = await res.json()
    setCreating(false)
    if (!res.ok) { setCreateError(data.error ?? 'Failed to create room'); return }
    setRooms(prev => [...prev, { ...data, archived_at: null }].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName(''); setNewDesc(''); setNewPrivate(false)
  }

  async function renameRoom(id: string) {
    if (!renameVal.trim()) return
    const res = await fetch(`/api/hub/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameVal.trim() }),
    })
    if (res.ok) {
      setRooms(prev => prev.map(r => r.id === id ? { ...r, name: renameVal.trim() } : r))
      setRenamingId(null)
    }
  }

  async function archiveRoom(id: string, archive: boolean) {
    const res = await fetch(`/api/hub/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive }),
    })
    if (res.ok) {
      setRooms(prev => prev.map(r => r.id === id ? { ...r, archived_at: archive ? new Date().toISOString() : null } : r))
    }
  }

  async function toggleRoomPrivate(id: string, makePrivate: boolean) {
    const room = rooms.find(r => r.id === id)
    if (!room) return
    if (makePrivate) {
      if (!confirm(`Make "${room.name}" private? Only members you add will have access — everyone else will lose access immediately.`)) return
    } else {
      if (!confirm(`Make "${room.name}" public? All Hub members will be able to join this room.`)) return
    }
    const res = await fetch(`/api/hub/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_private: makePrivate }),
    })
    if (res.ok) {
      setRooms(prev => prev.map(r => r.id === id ? { ...r, is_private: makePrivate } : r))
    }
  }

  async function toggleClaudeEnabled(id: string, enabled: boolean) {
    setRooms(prev => prev.map(r => r.id === id ? { ...r, claude_enabled: enabled } : r))
    await fetch(`/api/hub/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claude_enabled: enabled }),
    })
  }

  const [hubUsersList, setHubUsersList] = useState<HubUser[]>(hubUsers)

  async function toggleClaudeAllowed(userId: string, allowed: boolean) {
    setHubUsersList(prev => prev.map(u => u.id === userId ? { ...u, claude_allowed: allowed } : u))
    await fetch(`/api/hub/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claude_allowed: allowed }),
    })
  }

  async function loadMembers(roomId: string) {
    setMembersRoomId(roomId)
    setLoadingMembers(true)
    const res = await fetch(`/api/hub/rooms/${roomId}/members`)
    const data = await res.json()
    setMembers(data.members ?? [])
    setLoadingMembers(false)
    setAddUserId('')
  }

  async function addMember() {
    if (!membersRoomId || !addUserId) return
    const res = await fetch(`/api/hub/rooms/${membersRoomId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: addUserId }),
    })
    if (res.ok) {
      const user = hubUsers.find(u => u.id === addUserId)
      if (user && !members.find(m => m.user_id === addUserId)) {
        setMembers(prev => [...prev, { user_id: addUserId, display_name: user.display_name, role: 'member' }])
      }
      setAddUserId('')
    }
  }

  async function removeMember(userId: string) {
    if (!membersRoomId) return
    const res = await fetch(`/api/hub/rooms/${membersRoomId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) setMembers(prev => prev.filter(m => m.user_id !== userId))
  }

  async function saveAllowCreate(val: boolean) {
    setAllowCreate(val)
    await fetch('/api/hub/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allow_member_room_creation: val }),
    })
  }

  async function postAnnouncement() {
    if (!annContent.trim() || postingAnn) return
    setPostingAnn(true)
    setAnnError('')

    let expires_at: string
    if (annDuration === 'custom') {
      if (!annCustomDate) { setAnnError('Please pick a date'); setPostingAnn(false); return }
      expires_at = new Date(annCustomDate).toISOString()
    } else {
      expires_at = new Date(Date.now() + annDuration * 3600000).toISOString()
    }

    const res = await fetch('/api/hub/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: annContent.trim(), expires_at }),
    })
    const data = await res.json()
    setPostingAnn(false)
    if (!res.ok) { setAnnError(data.error ?? 'Failed to post'); return }
    setAnnouncement(data)
    setAnnContent('')
    router.refresh()
  }

  async function deleteAnnouncement() {
    if (!announcement) return
    const res = await fetch(`/api/hub/announcements/${announcement.id}`, { method: 'DELETE' })
    if (res.ok) { setAnnouncement(null); router.refresh() }
  }

  async function loadApiKeys() {
    if (apiKeysLoaded) return
    const res = await fetch('/api/hub/api-keys')
    const data = await res.json()
    setApiKeys(data.keys ?? [])
    setApiKeysLoaded(true)
  }

  async function createApiKey() {
    if (!newKeyName.trim() || creatingKey) return
    setCreatingKey(true)
    setKeyError('')
    const res = await fetch('/api/hub/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName.trim() }),
    })
    const data = await res.json()
    setCreatingKey(false)
    if (!res.ok) { setKeyError(data.error ?? 'Failed to create key'); return }
    setRevealedKey({ name: data.name, plain_key: data.plain_key })
    setApiKeys(prev => [{ ...data, last_used_at: null, revoked_at: null, created_by_user: null }, ...prev])
    setNewKeyName('')
  }

  async function revokeApiKey(id: string) {
    const res = await fetch(`/api/hub/api-keys/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setApiKeys(prev => prev.map(k => k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k))
    }
  }

  async function loadAutomationRules() {
    if (automationLoaded) return
    const [rulesRes, boardsRes] = await Promise.all([
      fetch('/api/hub/automation-rules'),
      fetch('/api/hub/boards'),
    ])
    const rulesData = await rulesRes.json()
    const boardsData = await boardsRes.json()
    setAutomationRules(rulesData.rules ?? [])
    setBoards((boardsData.boards ?? []).filter((b: Board) => !b.is_personal))
    setAutomationLoaded(true)
  }

  async function createAutomationRule() {
    if (!newRuleKeyword.trim() || !newRuleTemplate.trim() || savingRule) return
    if (newRuleActionType === 'post_room' && !newRuleTargetRoom) { setRuleError('Select a target room'); return }
    if (newRuleActionType === 'dm_user' && !newRuleTargetUser) { setRuleError('Select a target user'); return }
    if (newRuleActionType === 'create_board_task' && !newRuleTargetBoard) { setRuleError('Select a target board'); return }
    setSavingRule(true)
    setRuleError('')
    const res = await fetch('/api/hub/automation-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_room_id: newRuleTriggerRoom || null,
        keyword: newRuleKeyword.trim(),
        action_type: newRuleActionType,
        target_room_id: newRuleActionType === 'post_room' ? newRuleTargetRoom : null,
        target_user_id: newRuleActionType === 'dm_user' ? newRuleTargetUser : null,
        target_board_id: newRuleActionType === 'create_board_task' ? newRuleTargetBoard : null,
        message_template: newRuleTemplate.trim(),
      }),
    })
    const data = await res.json()
    setSavingRule(false)
    if (!res.ok) { setRuleError(data.error ?? 'Failed to create rule'); return }
    setAutomationRules(prev => [data, ...prev])
    setNewRuleKeyword(''); setNewRuleTemplate(''); setNewRuleTriggerRoom('')
    setNewRuleTargetRoom(''); setNewRuleTargetUser(''); setNewRuleTargetBoard('')
  }

  async function toggleRuleActive(id: string, active: boolean) {
    setAutomationRules(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    await fetch(`/api/hub/automation-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
  }

  async function deleteAutomationRule(id: string) {
    if (!confirm('Delete this automation rule?')) return
    const res = await fetch(`/api/hub/automation-rules/${id}`, { method: 'DELETE' })
    if (res.ok) setAutomationRules(prev => prev.filter(r => r.id !== id))
  }

  const activeRooms = rooms.filter(r => !r.archived_at)
  const archivedRooms = rooms.filter(r => r.archived_at)
  const selectedRoom = membersRoomId ? rooms.find(r => r.id === membersRoomId) : null

  return (
    <div>
      {/* Tab nav */}
      <div className="flex gap-1 mb-8 border-b border-gray-800">
        {([
          ['rooms', 'Rooms'],
          ['members', 'Members'],
          ['settings', 'Settings'],
          ['announcements', 'Announcements'],
          ['api-keys', 'API Keys'],
          ['automation', 'Automation'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); if (key === 'api-keys') loadApiKeys(); if (key === 'automation') loadAutomationRules() }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-[#2E7EB8] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── ROOMS TAB ── */}
      {tab === 'rooms' && (
        <div className="space-y-8">
          {/* Create room */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-4">Create Room</h2>
            <div className="space-y-3">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRoom()}
                placeholder="Room name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer select-none">
                  <div
                    onClick={() => setNewPrivate(v => !v)}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-none cursor-pointer ${newPrivate ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newPrivate ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  Private room
                </label>
                <button
                  onClick={createRoom}
                  disabled={!newName.trim() || creating}
                  className="px-5 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                >
                  {creating ? 'Creating…' : 'Create Room'}
                </button>
              </div>
              {createError && <p className="text-sm text-red-400">{createError}</p>}
            </div>
          </div>

          {/* Active rooms */}
          <div>
            <h2 className="font-semibold text-white mb-3">Active Rooms ({activeRooms.length})</h2>
            <div className="space-y-2">
              {activeRooms.map(room => (
                <div key={room.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
                  <span className="text-gray-500 text-sm flex-none">{room.is_private ? '🔒' : '#'}</span>
                  {renamingId === room.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') renameRoom(room.id); if (e.key === 'Escape') setRenamingId(null) }}
                      className="flex-1 bg-gray-800 border border-[#2E7EB8] rounded-lg px-3 py-1.5 text-sm text-white outline-none"
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white font-medium">{room.name}</span>
                      {room.description && <span className="text-xs text-gray-500 ml-2">{room.description}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-none">
                    {renamingId === room.id ? (
                      <>
                        <button onClick={() => renameRoom(room.id)} className="text-xs text-green-400 hover:text-green-300 px-2 py-1">Save</button>
                        <button onClick={() => setRenamingId(null)} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1">Cancel</button>
                      </>
                    ) : (
                      <>
                        {/* Claude enabled toggle */}
                        <button
                          onClick={() => toggleClaudeEnabled(room.id, !room.claude_enabled)}
                          title={room.claude_enabled ? 'Guardian ON — click to disable' : 'Guardian OFF — click to enable'}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                            room.claude_enabled
                              ? 'bg-[#2E7EB8]/20 text-[#6FB3E8] hover:bg-[#2E7EB8]/30'
                              : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800'
                          }`}
                        >
                          <span>✦</span>
                          <span>{room.claude_enabled ? 'Guardian ON' : 'Guardian OFF'}</span>
                        </button>
                        <button
                          onClick={() => { setRenamingId(room.id); setRenameVal(room.name) }}
                          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => toggleRoomPrivate(room.id, !room.is_private)}
                          className={`text-xs px-2 py-1 rounded hover:bg-gray-800 transition-colors ${
                            room.is_private
                              ? 'text-purple-400/70 hover:text-purple-300'
                              : 'text-gray-400 hover:text-white'
                          }`}
                          title={room.is_private ? 'Make public' : 'Make private'}
                        >
                          {room.is_private ? 'Make Public' : 'Make Private'}
                        </button>
                        <button
                          onClick={() => archiveRoom(room.id, true)}
                          className="text-xs text-yellow-500/70 hover:text-yellow-400 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {activeRooms.length === 0 && <p className="text-sm text-gray-500 px-1">No active rooms.</p>}
            </div>
          </div>

          {/* Archived rooms */}
          {archivedRooms.length > 0 && (
            <div>
              <h2 className="font-semibold text-gray-500 mb-3">Archived Rooms ({archivedRooms.length})</h2>
              <div className="space-y-2">
                {archivedRooms.map(room => (
                  <div key={room.id} className="bg-gray-900/50 border border-gray-800/50 rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
                    <span className="text-gray-600 text-sm flex-none">#</span>
                    <span className="flex-1 text-sm text-gray-400">{room.name}</span>
                    <button
                      onClick={() => archiveRoom(room.id, false)}
                      className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                    >
                      Unarchive
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MEMBERS TAB ── */}
      {tab === 'members' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Manage Room Members</h2>
            <p className="text-xs text-gray-500 mb-4">Select a room to add or remove members. For public rooms, members control who appears in Browse Rooms as &quot;joined&quot;.</p>
            {activeRooms.length === 0 ? (
              <p className="text-sm text-gray-500">No active rooms.</p>
            ) : (
              <div className="space-y-2 mb-6">
                {activeRooms.map(room => (
                  <button
                    key={room.id}
                    onClick={() => loadMembers(room.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors flex items-center gap-2 ${
                      membersRoomId === room.id ? 'bg-[#2E7EB8]/20 border border-[#2E7EB8]/40 text-white' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white'
                    }`}
                  >
                    <span className="text-gray-500 text-xs">{room.is_private ? '🔒' : '#'}</span>
                    <span className="font-medium">{room.name}</span>
                    {room.is_private && <span className="ml-auto text-xs text-purple-400/70">private</span>}
                  </button>
                ))}
              </div>
            )}

            {selectedRoom && (
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Members of #{selectedRoom.name}</h3>
                {loadingMembers ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {members.length === 0 && <p className="text-sm text-gray-500">No members yet.</p>}
                    {members.map(m => (
                      <div key={m.user_id} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white">
                            {m.display_name.slice(0, 1).toUpperCase()}
                          </div>
                          <span className="text-sm text-white">{m.display_name}</span>
                          {m.role === 'admin' && <span className="text-xs text-yellow-500 px-1.5 py-0.5 bg-yellow-500/10 rounded">admin</span>}
                        </div>
                        <button
                          onClick={() => removeMember(m.user_id)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={addUserId}
                    onChange={e => setAddUserId(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                  >
                    <option value="">Add a member…</option>
                    {hubUsers
                      .filter(u => !members.find(m => m.user_id === u.id))
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.display_name}</option>
                      ))
                    }
                  </select>
                  <button
                    onClick={addMember}
                    disabled={!addUserId}
                    className="px-4 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Guardian Access per user */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Guardian Access — Per User</h2>
            <p className="text-xs text-gray-500 mb-4">Controls who can use @Guardian in rooms and DMs. Room must also have Guardian enabled.</p>
            <div className="space-y-2">
              {hubUsersList.map(u => (
                <div key={u.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white flex-none">
                      {u.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-sm text-white">{u.display_name}</span>
                  </div>
                  <button
                    onClick={() => toggleClaudeAllowed(u.id, !u.claude_allowed)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      u.claude_allowed
                        ? 'bg-[#2E7EB8]/20 text-[#6FB3E8] hover:bg-[#2E7EB8]/30'
                        : 'bg-gray-700 text-gray-500 hover:bg-gray-600 hover:text-gray-300'
                    }`}
                  >
                    <span>✦</span>
                    <span>{u.claude_allowed ? 'Allowed' : 'Blocked'}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'settings' && (
        <div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Room Creation</h2>
            <p className="text-sm text-gray-500 mb-5">Controls who can create new rooms in Hub.</p>
            <div className="space-y-3">
              {[
                { val: true, label: 'Any member can create rooms', desc: 'All team members see a + button to create rooms.' },
                { val: false, label: 'Admins only', desc: 'Only admins can create rooms. The + button is hidden for regular members.' },
              ].map(opt => (
                <label
                  key={String(opt.val)}
                  onClick={() => saveAllowCreate(opt.val)}
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    allowCreate === opt.val ? 'border-[#2E7EB8]/60 bg-[#2E7EB8]/10' : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-none transition-colors ${allowCreate === opt.val ? 'border-[#2E7EB8] bg-[#2E7EB8]' : 'border-gray-600'}`}>
                    {allowCreate === opt.val && <div className="w-full h-full rounded-full bg-white scale-50 block" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── API KEYS TAB ── */}
      {tab === 'api-keys' && (
        <div className="space-y-6">
          {/* One-time key reveal modal */}
          {revealedKey && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-lg w-full">
                <h3 className="text-white font-semibold mb-1">API Key Created — Save It Now</h3>
                <p className="text-sm text-gray-400 mb-4">
                  This is the only time you&apos;ll see the full key for <strong className="text-white">{revealedKey.name}</strong>.
                  Copy it somewhere safe.
                </p>
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 font-mono text-sm text-green-400 break-all select-all mb-5">
                  {revealedKey.plain_key}
                </div>
                <button
                  onClick={() => setRevealedKey(null)}
                  className="w-full py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] text-sm text-white font-medium transition-colors"
                >
                  I&apos;ve saved it — close
                </button>
              </div>
            </div>
          )}

          {/* Create key */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Create API Key</h2>
            <p className="text-sm text-gray-500 mb-4">
              API keys let external services (Zapier, automations, scripts) post messages into Hub rooms.
            </p>
            <div className="flex gap-3">
              <input
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createApiKey()}
                placeholder="Key name (e.g. Zapier, Unitel Script)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <button
                onClick={createApiKey}
                disabled={!newKeyName.trim() || creatingKey}
                className="px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors flex-none"
              >
                {creatingKey ? 'Creating…' : 'Create'}
              </button>
            </div>
            {keyError && <p className="text-sm text-red-400 mt-2">{keyError}</p>}
          </div>

          {/* Keys list */}
          <div>
            <h2 className="font-semibold text-white mb-3">Keys ({apiKeys.length})</h2>
            {!apiKeysLoaded ? (
              <p className="text-sm text-gray-500 px-1">Loading…</p>
            ) : apiKeys.length === 0 ? (
              <p className="text-sm text-gray-500 px-1">No API keys yet.</p>
            ) : (
              <div className="space-y-2">
                {apiKeys.map(k => (
                  <div
                    key={k.id}
                    className={`bg-gray-900 border rounded-xl px-4 py-3 flex items-center gap-4 ${
                      k.revoked_at ? 'border-gray-800/50 opacity-50' : 'border-gray-800'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-sm font-medium ${k.revoked_at ? 'line-through text-gray-500' : 'text-white'}`}>
                          {k.name}
                        </span>
                        {k.revoked_at && (
                          <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Revoked</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">{k.key_prefix}…</div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        Created {new Date(k.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {k.created_by_user && ` by ${k.created_by_user.display_name}`}
                        {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        {k.revoked_at && ` · Revoked ${new Date(k.revoked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                      </div>
                    </div>
                    {!k.revoked_at && (
                      <button
                        onClick={() => {
                          if (confirm(`Revoke the "${k.name}" API key? This cannot be undone.`)) revokeApiKey(k.id)
                        }}
                        className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors flex-none"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Usage docs */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-3">How to Use</h2>
            <p className="text-sm text-gray-400 mb-3">POST to <code className="text-green-400 bg-gray-800 px-1.5 py-0.5 rounded text-xs">/api/hub/ingest</code> with your key in the Authorization header:</p>
            <pre className="bg-gray-800 rounded-xl p-4 text-xs text-gray-300 overflow-x-auto">{`POST https://lynxedo.com/api/hub/ingest
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "room_name": "general",
  "content": "Hello from the API!"
}`}</pre>
          </div>
        </div>
      )}

      {/* ── AUTOMATION TAB ── */}
      {tab === 'automation' && (
        <div className="space-y-8">
          {/* New rule form */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">New Automation Rule</h2>
            <p className="text-xs text-gray-500 mb-5">
              When a message in a room contains a keyword, automatically post to a room or DM a user.
              Use <code className="bg-gray-800 px-1 rounded text-gray-300">{'{trigger_message}'}</code>,{' '}
              <code className="bg-gray-800 px-1 rounded text-gray-300">{'{user}'}</code>, and{' '}
              <code className="bg-gray-800 px-1 rounded text-gray-300">{'{room}'}</code> in the message template.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Watch room (blank = any room)</label>
                  <select
                    value={newRuleTriggerRoom}
                    onChange={e => setNewRuleTriggerRoom(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                  >
                    <option value="">Any room</option>
                    {activeRooms.map(r => <option key={r.id} value={r.id}>#{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Keyword (case-insensitive, partial match)</label>
                  <input
                    value={newRuleKeyword}
                    onChange={e => setNewRuleKeyword(e.target.value)}
                    placeholder="e.g. rain, urgent, reschedule"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Action</label>
                  <select
                    value={newRuleActionType}
                    onChange={e => setNewRuleActionType(e.target.value as 'post_room' | 'dm_user')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                  >
                    <option value="post_room">Post to a room</option>
                    <option value="dm_user">DM a user</option>
                    <option value="create_board_task">Create a board task</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    {newRuleActionType === 'post_room' ? 'Target room' : newRuleActionType === 'dm_user' ? 'Target user' : 'Target board'}
                  </label>
                  {newRuleActionType === 'post_room' && (
                    <select
                      value={newRuleTargetRoom}
                      onChange={e => setNewRuleTargetRoom(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                    >
                      <option value="">Select room…</option>
                      {activeRooms.map(r => <option key={r.id} value={r.id}>#{r.name}</option>)}
                    </select>
                  )}
                  {newRuleActionType === 'dm_user' && (
                    <select
                      value={newRuleTargetUser}
                      onChange={e => setNewRuleTargetUser(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                    >
                      <option value="">Select user…</option>
                      {hubUsers.filter(u => !u.display_name.startsWith('Claude')).map(u => (
                        <option key={u.id} value={u.id}>{u.display_name}</option>
                      ))}
                    </select>
                  )}
                  {newRuleActionType === 'create_board_task' && (
                    <select
                      value={newRuleTargetBoard}
                      onChange={e => setNewRuleTargetBoard(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                    >
                      <option value="">Select board…</option>
                      {boards.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_private ? ' 🔒' : ''}</option>)}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Message template</label>
                <textarea
                  value={newRuleTemplate}
                  onChange={e => setNewRuleTemplate(e.target.value)}
                  placeholder={`e.g. {user} mentioned rain in #{room}: "{trigger_message}"`}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8] resize-none"
                />
              </div>

              {ruleError && <p className="text-sm text-red-400">{ruleError}</p>}

              <div className="flex justify-end">
                <button
                  onClick={createAutomationRule}
                  disabled={!newRuleKeyword.trim() || !newRuleTemplate.trim() || savingRule}
                  className="px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                >
                  {savingRule ? 'Saving…' : 'Create Rule'}
                </button>
              </div>
            </div>
          </div>

          {/* Rules list */}
          <div>
            <h2 className="font-semibold text-white mb-3">
              Rules ({automationRules.length})
            </h2>
            {!automationLoaded ? (
              <p className="text-sm text-gray-500 px-1">Loading…</p>
            ) : automationRules.length === 0 ? (
              <p className="text-sm text-gray-500 px-1">No automation rules yet.</p>
            ) : (
              <div className="space-y-2">
                {automationRules.map(rule => (
                  <div
                    key={rule.id}
                    className={`bg-gray-900 border rounded-xl px-4 py-3.5 flex items-start gap-4 ${
                      rule.active ? 'border-gray-800' : 'border-gray-800/50 opacity-60'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs text-gray-500">
                          {rule.trigger_room ? `#${rule.trigger_room.name}` : 'Any room'}
                        </span>
                        <span className="text-xs text-gray-600">→</span>
                        <span className="text-xs font-mono bg-gray-800 px-2 py-0.5 rounded text-orange-300">
                          {rule.keyword}
                        </span>
                        <span className="text-xs text-gray-600">→</span>
                        <span className="text-xs text-gray-400">
                          {rule.action_type === 'post_room'
                            ? `post in #${rule.target_room?.name ?? '?'}`
                            : rule.action_type === 'dm_user'
                            ? `DM ${rule.target_user?.display_name ?? '?'}`
                            : `task on "${rule.target_board?.name ?? '?'}"`}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 truncate">{rule.message_template}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-none mt-0.5">
                      <button
                        onClick={() => toggleRuleActive(rule.id, !rule.active)}
                        className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                          rule.active
                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                            : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                        }`}
                      >
                        {rule.active ? 'On' : 'Off'}
                      </button>
                      <button
                        onClick={() => deleteAutomationRule(rule.id)}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ANNOUNCEMENTS TAB ── */}
      {tab === 'announcements' && (
        <div className="space-y-6">
          {/* Active announcement */}
          {announcement && (
            <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-yellow-500 font-semibold uppercase tracking-wider mb-1">Active Announcement</div>
                  <p className="text-sm text-white">{announcement.content}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Expires {new Date(announcement.expires_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <button
                  onClick={deleteAnnouncement}
                  className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors flex-none"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {/* Post new announcement */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-4">
              {announcement ? 'Post New Announcement' : 'Post Announcement'}
            </h2>
            {announcement && (
              <p className="text-xs text-yellow-600 mb-4">Posting a new announcement will replace the current one for new visitors. (Old one stays until deleted or expired.)</p>
            )}
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  ref={annTextareaRef}
                  value={annContent}
                  onChange={e => setAnnContent(e.target.value)}
                  placeholder="Announcement text…"
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8] resize-none"
                />
                <button
                  type="button"
                  onClick={() => setShowAnnEmojiPicker(v => !v)}
                  className="absolute right-3 top-3 text-gray-500 hover:text-gray-300 transition-colors text-base"
                  title="Insert emoji"
                >
                  😊
                </button>
                {showAnnEmojiPicker && (
                  <EmojiPicker
                    onSelect={emoji => {
                      const el = annTextareaRef.current
                      if (el) {
                        const start = el.selectionStart ?? annContent.length
                        const end = el.selectionEnd ?? annContent.length
                        const next = annContent.slice(0, start) + emoji + annContent.slice(end)
                        setAnnContent(next)
                        setTimeout(() => {
                          el.focus()
                          el.setSelectionRange(start + emoji.length, start + emoji.length)
                        }, 0)
                      } else {
                        setAnnContent(prev => prev + emoji)
                      }
                      setShowAnnEmojiPicker(false)
                    }}
                    onClose={() => setShowAnnEmojiPicker(false)}
                  />
                )}
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">Duration</p>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map(opt => (
                    <button
                      key={opt.hours}
                      onClick={() => setAnnDuration(opt.hours)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        annDuration === opt.hours ? 'bg-[#2E7EB8] text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setAnnDuration('custom')}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      annDuration === 'custom' ? 'bg-[#2E7EB8] text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    Custom date
                  </button>
                </div>
                {annDuration === 'custom' && (
                  <input
                    type="datetime-local"
                    value={annCustomDate}
                    onChange={e => setAnnCustomDate(e.target.value)}
                    className="mt-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                  />
                )}
              </div>

              {annError && <p className="text-sm text-red-400">{annError}</p>}

              <button
                onClick={postAnnouncement}
                disabled={!annContent.trim() || postingAnn}
                className="px-6 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {postingAnn ? 'Posting…' : 'Post Announcement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
