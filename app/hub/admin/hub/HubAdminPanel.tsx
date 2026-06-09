'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import EmojiPicker from '@/components/hub/EmojiPicker'
import AutomationBuilder from '@/components/hub/admin/AutomationBuilder'

type Room = { id: string; name: string; description: string | null; is_private: boolean; archived_at: string | null; claude_enabled: boolean }
type HubUser = { id: string; display_name: string; claude_allowed?: boolean }
type AnnType = 'announcement' | 'shout_out'
type Announcement = {
  id: string
  content: string
  created_at: string
  expires_at: string
  type: AnnType
  archived_at: string | null
  edited_at: string | null
  created_by: string
}
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

type FileTagType = 'general' | 'social-page' | 'social-queue'
type FileTag = {
  id: string
  name: string
  color: string
  tag_type: FileTagType
  description: string | null
  created_at: string
}

const FILE_TAG_TYPE_LABELS: Record<FileTagType, string> = {
  general: 'General',
  'social-page': 'Social Page',
  'social-queue': 'Social Queue',
}

const FILE_TAG_DEFAULT_COLORS = ['#F97316', '#EF4444', '#10B981', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#6B7280']

type ChatSynxLink = {
  slack_user_id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  hub_user: { id: string; display_name: string; avatar_url: string | null } | null
}

type ChatSynxBridge = {
  id: string
  slack_channel_id: string
  active: boolean
  created_at: string
  hub_room: { id: string; name: string } | null
}

type ExternalLink = {
  id: string
  name: string
  url: string
  icon: string
  sort_order: number
  created_at: string
}

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
  activeAnnouncements,
}: {
  initialRooms: Room[]
  hubUsers: HubUser[]
  allowMemberRoomCreation: boolean
  activeAnnouncements: Announcement[]
}) {
  const router = useRouter()
  const [rooms, setRooms] = useState<Room[]>(initialRooms)
  const [allowCreate, setAllowCreate] = useState(allowMemberRoomCreation)
  const [activeAnns, setActiveAnns] = useState<Announcement[]>(activeAnnouncements)
  const activeAnnouncement = activeAnns.find(a => a.type === 'announcement') ?? null
  const activeShoutOut = activeAnns.find(a => a.type === 'shout_out') ?? null

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

  // Announcement composer
  const [annType, setAnnType] = useState<AnnType>('announcement')
  const [annContent, setAnnContent] = useState('')
  const [annDuration, setAnnDuration] = useState<number | 'custom'>(24)
  const [annCustomDate, setAnnCustomDate] = useState('')
  const [postingAnn, setPostingAnn] = useState(false)
  const [annError, setAnnError] = useState('')
  const [showAnnEmojiPicker, setShowAnnEmojiPicker] = useState(false)
  const annTextareaRef = useRef<HTMLTextAreaElement>(null)
  // Edit modal
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null)
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  // Past announcements (archived / expired)
  const [pastAnns, setPastAnns] = useState<Announcement[]>([])
  const [pastAnnsLoaded, setPastAnnsLoaded] = useState(false)
  const [loadingPastAnns, setLoadingPastAnns] = useState(false)
  const [deletingAnnId, setDeletingAnnId] = useState<string | null>(null)

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

  // Chat Synx — sub-tab + person links + channel bridges
  const [chatSynxSubTab, setChatSynxSubTab] = useState<'people' | 'channels'>('people')
  const [chatSynxLinks, setChatSynxLinks] = useState<ChatSynxLink[]>([])
  const [chatSynxLinksLoaded, setChatSynxLinksLoaded] = useState(false)
  const [newLinkSlackUserId, setNewLinkSlackUserId] = useState('')
  const [newLinkHubUserId, setNewLinkHubUserId] = useState('')
  const [savingPersonLink, setSavingPersonLink] = useState(false)
  const [personLinkError, setPersonLinkError] = useState('')
  const [chatSynxBridges, setChatSynxBridges] = useState<ChatSynxBridge[]>([])
  const [chatSynxBridgesLoaded, setChatSynxBridgesLoaded] = useState(false)
  const [newBridgeSlackChannelId, setNewBridgeSlackChannelId] = useState('')
  const [newBridgeHubRoomId, setNewBridgeHubRoomId] = useState('')
  const [savingBridge, setSavingBridge] = useState(false)
  const [bridgeError, setBridgeError] = useState('')

  // File tags
  const [fileTags, setFileTags] = useState<FileTag[]>([])
  const [fileTagsLoaded, setFileTagsLoaded] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#F97316')
  const [newTagType, setNewTagType] = useState<FileTagType>('general')
  const [newTagDescription, setNewTagDescription] = useState('')
  const [savingTag, setSavingTag] = useState(false)
  const [tagError, setTagError] = useState('')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editTagDraft, setEditTagDraft] = useState<{ name: string; color: string; tag_type: FileTagType; description: string }>({
    name: '', color: '#6B7280', tag_type: 'general', description: ''
  })

  // External Links
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([])
  const [externalLinksLoaded, setExternalLinksLoaded] = useState(false)
  const [newLinkName, setNewLinkName] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [newLinkIcon, setNewLinkIcon] = useState('🔗')
  const [newLinkSortOrder, setNewLinkSortOrder] = useState(0)
  const [savingLink, setSavingLink] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [showNewLinkEmojiPicker, setShowNewLinkEmojiPicker] = useState(false)
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [editLinkDraft, setEditLinkDraft] = useState<{ name: string; url: string; icon: string; sort_order: number }>({
    name: '', url: '', icon: '🔗', sort_order: 0,
  })
  const [showEditLinkEmojiPicker, setShowEditLinkEmojiPicker] = useState(false)

  // Section tabs
  const [tab, setTab] = useState<'rooms' | 'members' | 'settings' | 'announcements' | 'api-keys' | 'automation' | 'chat-synx' | 'file-tags' | 'external-links'>('rooms')

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
      body: JSON.stringify({ content: annContent.trim(), expires_at, type: annType }),
    })
    const data = await res.json()
    setPostingAnn(false)
    if (!res.ok) { setAnnError(data.error ?? 'Failed to post'); return }
    // Replace any active row of the same type with the new one
    setActiveAnns(prev => [...prev.filter(a => a.type !== data.type), data as Announcement])
    setAnnContent('')
    router.refresh()
  }

  async function archiveAnnouncement(ann: Announcement) {
    const res = await fetch(`/api/hub/announcements/${ann.id}`, { method: 'DELETE' })
    if (res.ok) {
      setActiveAnns(prev => prev.filter(a => a.id !== ann.id))
      if (pastAnnsLoaded) {
        setPastAnns(prev => [{ ...ann, archived_at: new Date().toISOString() }, ...prev])
      }
      router.refresh()
    }
  }

  async function loadPastAnns() {
    if (pastAnnsLoaded || loadingPastAnns) return
    setLoadingPastAnns(true)
    const res = await fetch('/api/hub/announcements?archived=1')
    const data = await res.json()
    setPastAnns(data.archived ?? [])
    setPastAnnsLoaded(true)
    setLoadingPastAnns(false)
  }

  async function hardDeleteAnn(id: string) {
    if (!confirm('Permanently delete this announcement? This cannot be undone.')) return
    setDeletingAnnId(id)
    const res = await fetch(`/api/hub/announcements/${id}?hard=1`, { method: 'DELETE' })
    setDeletingAnnId(null)
    if (res.ok) setPastAnns(prev => prev.filter(a => a.id !== id))
  }

  function startEdit(ann: Announcement) {
    setEditingAnn(ann)
    setEditContent(ann.content)
    setEditError('')
  }

  async function saveEdit() {
    if (!editingAnn || !editContent.trim() || savingEdit) return
    setSavingEdit(true)
    setEditError('')
    const res = await fetch(`/api/hub/announcements/${editingAnn.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent.trim() }),
    })
    const data = await res.json()
    setSavingEdit(false)
    if (!res.ok) { setEditError(data.error ?? 'Failed to save'); return }
    setActiveAnns(prev => prev.map(a => a.id === data.id ? { ...a, ...data } : a))
    setEditingAnn(null)
    router.refresh()
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

  async function loadChatSynxLinks() {
    const res = await fetch('/api/admin/chat-synx/links')
    if (!res.ok) return
    const data = await res.json()
    setChatSynxLinks(data.links ?? [])
    setChatSynxLinksLoaded(true)
  }

  async function createChatSynxLink() {
    if (savingPersonLink) return
    if (!newLinkSlackUserId.trim() || !newLinkHubUserId) { setPersonLinkError('Slack User ID and Hub user required'); return }
    setSavingPersonLink(true); setPersonLinkError('')
    const res = await fetch('/api/admin/chat-synx/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slack_user_id: newLinkSlackUserId.trim(), hub_user_id: newLinkHubUserId }),
    })
    const data = await res.json()
    setSavingPersonLink(false)
    if (!res.ok) { setPersonLinkError(data.error ?? 'Failed to create link'); return }
    setNewLinkSlackUserId(''); setNewLinkHubUserId('')
    await loadChatSynxLinks()
  }

  async function refreshChatSynxLink(slackUserId: string) {
    const res = await fetch(`/api/admin/chat-synx/links/${encodeURIComponent(slackUserId)}`, { method: 'PATCH' })
    if (!res.ok) return
    await loadChatSynxLinks()
  }

  async function deleteChatSynxLink(slackUserId: string) {
    if (!confirm('Delete this person mapping? Their Slack messages will stop reaching Hub until you re-link them.')) return
    await fetch(`/api/admin/chat-synx/links/${encodeURIComponent(slackUserId)}`, { method: 'DELETE' })
    setChatSynxLinks(prev => prev.filter(l => l.slack_user_id !== slackUserId))
  }

  async function loadChatSynxBridges() {
    const res = await fetch('/api/admin/chat-synx/bridges')
    if (!res.ok) return
    const data = await res.json()
    setChatSynxBridges(data.bridges ?? [])
    setChatSynxBridgesLoaded(true)
  }

  async function createChatSynxBridge() {
    if (savingBridge) return
    if (!newBridgeSlackChannelId.trim() || !newBridgeHubRoomId) { setBridgeError('Slack Channel ID and Hub room required'); return }
    setSavingBridge(true); setBridgeError('')
    const res = await fetch('/api/admin/chat-synx/bridges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slack_channel_id: newBridgeSlackChannelId.trim(), hub_room_id: newBridgeHubRoomId }),
    })
    const data = await res.json()
    setSavingBridge(false)
    if (!res.ok) { setBridgeError(data.error ?? 'Failed to create channel bridge'); return }
    setNewBridgeSlackChannelId(''); setNewBridgeHubRoomId('')
    await loadChatSynxBridges()
  }

  async function toggleChatSynxBridge(id: string, active: boolean) {
    setChatSynxBridges(prev => prev.map(b => b.id === id ? { ...b, active } : b))
    await fetch(`/api/admin/chat-synx/bridges/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
  }

  async function deleteChatSynxBridge(id: string) {
    if (!confirm('Delete this channel bridge? Messages will stop flowing between this Hub room and Slack channel.')) return
    await fetch(`/api/admin/chat-synx/bridges/${id}`, { method: 'DELETE' })
    setChatSynxBridges(prev => prev.filter(b => b.id !== id))
  }

  async function loadFileTags() {
    const res = await fetch('/api/admin/file-tags')
    if (!res.ok) return
    const data = await res.json()
    setFileTags(data.tags ?? [])
    setFileTagsLoaded(true)
  }

  async function createFileTag() {
    if (!newTagName.trim() || savingTag) return
    setSavingTag(true)
    setTagError('')
    const res = await fetch('/api/admin/file-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTagName.trim(),
        color: newTagColor,
        tag_type: newTagType,
        description: newTagDescription.trim() || null,
      }),
    })
    const data = await res.json()
    setSavingTag(false)
    if (!res.ok) { setTagError(data.error ?? 'Failed to create tag'); return }
    setFileTags(prev => [...prev, data.tag].sort((a, b) => a.tag_type.localeCompare(b.tag_type) || a.name.localeCompare(b.name)))
    setNewTagName(''); setNewTagDescription(''); setNewTagType('general'); setNewTagColor('#F97316')
  }

  function startEditTag(tag: FileTag) {
    setEditingTagId(tag.id)
    setEditTagDraft({
      name: tag.name,
      color: tag.color,
      tag_type: tag.tag_type,
      description: tag.description ?? '',
    })
    setTagError('')
  }

  async function saveEditTag(id: string) {
    if (!editTagDraft.name.trim()) return
    setTagError('')
    const res = await fetch(`/api/admin/file-tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editTagDraft.name.trim(),
        color: editTagDraft.color,
        tag_type: editTagDraft.tag_type,
        description: editTagDraft.description.trim() || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setTagError(data.error ?? 'Failed to update tag'); return }
    setFileTags(prev => prev.map(t => t.id === id ? data.tag : t)
      .sort((a, b) => a.tag_type.localeCompare(b.tag_type) || a.name.localeCompare(b.name)))
    setEditingTagId(null)
    if (data.warning) alert(data.warning)
  }

  async function deleteFileTag(tag: FileTag) {
    if (!confirm(`Delete tag "${tag.name}"?\n\nThis will also remove it from any files currently tagged with it.`)) return
    const res = await fetch(`/api/admin/file-tags/${tag.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Failed to delete tag')
      return
    }
    setFileTags(prev => prev.filter(t => t.id !== tag.id))
  }

  async function loadExternalLinks() {
    const res = await fetch('/api/admin/external-links')
    if (!res.ok) return
    const data = await res.json()
    setExternalLinks(data.links ?? [])
    setExternalLinksLoaded(true)
  }

  async function createExternalLink() {
    if (!newLinkName.trim() || !newLinkUrl.trim() || savingLink) return
    setSavingLink(true)
    setLinkError('')
    const res = await fetch('/api/admin/external-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newLinkName.trim(),
        url: newLinkUrl.trim(),
        icon: newLinkIcon || '🔗',
        sort_order: newLinkSortOrder,
      }),
    })
    const data = await res.json()
    setSavingLink(false)
    if (!res.ok) { setLinkError(data.error ?? 'Failed to create link'); return }
    setExternalLinks(prev => [...prev, data.link].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
    setNewLinkName(''); setNewLinkUrl(''); setNewLinkIcon('🔗'); setNewLinkSortOrder(0)
    window.dispatchEvent(new Event('hub-external-links-changed'))
  }

  function startEditLink(link: ExternalLink) {
    setEditingLinkId(link.id)
    setEditLinkDraft({ name: link.name, url: link.url, icon: link.icon, sort_order: link.sort_order })
    setLinkError('')
  }

  async function saveEditLink(id: string) {
    if (!editLinkDraft.name.trim() || !editLinkDraft.url.trim()) return
    setLinkError('')
    const res = await fetch(`/api/admin/external-links/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editLinkDraft.name.trim(),
        url: editLinkDraft.url.trim(),
        icon: editLinkDraft.icon || '🔗',
        sort_order: editLinkDraft.sort_order,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setLinkError(data.error ?? 'Failed to update link'); return }
    setExternalLinks(prev => prev.map(l => l.id === id ? data.link : l)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
    setEditingLinkId(null)
    window.dispatchEvent(new Event('hub-external-links-changed'))
  }

  async function deleteExternalLink(link: ExternalLink) {
    if (!confirm(`Delete link "${link.name}"?`)) return
    const res = await fetch(`/api/admin/external-links/${link.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Failed to delete link')
      return
    }
    setExternalLinks(prev => prev.filter(l => l.id !== link.id))
    window.dispatchEvent(new Event('hub-external-links-changed'))
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
          ['chat-synx', 'Chat Synx'],
          ['file-tags', 'File Tags'],
          ['external-links', 'External Links'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); if (key === 'api-keys') loadApiKeys(); if (key === 'automation') loadAutomationRules(); if (key === 'chat-synx') { if (!chatSynxLinksLoaded) loadChatSynxLinks(); if (!chatSynxBridgesLoaded) loadChatSynxBridges(); } if (key === 'file-tags' && !fileTagsLoaded) loadFileTags(); if (key === 'external-links' && !externalLinksLoaded) loadExternalLinks(); if (key === 'announcements') loadPastAnns() }}
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

          {/* Keyword rules list */}
          <div>
            <h2 className="font-semibold text-white mb-3">
              Keyword Rules ({automationRules.filter(r => (r.trigger_source ?? 'room_message') === 'room_message').length})
            </h2>
            {!automationLoaded ? (
              <p className="text-sm text-gray-500 px-1">Loading…</p>
            ) : automationRules.filter(r => (r.trigger_source ?? 'room_message') === 'room_message').length === 0 ? (
              <p className="text-sm text-gray-500 px-1">No keyword rules yet.</p>
            ) : (
              <div className="space-y-2">
                {automationRules.filter(r => (r.trigger_source ?? 'room_message') === 'room_message').map(rule => (
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

          {/* Scheduled & fleet-geofence automations */}
          <AutomationBuilder rooms={activeRooms} hubUsers={hubUsers} />
        </div>
      )}

      {/* ── ANNOUNCEMENTS TAB ── */}
      {tab === 'announcements' && (
        <div className="space-y-6">
          {/* Active announcement */}
          {activeAnnouncement && (
            <div className="bg-[#0F2D45] border border-[#2E7EB8]/40 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#6FB3E8] font-semibold uppercase tracking-wider mb-1">📢 Active Announcement</div>
                  <p className="text-sm text-white whitespace-pre-wrap">{activeAnnouncement.content}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Expires {new Date(activeAnnouncement.expires_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    {activeAnnouncement.edited_at && ' · edited'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 flex-none">
                  <button
                    onClick={() => startEdit(activeAnnouncement)}
                    className="text-xs text-gray-300 hover:text-white px-3 py-1.5 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => archiveAnnouncement(activeAnnouncement)}
                    className="text-xs text-yellow-400 hover:text-yellow-300 px-3 py-1.5 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/10 transition-colors"
                  >
                    Archive
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active shout out */}
          {activeShoutOut && (
            <div className="bg-amber-500/10 border border-amber-400/30 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-amber-300 font-semibold uppercase tracking-wider mb-1">🎉 Active Shout Out</div>
                  <p className="text-sm text-amber-50 whitespace-pre-wrap">{activeShoutOut.content}</p>
                  <p className="text-xs text-amber-200/60 mt-2">
                    Expires {new Date(activeShoutOut.expires_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    {activeShoutOut.edited_at && ' · edited'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 flex-none">
                  <button
                    onClick={() => startEdit(activeShoutOut)}
                    className="text-xs text-amber-100 hover:text-white px-3 py-1.5 border border-amber-400/30 rounded-lg hover:bg-amber-500/10 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => archiveAnnouncement(activeShoutOut)}
                    className="text-xs text-amber-300 hover:text-amber-200 px-3 py-1.5 border border-amber-400/30 rounded-lg hover:bg-amber-500/10 transition-colors"
                  >
                    Archive
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Post new */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-4">
              Post {annType === 'shout_out' ? 'Shout Out' : 'Announcement'}
            </h2>

            {/* Type selector */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { setAnnType('announcement'); if (annDuration === 72) setAnnDuration(24) }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                  annType === 'announcement'
                    ? 'bg-[#2E7EB8] text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <span>📢</span> Announcement
              </button>
              <button
                onClick={() => { setAnnType('shout_out'); setAnnDuration(72) }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                  annType === 'shout_out'
                    ? 'bg-amber-500 text-gray-900'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <span>🎉</span> Shout Out
              </button>
            </div>

            {((annType === 'announcement' && activeAnnouncement) || (annType === 'shout_out' && activeShoutOut)) && (
              <p className="text-xs text-yellow-600 mb-4">Posting will automatically archive the current active {annType === 'shout_out' ? 'shout out' : 'announcement'}.</p>
            )}
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  ref={annTextareaRef}
                  value={annContent}
                  onChange={e => setAnnContent(e.target.value)}
                  placeholder={annType === 'shout_out' ? 'Shout out text…' : 'Announcement text…'}
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
                className={`px-6 py-2.5 rounded-xl disabled:opacity-40 text-sm font-medium transition-colors ${
                  annType === 'shout_out'
                    ? 'bg-amber-500 hover:bg-amber-400 text-gray-900'
                    : 'bg-[#2E7EB8] hover:bg-[#2470a8] text-white'
                }`}
              >
                {postingAnn ? 'Posting…' : `Post ${annType === 'shout_out' ? 'Shout Out' : 'Announcement'}`}
              </button>
            </div>
          </div>

          {/* Edit modal */}
          {editingAnn && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-lg w-full">
                <h3 className="text-white font-semibold mb-1">
                  Edit {editingAnn.type === 'shout_out' ? 'Shout Out' : 'Announcement'}
                </h3>
                <p className="text-xs text-gray-500 mb-4">Expiration is not changed. Posting time is preserved.</p>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-[#2E7EB8] resize-none mb-4"
                />
                {editError && <p className="text-sm text-red-400 mb-3">{editError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditingAnn(null)}
                    className="px-4 py-2 rounded-xl text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={!editContent.trim() || savingEdit}
                    className="px-5 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                  >
                    {savingEdit ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Past announcements (archived / expired) */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-4">Past Announcements</h2>
            {loadingPastAnns ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : pastAnns.length === 0 ? (
              <p className="text-sm text-gray-500">No past announcements.</p>
            ) : (
              <div className="space-y-2">
                {pastAnns.map(a => (
                  <div key={a.id} className="flex items-start gap-3 bg-gray-800/50 rounded-xl px-4 py-3">
                    <span className="flex-none mt-0.5 text-sm">{a.type === 'shout_out' ? '🎉' : '📢'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 line-clamp-2">{a.content}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {a.archived_at
                          ? `Archived ${new Date(a.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : `Expired ${new Date(a.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                      </p>
                    </div>
                    <button
                      onClick={() => hardDeleteAnn(a.id)}
                      disabled={deletingAnnId === a.id}
                      className="flex-none text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      {deletingAnnId === a.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}


      {/* ── CHAT SYNX TAB ── */}
      {tab === 'chat-synx' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="font-semibold text-white mb-1">Chat Synx</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              Bridge Hub rooms to Slack channels. Set this up in two steps:
              <strong className="text-white"> People</strong> maps each teammate&apos;s Slack identity to their Hub account so messages cross over with the right name and avatar.
              <strong className="text-white"> Channels</strong> pairs a Hub room to a Slack channel.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Important: invite <code className="text-green-400">@Chat Synx</code> to any Slack channel you bridge, or events won&apos;t reach us.
            </p>
          </div>

          {/* Sub-tab toggle */}
          <div className="flex gap-2">
            {([
              ['people', 'People'],
              ['channels', 'Channels'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setChatSynxSubTab(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  chatSynxSubTab === key ? 'bg-[#2E7EB8] text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {chatSynxSubTab === 'people' && (
            <div className="space-y-8">
              {/* Create person link */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold text-white mb-1">Link a Slack person to a Hub user</h3>
                <p className="text-sm text-gray-500 mb-4">
                  One row per teammate. The Slack User ID identifies them in Slack; the Hub user is their account here. We&apos;ll pull their Slack display name and avatar automatically so outbound messages match.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Slack User ID</label>
                    <input
                      value={newLinkSlackUserId}
                      onChange={e => setNewLinkSlackUserId(e.target.value)}
                      placeholder="U01ABC234DEF (Slack profile → More → Copy member ID)"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Hub user</label>
                    <select
                      value={newLinkHubUserId}
                      onChange={e => setNewLinkHubUserId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                    >
                      <option value="">— pick a Hub user —</option>
                      {hubUsers.map(u => (<option key={u.id} value={u.id}>{u.display_name}</option>))}
                    </select>
                  </div>
                </div>
                {personLinkError && <p className="text-sm text-red-400 mt-3">{personLinkError}</p>}
                <button
                  onClick={createChatSynxLink}
                  disabled={savingPersonLink}
                  className="mt-4 px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                >
                  {savingPersonLink ? 'Linking…' : 'Link person'}
                </button>
              </div>

              {/* People list */}
              <div>
                <h3 className="font-semibold text-white mb-3">Mapped People ({chatSynxLinks.length})</h3>
                {!chatSynxLinksLoaded ? (
                  <p className="text-sm text-gray-500 px-1">Loading…</p>
                ) : chatSynxLinks.length === 0 ? (
                  <p className="text-sm text-gray-500 px-1">No people linked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {chatSynxLinks.map(l => (
                      <div key={l.slack_user_id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white flex items-center gap-2 flex-wrap">
                            {l.avatar_url ? (
                              <img src={l.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-700" />
                            )}
                            <span>{l.display_name ?? '(no Slack name cached)'}</span>
                            <code className="font-mono text-xs bg-gray-800 px-1.5 py-0.5 rounded text-gray-400">{l.slack_user_id}</code>
                            <span className="text-gray-500 mx-1">↔</span>
                            <span>{l.hub_user?.display_name ?? '(unknown Hub user)'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => refreshChatSynxLink(l.slack_user_id)}
                          className="text-xs text-gray-400 hover:text-white px-3 py-1.5 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors flex-none"
                          title="Re-pull display name and avatar from Slack"
                        >
                          Refresh
                        </button>
                        <button
                          onClick={() => deleteChatSynxLink(l.slack_user_id)}
                          className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors flex-none"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {chatSynxSubTab === 'channels' && (
            <div className="space-y-8">
              {/* Create channel bridge */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold text-white mb-1">Bridge a Hub room to a Slack channel</h3>
                <p className="text-sm text-gray-500 mb-4">
                  One row per room ↔ channel pair. Each Hub room and each Slack channel can only be in one bridge at a time.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Slack Channel ID</label>
                    <input
                      value={newBridgeSlackChannelId}
                      onChange={e => setNewBridgeSlackChannelId(e.target.value)}
                      placeholder="C01ABC234DEF (open channel in Slack web → ID is in URL)"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Hub room</label>
                    <select
                      value={newBridgeHubRoomId}
                      onChange={e => setNewBridgeHubRoomId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                    >
                      <option value="">— pick a Hub room —</option>
                      {rooms.filter(r => !r.archived_at).map(r => (<option key={r.id} value={r.id}>#{r.name}</option>))}
                    </select>
                  </div>
                </div>
                {bridgeError && <p className="text-sm text-red-400 mt-3">{bridgeError}</p>}
                <button
                  onClick={createChatSynxBridge}
                  disabled={savingBridge}
                  className="mt-4 px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                >
                  {savingBridge ? 'Bridging…' : 'Bridge channel'}
                </button>
              </div>

              {/* Bridges list */}
              <div>
                <h3 className="font-semibold text-white mb-3">Active Bridges ({chatSynxBridges.length})</h3>
                {!chatSynxBridgesLoaded ? (
                  <p className="text-sm text-gray-500 px-1">Loading…</p>
                ) : chatSynxBridges.length === 0 ? (
                  <p className="text-sm text-gray-500 px-1">No channels bridged yet.</p>
                ) : (
                  <div className="space-y-2">
                    {chatSynxBridges.map(b => (
                      <div
                        key={b.id}
                        className={`bg-gray-900 border rounded-xl px-4 py-3 flex items-center gap-4 ${b.active ? 'border-gray-800' : 'border-gray-800/50 opacity-60'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {!b.active && (<span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">Paused</span>)}
                          </div>
                          <div className="text-sm text-white">
                            <code className="font-mono text-xs bg-gray-800 px-1.5 py-0.5 rounded">{b.slack_channel_id}</code>
                            <span className="text-gray-500 mx-2">↔</span>
                            <span>#{b.hub_room?.name ?? '(unknown room)'}</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            Created {new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                        <button
                          onClick={() => toggleChatSynxBridge(b.id, !b.active)}
                          className="text-xs text-gray-400 hover:text-white px-3 py-1.5 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors flex-none"
                        >
                          {b.active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => deleteChatSynxBridge(b.id)}
                          className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors flex-none"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Help */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h3 className="font-semibold text-white mb-3">How to find Slack IDs</h3>
            <div className="space-y-3 text-sm text-gray-400">
              <p><strong className="text-white">Slack User ID:</strong> click a teammate&apos;s avatar in Slack → View full profile → ⋮ (More) → &quot;Copy member ID&quot;. Starts with <code className="text-green-400">U</code>.</p>
              <p><strong className="text-white">Slack Channel ID:</strong> open the channel in Slack on the web — the ID is at the end of the URL. Starts with <code className="text-green-400">C</code>.</p>
              <p><strong className="text-white">One-time scope check:</strong> The Chat Synx Slack app must have <code className="text-green-400">chat:write.customize</code> in its scopes for outbound posts to wear each Hub user&apos;s name and avatar. If posts show up as the bot instead, that scope is missing.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── FILE TAGS TAB ── */}
      {tab === 'file-tags' && (
        <div className="space-y-8">
          {/* Create tag */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Create File Tag</h2>
            <p className="text-sm text-gray-500 mb-4">
              Tags organize files in <code className="text-green-400">/hub/files</code>. <strong className="text-white">Social Queue</strong> tags mark photos for the social poster. <strong className="text-white">Social Page</strong> tags target a specific Facebook/Instagram account.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Name</label>
                <input
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createFileTag()}
                  placeholder="e.g. Irrigation, Spring Promo"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Type</label>
                <select
                  value={newTagType}
                  onChange={e => setNewTagType(e.target.value as FileTagType)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                >
                  <option value="general">General</option>
                  <option value="social-queue">Social Queue (eligible for social posts)</option>
                  <option value="social-page">Social Page (targets a specific FB/IG page)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {FILE_TAG_DEFAULT_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTagColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${newTagColor === c ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={e => setNewTagColor(e.target.value)}
                    className="w-7 h-7 rounded-full bg-transparent border-0 cursor-pointer"
                    aria-label="Custom color"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Description (optional)</label>
                <input
                  value={newTagDescription}
                  onChange={e => setNewTagDescription(e.target.value)}
                  placeholder="What this tag is for"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                />
              </div>
            </div>
            {tagError && <p className="text-sm text-red-400 mt-3">{tagError}</p>}
            <button
              onClick={createFileTag}
              disabled={savingTag || !newTagName.trim()}
              className="mt-4 px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
            >
              {savingTag ? 'Creating…' : 'Add Tag'}
            </button>
          </div>

          {/* Tags list */}
          <div>
            <h2 className="font-semibold text-white mb-3">Tags ({fileTags.length})</h2>
            {!fileTagsLoaded ? (
              <p className="text-sm text-gray-500 px-1">Loading…</p>
            ) : fileTags.length === 0 ? (
              <p className="text-sm text-gray-500 px-1">No tags yet. Create one above.</p>
            ) : (
              <div className="space-y-2">
                {fileTags.map(tag => (
                  <div
                    key={tag.id}
                    className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
                  >
                    {editingTagId === tag.id ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input
                            value={editTagDraft.name}
                            onChange={e => setEditTagDraft(d => ({ ...d, name: e.target.value }))}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                            placeholder="Name"
                          />
                          <select
                            value={editTagDraft.tag_type}
                            onChange={e => setEditTagDraft(d => ({ ...d, tag_type: e.target.value as FileTagType }))}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                          >
                            <option value="general">General</option>
                            <option value="social-queue">Social Queue</option>
                            <option value="social-page">Social Page</option>
                          </select>
                        </div>
                        <input
                          value={editTagDraft.description}
                          onChange={e => setEditTagDraft(d => ({ ...d, description: e.target.value }))}
                          placeholder="Description"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          {FILE_TAG_DEFAULT_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setEditTagDraft(d => ({ ...d, color: c }))}
                              className={`w-6 h-6 rounded-full transition-transform ${editTagDraft.color === c ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}`}
                              style={{ backgroundColor: c }}
                              aria-label={c}
                            />
                          ))}
                          <input
                            type="color"
                            value={editTagDraft.color}
                            onChange={e => setEditTagDraft(d => ({ ...d, color: e.target.value }))}
                            className="w-6 h-6 rounded-full bg-transparent border-0 cursor-pointer"
                          />
                        </div>
                        {tagError && <p className="text-sm text-red-400">{tagError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEditTag(tag.id)}
                            className="px-4 py-1.5 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] text-sm text-white"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingTagId(null); setTagError('') }}
                            className="px-4 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-white flex-none"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs uppercase tracking-wide text-gray-500">
                            {FILE_TAG_TYPE_LABELS[tag.tag_type]}
                          </div>
                          {tag.description && (
                            <div className="text-sm text-gray-400 truncate mt-0.5">{tag.description}</div>
                          )}
                        </div>
                        <button
                          onClick={() => startEditTag(tag)}
                          className="text-xs text-gray-400 hover:text-white px-3 py-1.5 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors flex-none"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteFileTag(tag)}
                          className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors flex-none"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Help */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-3">About Tag Types</h2>
            <div className="space-y-3 text-sm text-gray-400">
              <p><strong className="text-white">General</strong> — Plain organizational tag. Useful for sorting files in the Files list.</p>
              <p><strong className="text-white">Social Queue</strong> — Files tagged with one of these are eligible to be pulled into the social media posting queue (Lynxedo Social).</p>
              <p><strong className="text-white">Social Page</strong> — Represents a specific social media account (e.g. Heroes Page, Doody Duty Page). When connected to Lynxedo Social, posts are routed to the matching FB/IG account.</p>
              <p className="pt-2 border-t border-gray-800"><strong className="text-white">Renaming a tag</strong> automatically updates the tag everywhere it&apos;s currently used. <strong className="text-white">Deleting</strong> removes it from files too.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── EXTERNAL LINKS TAB ── */}
      {tab === 'external-links' && (
        <div className="space-y-8">
          {/* Create link */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-1">Add External Link</h2>
            <p className="text-sm text-gray-500 mb-4">
              Links appear in the Hub sidebar under <strong className="text-white">LINKS</strong>. Click opens in a new tab. Use these for tools the team uses outside of Lynxedo (Jobber, Gusto, QBO, etc.).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 items-end">
              <div className="relative">
                <label className="text-xs text-gray-400 block mb-1">Icon</label>
                <button
                  type="button"
                  onClick={() => setShowNewLinkEmojiPicker(v => !v)}
                  className="w-12 h-[42px] bg-gray-800 border border-gray-700 rounded-xl text-xl hover:border-[#2E7EB8] transition-colors flex items-center justify-center"
                  title="Pick emoji"
                >
                  {newLinkIcon}
                </button>
                {showNewLinkEmojiPicker && (
                  <EmojiPicker
                    onSelect={emoji => { setNewLinkIcon(emoji); setShowNewLinkEmojiPicker(false) }}
                    onClose={() => setShowNewLinkEmojiPicker(false)}
                  />
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Name</label>
                <input
                  value={newLinkName}
                  onChange={e => setNewLinkName(e.target.value)}
                  placeholder="e.g. Jobber"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Sort order</label>
                <input
                  type="number"
                  value={newLinkSortOrder}
                  onChange={e => setNewLinkSortOrder(parseInt(e.target.value) || 0)}
                  className="w-24 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-gray-400 block mb-1">URL</label>
                <input
                  value={newLinkUrl}
                  onChange={e => setNewLinkUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createExternalLink()}
                  placeholder="https://..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                />
              </div>
            </div>
            {linkError && <p className="text-sm text-red-400 mt-3">{linkError}</p>}
            <button
              onClick={createExternalLink}
              disabled={savingLink || !newLinkName.trim() || !newLinkUrl.trim()}
              className="mt-4 px-5 py-2.5 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
            >
              {savingLink ? 'Adding…' : 'Add Link'}
            </button>
          </div>

          {/* Links list */}
          <div>
            <h2 className="font-semibold text-white mb-3">Links ({externalLinks.length})</h2>
            {!externalLinksLoaded ? (
              <p className="text-sm text-gray-500 px-1">Loading…</p>
            ) : externalLinks.length === 0 ? (
              <p className="text-sm text-gray-500 px-1">No links yet. Add one above.</p>
            ) : (
              <div className="space-y-2">
                {externalLinks.map(link => (
                  <div key={link.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                    {editingLinkId === link.id ? (
                      <div className="space-y-3">
                        <div className="flex gap-3 items-end flex-wrap">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowEditLinkEmojiPicker(v => !v)}
                              className="w-12 h-10 bg-gray-800 border border-gray-700 rounded-lg text-lg hover:border-[#2E7EB8] transition-colors flex items-center justify-center"
                              title="Pick emoji"
                            >
                              {editLinkDraft.icon}
                            </button>
                            {showEditLinkEmojiPicker && (
                              <EmojiPicker
                                onSelect={emoji => {
                                  setEditLinkDraft(d => ({ ...d, icon: emoji }))
                                  setShowEditLinkEmojiPicker(false)
                                }}
                                onClose={() => setShowEditLinkEmojiPicker(false)}
                              />
                            )}
                          </div>
                          <input
                            value={editLinkDraft.name}
                            onChange={e => setEditLinkDraft(d => ({ ...d, name: e.target.value }))}
                            placeholder="Name"
                            className="flex-1 min-w-[180px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                          />
                          <input
                            type="number"
                            value={editLinkDraft.sort_order}
                            onChange={e => setEditLinkDraft(d => ({ ...d, sort_order: parseInt(e.target.value) || 0 }))}
                            className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                            title="Sort order"
                          />
                        </div>
                        <input
                          value={editLinkDraft.url}
                          onChange={e => setEditLinkDraft(d => ({ ...d, url: e.target.value }))}
                          placeholder="https://..."
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setEditingLinkId(null)}
                            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEditLink(link.id)}
                            disabled={!editLinkDraft.name.trim() || !editLinkDraft.url.trim()}
                            className="px-4 py-1.5 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-xs text-white font-medium transition-colors"
                          >
                            Save
                          </button>
                        </div>
                        {linkError && <p className="text-sm text-red-400">{linkError}</p>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-xl flex-none">{link.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white font-medium truncate">{link.name}</div>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gray-500 hover:text-gray-300 truncate block"
                          >
                            {link.url}
                          </a>
                        </div>
                        <span className="text-xs text-gray-600 flex-none">#{link.sort_order}</span>
                        <button
                          onClick={() => startEditLink(link)}
                          className="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteExternalLink(link)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Help */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-3">About External Links</h2>
            <div className="space-y-3 text-sm text-gray-400">
              <p>Links show up in the Hub sidebar under the <strong className="text-white">LINKS</strong> section, between Pages and the bottom of the sidebar. The section is collapsible — clicking the chevron hides it.</p>
              <p>Everyone in Hub sees the same set of links. Only admins can add, edit, or delete them.</p>
              <p><strong className="text-white">Sort order</strong> controls the order links appear in the sidebar (lower numbers first). Use multiples of 10 (10, 20, 30…) so you can insert between later.</p>
              <p>Clicking a link opens the URL in a new browser tab.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
