# Lynxedo — Persistent Handoff Document

> This doc is updated at the end of every session. New sessions start here.
> Working codebase: `~/Documents/lynxedo` (NOT the Google Drive App/ folder — that copy is stale)
> Start dev server: `cd ~/Documents/lynxedo && npm run dev`
> IMPORTANT: Disconnect and reconnect Jobber in Settings at the start of every test session.

---

## What the App Is

**Lynxedo** — a Next.js web app for field service route optimization.

1. Sign in via Supabase magic link (email only, no password)
2. Connect a Jobber account via OAuth
3. Pick a tech + date → pull visits and assessments from Jobber
4. Optimize stop order (2-opt TSP) using real Mapbox road travel times
5. Drag stops to reorder manually if needed
6. Send calculated appointment times back to Jobber
7. Print a route sheet (map page 1 landscape + stop cards portrait)

**Pricing model:** $29/mo Basic, $69/mo Advanced (per account, not per user). 14-day free trial.

---

## Tech Stack

| Layer | What |
|-------|------|
| Framework | Next.js 15 (App Router), TypeScript |
| Auth + DB | Supabase (magic link auth, user_settings table) |
| Maps | Mapbox GL JS (interactive map), Mapbox Matrix API (road times), Mapbox Static Images API (print map) |
| Routing algo | 2-opt TSP in `lib/tsp.ts` |
| Geocoding | US Census geocoder (free, no auth) |
| Styling | Tailwind CSS, dark theme (bg-gray-950) |
| Hosting | Currently: Windows laptop on LAN + Cloudflare Tunnel. Next: VPS (see Migration below) |

---

## What Is Fully Working (Stage 1 Complete ✅)

- **Auth** — Supabase magic link, session persistence, sign out
- **Jobber OAuth** — connect/disconnect, token auto-refresh every 45 min
- **Visit loading** — pulls visits + assessments for any tech + date from Jobber
- **Route optimization** — 2-opt TSP using real Mapbox Matrix road times (falls back to haversine above 25 stops)
- **Road geometry on map** — Mapbox Directions API draws actual road lines (falls back to straight lines above 25 waypoints)
- **On-site duration** — two methods:
  - *Default*: fixed minutes per stop
  - *Formula*: sums line items → optional lawn size (K=min) → padding → minimum floor
- **Fallback warning** — yellow banner on stops where formula couldn't calculate (fell back to default)
- **Assessment stops** — 📋 badge, fixed duration, correct address field (`street` not `address.street1`)
- **🗺 Road times badge** — shown when Mapbox Matrix was used vs straight-line
- **Drag-to-reorder** — drag stops manually, then Recalculate to update ETAs
- **Lock first/last stop** — depot always fixed during optimize
- **Send to Jobber** — writes appointment times to each visit (assessments included)
- **Print route sheet** — Mapbox Static Images map (landscape p.1) + stop cards (portrait)
- **Settings** — Profile, On-Site Duration, Routing Defaults, Depot, Jobber Connection; all persisted in Supabase
- **Line item caching** — cached in `duration_rules.cachedLineItems` in Supabase; refresh button in Settings
- **Privacy Policy** — live at `/privacy`, no auth required
- **Help page** — live at `/help`, no auth required; covers all settings + daily workflow + troubleshooting
- **Page title** — "Lynxedo — Route Optimization" (fixed Session 16; was "Create Next App")
- **TypeScript** — `npx tsc --noEmit` exits clean (0 errors)

---

## What Still Needs Manual Testing (Before Calling Stage 1 Signed Off)

These require a browser test — no code changes needed:

1. **Assessment 📋 badge** — load a date that has an assessment for a tech, confirm the badge appears in the stop list
2. **Settings persistence** — go to Settings → On-Site Duration → set method to Formula → Save → reload the page → confirm it comes back as Formula (not Default). Then run an optimize with a stop that has no matching line items → confirm yellow banner fires.

---

## Roadmap

### Stage 2 — Deployment (next major milestone)
**Blocked on:** Systems migration planning session (see below)

- Deploy to VPS (DigitalOcean / Hetzner, ~$6–12/mo)
- Nginx reverse proxy → `routing.lynxedo.com`
- SSL via Let's Encrypt, Cloudflare in front
- Update Jobber OAuth callback URL to production domain
- Set production environment variables (Supabase, Mapbox, Jobber)
- Run as a managed process (PM2 or systemd)

### Stage 3 — Advanced Features (after deployment)
- Multi-tech loading — combine visits from multiple techs into one route list
- Send to different date — date picker in Send panel
- Duration method: Custom Field — pull lawn size from Jobber job custom field
- Duration method: Historical — average actual on-site time from past 3 visits

---

## Systems Migration Context (New — Session 16)

**Current setup (Windows laptop on office LAN):**
- Heroes105 MCP server (`server.js`, port 3001) — exposed via Cloudflare Tunnel at `mcp.lynxedo.com`
- Lynxedo Next.js dev server — currently local only, not yet publicly hosted
- Potentially other scripts/sites to be inventoried

**Plan:**
A dedicated Cowork session ("systems migration planning") should be opened with access to:
- `jobber-mcp` folder (MCP server code + bat files + tunnel config)
- `App` folder (lynxedo Next.js app)
- `Heroes Reference` folder (shared standards)
- An inventory of everything else running on the Windows laptop

That session will:
1. Inventory all running services on the laptop
2. Design the VPS architecture (single server or split, Nginx vhost config, process management)
3. Plan Cloudflare DNS + tunnel migration
4. Output a step-by-step migration runbook
5. Update this handoff with deployment decisions

**Do NOT start VPS deployment without that planning session.** The MCP server and the web app share the same domain (`lynxedo.com`) and need to be migrated together.

---


## App File Structure (relevant files)

```
~/Documents/lynxedo/
  app/
    layout.tsx                    — root layout, metadata, fonts
    globals.css
    page.tsx                      — root redirect to /dashboard
    login/page.tsx                — magic link sign-in
    dashboard/
      page.tsx                    — server component, auth check
      RouteBuilder.tsx            — main route UI + printRouteSheet()
    settings/
      page.tsx                    — server component, loads all settings
      SettingsForm.tsx            — all settings UI (5 sections)
    help/page.tsx                 — help guide (no auth)
    privacy/page.tsx              — privacy policy (no auth)
    api/
      visits/route.ts             — visits + assessments (parallel fetch from Jobber)
      optimize/route.ts           — Matrix API + 2-opt TSP + computeDuration
      send-to-jobber/route.ts     — writes appointment times to Jobber
      settings/route.ts           — GET/POST user_settings (incl. duration_method + duration_rules)
      users/route.ts              — Jobber user list
      auth/
        callback/route.ts         — Supabase OAuth callback
        jobber/route.ts           — Jobber OAuth start
        jobber/callback/route.ts  — Jobber OAuth callback + token storage
        jobber/disconnect/route.ts
      jobber/
        line-items/route.ts       — productOrServices query (for formula setup)
  lib/
    jobber.ts                     — Jobber API helpers, token refresh
    geocode.ts                    — US Census geocoder
    tsp.ts                        — 2-opt TSP with optional durationMatrix
    supabase/
      client.ts                   — browser Supabase client
      server.ts                   — server Supabase client
  .env.local                      — NEXT_PUBLIC_MAPBOX_TOKEN, Supabase URL/key, Jobber client ID/secret
  SESSION_HANDOFF.md              — this file
```

---

## Known Quirks

- **Jobber reconnect required every session** — disconnect/reconnect OAuth in Settings; token can go stale
- **Codebase at `~/Documents/lynxedo`** — Google Drive copy in `App/` is stale, don't edit there
- **Blob URL for route sheet** — `new Blob([html])` → `URL.createObjectURL` → `window.open`
- **GL JS scripts at bottom of body** — Mapbox GL JS `<script>` must come after `#route-map` div
- **Matrix API limit: 25 locations** — depot + up to 24 stops; falls back to haversine above that
- **Directions API limit: 25 waypoints** — same; map falls back to straight lines above that
- **Assessment address field** — uses `street` (not `address.street1` like regular visits)
- **Line items caching** — cached in `duration_rules.cachedLineItems` in Supabase
- **Shared types in `types.ts`** — never import from `route.ts` in a Client Component (causes build error)
- **NEVER modify `jobber-mcp/server.js`** — read-only reference folder; all new Lynxedo logic goes in Next.js API routes

---

## Session History

| Session | What Was Built |
|---------|---------------|
| 1–3 | Supabase auth, login page, basic dashboard |
| 4 | Jobber OAuth connect, token storage |
| 5 | Visits API, pull visits by date + tech |
| 6 | 2-opt TSP optimizer, Mapbox directions for drive times |
| 7 | Send-to-Jobber (sets appointment times) |
| 8 | Settings page: Profile, Routing Defaults, Depot, Jobber Connection |
| 9 | Route sheet: stop cards with line items, phone, job title, instructions |
| 10 | Map (Mapbox GL JS), on-site duration formula, job title in stop list |
| 11 | Real road drive times (Matrix API), road geometry on map, 🗺 badge |
| 12 | Drag-to-reorder + Recalculate, lock first/last stop |
| 13 | Print map: Mapbox Static Images API, p.1 landscape, stop cards portrait |
| 14 | Configurable duration system: line item formula, assessments, method dropdown, fallback warnings |
| 15 | TypeScript fixes: assessment cast + settings page missing duration fields |
| 16 | Privacy policy (`/privacy`), Help page (`/help`), nav links, page title fix, this handoff doc |
