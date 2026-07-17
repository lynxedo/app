'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/format'

// Staff Pricer — a faithful port of Pricer/pricer.html, but the program data is
// read live from /api/hub/pricer/charts (published Service Builder charts)
// instead of the hardcoded arrays the prototype used. The 3 add-ons
// (Moisture Manager, Bed Weed Control, Plant Health Care) use non-size formulas
// and stay special-cased here until they're modeled in the Builder (later session).

type Program = {
  program_key: string
  name: string
  description: string | null
  category: string
  sort_order: number
  visits: number
  base_fee: number
  price_per_k: number
  version_label: string | null
}

function fmt(val: number): string {
  if (!isFinite(val)) return '—'
  return formatCurrency(val, { decimals: val % 1 === 0 ? 0 : 2 })
}
// Formula (matches the Service Builder + the original Pricer): per-visit price =
// base + perK × sizeK; annual = per-visit × visits.
const perVisitOf = (p: Program, sizeK: number) => p.base_fee + p.price_per_k * sizeK

// ── Scoped styles — ported verbatim from pricer.html, every selector prefixed
// with .pricer-root so the light theme can't leak into the dark Hub shell. ──
const CSS = `
.pricer-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f2f6f2; color: #1a2e1a; height: 100%; overflow-y: auto; }
.pricer-root * { box-sizing: border-box; }
.pricer-root header { background: linear-gradient(135deg, #1b4d1b 0%, #2e7d32 100%); color: white; padding: 28px 24px 24px; text-align: center; }
.pricer-root header h1 { font-size: 1.7rem; font-weight: 800; letter-spacing: -0.5px; }
.pricer-root header p { opacity: 0.82; margin-top: 5px; font-size: 0.92rem; letter-spacing: 0.3px; }
.pricer-root .input-bar { background: white; border-bottom: 1px solid #dde8dd; padding: 18px 24px; position: sticky; top: 0; z-index: 30; box-shadow: 0 2px 10px rgba(0,0,0,0.09); }
.pricer-root .input-bar-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.pricer-root .main-size-group { display: flex; align-items: center; gap: 12px; }
.pricer-root .input-bar label { font-size: 0.9rem; font-weight: 700; color: #1b4d1b; white-space: nowrap; }
.pricer-root .main-size-group input[type=number] { width: 90px; padding: 9px 12px; font-size: 1.25rem; font-weight: 800; border: 2px solid #2e7d32; border-radius: 8px; text-align: center; color: #1b4d1b; outline: none; }
.pricer-root .main-size-group input[type=number]:focus { border-color: #1b6b1b; box-shadow: 0 0 0 3px rgba(46,125,50,0.15); }
.pricer-root .unit-label { font-size: 0.9rem; color: #666; font-weight: 500; }
.pricer-root .size-hint { font-size: 0.75rem; color: #999; margin-left: auto; }
.pricer-root .addon-inputs-panel { max-width: 1200px; margin: 24px auto 0; padding: 0 16px; }
.pricer-root .addon-inputs-box { background: white; border-radius: 12px; border: 1px solid #dde8dd; padding: 20px 24px; display: flex; gap: 24px; flex-wrap: wrap; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.pricer-root .addon-inputs-box h3 { width: 100%; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: 700; margin-bottom: -8px; }
.pricer-root .addon-field { flex: 1; min-width: 210px; }
.pricer-root .addon-field label { display: block; font-size: 0.82rem; font-weight: 700; color: #1b4d1b; margin-bottom: 5px; }
.pricer-root .addon-field input[type=number], .pricer-root .addon-field select { width: 100%; padding: 8px 11px; border: 1px solid #c8d8c8; border-radius: 7px; font-size: 0.92rem; color: #1a2e1a; outline: none; background: #fafffe; }
.pricer-root .addon-field input[type=number]:focus, .pricer-root .addon-field select:focus { border-color: #2e7d32; box-shadow: 0 0 0 2px rgba(46,125,50,0.12); }
.pricer-root .addon-field .hint { font-size: 0.73rem; color: #aaa; margin-top: 4px; }
.pricer-root main { max-width: 1200px; margin: 28px auto 40px; padding: 0 16px; }
.pricer-root .section-header { display: flex; align-items: center; gap: 10px; font-size: 1.15rem; font-weight: 800; color: #1b4d1b; margin: 32px 0 14px; padding-bottom: 10px; border-bottom: 3px solid #2e7d32; }
.pricer-root .section-header.first { margin-top: 0; }
.pricer-root .programs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px; margin-bottom: 8px; }
.pricer-root .program-card { background: white; border-radius: 12px; padding: 18px 20px; border: 1px solid #ddeadd; box-shadow: 0 1px 5px rgba(0,0,0,0.06); transition: box-shadow 0.2s, transform 0.15s; display: flex; flex-direction: column; }
.pricer-root .program-card:hover { box-shadow: 0 5px 18px rgba(46,125,50,0.13); transform: translateY(-2px); }
.pricer-root .card-name { font-size: 1rem; font-weight: 800; color: #1b4d1b; margin-bottom: 4px; }
.pricer-root .card-desc { font-size: 0.79rem; color: #667; line-height: 1.45; flex-grow: 1; margin-bottom: 10px; }
.pricer-root .card-badge { display: inline-block; font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 20px; margin-bottom: 14px; background: #e8f5e9; color: #2e7d32; align-self: flex-start; }
.pricer-root .card-badge.onetime { background: #fff8e1; color: #f57f17; }
.pricer-root .card-pricing { border-top: 1px solid #eef3ee; padding-top: 14px; display: flex; justify-content: space-around; align-items: flex-end; gap: 8px; }
.pricer-root .price-col { text-align: center; }
.pricer-root .price-label { font-size: 0.67rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
.pricer-root .price-val { font-size: 1.35rem; font-weight: 800; color: #1b6b1b; line-height: 1; }
.pricer-root .price-val.big { font-size: 1.65rem; }
.pricer-root .price-divider { width: 1px; height: 38px; background: #eef3ee; flex-shrink: 0; }
.pricer-root .addon-cards { display: flex; flex-direction: column; gap: 12px; }
.pricer-root .addon-card { background: white; border-radius: 12px; border: 1px solid #ddeadd; padding: 18px 20px; box-shadow: 0 1px 5px rgba(0,0,0,0.06); transition: opacity 0.2s; }
.pricer-root .addon-card.dormant { opacity: 0.38; }
.pricer-root .addon-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 4px; }
.pricer-root .addon-name { font-size: 1rem; font-weight: 800; color: #1b4d1b; }
.pricer-root .addon-tag { font-size: 0.68rem; font-weight: 700; padding: 3px 9px; border-radius: 20px; background: #fff3e0; color: #e65100; white-space: nowrap; flex-shrink: 0; }
.pricer-root .addon-desc { font-size: 0.79rem; color: #667; margin-bottom: 14px; line-height: 1.4; }
.pricer-root .addon-dormant-hint { font-size: 0.79rem; color: #aaa; font-style: italic; }
.pricer-root .addon-pricing-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; border-top: 1px solid #eef3ee; padding-top: 14px; }
.pricer-root .ap-col { text-align: center; }
.pricer-root .ap-label { font-size: 0.67rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
.pricer-root .ap-val { font-size: 1.2rem; font-weight: 800; color: #1b6b1b; }
.pricer-root .notice { text-align: center; padding: 40px 24px; border-radius: 12px; font-size: 1rem; font-weight: 600; }
.pricer-root .notice.error { background: #fff5f5; border: 1px solid #ffcdd2; color: #c62828; }
.pricer-root .notice.muted { background: white; border: 1px solid #dde8dd; color: #667; }
.pricer-root footer { text-align: center; padding: 20px; font-size: 0.75rem; color: #aaa; border-top: 1px solid #e0e8e0; }
`

function ProgramCard({ p, sizeK }: { p: Program; sizeK: number }) {
  const isOneTime = p.category === 'onetime'
  const perVisit = perVisitOf(p, sizeK)
  const annual = perVisit * (p.visits || 1)
  return (
    <div className="program-card">
      <div className="card-name">{p.name}</div>
      <div className="card-desc">{p.description}</div>
      <span className={`card-badge${isOneTime ? ' onetime' : ''}`}>
        {isOneTime ? 'One-Time Service' : `${p.visits} visits / year`}
      </span>
      <div className="card-pricing">
        {isOneTime ? (
          <div className="price-col">
            <div className="price-label">One-Time Price</div>
            <div className="price-val big">{fmt(perVisit)}</div>
          </div>
        ) : (
          <>
            <div className="price-col">
              <div className="price-label">Per Visit</div>
              <div className="price-val">{fmt(perVisit)}</div>
            </div>
            <div className="price-divider" />
            <div className="price-col">
              <div className="price-label">Annual</div>
              <div className="price-val big">{fmt(annual)}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AddonCard({ name, desc, tag, annual }: { name: string; desc: string; tag: string; annual: number }) {
  return (
    <div className="addon-card">
      <div className="addon-top">
        <div className="addon-name">{name}</div>
        <span className="addon-tag">{tag}</span>
      </div>
      <div className="addon-desc">{desc}</div>
      <div className="addon-pricing-grid">
        <div className="ap-col"><div className="ap-label">Annual</div><div className="ap-val">{fmt(annual)}</div></div>
        <div className="ap-col"><div className="ap-label">Per Visit (8-visit plan)</div><div className="ap-val">{fmt(annual / 8)}</div></div>
        <div className="ap-col"><div className="ap-label">Per Visit (12-visit plan)</div><div className="ap-val">{fmt(annual / 12)}</div></div>
      </div>
    </div>
  )
}

function DormantAddon({ name, tag, hint }: { name: string; tag: string; hint: string }) {
  return (
    <div className="addon-card dormant">
      <div className="addon-top">
        <div className="addon-name">{name}</div>
        <span className="addon-tag">{tag}</span>
      </div>
      <div className="addon-dormant-hint">{hint}</div>
    </div>
  )
}

export default function PricerView({ businessName = 'Heroes Lawn Care' }: { businessName?: string }) {
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sizeStr, setSizeStr] = useState('5')
  const [bedStr, setBedStr] = useState('')
  const [phcTier, setPhcTier] = useState(0)

  // ?size= handoff from the Lawn Sizer: K already, or full sq ft (>= 100 → ÷1000).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('size')
    if (raw) {
      const v = parseFloat(raw)
      if (v >= 100) setSizeStr(String(v / 1000))
      else if (v >= 3) setSizeStr(String(v))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/pricer/charts')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (!cancelled) setPrograms(d.programs ?? []) })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'Failed to load pricing') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const sizeK = parseFloat(sizeStr) || 0
  const bedK = parseFloat(bedStr) || 0

  const annual = useMemo(() => programs.filter(p => p.category === 'annual'), [programs])
  const onetime = useMemo(() => programs.filter(p => p.category === 'onetime'), [programs])
  const other = useMemo(() => programs.filter(p => p.category !== 'annual' && p.category !== 'onetime'), [programs])
  const versionLabel = programs.find(p => p.version_label)?.version_label ?? null

  const tooSmall = sizeK < 3
  const mmAnnual = 270 + 30 * sizeK
  const bwpAnnual = 40 + 150 * bedK
  const phcAnnual = 225 + 125 * phcTier

  return (
    <div className="pricer-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header>
        <h1>🌿 Fertilizer Force Pricing</h1>
        <p>{businessName} · {versionLabel ? `${versionLabel} ` : ''}Program Pricing</p>
      </header>

      <div className="input-bar">
        <div className="input-bar-inner">
          <label htmlFor="lawnSize">Lawn Size</label>
          <div className="main-size-group">
            <input id="lawnSize" type="number" min={3} step={0.5} value={sizeStr}
              onChange={e => setSizeStr(e.target.value)} placeholder="10" />
            <span className="unit-label">K sq ft</span>
          </div>
          <span className="size-hint">Enter in thousands (e.g. 10 = 10,000 sq ft) · Minimum 3K</span>
        </div>
      </div>

      <div className="addon-inputs-panel">
        <div className="addon-inputs-box">
          <h3>Add-On Options (optional)</h3>
          <div className="addon-field">
            <label htmlFor="bedSize">Bed Weed Control — Bed Area (K sq ft)</label>
            <input id="bedSize" type="number" min={0} step={0.5} value={bedStr}
              onChange={e => setBedStr(e.target.value)} placeholder="e.g. 1.5" />
            <div className="hint">Enter in thousands (e.g. 1.5 = 1,500 sq ft of beds)</div>
          </div>
          <div className="addon-field">
            <label htmlFor="phcTier">Plant Health Care — Difficulty Tier</label>
            <select id="phcTier" value={phcTier} onChange={e => setPhcTier(parseInt(e.target.value) || 0)}>
              <option value={0}>— Select tier —</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map(tier => (
                <option key={tier} value={tier}>Tier {tier} — {fmt(225 + 125 * tier)}/yr</option>
              ))}
            </select>
            <div className="hint">Based on landscape complexity, not size</div>
          </div>
        </div>
      </div>

      <main>
        {loading ? (
          <div className="notice muted">Loading live pricing…</div>
        ) : loadError ? (
          <div className="notice error">⚠️ Couldn&apos;t load pricing: {loadError}</div>
        ) : programs.length === 0 ? (
          <div className="notice muted">No published programs yet. Publish a program in the Service Builder to see it here.</div>
        ) : tooSmall ? (
          <div className="notice error">⚠️ Minimum lawn size is 3K (3,000 sq ft) — please enter a size of 3 or greater.</div>
        ) : (
          <>
            {annual.length > 0 && (
              <>
                <div className="section-header first">🌱 Annual Programs</div>
                <div className="programs-grid">
                  {annual.map(p => <ProgramCard key={p.program_key} p={p} sizeK={sizeK} />)}
                </div>
              </>
            )}

            {onetime.length > 0 && (
              <>
                <div className="section-header">⚡ One-Time &amp; Seasonal Services</div>
                <div className="programs-grid">
                  {onetime.map(p => <ProgramCard key={p.program_key} p={p} sizeK={sizeK} />)}
                </div>
              </>
            )}

            {other.length > 0 && (
              <>
                <div className="section-header">📋 Other Programs</div>
                <div className="programs-grid">
                  {other.map(p => <ProgramCard key={p.program_key} p={p} sizeK={sizeK} />)}
                </div>
              </>
            )}

            <div className="section-header">➕ Program Add-Ons</div>
            <div className="addon-cards">
              <AddonCard
                name="Moisture Manager"
                desc="Collects & releases moisture to grass during heat stress — reduces irrigation needs · 4 treatments/yr"
                tag="Add-On Only"
                annual={mmAnnual}
              />
              {bedK > 0 ? (
                <AddonCard
                  name="Bed Weed Control (BWP)"
                  desc={`Pre-emergent applications for landscape beds · ${bedK}K sq ft of beds · 5 treatments/yr`}
                  tag="Add-On Only"
                  annual={bwpAnnual}
                />
              ) : (
                <DormantAddon name="Bed Weed Control (BWP)" tag="Add-On Only" hint="Enter bed area (in thousands) in the options above to see pricing." />
              )}
              {phcTier > 0 ? (
                <AddonCard
                  name="Plant Health Care (PHC)"
                  desc={`Fertilizers, Insecticides & Disease Control for landscape plants & small trees · Difficulty Tier ${phcTier} · 7 treatments/yr`}
                  tag="Add-On Only"
                  annual={phcAnnual}
                />
              ) : (
                <DormantAddon name="Plant Health Care (PHC)" tag="Add-On Only" hint="Select a difficulty tier in the options above to see pricing." />
              )}
            </div>
          </>
        )}
      </main>

      <footer>
        Prices are annual totals and subject to site confirmation. {businessName} · Internal quoting tool
      </footer>
    </div>
  )
}
