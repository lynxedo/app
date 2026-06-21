// Single source of truth for the theme list. The CSS for each theme lives in
// app/globals.css (html.theme-{id}); this file is the canonical id/label/accent
// registry that the server allow-lists, the live-switcher, and both pickers all
// import — so adding a theme is a 2-file change (here + globals.css), not 5.
//
// Pure data (no React / no client-only APIs) so server components
// (app/layout.tsx, app/api/profile/route.ts) can import it too.

export type ThemeCat = 'Dark' | 'Light' | 'Hybrid' | 'Liquid Glass' | 'Heroes Lawn Care'

export interface ThemeDef {
  id: string
  label: string
  accent: string   // representative accent, for the picker swatch
  dark: boolean     // is the sidebar/dominant surface dark? (swatch background)
  cat: ThemeCat
}

export const THEMES: ThemeDef[] = [
  // Classics
  { id: 'midnight',  label: 'Midnight',  accent: '#2e7eb8', dark: true,  cat: 'Dark' },
  { id: 'daylight',  label: 'Daylight',  accent: '#2563eb', dark: false, cat: 'Light' },
  // Original dark set (slated to be retired as the hybrid/glass families land)
  { id: 'carbon',    label: 'Carbon',    accent: '#7c6cf0', dark: true,  cat: 'Dark' },
  { id: 'evergreen', label: 'Evergreen', accent: '#2faa5f', dark: true,  cat: 'Dark' },
  { id: 'slate',     label: 'Slate',     accent: '#14b8c4', dark: true,  cat: 'Dark' },
  { id: 'ember',     label: 'Ember',     accent: '#e84d6b', dark: true,  cat: 'Dark' },
  { id: 'mocha',     label: 'Mocha',     accent: '#d4a24e', dark: true,  cat: 'Dark' },
  // Original light set
  { id: 'linen',     label: 'Linen',     accent: '#d97706', dark: false, cat: 'Light' },
  { id: 'sage',      label: 'Sage',      accent: '#16a34a', dark: false, cat: 'Light' },
  { id: 'arctic',    label: 'Arctic',    accent: '#0d9488', dark: false, cat: 'Light' },
  { id: 'blossom',   label: 'Blossom',   accent: '#7c3aed', dark: false, cat: 'Light' },
  { id: 'graphite',  label: 'Graphite',  accent: '#3b6ea5', dark: false, cat: 'Light' },
  // Hybrid — dark nav + light workspace
  { id: 'eclipse',   label: 'Eclipse',   accent: '#4f46e5', dark: true,  cat: 'Hybrid' },
  { id: 'cobalt',    label: 'Cobalt',    accent: '#1277e0', dark: true,  cat: 'Hybrid' },
  { id: 'pine',      label: 'Pine',      accent: '#16a34a', dark: true,  cat: 'Hybrid' },
  // Hybrid — light nav + dark workspace
  { id: 'twilight',  label: 'Twilight',  accent: '#f59e0b', dark: false, cat: 'Hybrid' },
  { id: 'daybreak',  label: 'Daybreak',  accent: '#22d3ee', dark: false, cat: 'Hybrid' },
  { id: 'sandstone', label: 'Sandstone', accent: '#ff5277', dark: false, cat: 'Hybrid' },
  // Liquid Glass — dark
  { id: 'aurora',     label: 'Aurora Glass',  accent: '#c4a6ff', dark: true, cat: 'Liquid Glass' },
  { id: 'nebula',     label: 'Nebula Glass',  accent: '#ff9ad1', dark: true, cat: 'Liquid Glass' },
  { id: 'tide',       label: 'Tide Glass',    accent: '#5eead4', dark: true, cat: 'Liquid Glass' },
  { id: 'obsidian',   label: 'Obsidian Glass',accent: '#7dd3fc', dark: true, cat: 'Liquid Glass' },
  { id: 'emberglass', label: 'Ember Glass',   accent: '#ffae6b', dark: true, cat: 'Liquid Glass' },
  // Liquid Glass — light
  { id: 'frost',     label: 'Frost Glass',   accent: '#6d28d9', dark: false, cat: 'Liquid Glass' },
  { id: 'sherbet',   label: 'Sherbet Glass', accent: '#e8536f', dark: false, cat: 'Liquid Glass' },
  { id: 'seafoam',   label: 'Seafoam Glass', accent: '#0d9488', dark: false, cat: 'Liquid Glass' },
  { id: 'sky',       label: 'Sky Glass',     accent: '#2563eb', dark: false, cat: 'Liquid Glass' },
  { id: 'honey',     label: 'Honey Glass',   accent: '#d97706', dark: false, cat: 'Liquid Glass' },
  // Heroes Lawn Care (brand)
  { id: 'heroes',      label: 'Heroes',       accent: '#007848', dark: true, cat: 'Heroes Lawn Care' },
  { id: 'heroesglass', label: 'Heroes Glass', accent: '#e6b252', dark: true, cat: 'Heroes Lawn Care' },
]

export const THEME_IDS = THEMES.map(t => t.id)

// Display order for grouped pickers (settings page).
export const THEME_CATEGORIES: ThemeCat[] = ['Dark', 'Light', 'Hybrid', 'Liquid Glass', 'Heroes Lawn Care']
