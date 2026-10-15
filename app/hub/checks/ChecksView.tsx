'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Checks — photograph a customer's paper check, front and back, and send it to
// the "checks and cash" room for Zac to deposit with his bank's mobile deposit.
//
// The photo has to be one a bank app accepts (Zac photographs the photo), so:
//   • it must be HORIZONTAL — a web page can't lock an iPhone's rotation, so a
//     tall photo is refused here, before it is ever uploaded;
//   • every side goes through the photo check (/api/hub/checks/photo), which
//     names what's wrong in plain words. "Use it anyway" always exists, so an
//     odd check never blocks a tech standing at the customer's door.

const FIELD =
  'w-full bg-gray-900 border border-white/10 rounded-lg px-3.5 py-2.5 text-base text-white placeholder:text-white/35 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/40 transition-colors'

/** Longest edge uploaded. A bank app needs the MICR line and amounts crisp;
 *  2400px keeps them sharp at ~500 KB instead of a 4 MB original. */
const MAX_EDGE = 2400

const PROBLEM_TEXT: Record<string, string> = {
  not_a_check: 'This doesn’t look like a check.',
  wrong_side: 'This looks like the other side of the check.',
  blurry: 'It’s blurry — hold still and let the camera focus.',
  glare: 'There’s glare on it — tilt away from the light or move out of direct sun.',
  angled: 'It’s at an angle — hold the phone flat, straight above the check.',
  cut_off: 'Part of the check is cut off — get all four corners in.',
  background: 'The background is too light — put the check on something dark.',
  too_far: 'It’s too far away — fill most of the picture with the check.',
  too_dark: 'It’s too dark to read — find more light.',
}

type Side = 'front' | 'back'
type Review = {
  ok: boolean
  problems: string[]
  read: { amount_cents?: number; check_number?: string; payer?: string; endorsed?: boolean }
}
type Shot = {
  previewUrl: string
  width: number
  height: number
  state: 'checking' | 'done' | 'error'
  path?: string
  size?: number
  review?: Review | null
  accepted?: boolean      // "Use it anyway"
  error?: string
}
type ContactHit = { id: string; name: string; address_line1?: string | null; city?: string | null }
type CheckRow = {
  id: string
  customer_name: string
  amount_cents: number
  check_number: string | null
  memo: string | null
  sent_anyway: boolean
  status: 'pending' | 'deposited' | 'void'
  created_at: string
  deposited_at: string | null
  submitted_by_name: string | null
  deposited_by_name: string | null
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "250", "250.5", "$1,250.00" → cents; anything else → null. */
function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, '')
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(cleaned)) return null
  const cents = Math.round(parseFloat(cleaned) * 100)
  return cents > 0 ? cents : null
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Decode through an <img> (which honours the photo's EXIF rotation — a phone
 * held sideways gives a wide image), refuse a tall one, downscale to JPEG.
 */
async function preparePhoto(file: File): Promise<{ blob: Blob; width: number; height: number } | 'portrait' | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w0 = img.naturalWidth, h0 = img.naturalHeight
    if (!w0 || !h0) return null
    if (h0 > w0) return 'portrait'
    const scale = Math.min(1, MAX_EDGE / w0)
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.9))
    return blob && blob.size > 0 ? { blob, width: w, height: h } : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

/** A sideways phone over a check on a dark surface — the whole instruction at a glance. */
function HowToShoot({ side }: { side: Side }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-none w-24 h-14 rounded-md bg-black border border-white/15 flex items-center justify-center">
        <div className="w-16 h-8 rounded-sm bg-[#e8e4d8] relative">
          {side === 'front' ? (
            <>
              <div className="absolute left-1.5 top-1.5 w-6 h-0.5 bg-black/40" />
              <div className="absolute right-1.5 top-3 w-3 h-1.5 border border-black/40" />
              <div className="absolute left-1.5 bottom-1 w-12 h-0.5 bg-black/30" />
            </>
          ) : (
            <div className="absolute left-1 top-1 bottom-1 w-4 border-r border-black/30" />
          )}
        </div>
      </div>
      <ul className="text-xs text-white/55 leading-relaxed">
        <li>• Phone <span className="text-white/80 font-medium">sideways</span></li>
        <li>• Check flat on something <span className="text-white/80 font-medium">dark</span></li>
        <li>• Straight above, no glare, all 4 corners</li>
      </ul>
    </div>
  )
}

export default function ChecksView() {
  const [tab, setTab] = useState<'send' | 'pending' | 'deposited'>('send')

  // ── Send form ──
  const [customer, setCustomer] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [hits, setHits] = useState<ContactHit[]>([])
  const [showHits, setShowHits] = useState(false)
  const [amount, setAmount] = useState('')
  const [checkNo, setCheckNo] = useState('')
  const [memo, setMemo] = useState('')
  const [shots, setShots] = useState<Record<Side, Shot | null>>({ front: null, back: null })
  const [portraitSide, setPortraitSide] = useState<Side | null>(null)
  const [autoFilled, setAutoFilled] = useState<{ amount?: boolean; checkNo?: boolean }>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ posted: boolean } | null>(null)

  const cameraRef = { front: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null) }
  const pickRef = { front: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null) }
  // Typed values, read inside the async photo callback without a stale closure.
  const typedRef = useRef({ amount, checkNo })
  typedRef.current = { amount, checkNo }

  // ── Lists ──
  const [rows, setRows] = useState<CheckRow[] | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Customer search — the Contacts directory, so the check links to the customer file.
  useEffect(() => {
    const q = customer.trim()
    if (contactId || q.length < 2) { setHits([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=8&include_do_not_text=1`, { signal: ctrl.signal })
        if (!r.ok) return
        const j = await r.json()
        setHits(((j.contacts ?? []) as ContactHit[]).filter(c => c.name?.trim()))
      } catch { /* aborted or offline — the name still works as typed */ }
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [customer, contactId])

  const loadList = useCallback(async (status: 'pending' | 'deposited') => {
    setListError(null)
    try {
      const r = await fetch(`/api/hub/checks?status=${status}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not load checks')
      setCanManage(!!j.canManage)
      if (status === 'pending') setPendingCount(j.checks.length)
      setRows(j.checks)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load checks')
    }
  }, [])

  // The waiting count shows on its tab from the start.
  useEffect(() => {
    fetch('/api/hub/checks?status=pending')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) { setPendingCount(j.checks.length); setCanManage(!!j.canManage) } })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'send') { setRows(null); loadList(tab) }
  }, [tab, loadList])

  async function onPhoto(side: Side, file: File | undefined) {
    if (!file) return
    setError(null)
    const prepared = await preparePhoto(file)
    if (prepared === 'portrait') { setPortraitSide(side); return }
    setPortraitSide(null)
    if (!prepared) { setError('Couldn’t open that photo — try taking it again.'); return }

    const previewUrl = URL.createObjectURL(prepared.blob)
    setShots(s => {
      if (s[side]?.previewUrl) URL.revokeObjectURL(s[side]!.previewUrl)
      return { ...s, [side]: { previewUrl, width: prepared.width, height: prepared.height, state: 'checking' } }
    })

    try {
      const fd = new FormData()
      fd.append('side', side)
      fd.append('photo', new File([prepared.blob], `check-${side}.jpg`, { type: 'image/jpeg' }))
      const r = await fetch('/api/hub/checks/photo', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not save that photo')
      const review = j.review as Review | null
      setShots(s => s[side]?.previewUrl === previewUrl
        ? { ...s, [side]: { ...s[side]!, state: 'done', path: j.path, size: j.size, review } }
        : s)
      // Fill blank fields from what the check says. Typed values are never overwritten.
      if (side === 'front' && review?.ok) {
        const filled: { amount?: boolean; checkNo?: boolean } = {}
        if (review.read.amount_cents && !typedRef.current.amount.trim()) {
          setAmount((review.read.amount_cents / 100).toFixed(2)); filled.amount = true
        }
        if (review.read.check_number && !typedRef.current.checkNo.trim()) {
          setCheckNo(review.read.check_number); filled.checkNo = true
        }
        setAutoFilled(filled)
      }
    } catch (e) {
      setShots(s => s[side]?.previewUrl === previewUrl
        ? { ...s, [side]: { ...s[side]!, state: 'error', error: e instanceof Error ? e.message : 'Upload failed' } }
        : s)
    }
  }

  function retake(side: Side) {
    setShots(s => {
      if (s[side]?.previewUrl) URL.revokeObjectURL(s[side]!.previewUrl)
      return { ...s, [side]: null }
    })
    cameraRef[side].current?.click()
  }

  const amountCents = parseAmount(amount)
  const front = shots.front, back = shots.back
  const sideReady = (s: Shot | null) =>
    !!s && s.state === 'done' && !!s.path && (s.review == null || s.review.ok || !!s.accepted)
  const flaggedAnyway = [front, back].some(s => s?.review && !s.review.ok && s.accepted)

  // What the check says vs what was typed — a typo catcher, never a blocker.
  const readAmount = front?.review?.read.amount_cents
  const readCheckNo = front?.review?.read.check_number
  const amountMismatch = readAmount && amountCents && readAmount !== amountCents ? readAmount : null
  const checkNoMismatch = readCheckNo && checkNo.trim() && readCheckNo !== checkNo.replace(/\D/g, '') ? readCheckNo : null

  const canSend = !!customer.trim() && !!amountCents && sideReady(front) && sideReady(back) && !sending

  async function send() {
    if (!canSend || !front || !back) return
    setSending(true); setError(null)
    try {
      const sidePayload = (s: Shot) => ({ path: s.path, size: s.size, width: s.width, height: s.height, review: s.review ?? null })
      const r = await fetch('/api/hub/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          customer_name: customer.trim(),
          amount_cents: amountCents,
          check_number: checkNo.trim() || null,
          memo: memo.trim() || null,
          front: sidePayload(front),
          back: sidePayload(back),
          sent_anyway: flaggedAnyway,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not send the check')
      setSent({ posted: !!j.posted })
      setPendingCount(c => (c ?? 0) + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the check')
    } finally {
      setSending(false)
    }
  }

  function resetForm() {
    for (const s of [shots.front, shots.back]) if (s?.previewUrl) URL.revokeObjectURL(s.previewUrl)
    setCustomer(''); setContactId(null); setAmount(''); setCheckNo(''); setMemo('')
    setShots({ front: null, back: null }); setAutoFilled({}); setPortraitSide(null)
    setError(null); setSent(null)
  }

  async function setStatus(id: string, status: 'deposited' | 'pending' | 'void') {
    if (status === 'void' && !confirm('Void this check? Use this only if it will never be deposited.')) return
    setBusyId(id)
    try {
      const r = await fetch(`/api/hub/checks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not update')
      setRows(rs => (rs ?? []).filter(x => x.id !== id))
      setPendingCount(c => c == null ? c : Math.max(0, c + (status === 'pending' ? 1 : -1)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusyId(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  // A render function, not a component: a component declared in here would be a
  // new type every render, remounting the file inputs — and a re-render while the
  // phone's camera is open would drop the photo.
  function photoStep(side: Side) {
    const shot = shots[side]
    const label = side === 'front' ? 'Front' : 'Back'
    return (
      <div key={side} className="rounded-xl border border-white/10 bg-gray-900/60 p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-sm font-semibold text-white/85">{label} of the check</span>
          {shot?.state === 'done' && (shot.review?.ok || shot.accepted || shot.review == null) && (
            <span className={`text-xs font-medium ${shot.review?.ok ? 'text-emerald-400' : 'text-amber-300'}`}>
              {shot.review?.ok ? '✓ Looks good' : shot.accepted ? 'Using anyway' : 'Not checked'}
            </span>
          )}
        </div>

        {!shot && (
          <>
            {portraitSide === side && (
              <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100">
                ↻ That photo was taken upright. <b>Turn your phone sideways</b> and take it again — a bank needs it horizontal.
              </div>
            )}
            <HowToShoot side={side} />
            <button
              type="button"
              onClick={() => cameraRef[side].current?.click()}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] font-semibold transition-colors"
            >
              📷 Take photo of the {side}
            </button>
            <button
              type="button"
              onClick={() => pickRef[side].current?.click()}
              className="mt-1.5 w-full text-xs text-white/45 hover:text-white/70 py-1.5"
            >
              or choose a photo you already have
            </button>
          </>
        )}

        {shot && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.previewUrl}
              alt={`${label} of the check`}
              className="w-full rounded-lg border border-white/10 bg-black object-contain"
              style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
            />

            {shot.state === 'checking' && (
              <div className="mt-2.5 flex items-center gap-2 text-sm text-white/60">
                <Spinner /> Checking the photo…
              </div>
            )}

            {shot.state === 'error' && (
              <div className="mt-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                {shot.error} <button type="button" onClick={() => retake(side)} className="underline font-medium ml-1">Retake</button>
              </div>
            )}

            {shot.state === 'done' && shot.review == null && (
              <div className="mt-2.5 text-xs text-amber-200/80">
                Couldn’t check this photo automatically — look it over yourself before sending.
              </div>
            )}

            {shot.state === 'done' && shot.review && !shot.review.ok && !shot.accepted && (
              <div className="mt-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
                <div className="text-sm font-semibold text-red-200">A bank may reject this photo:</div>
                <ul className="mt-1 text-sm text-red-100/90 space-y-0.5">
                  {shot.review.problems.map(p => <li key={p}>• {PROBLEM_TEXT[p] ?? p}</li>)}
                </ul>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" onClick={() => retake(side)}
                    className="flex-1 px-3 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] text-sm font-semibold">
                    📷 Retake
                  </button>
                  <button type="button"
                    onClick={() => setShots(s => ({ ...s, [side]: { ...s[side]!, accepted: true } }))}
                    className="px-3 py-2.5 rounded-lg border border-white/15 text-white/70 hover:text-white text-sm">
                    Use it anyway
                  </button>
                </div>
              </div>
            )}

            {shot.state === 'done' && side === 'back' && shot.review?.read.endorsed === false && (
              <div className="mt-2.5 text-xs text-amber-200/80">
                The back looks blank — if the bank needs it endorsed, sign or stamp it and retake.
              </div>
            )}

            {shot.state === 'done' && (shot.review == null || shot.review.ok || shot.accepted) && (
              <button type="button" onClick={() => retake(side)} className="mt-2 text-xs text-white/45 hover:text-white/75">
                Retake
              </button>
            )}
          </div>
        )}

        {/* capture="environment" opens the rear camera directly on a phone (and is
            ignored on a desktop). The second input is the plain picker, for a
            scan or a photo already on the device. */}
        <input ref={cameraRef[side]} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { onPhoto(side, e.target.files?.[0]); e.target.value = '' }} />
        <input ref={pickRef[side]} type="file" accept="image/*" className="hidden"
          onChange={e => { onPhoto(side, e.target.files?.[0]); e.target.value = '' }} />
      </div>
    )
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'send', label: 'Send a check' },
    { id: 'pending', label: `Waiting to deposit${pendingCount ? ` (${pendingCount})` : ''}` },
    { id: 'deposited', label: 'Deposited' },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-950 text-white">
      <header className="px-4 md:px-6 pt-4 pb-0 border-b border-white/10 max-md:pl-14">
        <h1 className="text-xl font-bold">Checks</h1>
        <p className="text-sm text-white/50 mt-0.5">
          Photograph a customer’s check and it goes straight to the checks and cash room for deposit.
        </p>
        <nav className="flex gap-1 mt-3 -mb-px overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id ? 'border-brand text-white' : 'border-transparent text-white/50 hover:text-white/80'
              }`}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'send' && sent && (
        <main className="max-w-md mx-auto px-4 md:px-6 py-16 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-3xl">💵</div>
          <h2 className="text-xl font-bold mt-5">{sent.posted ? 'Check sent' : 'Check saved'}</h2>
          <p className="text-white/60 mt-2 text-sm leading-relaxed">
            {sent.posted
              ? 'It’s in the checks and cash room for deposit. Hand the paper check to the office as usual.'
              : 'It’s on the checks list, but there’s no “checks and cash” room to post it in — let the office know.'}
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <button type="button" onClick={resetForm}
              className="px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] font-medium">Send another</button>
            <button type="button" onClick={() => { resetForm(); setTab('pending') }}
              className="px-4 py-2.5 rounded-lg border border-white/15 text-white/80 hover:text-white font-medium">See the list</button>
          </div>
        </main>
      )}

      {tab === 'send' && !sent && (
        <main className="max-w-xl mx-auto px-4 md:px-6 py-6 space-y-5">
          {/* Customer */}
          <div className="relative">
            <label htmlFor="ck-customer" className="block text-sm font-medium text-white/80 mb-1.5">
              Customer <span className="text-red-400">*</span>
            </label>
            <input
              id="ck-customer"
              value={customer}
              onChange={e => { setCustomer(e.target.value); setContactId(null); setShowHits(true) }}
              onFocus={() => setShowHits(true)}
              onBlur={() => setTimeout(() => setShowHits(false), 150)}
              placeholder="Start typing a name"
              autoComplete="off"
              className={FIELD}
            />
            {contactId && <p className="text-xs text-emerald-400/90 mt-1">✓ Linked to their customer file</p>}
            {showHits && hits.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-white/10 bg-gray-900 shadow-xl overflow-hidden">
                {hits.map(h => (
                  <button key={h.id} type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setCustomer(h.name); setContactId(h.id); setHits([]); setShowHits(false) }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-white/5 border-b border-white/5 last:border-0">
                    <div className="text-sm text-white">{h.name}</div>
                    {(h.address_line1 || h.city) && (
                      <div className="text-xs text-white/40">{[h.address_line1, h.city].filter(Boolean).join(', ')}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount + check number */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ck-amount" className="block text-sm font-medium text-white/80 mb-1.5">
                Amount <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">$</span>
                <input id="ck-amount" value={amount} inputMode="decimal" placeholder="0.00"
                  onChange={e => { setAmount(e.target.value); setAutoFilled(a => ({ ...a, amount: false })) }}
                  className={`${FIELD} pl-7`} />
              </div>
              {autoFilled.amount && <p className="text-xs text-white/40 mt-1">Read from the check — double-check it.</p>}
              {amount.trim() && !amountCents && <p className="text-xs text-red-300 mt-1">Enter an amount like 250.00</p>}
            </div>
            <div>
              <label htmlFor="ck-number" className="block text-sm font-medium text-white/80 mb-1.5">Check #</label>
              <input id="ck-number" value={checkNo} inputMode="numeric" placeholder="1043"
                onChange={e => { setCheckNo(e.target.value); setAutoFilled(a => ({ ...a, checkNo: false })) }}
                className={FIELD} />
              {autoFilled.checkNo && <p className="text-xs text-white/40 mt-1">Read from the check.</p>}
            </div>
          </div>

          {(amountMismatch || checkNoMismatch) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-100 space-y-1.5">
              {amountMismatch && (
                <div>
                  The check looks like it says <b>{money(amountMismatch)}</b> — you typed {amountCents ? money(amountCents) : amount}.{' '}
                  <button type="button" className="underline font-medium" onClick={() => setAmount((amountMismatch / 100).toFixed(2))}>
                    Use {money(amountMismatch)}
                  </button>
                </div>
              )}
              {checkNoMismatch && (
                <div>
                  The check number looks like <b>#{checkNoMismatch}</b> — you typed #{checkNo}.{' '}
                  <button type="button" className="underline font-medium" onClick={() => setCheckNo(checkNoMismatch)}>
                    Use #{checkNoMismatch}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          {photoStep('front')}
          {photoStep('back')}

          <div>
            <label htmlFor="ck-memo" className="block text-sm font-medium text-white/80 mb-1.5">
              Note <span className="text-white/35 font-normal">(optional)</span>
            </label>
            <input id="ck-memo" value={memo} onChange={e => setMemo(e.target.value)}
              placeholder="e.g. pays two invoices, left on Kathryn's desk" className={FIELD} />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">{error}</div>
          )}

          <button type="button" onClick={send} disabled={!canSend}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-brand hover:bg-brand-hover text-[#fff] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {sending && <Spinner />}
            {sending ? 'Sending…' : `Send${amountCents ? ` ${money(amountCents)}` : ''} to checks and cash`}
          </button>
          {!canSend && !sending && (
            <p className="text-xs text-white/35 text-center -mt-2">
              {!customer.trim() ? 'Add the customer.' : !amountCents ? 'Add the amount.'
                : !front || !back ? 'Take both photos.' : 'Finish the photos above.'}
            </p>
          )}
        </main>
      )}

      {tab !== 'send' && (
        <main className="max-w-2xl mx-auto px-4 md:px-6 py-6">
          {!canManage && rows && (
            <p className="text-xs text-white/40 mb-3">These are the checks you’ve sent.</p>
          )}
          {listError && <div className="text-sm text-red-300">{listError}</div>}
          {!rows && !listError && <div className="flex items-center gap-2 text-sm text-white/50"><Spinner /> Loading…</div>}
          {rows && rows.length === 0 && (
            <div className="text-center text-white/45 py-16 text-sm">
              {tab === 'pending' ? 'Nothing waiting — every check has been deposited.' : 'No deposited checks yet.'}
            </div>
          )}
          {rows && rows.length > 0 && tab === 'pending' && (
            <div className="mb-3 text-sm text-white/60">
              {rows.length} check{rows.length === 1 ? '' : 's'} · <b className="text-white">{money(rows.reduce((t, r) => t + r.amount_cents, 0))}</b> waiting
            </div>
          )}
          <div className="space-y-2.5">
            {rows?.map(r => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-gray-900/60 p-3 flex gap-3">
                <a href={`/api/hub/checks/${r.id}/photo/front`} target="_blank" rel="noreferrer" className="flex-none">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/hub/checks/${r.id}/photo/front`} alt="Front of the check"
                    className="w-28 h-14 object-cover rounded-md border border-white/10 bg-black" loading="lazy" />
                </a>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold text-white truncate">{r.customer_name}</div>
                    <div className="font-bold text-white tabular-nums">{money(r.amount_cents)}</div>
                  </div>
                  <div className="text-xs text-white/50 mt-0.5">
                    {r.check_number ? `#${r.check_number} · ` : ''}from {r.submitted_by_name ?? 'someone'} · {ago(r.created_at)}
                    {' · '}<a href={`/api/hub/checks/${r.id}/photo/back`} target="_blank" rel="noreferrer" className="underline hover:text-white/80">back</a>
                  </div>
                  {r.memo && <div className="text-xs text-white/60 mt-0.5">{r.memo}</div>}
                  {r.sent_anyway && <div className="text-xs text-amber-300/90 mt-0.5">⚠ Sent anyway — the photo check flagged it</div>}
                  {r.status === 'deposited' && r.deposited_at && (
                    <div className="text-xs text-emerald-400/90 mt-0.5">
                      ✓ Deposited {shortDate(r.deposited_at)}{r.deposited_by_name ? ` by ${r.deposited_by_name}` : ''}
                    </div>
                  )}
                  {canManage && (
                    <div className="mt-2 flex items-center gap-3">
                      {r.status === 'pending' ? (
                        <>
                          <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, 'deposited')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[#fff] text-sm font-semibold disabled:opacity-50">
                            ✓ Deposited
                          </button>
                          <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, 'void')}
                            className="text-xs text-white/40 hover:text-white/70">
                            Void
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={busyId === r.id} onClick={() => setStatus(r.id, 'pending')}
                          className="text-xs text-white/45 hover:text-white/75 underline">
                          Undo — not deposited yet
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}
    </div>
  )
}
