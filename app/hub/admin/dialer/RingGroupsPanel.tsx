'use client'

import { useState } from 'react'

export type RingGroupMember = {
  user_id: string
  position: number
  member_timeout_sec: number
}

export type RingGroup = {
  id: string
  name: string
  ring_mode: 'simultaneous' | 'sequential'
  ring_timeout_sec: number
  members: RingGroupMember[]
}

type HubUser = { id: string; display_name: string }

export default function RingGroupsPanel({
  initial,
  hubUsers,
  onChange,
}: {
  initial: RingGroup[]
  hubUsers: HubUser[]
  onChange?: (rows: RingGroup[]) => void
}) {
  const [groups, setGroups] = useState<RingGroup[]>(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function replaceLocal(next: RingGroup[]) {
    setGroups(next)
    onChange?.(next)
  }

  async function createGroup(input: {
    name: string
    ring_mode: 'simultaneous' | 'sequential'
    member_user_ids: string[]
  }) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dialer/ring-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          ring_mode: input.ring_mode,
          ring_timeout_sec: 25,
          member_user_ids: input.member_user_ids,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Create failed (${res.status})`)
      }
      const data = await res.json()
      const newGroup: RingGroup = {
        id: data.id,
        name: input.name,
        ring_mode: input.ring_mode,
        ring_timeout_sec: 25,
        members: input.member_user_ids.map((u, idx) => ({
          user_id: u,
          position: idx,
          member_timeout_sec: 20,
        })),
      }
      replaceLocal([...groups, newGroup].sort((a, b) => a.name.localeCompare(b.name)))
      setCreating(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function patchGroup(id: string, patch: Partial<RingGroup>) {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      if (patch.name !== undefined) body.name = patch.name
      if (patch.ring_mode !== undefined) body.ring_mode = patch.ring_mode
      if (patch.ring_timeout_sec !== undefined) body.ring_timeout_sec = patch.ring_timeout_sec
      if (patch.members !== undefined) {
        body.member_user_ids = patch.members.map((m) => m.user_id)
      }
      const res = await fetch(`/api/admin/dialer/ring-groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      replaceLocal(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function deleteGroup(id: string) {
    const g = groups.find((x) => x.id === id)
    if (!g) return
    if (!confirm(`Delete ring group "${g.name}"? Any IVR menu pointing here will fall through to general voicemail.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/dialer/ring-groups/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Delete failed (${res.status})`)
      }
      replaceLocal(groups.filter((x) => x.id !== id))
      if (editingId === id) setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">
        Named groups for IVR menu actions. Simultaneous rings everyone at once;
        sequential rings one at a time in the order shown, falling through to
        the next on no-answer. Anyone with DND on is skipped. Unanswered calls
        land in the general voicemail.
      </p>
      {error && (
        <div className="rounded-md border border-red-700/40 bg-red-900/30 text-red-200 px-2 py-1.5 text-xs">
          {error}
        </div>
      )}
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.id} className="rounded border border-white/10 bg-white/5">
            <GroupRow
              group={g}
              hubUsers={hubUsers}
              isEditing={editingId === g.id}
              busy={busy}
              onEdit={() => setEditingId(editingId === g.id ? null : g.id)}
              onSave={(patch) => patchGroup(g.id, patch)}
              onDelete={() => deleteGroup(g.id)}
            />
          </li>
        ))}
      </ul>

      {creating ? (
        <NewGroupForm
          hubUsers={hubUsers}
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={createGroup}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-sm px-3 py-1.5 rounded border border-dashed border-white/20 text-white/70 hover:bg-white/5 hover:text-white"
        >
          + New ring group
        </button>
      )}
    </div>
  )
}

function GroupRow({
  group,
  hubUsers,
  isEditing,
  busy,
  onEdit,
  onSave,
  onDelete,
}: {
  group: RingGroup
  hubUsers: HubUser[]
  isEditing: boolean
  busy: boolean
  onEdit: () => void
  onSave: (patch: Partial<RingGroup>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(group.name)
  const [mode, setMode] = useState<RingGroup['ring_mode']>(group.ring_mode)
  const [members, setMembers] = useState<RingGroupMember[]>(group.members)
  const userById = new Map(hubUsers.map((u) => [u.id, u.display_name]))

  function moveMember(idx: number, delta: number) {
    const next = [...members]
    const j = idx + delta
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    next.forEach((m, i) => (m.position = i))
    setMembers(next)
  }

  function toggleMember(userId: string) {
    if (members.some((m) => m.user_id === userId)) {
      setMembers(members.filter((m) => m.user_id !== userId).map((m, i) => ({ ...m, position: i })))
    } else {
      setMembers([
        ...members,
        { user_id: userId, position: members.length, member_timeout_sec: 20 },
      ])
    }
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {isEditing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-56"
          />
        ) : (
          <span className="text-sm font-medium">{group.name}</span>
        )}
        <span className="text-xs text-white/40">
          {(isEditing ? mode : group.ring_mode) === 'simultaneous'
            ? 'Rings everyone at once'
            : 'Rings one at a time, in order'}
        </span>
        <span className="text-xs text-white/40">·</span>
        <span className="text-xs text-white/40">
          {(isEditing ? members.length : group.members.length)} member
          {(isEditing ? members.length : group.members.length) === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/10"
          >
            {isEditing ? 'Cancel' : 'Edit'}
          </button>
          {!isEditing && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs px-2 py-1 rounded border border-red-700/40 text-red-300 hover:bg-red-900/30"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-white/50">Ring mode:</span>
            <div className="inline-flex rounded border border-white/15 overflow-hidden">
              <button
                type="button"
                onClick={() => setMode('simultaneous')}
                className={`px-2 py-0.5 ${
                  mode === 'simultaneous' ? 'bg-brand text-white' : 'text-white/60 hover:bg-white/10'
                }`}
              >
                Simultaneous
              </button>
              <button
                type="button"
                onClick={() => setMode('sequential')}
                className={`px-2 py-0.5 ${
                  mode === 'sequential' ? 'bg-brand text-white' : 'text-white/60 hover:bg-white/10'
                }`}
              >
                Sequential
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs text-white/50 mb-1">Members (in ring order)</div>
            <ul className="space-y-1">
              {members.map((m, idx) => (
                <li
                  key={m.user_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 border border-white/10"
                >
                  <span className="text-xs text-white/40 w-6 text-center font-mono">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm">
                    {userById.get(m.user_id) ?? m.user_id}
                  </span>
                  {mode === 'sequential' && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveMember(idx, -1)}
                        disabled={idx === 0}
                        className="text-xs px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMember(idx, 1)}
                        disabled={idx === members.length - 1}
                        className="text-xs px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10 disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleMember(m.user_id)}
                    className="text-xs text-white/40 hover:text-red-300"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {members.length === 0 && (
                <li className="text-xs text-white/40 px-2">No members yet.</li>
              )}
            </ul>
          </div>

          <div>
            <div className="text-xs text-white/50 mb-1">Add members</div>
            <div className="flex flex-wrap gap-1">
              {hubUsers
                .filter((u) => !members.some((m) => m.user_id === u.id))
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleMember(u.id)}
                    className="text-xs px-2 py-1 rounded border border-white/15 text-white/70 hover:bg-white/10"
                  >
                    + {u.display_name}
                  </button>
                ))}
              {hubUsers.filter((u) => !members.some((m) => m.user_id === u.id)).length === 0 && (
                <span className="text-xs text-white/40">Everyone is already in this group.</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSave({ name: name.trim(), ring_mode: mode, members })
              }}
              disabled={busy || !name.trim()}
              className="text-xs px-3 py-1.5 rounded bg-brand hover:bg-brand-light disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {!isEditing && group.members.length > 0 && (
        <div className="text-xs text-white/50">
          {group.members
            .map((m) => userById.get(m.user_id) ?? '?')
            .join(group.ring_mode === 'sequential' ? ' → ' : ', ')}
        </div>
      )}
    </div>
  )
}

function NewGroupForm({
  hubUsers,
  busy,
  onCancel,
  onCreate,
}: {
  hubUsers: HubUser[]
  busy: boolean
  onCancel: () => void
  onCreate: (input: {
    name: string
    ring_mode: 'simultaneous' | 'sequential'
    member_user_ids: string[]
  }) => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'simultaneous' | 'sequential'>('simultaneous')
  const [members, setMembers] = useState<string[]>([])

  function toggle(id: string) {
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))
  }

  return (
    <div className="rounded border border-white/10 bg-white/5 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <label className="text-white/50">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sales team"
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm flex-1 max-w-xs"
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/50">Ring mode:</span>
        <div className="inline-flex rounded border border-white/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('simultaneous')}
            className={`px-2 py-0.5 ${
              mode === 'simultaneous' ? 'bg-brand text-white' : 'text-white/60 hover:bg-white/10'
            }`}
          >
            Simultaneous
          </button>
          <button
            type="button"
            onClick={() => setMode('sequential')}
            className={`px-2 py-0.5 ${
              mode === 'sequential' ? 'bg-brand text-white' : 'text-white/60 hover:bg-white/10'
            }`}
          >
            Sequential
          </button>
        </div>
      </div>
      <div>
        <div className="text-xs text-white/50 mb-1">Members</div>
        <div className="flex flex-wrap gap-1">
          {hubUsers.map((u) => {
            const on = members.includes(u.id)
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={`text-xs px-2 py-1 rounded border ${
                  on
                    ? 'border-brand bg-brand/20 text-white'
                    : 'border-white/15 text-white/70 hover:bg-white/10'
                }`}
              >
                {on ? '✓ ' : ''}{u.display_name}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!name.trim() || busy}
          onClick={() =>
            onCreate({ name: name.trim(), ring_mode: mode, member_user_ids: members })
          }
          className="text-xs px-3 py-1.5 rounded bg-brand hover:bg-brand-light disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create group'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-white/15 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
