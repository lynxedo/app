'use client'

import type { ConfigField, WidgetConfig } from '@/lib/scoreboards/widgets/types'
import { SPAN_STOPS } from '@/lib/scoreboards/widgets/types'
import type { WidgetCatalogEntry } from '@/lib/scoreboards/widgets/registry'

/* The settings panel is GENERATED from the widget's declared config schema.
 *
 * This is the whole reason the library scales: a new widget declares
 * `{ topN: { kind:'number', ... } }` and gets a working settings form. Nobody
 * hand-builds a settings screen per widget, which is what would otherwise make
 * "one library, two consumers" collapse under its own weight.
 */

type Props = {
  def: WidgetCatalogEntry
  span: number
  config: WidgetConfig
  windowLabel: string
  onConfig: (key: string, value: unknown) => void
  onSpan: (span: number) => void
  onRemove: () => void
  onClose: () => void
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-[11px] font-semibold text-sky-300">{label}</label>
      {children}
      {hint ? <div className="mt-1.5 text-[10.5px] text-gray-500">{hint}</div> : null}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-sky-400/15 bg-[#020c16]/60 px-2.5 py-1.5 text-[12px] text-gray-200'
const pillCls = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-[11px] ${on ? 'border-sky-400/50 bg-sky-400/15 text-sky-200' : 'border-sky-400/15 text-gray-400 hover:text-sky-200'}`

export function WidgetSettings({ def, span, config, windowLabel, onConfig, onSpan, onRemove, onClose }: Props) {
  const entries = Object.entries(def.config) as [string, ConfigField][]

  return (
    <aside className="flex h-full w-[352px] max-w-[92vw] flex-col border-l border-sky-400/15 bg-gradient-to-b from-[var(--t-panel)] to-[var(--t-sidebar)]">
      <div className="flex items-start gap-2.5 border-b border-sky-400/15 px-4.5 py-3.5 px-4">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-sky-200">{def.title}</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">{def.group} widget</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="grid h-6 w-6 place-items-center rounded-md border border-amber-400/35 text-[12px] text-amber-200 hover:bg-amber-500 hover:text-[#291a00]"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {entries.length === 0 ? (
          <div className="mb-4 rounded-lg border border-sky-400/15 bg-white/[0.02] p-3 text-[11.5px] leading-snug text-gray-400">
            This widget has no options of its own — it shows one number for whatever period the board is set to.
          </div>
        ) : null}

        {entries.map(([key, field]) => {
          const value = config[key]
          if (field.kind === 'number') {
            return (
              <Field key={key} label={`${field.label}${field.unit ? ` (${field.unit})` : ''}`} hint={field.hint}>
                <input
                  type="number"
                  className={inputCls}
                  value={Number(value ?? field.def)}
                  min={field.min}
                  max={field.max}
                  onChange={e => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) onConfig(key, Math.min(field.max, Math.max(field.min, n)))
                  }}
                />
              </Field>
            )
          }
          if (field.kind === 'enum') {
            return (
              <Field key={key} label={field.label} hint={field.hint}>
                <select className={inputCls} value={String(value ?? field.def)} onChange={e => onConfig(key, e.target.value)}>
                  {field.opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            )
          }
          if (field.kind === 'multi') {
            const on = Array.isArray(value) ? (value as string[]) : field.def
            return (
              <Field key={key} label={field.label} hint={field.hint}>
                <div className="flex flex-wrap gap-1.5">
                  {field.opts.map(o => {
                    const active = on.includes(o)
                    return (
                      <button
                        key={o}
                        aria-pressed={active}
                        className={pillCls(active)}
                        onClick={() => {
                          const next = active ? on.filter(x => x !== o) : [...on, o]
                          // Never let the last one off — an empty filter reads as a
                          // broken widget rather than a deliberate choice.
                          if (next.length) onConfig(key, next)
                        }}
                      >
                        {o}
                      </button>
                    )
                  })}
                </div>
              </Field>
            )
          }
          return (
            <Field key={key} label={field.label} hint={field.hint}>
              <div className="flex gap-1.5">
                {[['Yes', true], ['No', false]].map(([label, v]) => (
                  <button
                    key={String(label)}
                    aria-pressed={value === v}
                    className={pillCls(value === v)}
                    onClick={() => onConfig(key, v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )
        })}

        <Field label="Card size" hint="Four fit a row at Quarter, three at Third. Or drag the card's right edge. Cards stack to one column on a phone.">
          <div className="flex flex-wrap gap-1.5">
            {SPAN_STOPS.map(s => (
              <button key={s.span} aria-pressed={span === s.span} className={pillCls(span === s.span)} onClick={() => onSpan(s.span)}>
                {s.label}
              </button>
            ))}
            {!SPAN_STOPS.some(s => s.span === span) ? (
              <span className="self-center text-[11px] text-amber-400">{span}/12</span>
            ) : null}
          </div>
        </Field>

        <Field label="Date range" hint={`Follows the board's range — currently ${windowLabel}.`}>
          <div className={`${inputCls} text-gray-500`}>Board range</div>
        </Field>

        {entries.length ? (
          <details className="mt-2 rounded-lg border border-sky-400/15 bg-[#020c16]/50">
            <summary className="cursor-pointer px-2.5 py-2 text-[11px] text-sky-300">Why this form looks like this</summary>
            <pre className="overflow-x-auto px-2.5 pb-2 font-mono text-[10.5px] leading-relaxed text-[#8fb3c9]">
{`config: {
${entries.map(([k, f]) => `  ${k}: { kind: '${f.kind}' }`).join(',\n')}
}`}
            </pre>
            <div className="px-2.5 pb-2.5 text-[10.5px] leading-snug text-gray-500">
              The widget declares its own options; this panel is built from that declaration. Adding a widget never means building a settings screen.
            </div>
          </details>
        ) : null}
      </div>

      <div className="flex gap-2 border-t border-sky-400/15 px-4 py-3">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-[#291a00] hover:brightness-110"
        >
          Done
        </button>
        <button
          onClick={onRemove}
          className="rounded-lg border border-amber-400/45 px-3 py-1.5 text-[12px] text-amber-200 hover:bg-amber-500/10"
        >
          Remove
        </button>
      </div>
    </aside>
  )
}
