'use client'

import { useState } from 'react'

export default function TxtLandingPanel({ isAdmin }: { isAdmin: boolean }) {
  const [showInject, setShowInject] = useState(false)
  const [phone, setPhone] = useState('+12815550199')
  const [name, setName] = useState('Test Customer')
  const [body, setBody] = useState('Hey, what time are you coming tomorrow?')
  const [status, setStatus] = useState<string>('')

  async function injectInbound() {
    setStatus('Injecting…')
    const res = await fetch('/api/txt/dev/inject-inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name, body }),
    })
    const data = await res.json()
    if (!res.ok) {
      setStatus(`Error: ${data.error || 'failed'}`)
      return
    }
    setStatus(`Injected → /hub/txt/${data.conversation_id}`)
    setTimeout(() => {
      window.location.href = `/hub/txt/${data.conversation_id}`
    }, 600)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div className="text-5xl mb-3">💬</div>
      <h1 className="text-xl font-medium mb-2">Txt</h1>
      <p className="text-sm text-white/50 max-w-md mb-6">
        Pick a conversation from the sidebar, or start a new one with{' '}
        <span className="text-white/80">+ New conversation</span>.
      </p>
      <div className="text-xs text-white/40 max-w-md mb-8 px-4 py-3 rounded-md bg-amber-500/10 border border-amber-500/20">
        Staging only · Twilio not yet wired · Outbound sends will show as failed until A2P registration completes
      </div>

      {isAdmin && (
        <div className="w-full max-w-md">
          {!showInject ? (
            <button
              onClick={() => setShowInject(true)}
              className="px-3 py-1.5 text-xs rounded-md bg-white/5 hover:bg-white/10 text-white/70"
            >
              🧪 Dev: inject fake inbound
            </button>
          ) : (
            <div className="text-left space-y-2 px-4 py-3 rounded-md bg-white/5 border border-white/10">
              <div className="text-xs text-white/60 font-medium mb-1">
                Inject fake inbound SMS (dev only — exercises the assignment flow without Twilio)
              </div>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (E.164 +1...)"
                className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contact name"
                className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Message body"
                rows={2}
                className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={injectInbound}
                  className="flex-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm"
                >
                  Inject
                </button>
                <button
                  onClick={() => setShowInject(false)}
                  className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
                >
                  Close
                </button>
              </div>
              {status && (
                <div className="text-xs text-white/60">{status}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
