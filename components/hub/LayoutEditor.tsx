'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CATALOG,
  CatalogIcon,
  DndIcon,
  LockIcon,
  type CatalogId,
  type RailPermissions,
} from './railCatalog'
import { classifyToken, tokenAllowed, MOBILE_VISIBLE, lockedCount, type HubLayout } from '@/lib/hub-layout'

type Room = { id: string; name: string; is_private: boolean }
type Conversation = { id: string; participants: { id: string; display_name: string; avatar_url?: string | null }[] }

const SYSTEM_LABELS: Record<string, string> = {
  hub: 'Hub',
  txt: 'Txt (Captivated)',
  'time-clock': 'Time Clock',
}

function convFirstNames(conv: Conversation, currentUserId?: string): string {
  const others = conv.participants.filter(p => p.id !== currentUserId)
  if (others.length === 0) return conv.participants[0]?.display_name ?? 'You'
  return others.map(p => (p.display_name || '?').split(' ')[0]).join(', ')
}

function TokenIcon({ token, rooms, conversations, currentUserId }: { token: string; rooms: Room[]; conversations: Conversation[]; currentUserId?: string }) {
  const c = classifyToken(token)
  if (c.kind === 'master-dnd') return <span className="text-red-400"><DndIcon /></span>
  if (c.kind === 'hub-dnd') return <span className="text-orange-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></span>
  if (c.kind === 'dialer-dnd') return <span className="text-orange-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg></span>
  if (c.kind === 'url') return <span className="text-white/80"><CatalogIcon id="links" /></span>
  if (c.kind === 'room') {
    const room = rooms.find(r => r.id === c.id)
    const letter = (room?.name || '#').trim().charAt(0).toUpperCase() || '#'
    return <span className="flex items-center justify-center w-5 h-5 rounded-md bg-white/15 text-white/80 text-[11px] font-bold">{letter}</span>
  }
  if (c.kind === 'dm') {
    const conv = conversations.find(cv => cv.id === c.id)
    const letter = (conv ? convFirstNames(conv, currentUserId) : '?').trim().charAt(0).toUpperCase() || '?'
    return <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-700 text-white text-[11px] font-bold">{letter}</span>
  }
  return <span className="text-white/80"><CatalogIcon id={c.id} /></span>
}

function tokenLabel(token: string, rooms: Room[], conversations: Conversation[], currentUserId?: string): string {
  const c = classifyToken(token)
  if (c.kind === 'master-dnd') return 'Master DND'
  if (c.kind === 'hub-dnd') return 'Hub Notifications DND'
  if (c.kind === 'dialer-dnd') return 'Calls DND'
  if (c.kind === 'url') {
    try { return new URL(c.href).hostname.replace(/^www\./, '') } catch { return c.href }
  }
  if (c.kind === 'room') return rooms.find(r => r.id === c.id)?.name ?? 'Room'
  if (c.kind === 'dm') {
    const conv = conversations.find(cv => cv.id === c.id)
    return conv ? convFirstNames(conv, currentUserId) : 'Direct message'
  }
  const id = c.id
  if (SYSTEM_LABELS[id]) return SYSTEM_LABELS[id]
  return CATALOG.find(e => e.id === id)?.label ?? id
}

export default function LayoutEditor({
  layout,
  permissions,
  rooms,
  conversations,
  currentUserId,
  onChange,
  onClose,
}: {
  layout: HubLayout
  permissions: RailPermissions
  rooms: Room[]
  conversations: Conversation[]
  currentUserId?: string
  onChange: (next: HubLayout) => void
  onClose: () => void
}) {
  const [addTab, setAddTab] = useState<'apps' | 'rooms' | 'dms' | 'actions' | 'url'>('apps')
  const [urlValue, setUrlValue] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const list = layout.items
  const inList = useMemo(() => new Set(list), [list])
  // The leading locked items (Hub/Txt/Dialer/Time Clock) can't be removed or
  // reordered — they're pinned for everyone.
  const lockCount = lockedCount(list)

  function setList(next: string[]) { onChange({ version: 3, items: next }) }
  function addToken(token: string) { if (!inList.has(token)) setList([...list, token]) }
  function removeAt(i: number) { if (i < lockCount) return; setList(list.filter((_, idx) => idx !== i)) }
  function move(i: number, dir: -1 | 1) {
    if (i < lockCount) return
    const j = i + dir
    if (j < lockCount || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setList(next)
  }
  function reorder(from: number, to: number) {
    if (from < lockCount || from === to) return
    const dest = Math.max(to, lockCount)
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(dest, 0, moved)
    setList(next)
  }

  const addableApps: { token: string; label: string }[] = useMemo(() => {
    const sys = ['hub', 'time-clock']
    const cat = CATALOG.filter(e => e.pickable && e.id !== ('activity' as CatalogId)).map(e => e.id as string)
    return [...sys, ...cat]
      .filter(t => tokenAllowed(t, permissions))
      .filter(t => !inList.has(t))
      .map(t => ({ token: t, label: tokenLabel(t, rooms, conversations, currentUserId) }))
  }, [permissions, inList, rooms, conversations, currentUserId])

  const addableRooms = useMemo(() => rooms.filter(r => !inList.has(`room:${r.id}`)), [rooms, inList])
  const addableDms = useMemo(() => conversations.filter(c => !inList.has(`dm:${c.id}`)), [conversations, inList])

  function addUrl() {
    let href = urlValue.trim()
    if (!href) return
    if (!/^https?:\/\//i.test(href)) href = 'https://' + href
    try { new URL(href) } catch { return }
    addToken('url:' + href)
    setUrlValue('')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[88vh] flex flex-col bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <div>
            <h2 className="font-semibold text-white">Customize your menu</h2>
            <p className="text-xs text-gray-400 mt-0.5">One list powers your rail, mobile bar, and the Apps drawer. The first few (🔒) are pinned for everyone; reorder, hide, or add anything below them. Saves instantly.</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white p-1" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {list.length > MOBILE_VISIBLE && (
            <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-2">
              The top of this list fills your rail/bar; the rest live under the <strong>Apps</strong> button. Phones show the first {MOBILE_VISIBLE}; desktop shows as many as fit the screen.
            </p>
          )}

          {list.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">Nothing here yet — add items below.</p>
          ) : (
            <ul className="space-y-1.5 mb-4">
              {list.map((token, i) => {
                const locked = i < lockCount
                return (
                <li
                  key={`${token}-${i}`}
                  draggable={!locked}
                  onDragStart={() => { if (!locked) setDragIndex(i) }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null) }}
                  onDragEnd={() => setDragIndex(null)}
                  className={`flex items-center gap-2 border rounded-xl px-2.5 py-2 ${locked ? 'bg-sky-500/[0.06] border-sky-400/20' : 'bg-gray-800/70 border-gray-700'} ${dragIndex === i ? 'opacity-50' : ''} ${i < MOBILE_VISIBLE ? '' : 'opacity-90'}`}
                >
                  {locked ? (
                    <span className="text-sky-300/70" title="Pinned for everyone — can't be removed or moved"><LockIcon className="w-4 h-4" /></span>
                  ) : (
                    <span className="text-gray-500 cursor-grab select-none" title="Drag to reorder" aria-hidden="true">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zM7 16a1 1 0 11-2 0 1 1 0 012 0zM15 4a1 1 0 11-2 0 1 1 0 012 0zM15 10a1 1 0 11-2 0 1 1 0 012 0zM15 16a1 1 0 11-2 0 1 1 0 012 0z" /></svg>
                    </span>
                  )}
                  <TokenIcon token={token} rooms={rooms} conversations={conversations} currentUserId={currentUserId} />
                  <span className="flex-1 text-sm text-white truncate">{tokenLabel(token, rooms, conversations, currentUserId)}</span>
                  {locked ? (
                    <span className="text-[10px] font-semibold text-sky-300/60 uppercase tracking-wide pr-1.5">Pinned</span>
                  ) : (
                    <>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === lockCount} className="text-white/40 hover:text-white disabled:opacity-20 p-1" aria-label="Move up">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-white/40 hover:text-white disabled:opacity-20 p-1" aria-label="Move down">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      <button type="button" onClick={() => removeAt(i)} className="text-white/40 hover:text-rose-400 p-1" aria-label="Remove">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </>
                  )}
                </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-gray-800 pt-3">
            <div className="flex gap-1 mb-3 text-xs flex-wrap">
              {([['apps', 'Apps'], ['rooms', 'Rooms'], ['dms', 'DMs'], ['actions', 'Actions'], ['url', 'Custom link']] as const).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAddTab(k)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${addTab === k ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {addTab === 'apps' && (
              addableApps.length === 0 ? (
                <p className="text-xs text-gray-500 py-2">Everything is already on your menu.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {addableApps.map(({ token, label }) => (
                    <button key={token} type="button" onClick={() => addToken(token)} className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/60 rounded-lg px-2.5 py-2 text-left">
                      <TokenIcon token={token} rooms={rooms} conversations={conversations} currentUserId={currentUserId} />
                      <span className="text-sm text-white truncate flex-1">{label}</span>
                      <span className="text-orange-400 text-lg leading-none">+</span>
                    </button>
                  ))}
                </div>
              )
            )}

            {addTab === 'rooms' && (
              addableRooms.length === 0 ? (
                <p className="text-xs text-gray-500 py-2">No rooms to add.</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {addableRooms.map(room => (
                    <button key={room.id} type="button" onClick={() => addToken(`room:${room.id}`)} className="w-full flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/60 rounded-lg px-2.5 py-2 text-left">
                      <span className="text-white/50">{room.is_private ? <LockIcon className="w-3.5 h-3.5" /> : '#'}</span>
                      <span className="text-sm text-white truncate flex-1">{room.name}</span>
                      <span className="text-orange-400 text-lg leading-none">+</span>
                    </button>
                  ))}
                </div>
              )
            )}

            {addTab === 'dms' && (
              addableDms.length === 0 ? (
                <p className="text-xs text-gray-500 py-2">No direct messages to add.</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {addableDms.map(conv => (
                    <button key={conv.id} type="button" onClick={() => addToken(`dm:${conv.id}`)} className="w-full flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/60 rounded-lg px-2.5 py-2 text-left">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-700 text-white text-[11px] font-bold">{convFirstNames(conv, currentUserId).trim().charAt(0).toUpperCase() || '?'}</span>
                      <span className="text-sm text-white truncate flex-1">{convFirstNames(conv, currentUserId)}</span>
                      <span className="text-orange-400 text-lg leading-none">+</span>
                    </button>
                  ))}
                </div>
              )
            )}

            {addTab === 'actions' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => addToken('sys:dnd')}
                  disabled={inList.has('sys:dnd')}
                  className="w-full flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 disabled:opacity-40 border border-gray-700/60 rounded-lg px-2.5 py-2 text-left"
                >
                  <span className="text-red-400"><DndIcon /></span>
                  <div className="flex-1">
                    <div className="text-sm text-white">Master DND toggle</div>
                    <div className="text-[11px] text-gray-500">Silences all — calls, messages, push</div>
                  </div>
                  <span className="text-orange-400 text-lg leading-none">{inList.has('sys:dnd') ? '✓' : '+'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => addToken('sys:hub-dnd')}
                  disabled={inList.has('sys:hub-dnd')}
                  className="w-full flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 disabled:opacity-40 border border-gray-700/60 rounded-lg px-2.5 py-2 text-left"
                >
                  <span className="text-orange-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-sm text-white">Hub notifications DND</div>
                    <div className="text-[11px] text-gray-500">Pauses Hub message push notifications</div>
                  </div>
                  <span className="text-orange-400 text-lg leading-none">{inList.has('sys:hub-dnd') ? '✓' : '+'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => addToken('sys:dialer-dnd')}
                  disabled={inList.has('sys:dialer-dnd')}
                  className="w-full flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 disabled:opacity-40 border border-gray-700/60 rounded-lg px-2.5 py-2 text-left"
                >
                  <span className="text-orange-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-sm text-white">Calls DND toggle</div>
                    <div className="text-[11px] text-gray-500">Silences inbound calls to your extension</div>
                  </div>
                  <span className="text-orange-400 text-lg leading-none">{inList.has('sys:dialer-dnd') ? '✓' : '+'}</span>
                </button>
              </div>
            )}

            {addTab === 'url' && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={urlValue}
                  onChange={e => setUrlValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addUrl() }}
                  placeholder="example.com or https://…"
                  className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                />
                <button type="button" onClick={addUrl} className="bg-orange-500 hover:bg-orange-400 text-white font-semibold px-4 rounded-lg text-sm">Add</button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-none px-5 py-3 border-t border-gray-800 flex justify-end">
          <button type="button" onClick={onClose} className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg text-sm">Done</button>
        </div>
      </div>
    </div>
  )
}
