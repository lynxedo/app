// Radio's glyphs, drawn to the same rule as the rail (see `I` in railCatalog.tsx):
// stroked outline on a 24×24 grid, stroke-width 1.8, round caps and joins, colour
// from currentColor. No emoji anywhere in the feature — Ben, Sep 16 2026: "I do not
// like emoji looking icons." Size with className; the defaults suit a header button.

type IconProps = { className?: string; title?: string }

function Glyph({ d, className = 'h-4 w-4', title }: IconProps & { d: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

/** A handheld two-way radio: body, antenna, grille, one control. The feature's mark. */
export function RadioIcon(p: IconProps) {
  return (
    <Glyph
      {...p}
      d="M8 8h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V10a2 2 0 012-2zM10 8V3M9.5 12h5M9.5 15h5M15 18.5h.01"
    />
  )
}

/** Microphone — the "your turn / you're talking" state. */
export function MicIcon(p: IconProps) {
  return (
    <Glyph
      {...p}
      d="M12 15a3.5 3.5 0 003.5-3.5V6.5a3.5 3.5 0 10-7 0v5A3.5 3.5 0 0012 15zM18.5 11.5a6.5 6.5 0 01-13 0M12 18v3M9 21h6"
    />
  )
}

/** Speaker with two waves — the "they're talking, listen" state. */
export function SpeakerIcon(p: IconProps) {
  return (
    <Glyph
      {...p}
      d="M4 10v4h3.5l4.5 3.5v-11L7.5 10H4zM15.5 9.5a3.5 3.5 0 010 5M18 7a7 7 0 010 10"
    />
  )
}
