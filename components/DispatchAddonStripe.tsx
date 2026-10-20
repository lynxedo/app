'use client'

// Dispatch's color language (Ben, Oct 20 2026) — the same on a box and a pin:
//   fill / pin center   = SERVICE (Dispatch stop colors, else Pin Colors base program)
//   left edge / border  = TECH
//   right edge / halo   = ADD-ONS (Pin Colors add-on programs), up to 3 stripes
// This draws the right-edge stripes. The parent must be positioned (relative
// or absolute) and should leave ~6px of right padding.

export default function DispatchAddonStripe({ colors, width = 5 }: { colors: string[]; width?: number }) {
  const list = colors.slice(0, 3)
  if (list.length === 0) return null
  return (
    <div className="absolute top-0 right-0 bottom-0 flex flex-col pointer-events-none" style={{ width }} title="Add-on programs">
      {list.map((c, i) => <div key={i} className="flex-1" style={{ background: c }} />)}
    </div>
  )
}
