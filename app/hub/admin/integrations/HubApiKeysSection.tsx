'use client'

import { useState, useEffect } from 'react'
import { useConfirm } from '@/components/ui'

// Inbound automation keys (hub_api_keys). These are the OPPOSITE direction from
// the provider cards above: instead of Lynxedo reaching OUT to another tool, an
// inbound key lets an outside service (Zapier, the Unitel call script, a social
// auto-poster) push messages INTO the Hub via POST /api/hub/ingest. Kept as its
// own clearly-separated block so it never reads as one of the connect cards.
type ApiKey = {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  created_by_user: { display_name: string } | null
}

export default function HubApiKeysSection() {
  const confirmDialog = useConfirm()

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [revealedKey, setRevealedKey] = useState<{ name: string; plain_key: string } | null>(null)

  useEffect(() => {
    loadApiKeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800">
        <h2 className="font-semibold text-lg">Inbound automation keys</h2>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          The reverse of the connections above: instead of Lynxedo reaching out to another
          tool, an <strong className="text-gray-300">inbound</strong> key lets an outside service
          (Zapier, a script, a social auto-poster) securely push messages{' '}
          <strong className="text-gray-300">into</strong> your Hub. Create one key per service and keep it secret.
        </p>
      </div>

      <div className="p-6 space-y-6">
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
                className="w-full py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-sm text-white font-medium transition-colors"
              >
                I&apos;ve saved it — close
              </button>
            </div>
          </div>
        )}

        {/* Create key */}
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-1">Create a key</h3>
          <p className="text-sm text-gray-500 mb-4">
            Give the key a name so you know which service it belongs to. You&apos;ll see the full key once — copy it right away.
          </p>
          <div className="flex gap-3">
            <input
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createApiKey()}
              placeholder="Key name (e.g. Zapier, Unitel Script)"
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-brand"
            />
            <button
              onClick={createApiKey}
              disabled={!newKeyName.trim() || creatingKey}
              className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-40 text-sm text-white font-medium transition-colors flex-none"
            >
              {creatingKey ? 'Creating…' : 'Create'}
            </button>
          </div>
          {keyError && <p className="text-sm text-red-400 mt-2">{keyError}</p>}
        </div>

        {/* Keys list */}
        <div>
          <h3 className="font-semibold text-white mb-3">Keys ({apiKeys.length})</h3>
          {!apiKeysLoaded ? (
            <p className="text-sm text-gray-500 px-1">Loading…</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-sm text-gray-500 px-1">No API keys yet.</p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map(k => (
                <div
                  key={k.id}
                  className={`bg-gray-950/40 border rounded-xl px-4 py-3 flex items-center gap-4 ${
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
                      onClick={async () => {
                        if (await confirmDialog({ message: `Revoke the "${k.name}" API key? This cannot be undone.`, danger: true })) revokeApiKey(k.id)
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
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-3">How to use</h3>
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
    </section>
  )
}
