// Single source of truth for the theme list. The CSS for each theme lives in
// app/globals.css (html.theme-{id}); this file is the canonical id/label/accent
// registry that the server allow-lists, the live-switcher, and both pickers all
// import — so adding a theme is a 2-file change (here + globals.css), not 5.
//
// Pure data (no React / no client-only APIs) so server components
// (app/layout.tsx, app/api/profile/route.ts) can import it too.

export type ThemeCat = 'Dark' | 'Light' | 'Hybrid' | 'Glossy'

export interface ThemeDef {
  id: string
  label: string
  accent: string   // representative accent, for the picker swatch
  dark: boolean     // is the sidebar/dominant surface dark? (swatch background)
  cat: ThemeCat
}

export const THEMES: ThemeDef[] = [
  // Dark
  { id: 'midnight',  label: 'Midnight',  accent: '#2e7eb8', dark: true,  cat: 'Dark' },
  { id: 'carbon',    label: 'Carbon',    accent: '#7c6cf0', dark: true,  cat: 'Dark' },
  // Light
  { id: 'daylight',  label: 'Daylight',  accent: '#2563eb', dark: false, cat: 'Light' },
  { id: 'blossom',   label: 'Blossom',   accent: '#7c3aed', dark: false, cat: 'Light' },
  // Hybrid — dark nav + light workspace
  { id: 'eclipse',   label: 'Eclipse',   accent: '#4f46e5', dark: true,  cat: 'Hybrid' },
  { id: 'pine',      label: 'Pine',      accent: '#16a34a', dark: true,  cat: 'Hybrid' },
  { id: 'sharp',     label: 'Sharp',     accent: '#1d4ed8', dark: true,  cat: 'Hybrid' },
  // Glossy — frosted panels over a gradient base (all dark)
  { id: 'aurora',      label: 'Aurora Glass',   accent: '#c4a6ff', dark: true, cat: 'Glossy' },
  { id: 'nebula',      label: 'Nebula Glass',   accent: '#ff9ad1', dark: true, cat: 'Glossy' },
  { id: 'tide',        label: 'Tide Glass',     accent: '#5eead4', dark: true, cat: 'Glossy' },
  { id: 'obsidian',    label: 'Obsidian Glass', accent: '#7dd3fc', dark: true, cat: 'Glossy' },
  { id: 'emberglass',  label: 'Ember Glass',    accent: '#ffae6b', dark: true, cat: 'Glossy' },
  { id: 'heroesglass', label: 'Heroes Glass',   accent: '#e6b252', dark: true, cat: 'Glossy' },
]

export const THEME_IDS = THEMES.map(t => t.id)

// Display order for grouped pickers (settings page).
export const THEME_CATEGORIES: ThemeCat[] = ['Dark', 'Light', 'Hybrid', 'Glossy']

// Black or white — whichever reads on a user-picked background color. Used by
// the Sharp theme's "text is only black or white" rule for colors that live in
// data (Tracker stages / statuses), which CSS alone can't judge. WCAG relative
// luminance; 0.179 is the point where black and white give equal contrast.
export function inkOn(hex: string): '#000' | '#fff' {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim())
  if (!m) return '#fff'
  const lin = (i: number) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
  return L > 0.179 ? '#000' : '#fff'
}

// Inline style vars for an `lx-chip` element — Sharp paints it solid `--chip`
// with `--chip-ink` text; every other theme ignores them.
export function chipVars(hex: string): Record<string, string> {
  return { '--chip': hex, '--chip-ink': inkOn(hex) }
}
