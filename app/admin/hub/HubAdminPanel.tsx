'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Room = { id: string; name: string; description: string | null; is_private: boolean; archived_at: string | null }
type HubUser = { id: string; display_name: string }
type Announcement = { id: string; content: string; created_at: string; expires_at: string } | null

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

  // Section tabs
  const [tab, setTab] = useState<'rooms' | 'members' | 'settings' | 'announcements'>('rooms')

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

  const activeRooms = rooms.filter(r => !r.archived_at)
  const archivedRooms = rooms.filter(r => r.archived_at)
  const privateRooms = activeRooms.filter(r => r.is_private)
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
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
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
                        <button
                          onClick={() => { setRenamingId(room.id); setRenameVal(room.name) }}
                          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                        >
                          Rename
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
            <h2 className="font-semibold text-white mb-4">Manage Private Room Members</h2>
            {privateRooms.length === 0 ? (
              <p className="text-sm text-gray-500">No private rooms exist yet.</p>
            ) : (
              <div className="space-y-2 mb-6">
                {privateRooms.map(room => (
                  <button
                    key={room.id}
                    onClick={() => loadMembers(room.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors flex items-center gap-2 ${
                      membersRoomId === room.id ? 'bg-[#2E7EB8]/20 border border-[#2E7EB8]/40 text-white' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white'
                    }`}
                  >
                    <span className="text-gray-500">🔒</span>
                    <span className="font-medium">{room.name}</span>
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
              <textarea
                value={annContent}
                onChange={e => setAnnContent(e.target.value)}
                placeholder="Announcement text…"
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8] resize-none"
              />

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
