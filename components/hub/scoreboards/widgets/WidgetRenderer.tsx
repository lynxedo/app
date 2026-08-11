'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type {
  AttentionPayload, BarsPayload, DonutPayload, KpiPayload, ListPayload, StackedPayload, TablePayload,
  WidgetPayload,
} from '@/lib/scoreboards/widgets/payloads'
import { formatValue, toneColor } from './tone'

/* Every visual a widget can be. One component per payload kind, so adding a
 * widget that draws something we already draw costs nothing on the client.
 *
 * Charts are SVG/CSS rather than Chart.js: these shapes are bars, stacks and one
 * donut, and hand-drawing them means no per-widget chart registration, no canvas
 * lifecycle inside a draggable card, and crisp text at any card size. */

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <div className="text-[13px] font-semibold text-sky-200">{title}</div>
      {sub ? <div className="mb-3.5 text-[11px] text-gray-500">{sub}</div> : <div className="mb-3" />}
    </>
  )
}

function Empty({ message }: { message: string }) {
  return <div className="flex min-h-[120px] items-center justify-center text-center text-sm text-gray-500">{message}</div>
}

function Legend({ items }: { items: { label: string; tone: Parameters<typeof toneColor>[0] }[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: toneColor(i.tone) }} />{i.label}
        </span>
      ))}
    </div>
  )
}

/** Trend shape only — no axes, no numbers. It says "rising" or "lumpy", nothing more. */
function Spark({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null
  const W = 100, H = 22
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - min) / range) * (H - 3) - 1.5
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="mt-2 block" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" opacity={0.7} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Kpi({ p }: { p: KpiPayload }) {
  const long = p.value.length > 12
  return (
    <>
      <div className="text-[11px] font-medium text-sky-300">{p.label}</div>
      <div
        className={`mt-1.5 font-bold tracking-tight ${long ? 'text-[16px] leading-tight break-words' : 'text-[26px] leading-none'}`}
        style={{ color: p.tone ? toneColor(p.tone) : '#f0f9ff' }}
      >
        {p.value}
      </div>
      {p.delta ? (
        <div className="mt-1 text-[11px] font-medium" style={{ color: toneColor(p.delta.tone) }}>
          {p.delta.text}
        </div>
      ) : null}
      {p.sub ? <div className="mt-1.5 text-[11px] text-gray-500">{p.sub}</div> : null}
      {p.spark ? <Spark values={p.spark} tone={toneColor(p.delta?.tone ?? p.tone ?? 'neutral')} /> : null}
    </>
  )
}

/* Chips, not a chart. Each is a thing to do; the ones with somewhere to go are
 * links, and the ones without are plain — a fake link that goes nowhere is worse
 * than no link. */
function Attention({ p }: { p: AttentionPayload }) {
  return (
    <>
      <Head title={p.title} sub={p.sub} />
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {p.chips.map(c => {
          const color = toneColor(c.tone)
          const body = (
            <>
              <div className="text-[11px] font-medium text-gray-400">{c.label}</div>
              <div className="mt-1 text-[19px] font-bold leading-none tabular-nums" style={{ color }}>{c.value}</div>
              {c.detail ? <div className="mt-1.5 text-[10.5px] leading-snug text-gray-500">{c.detail}</div> : null}
            </>
          )
          const cls = 'rounded-xl border p-3 transition-colors'
          const style = { borderColor: `${color}33`, background: `${color}0d` }
          return c.href
            ? <Link key={c.key} href={c.href} className={`${cls} hover:border-[var(--t-accent)]/60`} style={style}>{body}</Link>
            : <div key={c.key} className={cls} style={style}>{body}</div>
        })}
      </div>
      {p.foot ? <div className="mt-3 text-[10.5px] leading-snug text-gray-600">{p.foot}</div> : null}
    </>
  )
}

function Bars({ p }: { p: BarsPayload }) {
  const max = Math.max(1, ...p.rows.map(r => r.value))
  return (
    <>
      <Head title={p.title} sub={p.sub} />
      {p.rows.length === 0
        ? <Empty message={p.empty ?? 'Nothing to show yet'} />
        : (
          <div className="flex flex-col gap-[7px]">
            {p.rows.map(r => (
              <div key={r.label} className="grid grid-cols-[minmax(72px,104px)_1fr_46px] items-center gap-2.5 text-[11px]" title={r.detail}>
                <div className="truncate text-gray-400">{r.label}</div>
                <div className="h-[15px] overflow-hidden rounded-[3px] bg-white/[0.05]">
                  <div
                    className="h-full rounded-[3px]"
                    style={{ width: `${Math.max(2, (100 * r.value) / max)}%`, background: toneColor(r.tone), opacity: 0.78 }}
                  />
                </div>
                <div className="text-right font-semibold text-gray-300 tabular-nums">{formatValue(r.value, p.format)}</div>
              </div>
            ))}
          </div>
        )}
      {p.legend ? <Legend items={p.legend} /> : null}
    </>
  )
}

function Stacked({ p }: { p: StackedPayload }) {
  return (
    <>
      <Head title={p.title} sub={p.sub} />
      {p.rows.length === 0
        ? <Empty message={p.empty ?? 'Nothing to show yet'} />
        : (
          <div className="flex flex-col gap-[7px]">
            {p.rows.map(r => {
              const total = Math.max(1, r.parts.reduce((s, x) => s + x.value, 0))
              return (
                <div key={r.label} className="grid grid-cols-[minmax(72px,104px)_1fr_46px] items-center gap-2.5 text-[11px]">
                  <div className="truncate text-gray-400">{r.label}</div>
                  <div className="flex h-[15px] overflow-hidden rounded-[3px] bg-white/[0.05]">
                    {r.parts.map((x, i) => (
                      <div
                        key={i}
                        title={`${x.label}: ${x.value}`}
                        style={{ width: `${(100 * x.value) / total}%`, background: toneColor(x.tone), opacity: 0.8 }}
                      />
                    ))}
                  </div>
                  <div className="text-right font-semibold text-gray-300 tabular-nums">{r.caption}</div>
                </div>
              )
            })}
          </div>
        )}
      <Legend items={p.legend} />
    </>
  )
}

function Donut({ p }: { p: DonutPayload }) {
  const size = 150, r = size / 2 - 12, C = 2 * Math.PI * r
  const total = p.parts.reduce((s, x) => s + x.value, 0)
  let offset = 0
  return (
    <div className="grid items-center gap-4 md:grid-cols-[170px_1fr]">
      <div className="grid place-items-center">
        {total <= 0
          ? <Empty message={p.empty ?? 'Nothing to show yet'} />
          : (
            <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={p.title}>
              <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                {p.parts.map(part => {
                  const len = (C * part.value) / total
                  const el = (
                    <circle
                      key={part.label}
                      cx={size / 2} cy={size / 2} r={r}
                      fill="none" stroke={toneColor(part.tone)} strokeWidth={16}
                      strokeDasharray={`${len} ${C}`} strokeDashoffset={-offset}
                      opacity={0.85}
                    />
                  )
                  offset += len
                  return el
                })}
              </g>
            </svg>
          )}
      </div>
      <div>
        <Head title={p.title} sub={p.sub} />
        <Legend items={p.parts.map(x => ({ label: `${x.label} (${x.value})`, tone: x.tone }))} />
        {p.note ? <div className="mt-3 text-[12px] leading-snug text-gray-400">{p.note}</div> : null}
      </div>
    </div>
  )
}

function Table({ p }: { p: TablePayload }) {
  const sortable = p.columns.filter(c => c.sortable)
  const [sortKey, setSortKey] = useState<string>(sortable[0]?.key ?? '')
  const rows = useMemo(() => {
    if (!sortKey) return p.rows
    return [...p.rows].sort((a, b) => Number(b.cells[sortKey] ?? -1) - Number(a.cells[sortKey] ?? -1))
  }, [p.rows, sortKey])

  return (
    <>
      <Head title={p.title} sub={p.sub} />
      {p.rows.length === 0
        ? <Empty message={p.empty ?? 'Nothing to show yet'} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-sky-400/15">
                  {p.columns.map(c => (
                    <th
                      key={c.key}
                      title={c.title}
                      onClick={c.sortable ? () => setSortKey(c.key) : undefined}
                      className={`whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wide ${c.align === 'left' ? 'text-left' : 'text-right'} ${c.sortable ? 'cursor-pointer select-none hover:text-sky-300' : ''} ${c.key === sortKey ? 'text-sky-300' : 'text-gray-500'}`}
                    >
                      {c.label}{c.key === sortKey ? ' ▾' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    {p.columns.map((c, ci) => {
                      const tone = row.tones?.[c.key]
                      const value = formatValue(row.cells[c.key] ?? null, c.format)
                      if (ci === 0) {
                        return (
                          <td key={c.key} className="max-w-[220px] px-2.5 py-2">
                            <div className="truncate font-medium text-gray-200">{value}</div>
                            {row.meta ? (
                              <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: toneColor(row.meta.tone) }} />
                                {row.meta.text}
                              </div>
                            ) : null}
                          </td>
                        )
                      }
                      return (
                        <td
                          key={c.key}
                          className={`px-2.5 py-2 tabular-nums ${c.align === 'left' ? 'text-left' : 'text-right'} ${tone ? 'font-semibold' : 'text-gray-300'}`}
                          style={tone ? { color: toneColor(tone) } : undefined}
                        >
                          {value}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {p.foot ? <div className="mt-3 text-[10.5px] leading-snug text-gray-600">{p.foot}</div> : null}
    </>
  )
}

function List({ p }: { p: ListPayload }) {
  return (
    <>
      <Head title={p.title} sub={p.sub} />
      {p.items.length === 0
        ? <Empty message={p.empty ?? 'Nothing to report yet'} />
        : (
          <ul className="space-y-2">
            {p.items.map((line, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-gray-300">
                <span className="shrink-0">💡</span><span>{line}</span>
              </li>
            ))}
          </ul>
        )}
    </>
  )
}

export function WidgetRenderer({ payload }: { payload: WidgetPayload }) {
  switch (payload.kind) {
    case 'kpi': return <Kpi p={payload} />
    case 'bars': return <Bars p={payload} />
    case 'stacked': return <Stacked p={payload} />
    case 'donut': return <Donut p={payload} />
    case 'table': return <Table p={payload} />
    case 'list': return <List p={payload} />
    case 'attention': return <Attention p={payload} />
  }
}
