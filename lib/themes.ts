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
