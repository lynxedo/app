'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { DEFAULT_MIX_ROWS, fmtAmt } from '@/lib/mix-sheet'
import type { MixSheetPayload } from '@/lib/mix-sheet-server'

// All styling is scoped under .msroot so it can't touch the dark Hub chrome.
const CSS = `
.msroot{--ink:#161616;--muted:#555;--faint:#888;--line:#cccccc;--line-soft:#e6e6e6;--zebra:#f6f6f6;--water:#ededed;--band:#111;--ui:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  flex:1;min-height:0;overflow-y:auto;background:#f1f1f1;color:var(--ink);font-family:var(--ui);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.msroot .pad{max-width:1100px;margin:0 auto;padding:16px clamp(12px,3vw,26px) 48px}
.msroot.phone .pad{max-width:430px}
.msroot.phone .only-wide{display:none}
.msroot a{color:#111}
.msroot .mast{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px}
.msroot h1.t{margin:0;font-size:clamp(19px,2.3vw,24px);font-weight:800;letter-spacing:-.01em}
.msroot .sub{margin:3px 0 0;color:var(--muted);font-size:13px}
.msroot .back{font-size:12px;font-weight:700;color:#333;text-decoration:none;border:1px solid var(--line);background:#fff;padding:6px 11px;border-radius:8px}
.msroot .bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.05);margin-bottom:16px}
.msroot .grp{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.msroot .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:700}
.msroot input[type=date]{font-family:var(--ui);font-size:13px;font-weight:600;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 9px;background:#fff}
.msroot .chip{cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--muted);padding:6px 12px;border-radius:999px;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:7px}
.msroot .chip .tick{width:14px;height:14px;border-radius:4px;border:1.5px solid var(--line);display:grid;place-items:center;font-size:10px;color:#fff;background:transparent}
.msroot .chip[aria-pressed=true]{border-color:#111;background:#ececec;color:#111}
.msroot .chip[aria-pressed=true] .tick{background:#111;border-color:#111}
.msroot .sp{flex:1 1 auto}
.msroot .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.msroot .seg button{border:0;background:#fff;color:var(--muted);font-weight:700;font-size:12.5px;padding:7px 12px;cursor:pointer}
.msroot .seg button[aria-pressed=true]{background:#111;color:#fff}
.msroot .btn{cursor:pointer;border:1px solid #111;background:#111;color:#fff;font-weight:700;padding:8px 14px;border-radius:8px;font-size:13px;font-family:var(--ui)}
.msroot .btn:disabled{opacity:.5}
.msroot .saved{font-size:11.5px;color:var(--faint);font-weight:600}
.msroot button:focus-visible,.msroot .chip:focus-visible,.msroot input:focus-visible{outline:2px solid #111;outline-offset:2px}
.msroot .layout{display:block}
.msroot .extras{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
@media (max-width:760px){.msroot .extras{grid-template-columns:1fr}}
.msroot.phone .extras{grid-template-columns:1fr}
.msroot .panel{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.msroot .shead{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line-soft)}
.msroot .shead h2{margin:0;font-size:15px;font-weight:800}
.msroot .shead .meta{font-size:12px;color:var(--muted)}
.msroot .fit{font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px}
.msroot .fit.ok{color:#111;background:#ececec}
.msroot .fit.warn{color:#fff;background:#111}
.msroot .scroll{overflow-x:auto}
.msroot table{border-collapse:separate;border-spacing:0;width:100%;font-variant-numeric:tabular-nums}
.msroot thead th{position:sticky;top:0;z-index:3;background:var(--band);color:#fff;text-align:right;padding:9px 12px;font-size:12px;font-weight:700;vertical-align:bottom;white-space:nowrap}
.msroot thead th .pname{font-size:13px;font-weight:800}
.msroot thead th .prate{font-weight:700;color:#f0f0f0;font-size:11px;margin-top:2px}
.msroot thead th .tags{display:grid;grid-template-columns:repeat(2,auto);gap:3px 4px;justify-content:end;margin-top:5px}
.msroot thead th .tag{font-size:9px;font-weight:800;letter-spacing:.03em;padding:2px 5px;border-radius:5px;background:rgba(255,255,255,.18);color:#fff}
.msroot thead th.prod{white-space:normal;width:84px;min-width:84px}
.msroot thead th.prod .pname{display:block;white-space:normal;overflow-wrap:anywhere}
.msroot th.size,.msroot td.size{position:sticky;left:0;z-index:2;text-align:left;min-width:74px}
.msroot th.water,.msroot td.water{position:sticky;z-index:2;text-align:left;min-width:80px}
.msroot thead th.size,.msroot thead th.water{z-index:4;text-align:left}
.msroot td{padding:7px 12px;text-align:right;font-size:13.5px;border-bottom:1px solid var(--line-soft);white-space:nowrap}
.msroot td .u{color:var(--faint);font-size:10.5px;margin-left:3px}
.msroot tbody tr:nth-child(even) td{background:var(--zebra)}
.msroot td.size{background:#fff;font-weight:800}
.msroot td.water{background:var(--water);font-weight:700;color:#333}
.msroot tbody tr:nth-child(even) td.size{background:#f3f3f3}
.msroot th.size{background:var(--band)}
.msroot th.water{background:#2a2a2a}
.msroot th.or-start,.msroot td.or-start{border-left:2px solid #111}
.msroot th.or-end,.msroot td.or-end{border-right:2px solid #111}
.msroot .orbadge{display:inline-block;font-size:8.5px;font-weight:800;color:#fff;background:#111;padding:1px 5px;border-radius:5px;margin-bottom:4px}
.msroot aside{display:flex;flex-direction:column;gap:16px}
.msroot .bhead{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--line-soft);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#111}
.msroot .bbody{padding:12px 14px}
.msroot .elabel{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:700;margin-bottom:7px}
.msroot .ro{white-space:pre-wrap;font-size:13px;line-height:1.5;color:var(--ink)}
.msroot .ro.muted{color:var(--faint);font-style:italic}
.msroot .print-only{display:none}
.msroot textarea{width:100%;border:1px dashed var(--line);border-radius:9px;padding:10px;font-family:var(--ui);font-size:13px;color:var(--ink);line-height:1.5;resize:vertical;background:#fff}
.msroot textarea.notes{min-height:140px}
.msroot textarea.gran{min-height:96px}
.msroot textarea:focus{outline:0;border-color:#111;box-shadow:0 0 0 3px #e7e7e7}
.msroot .empty{padding:28px;text-align:center;color:var(--muted);font-size:13.5px}
@media print{
  /* "letter landscape" (not the bare "landscape" keyword, which Chrome ignores). */
  @page{size:letter landscape;margin:.35in}
  /* Print ONLY the mix sheet — hide the entire Hub shell (icon rail, sidebars,
     headers) regardless of its markup, then lift the sheet to the page origin. */
  html,body{background:#fff!important}
  body *{visibility:hidden!important}
  #ms-print,#ms-print *{visibility:visible!important}
  #ms-print{position:fixed!important;left:0!important;top:0!important;right:0!important;width:100%!important;background:#fff!important;overflow:visible!important}
  .msroot .pad{max-width:none;padding:0}
  .msroot .ms-noprint{display:none!important}
  .msroot .scroll{overflow:visible!important}
  .msroot table{width:100%!important;table-layout:auto}
  .msroot th,.msroot td{min-width:0!important}
  /* Drop sticky + the JS-set left offset so columns align on paper. */
  .msroot th.size,.msroot td.size,.msroot th.water,.msroot td.water{position:static!important;left:auto!important}
  .msroot thead th.prod{width:auto;min-width:0}
  .msroot .panel{box-shadow:none;border-color:#bbb;break-inside:avoid}
  .msroot .extras{break-inside:avoid;margin-top:12px}
  .msroot thead th{font-size:9.5px;padding:4px 5px}
  .msroot td{font-size:10px;padding:3px 5px}
  .screen-only{display:none!important}
  .print-only{display:block!important}
}
`

function monthLabel(asOf: string): string {
  const d = new Date(asOf + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function initSelected(p: MixSheetPayload): Set<string> {
  const all = new Set(p.programs.map(x => x.key))
  const sel = p.config.selected_programs
  if (!sel || sel.length === 0) return all
  const s = new Set(sel.filter(k => all.has(k)))
  return s.size ? s : all
}

export default function MixSheetView({ initial, canEdit }: { initial: MixSheetPayload; canEdit: boolean }) {
  const [asOf, setAsOf] = useState(initial.asOf)
  const [data, setData] = useState<MixSheetPayload>(initial)
  const [selected, setSelected] = useState<Set<string>>(() => initSelected(initial))
  const [notes, setNotes] = useState(initial.config.notes ?? '')
  const [granular, setGranular] = useState(initial.config.granular_options ?? '')
  const [phone, setPhone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const saveTimer = useRef<number | null>(null)

  // Re-fetch the live sheet when the date changes.
  useEffect(() => {
    if (asOf === data.asOf) return
    let cancelled = false
    setBusy(true)
    fetch(`/api/hub/mix-sheet?asOf=${encodeURIComponent(asOf)}`)
      .then(r => r.json())
      .then((p: MixSheetPayload) => {
        if (cancelled || !p || !p.columns) return
        setData(p); setSelected(initSelected(p)); setNotes(p.config.notes ?? ''); setGranular(p.config.granular_options ?? '')
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [asOf, data.asOf])

  function saveConfig(next: { selected?: string[] | null; notes?: string; granular?: string }) {
    if (!canEdit) return // non-editors can filter their own view, but never persist
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      const body = {
        period_key: data.config.period_key,
        label: monthLabel(asOf),
        selected_programs: next.selected !== undefined ? next.selected : (selected.size === data.programs.length ? null : [...selected]),
        notes: next.notes !== undefined ? next.notes : notes,
        granular_options: next.granular !== undefined ? next.granular : granular,
      }
      try {
        const r = await fetch('/api/hub/mix-sheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (r.ok) setSaved(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      } catch { /* offline — kept locally */ }
    }, 600)
  }

  function toggleProgram(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      saveConfig({ selected: next.size === data.programs.length ? null : [...next] })
      return next
    })
  }

  const cols = useMemo(
    () => data.columns.filter(c => c.programKeys.some(k => selected.has(k))),
    [data.columns, selected],
  )
  const fitsOnePage = cols.length <= 9 // ~9 narrow columns fit a landscape page

  return (
    <div id="ms-print" className={`msroot${phone ? ' phone' : ''}`}>
      <style>{CSS}</style>
      <div className="pad">
        <div className="mast ms-noprint">
          <div>
            <h1 className="t">Technician Mix Sheet</h1>
            <p className="sub">How much of each product per tank — read across from <b>water gallons</b> or <b>lawn size</b>. Auto-filled from your dated mixes.</p>
          </div>
          <Link href="/hub/admin/service-mapping" className="back">← Service Mapping</Link>
        </div>

        <div className="bar ms-noprint">
          <div className="grp">
            <span className="lbl">Mix for</span>
            <input type="date" value={asOf} onChange={e => e.target.value && setAsOf(e.target.value)} aria-label="Show the mix for this date" />
          </div>
          <div className="grp">
            <span className="lbl">Programs</span>
            {data.programs.length === 0 && <span className="saved">none mapped for this date</span>}
            {data.programs.map(p => (
              <button key={p.key} className="chip" aria-pressed={selected.has(p.key)} onClick={() => toggleProgram(p.key)} title={p.name}>
                <span className="tick">✓</span>{p.abbr}
              </button>
            ))}
          </div>
          <span className="sp" />
          <div className="grp">
            <span className="lbl">View</span>
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={!phone} onClick={() => setPhone(false)}>🖥 Sheet</button>
              <button aria-pressed={phone} onClick={() => setPhone(true)}>📱 Phone</button>
            </div>
          </div>
          <button className="btn" onClick={() => window.print()}>⬇ Landscape PDF</button>
          {saved && <span className="saved">Saved {saved}</span>}
        </div>

        <div className="layout">
          <section className="panel">
            <div className="shead">
              <div>
                <h2>{monthLabel(asOf)} · {[...selected].length ? data.programs.filter(p => selected.has(p.key)).map(p => p.abbr).join(' / ') : 'no programs'}</h2>
                <div className="meta">💧 Tank ratio {fmtAmt(data.tankRate)} gal per 1,000 sq ft · 🌅 Water in the next morning{busy ? ' · loading…' : ''}</div>
              </div>
              {cols.length > 0 && <span className={`fit ${fitsOnePage ? 'ok' : 'warn'}`}>{fitsOnePage ? `✓ Fits one page (${cols.length})` : `⚠ ${cols.length} products — may spill`}</span>}
            </div>

            {cols.length === 0 ? (
              <div className="empty">
                {data.columns.length > 0
                  ? <>No programs selected — turn on a program chip above to show its products.</>
                  : <>No products for this date. Set up a dated mix in <b>Service Mapping</b> whose dates cover {monthLabel(asOf)}, or pick another date.</>}
              </div>
            ) : (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="size">Sq Ft<br /><span style={{ fontWeight: 600, color: '#c9c9c9', fontSize: '10.5px' }}>(in 1,000s)</span></th>
                      <th className="water">Water<br /><span style={{ fontWeight: 600, color: '#c9c9c9', fontSize: '10.5px' }}>(gallons)</span></th>
                      {cols.map((c, i) => {
                        const prev = cols[i - 1], nextC = cols[i + 1]
                        const orStart = !!c.altGroup && (!prev || prev.altGroup !== c.altGroup)
                        const orEnd = !!c.altGroup && (!nextC || nextC.altGroup !== c.altGroup)
                        const orPair = !!c.altGroup && !!prev && prev.altGroup === c.altGroup
                        const cls = `prod${orStart ? ' or-start' : ''}${orEnd ? ' or-end' : ''}`
                        return (
                          <th key={c.key} className={cls}>
                            {orPair && <span className="orbadge">OR</span>}
                            {orPair && <br />}
                            <span className="pname">{c.name}</span>
                            <div className="prate">{fmtAmt(c.ratePerK)} {c.unit}/K</div>
                            <div className="tags">{c.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {DEFAULT_MIX_ROWS.map(k => (
                      <tr key={k}>
                        <td className="size">{fmtAmt(k)}</td>
                        <td className="water">{fmtAmt(k * data.tankRate)}</td>
                        {cols.map((c, i) => {
                          const prev = cols[i - 1], nextC = cols[i + 1]
                          const cls = `${(c.altGroup && (!prev || prev.altGroup !== c.altGroup)) ? ' or-start' : ''}${(c.altGroup && (!nextC || nextC.altGroup !== c.altGroup)) ? ' or-end' : ''}`
                          return <td key={c.key} className={cls.trim()}>{fmtAmt(k * c.ratePerK)}<span className="u">{c.unit}</span></td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {cols.length > 0 && (
          <div className="extras">
            <div className="panel">
              <div className="bhead">🌾 Granular options</div>
              <div className="bbody">
                <div className="screen-only">
                  {canEdit ? (<>
                    <div className="elabel">✎ Editable · saved for {monthLabel(asOf)}</div>
                    <textarea className="gran" value={granular} placeholder={'e.g.\nRRR — ProPeat 5# per K, spot-spray weeds\nLHB — 28-3-10, 3.5# per K\nGranular preferred; liquid if weedy.'} onChange={e => { setGranular(e.target.value); saveConfig({ granular: e.target.value }) }} />
                  </>) : (granular ? <div className="ro">{granular}</div> : <div className="ro muted">No granular options noted.</div>)}
                </div>
                <div className="print-only ro">{granular}</div>
              </div>
            </div>
            <div className="panel">
              <div className="bhead">📝 Notes</div>
              <div className="bbody">
                <div className="screen-only">
                  {canEdit ? (<>
                    <div className="elabel">✎ Editable · saved for {monthLabel(asOf)}</div>
                    <textarea className="notes" value={notes} placeholder={'Round notes for the crew — e.g. “Water in the next morning. RRR is granular this round. PHC + Bed Weed = inspection, treat new sales.”'} onChange={e => { setNotes(e.target.value); saveConfig({ notes: e.target.value }) }} />
                  </>) : (notes ? <div className="ro">{notes}</div> : <div className="ro muted">No notes for this month.</div>)}
                </div>
                <div className="print-only ro">{notes}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
