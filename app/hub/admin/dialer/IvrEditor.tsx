'use client'

import { useMemo, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Local mirror of the lib/twilio-voice.ts IVR types — kept here so this is a
// pure client component without server-only imports. If the server-side types
// drift, this file needs the same update.
// ---------------------------------------------------------------------------

type IvrPrompt =
  | { kind: 'tts'; text: string }
  | { kind: 'audio'; audio_url: string }

export type IvrAction =
  | { kind: 'submenu'; target_node_id: string }
  | { kind: 'voicemail' }
  | { kind: 'transfer_user'; user_id: string; identity: string; timeout_sec?: number }
  | { kind: 'transfer_pstn'; number: string; timeout_sec?: number }
  | { kind: 'hangup' }
  | { kind: 'say'; prompt: IvrPrompt }
  | { kind: 'repeat'; max_repeats?: number; then?: IvrAction }
  | { kind: 'extension'; extension: string }
  | { kind: 'ring_group'; ring_group_id: string }

type DigitKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#'

export type IvrNode = {
  id: string
  label?: string
  prompt: IvrPrompt
  keypresses: Partial<Record<DigitKey, IvrAction>>
  no_input?: IvrAction
  invalid_input?: IvrAction
  gather_timeout_sec?: number
}

export type IvrTree = {
  root_node_id: string
  nodes: Record<string, IvrNode>
}

export type IvrConfig = {
  trees: {
    default?: IvrTree
    after_hours?: IvrTree
    holiday?: IvrTree
  }
}

type HubUser = { id: string; display_name: string }

// Session 60: passed in from DialerAdminPanel so IvrEditor can show pickers
// for the new extension + ring_group action kinds.
export type ExtensionAssignment = { extension: string; user_id: string; display_name: string }
export type RingGroupSummary = { id: string; name: string }

const DIGITS: DigitKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#']

// Generate a short unique node id within an existing tree. `n1`, `n2`, ...
function nextNodeId(nodes: Record<string, IvrNode>): string {
  let i = 1
  while (nodes[`n${i}`]) i++
  return `n${i}`
}

function blankNode(id: string, label = 'New menu'): IvrNode {
  return {
    id,
    label,
    prompt: { kind: 'tts', text: '' },
    keypresses: {},
    no_input: { kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } },
    invalid_input: { kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } },
    gather_timeout_sec: 6,
  }
}

function blankConfig(): IvrConfig {
  const rootId = 'n1'
  return {
    trees: {
      default: {
        root_node_id: rootId,
        nodes: { [rootId]: blankNode(rootId, 'Main menu') },
      },
    },
  }
}

export default function IvrEditor({
  enabled,
  config,
  onChange,
  hubUsers,
  extensions = [],
  ringGroups = [],
}: {
  enabled: boolean
  config: IvrConfig
  onChange: (next: { enabled: boolean; config: IvrConfig }) => void
  hubUsers: HubUser[]
  extensions?: ExtensionAssignment[]
  ringGroups?: RingGroupSummary[]
}) {
  const tree: IvrTree = config.trees?.default ?? { root_node_id: '', nodes: {} }
  const nodes = tree.nodes ?? {}
  const nodeList = useMemo(() => Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [nodes])

  const [selectedId, setSelectedId] = useState<string>(tree.root_node_id || nodeList[0]?.id || '')
  const selected: IvrNode | undefined = selectedId ? nodes[selectedId] : undefined

  function patchTree(next: IvrTree) {
    onChange({
      enabled,
      config: { ...config, trees: { ...config.trees, default: next } },
    })
  }

  function patchNode(id: string, next: IvrNode) {
    patchTree({
      ...tree,
      nodes: { ...tree.nodes, [id]: next },
    })
  }

  function initializeIfEmpty() {
    if (!tree.root_node_id || Object.keys(nodes).length === 0) {
      const fresh = blankConfig()
      onChange({ enabled, config: fresh })
      setSelectedId(fresh.trees.default!.root_node_id)
    }
  }

  function addNode() {
    const id = nextNodeId(nodes)
    patchTree({
      ...tree,
      nodes: { ...tree.nodes, [id]: blankNode(id, `Menu ${id}`) },
    })
    setSelectedId(id)
  }

  function deleteNode(id: string) {
    if (id === tree.root_node_id) {
      alert('Cannot delete the root node. Promote a different node to root first.')
      return
    }
    if (!confirm(`Delete menu "${nodes[id]?.label || id}"? Any keypresses pointing here will break.`)) return
    const newNodes = { ...nodes }
    delete newNodes[id]
    // Also scrub any keypresses across other nodes that referenced this id.
    for (const nid of Object.keys(newNodes)) {
      const n = newNodes[nid]
      const newKp: IvrNode['keypresses'] = {}
      for (const [k, action] of Object.entries(n.keypresses)) {
        if (action.kind === 'submenu' && action.target_node_id === id) continue
        newKp[k as DigitKey] = action
      }
      newNodes[nid] = { ...n, keypresses: newKp }
    }
    patchTree({ ...tree, nodes: newNodes })
    setSelectedId(tree.root_node_id)
  }

  function promoteToRoot(id: string) {
    patchTree({ ...tree, root_node_id: id })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              const nowEnabled = e.target.checked
              if (nowEnabled && Object.keys(nodes).length === 0) {
                // First-time enable on an empty config — seed a blank menu.
                const fresh = blankConfig()
                onChange({ enabled: true, config: fresh })
                setSelectedId(fresh.trees.default!.root_node_id)
              } else {
                onChange({ enabled: nowEnabled, config })
              }
            }}
            className="accent-[#2E7EB8] w-4 h-4"
          />
          <span className="text-sm font-medium">Auto-attendant enabled</span>
        </label>
        <span className="text-xs text-white/40">
          {enabled
            ? 'Inbound calls hear your menu first.'
            : 'Inbound calls go straight to the "ring this person → voicemail" flow above.'}
        </span>
      </div>

      {Object.keys(nodes).length === 0 ? (
        <div className="rounded-md border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-white/60 mb-3">
            No menus yet. Enable the toggle above to start, or click below to create
            an empty menu without enabling it (handy for drafting).
          </p>
          <button
            type="button"
            onClick={initializeIfEmpty}
            className="text-sm px-3 py-1.5 rounded border border-white/15 hover:bg-white/10"
          >
            Create empty menu
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-[260px_1fr] gap-4">
          {/* Left column: node list */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs uppercase tracking-wide text-white/40">Menus</h3>
              <button
                type="button"
                onClick={addNode}
                className="text-xs px-2 py-0.5 rounded border border-white/15 hover:bg-white/10"
              >
                + Add
              </button>
            </div>
            <ul className="space-y-1">
              {nodeList.map((n) => {
                const isRoot = n.id === tree.root_node_id
                const isSel = n.id === selectedId
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
                        isSel
                          ? 'bg-[#2E7EB8]/30 border border-[#2E7EB8]/50'
                          : 'hover:bg-white/10 border border-transparent'
                      }`}
                    >
                      <span className="text-xs text-white/40 font-mono">{n.id}</span>
                      <span className="flex-1 truncate">{n.label || '(unlabeled)'}</span>
                      {isRoot && <span className="text-[10px] text-emerald-300">root</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="text-[11px] text-white/30 pt-2">
              The root menu is what callers hear first.
            </p>
          </div>

          {/* Right column: node editor */}
          <div className="space-y-4">
            {selected ? (
              <NodeEditor
                node={selected}
                isRoot={selected.id === tree.root_node_id}
                allNodes={nodeList}
                hubUsers={hubUsers}
                extensions={extensions}
                ringGroups={ringGroups}
                onChange={(next) => patchNode(selected.id, next)}
                onDelete={() => deleteNode(selected.id)}
                onPromoteToRoot={() => promoteToRoot(selected.id)}
              />
            ) : (
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-white/60">Pick a menu on the left.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NodeEditor — prompt + per-keypress action editor for one node.
// ---------------------------------------------------------------------------

function NodeEditor({
  node,
  isRoot,
  allNodes,
  hubUsers,
  extensions,
  ringGroups,
  onChange,
  onDelete,
  onPromoteToRoot,
}: {
  node: IvrNode
  isRoot: boolean
  allNodes: IvrNode[]
  hubUsers: HubUser[]
  extensions: ExtensionAssignment[]
  ringGroups: RingGroupSummary[]
  onChange: (next: IvrNode) => void
  onDelete: () => void
  onPromoteToRoot: () => void
}) {
  function setKeypress(digit: DigitKey, action: IvrAction | undefined) {
    const next: IvrNode['keypresses'] = { ...node.keypresses }
    if (action === undefined) delete next[digit]
    else next[digit] = action
    onChange({ ...node, keypresses: next })
  }

  const mappedDigits = Object.keys(node.keypresses).sort()

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 font-mono">{node.id}</span>
            <input
              type="text"
              value={node.label || ''}
              onChange={(e) => onChange({ ...node, label: e.target.value })}
              placeholder="Menu label"
              className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-56"
            />
          </div>
          <div className="flex items-center gap-2">
            {!isRoot && (
              <button
                type="button"
                onClick={onPromoteToRoot}
                className="text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/10"
              >
                Set as root
              </button>
            )}
            {!isRoot && (
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

        <PromptEditor
          prompt={node.prompt}
          nodeId={node.id}
          onChange={(p) => onChange({ ...node, prompt: p })}
        />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
        <header>
          <h3 className="font-semibold text-sm">Keypress actions</h3>
          <p className="text-xs text-white/40 mt-0.5">
            What happens when the caller presses a digit at this menu.
          </p>
        </header>

        <div className="space-y-2">
          {mappedDigits.map((d) => (
            <KeypressRow
              key={d}
              digit={d as DigitKey}
              action={node.keypresses[d as DigitKey]!}
              allNodes={allNodes}
              currentNodeId={node.id}
              hubUsers={hubUsers}
              extensions={extensions}
              ringGroups={ringGroups}
              onChange={(a) => setKeypress(d as DigitKey, a)}
              onRemove={() => setKeypress(d as DigitKey, undefined)}
            />
          ))}
          <AddKeypressButton
            takenDigits={mappedDigits as DigitKey[]}
            onAdd={(d) => setKeypress(d, { kind: 'voicemail' })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
        <header>
          <h3 className="font-semibold text-sm">Fallbacks</h3>
          <p className="text-xs text-white/40 mt-0.5">
            What happens if the caller doesn't press anything, or presses something
            you haven't mapped.
          </p>
        </header>

        <FallbackEditor
          label="If no input"
          action={node.no_input ?? { kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } }}
          allNodes={allNodes}
          currentNodeId={node.id}
          hubUsers={hubUsers}
          extensions={extensions}
          ringGroups={ringGroups}
          onChange={(a) => onChange({ ...node, no_input: a })}
        />
        <FallbackEditor
          label="If invalid input"
          action={node.invalid_input ?? { kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } }}
          allNodes={allNodes}
          currentNodeId={node.id}
          hubUsers={hubUsers}
          extensions={extensions}
          ringGroups={ringGroups}
          onChange={(a) => onChange({ ...node, invalid_input: a })}
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// PromptEditor — TTS textarea or audio uploader.
// ---------------------------------------------------------------------------

function PromptEditor({
  prompt,
  nodeId,
  onChange,
}: {
  prompt: IvrPrompt
  nodeId: string
  onChange: (p: IvrPrompt) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function uploadAudio(file: File) {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('node_id', nodeId)
      const res = await fetch('/api/admin/dialer/ivr-prompt', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json()
      onChange({ kind: 'audio', audio_url: data.url })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/50">Prompt:</span>
        <div className="inline-flex rounded border border-white/15 overflow-hidden">
          <button
            type="button"
            onClick={() =>
              onChange(
                prompt.kind === 'tts'
                  ? prompt
                  : { kind: 'tts', text: '' }
              )
            }
            className={`px-2 py-0.5 ${
              prompt.kind === 'tts' ? 'bg-[#2E7EB8] text-white' : 'text-white/60 hover:bg-white/10'
            }`}
          >
            Type text
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(
                prompt.kind === 'audio'
                  ? prompt
                  : { kind: 'audio', audio_url: '' }
              )
            }
            className={`px-2 py-0.5 ${
              prompt.kind === 'audio' ? 'bg-[#2E7EB8] text-white' : 'text-white/60 hover:bg-white/10'
            }`}
          >
            Upload audio
          </button>
        </div>
      </div>

      {prompt.kind === 'tts' ? (
        <textarea
          value={prompt.text}
          onChange={(e) => onChange({ kind: 'tts', text: e.target.value })}
          placeholder='e.g. "Thank you for calling Heroes Lawn Care. Press 1 for scheduling, press 2 for billing."'
          rows={3}
          className="w-full bg-gray-900 border border-white/15 rounded px-2 py-1.5 text-sm"
        />
      ) : (
        <div className="space-y-2">
          {prompt.audio_url ? (
            <div className="flex items-center gap-3 flex-wrap">
              <audio src={prompt.audio_url} controls preload="metadata" className="h-8 max-w-xs" />
              <button
                type="button"
                onClick={() => onChange({ kind: 'audio', audio_url: '' })}
                className="text-xs px-2 py-1 rounded border border-red-700/40 text-red-300 hover:bg-red-900/30"
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="text-xs text-white/50">No audio uploaded.</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadAudio(f)
            }}
            disabled={uploading}
            className="text-xs text-white/70 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-[#2E7EB8] file:text-white file:text-sm hover:file:bg-[#3a8dc9] file:cursor-pointer"
          />
          {uploading && <span className="ml-2 text-xs text-white/50">Uploading…</span>}
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KeypressRow + AddKeypressButton + FallbackEditor — action selectors.
// ---------------------------------------------------------------------------

const ACTION_KINDS: { value: IvrAction['kind']; label: string; disabled?: boolean }[] = [
  { value: 'submenu', label: 'Go to another menu' },
  { value: 'voicemail', label: 'Send to voicemail' },
  { value: 'transfer_user', label: 'Ring a person' },
  { value: 'extension', label: 'Ring an extension' },
  { value: 'ring_group', label: 'Ring a group' },
  { value: 'transfer_pstn', label: 'Forward to a phone number' },
  { value: 'say', label: 'Say a message, then hang up' },
  { value: 'hangup', label: 'Hang up' },
]

function KeypressRow({
  digit,
  action,
  allNodes,
  currentNodeId,
  hubUsers,
  extensions,
  ringGroups,
  onChange,
  onRemove,
}: {
  digit: DigitKey
  action: IvrAction
  allNodes: IvrNode[]
  currentNodeId: string
  hubUsers: HubUser[]
  extensions: ExtensionAssignment[]
  ringGroups: RingGroupSummary[]
  onChange: (a: IvrAction) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-start gap-2 p-2 rounded border border-white/10 bg-white/5">
      <div className="w-8 h-8 rounded bg-[#2E7EB8]/30 text-white text-base font-semibold flex items-center justify-center shrink-0">
        {digit}
      </div>
      <div className="flex-1 min-w-0">
        <ActionEditor
          action={action}
          allNodes={allNodes}
          currentNodeId={currentNodeId}
          hubUsers={hubUsers}
          extensions={extensions}
          ringGroups={ringGroups}
          onChange={onChange}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-xs text-white/40 hover:text-red-300"
        title="Remove this keypress"
      >
        ✕
      </button>
    </div>
  )
}

function AddKeypressButton({
  takenDigits,
  onAdd,
}: {
  takenDigits: DigitKey[]
  onAdd: (d: DigitKey) => void
}) {
  const [open, setOpen] = useState(false)
  const taken = new Set(takenDigits)
  const available = DIGITS.filter((d) => !taken.has(d))
  if (available.length === 0) return null
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm px-3 py-1.5 rounded border border-dashed border-white/20 text-white/70 hover:bg-white/5 hover:text-white"
      >
        + Add keypress
      </button>
      {open && (
        <div className="absolute z-10 mt-1 bg-gray-900 border border-white/15 rounded p-2 grid grid-cols-6 gap-1">
          {available.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                onAdd(d)
                setOpen(false)
              }}
              className="w-8 h-8 rounded bg-white/5 hover:bg-[#2E7EB8] text-sm font-semibold"
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FallbackEditor({
  label,
  action,
  allNodes,
  currentNodeId,
  hubUsers,
  extensions,
  ringGroups,
  onChange,
}: {
  label: string
  action: IvrAction
  allNodes: IvrNode[]
  currentNodeId: string
  hubUsers: HubUser[]
  extensions: ExtensionAssignment[]
  ringGroups: RingGroupSummary[]
  onChange: (a: IvrAction) => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-white/50">{label}</div>
      <ActionEditor
        action={action}
        allNodes={allNodes}
        currentNodeId={currentNodeId}
        hubUsers={hubUsers}
        extensions={extensions}
        ringGroups={ringGroups}
        onChange={onChange}
        allowRepeat
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionEditor — kind picker + kind-specific target fields.
// ---------------------------------------------------------------------------

function ActionEditor({
  action,
  allNodes,
  currentNodeId,
  hubUsers,
  extensions,
  ringGroups,
  onChange,
  allowRepeat = false,
}: {
  action: IvrAction
  allNodes: IvrNode[]
  currentNodeId: string
  hubUsers: HubUser[]
  extensions: ExtensionAssignment[]
  ringGroups: RingGroupSummary[]
  onChange: (a: IvrAction) => void
  allowRepeat?: boolean
}) {
  const otherNodes = allNodes.filter((n) => n.id !== currentNodeId)

  function changeKind(kind: IvrAction['kind']) {
    switch (kind) {
      case 'submenu':
        onChange({ kind: 'submenu', target_node_id: otherNodes[0]?.id ?? '' })
        break
      case 'voicemail':
        onChange({ kind: 'voicemail' })
        break
      case 'transfer_user':
        onChange({
          kind: 'transfer_user',
          user_id: hubUsers[0]?.id ?? '',
          identity: hubUsers[0]?.id ?? '',
        })
        break
      case 'transfer_pstn':
        onChange({ kind: 'transfer_pstn', number: '' })
        break
      case 'say':
        onChange({ kind: 'say', prompt: { kind: 'tts', text: '' } })
        break
      case 'hangup':
        onChange({ kind: 'hangup' })
        break
      case 'repeat':
        onChange({ kind: 'repeat', max_repeats: 2, then: { kind: 'voicemail' } })
        break
      case 'extension':
        onChange({ kind: 'extension', extension: extensions[0]?.extension ?? '' })
        break
      case 'ring_group':
        onChange({ kind: 'ring_group', ring_group_id: ringGroups[0]?.id ?? '' })
        break
    }
  }

  return (
    <div className="space-y-2">
      <select
        value={action.kind}
        onChange={(e) => changeKind(e.target.value as IvrAction['kind'])}
        className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
      >
        {allowRepeat && (
          <option value="repeat">Repeat menu (then voicemail)</option>
        )}
        {ACTION_KINDS.map((k) => (
          <option key={k.value} value={k.value} disabled={k.disabled}>
            {k.label}
          </option>
        ))}
      </select>

      {action.kind === 'submenu' && (
        <select
          value={action.target_node_id}
          onChange={(e) => onChange({ kind: 'submenu', target_node_id: e.target.value })}
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
        >
          <option value="">— pick a menu —</option>
          {otherNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id} · {n.label || '(unlabeled)'}
            </option>
          ))}
        </select>
      )}

      {action.kind === 'transfer_user' && (
        <select
          value={action.user_id}
          onChange={(e) =>
            onChange({
              kind: 'transfer_user',
              user_id: e.target.value,
              identity: e.target.value,
            })
          }
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
        >
          <option value="">— pick a person —</option>
          {hubUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
      )}

      {action.kind === 'transfer_pstn' && (
        <input
          type="tel"
          value={action.number}
          onChange={(e) =>
            onChange({ kind: 'transfer_pstn', number: e.target.value })
          }
          placeholder="+12815551234"
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
        />
      )}

      {action.kind === 'extension' && (
        extensions.length === 0 ? (
          <p className="text-[11px] text-amber-300">
            No extensions assigned yet. Assign one in the Extensions section below.
          </p>
        ) : (
          <select
            value={action.extension}
            onChange={(e) =>
              onChange({ kind: 'extension', extension: e.target.value })
            }
            className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
          >
            <option value="">— pick an extension —</option>
            {extensions.map((x) => (
              <option key={x.extension} value={x.extension}>
                {x.extension} · {x.display_name}
              </option>
            ))}
          </select>
        )
      )}

      {action.kind === 'ring_group' && (
        ringGroups.length === 0 ? (
          <p className="text-[11px] text-amber-300">
            No ring groups yet. Create one in the Ring Groups section below.
          </p>
        ) : (
          <select
            value={action.ring_group_id}
            onChange={(e) =>
              onChange({ kind: 'ring_group', ring_group_id: e.target.value })
            }
            className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-full"
          >
            <option value="">— pick a group —</option>
            {ringGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )
      )}

      {action.kind === 'say' && (
        <textarea
          value={action.prompt.kind === 'tts' ? action.prompt.text : ''}
          onChange={(e) =>
            onChange({
              kind: 'say',
              prompt: { kind: 'tts', text: e.target.value },
            })
          }
          placeholder='e.g. "We are closed for the holiday. Please call back Monday."'
          rows={2}
          className="w-full bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm"
        />
      )}

      {action.kind === 'repeat' && (
        <p className="text-[11px] text-white/40">
          Re-plays the menu up to {action.max_repeats ?? 2} more times, then sends
          the caller to voicemail.
        </p>
      )}
    </div>
  )
}
