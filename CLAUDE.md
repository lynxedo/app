# CLAUDE.md — Lynxedo Website (Next.js App)

This folder contains the source code for the Lynxedo platform at lynxedo.com.

Read `Google Drive > My Drive > Lynxedo > Reference > LYNXEDO_MASTER_REFERENCE.md` for full platform context.

---

## Deploying Code Changes

**Edit files here → `git push origin main` → GitHub Actions auto-deploys to VPS in ~48 seconds.**

That's it. No copying files, no manual restarts, no deploy scripts. GitHub Actions handles: `git pull` → `npm ci` → `npm run build` → `pm2 restart lynxedo`.

`deploy.bat` is retired. Do not use it.

---

## Standing Rules — Always Follow These

### NEXT_PUBLIC_ env vars are baked at build time
Changing `.env.local` alone does nothing. Must rebuild (i.e. push to GitHub and let Actions run).

### request.url is localhost internally
The Cloudflare tunnel proxies to localhost:3000. `request.url` in API routes returns `http://localhost:3000/...` not `https://lynxedo.com/...`. Always use `process.env.NEXT_PUBLIC_APP_URL` for any redirect URLs — never `new URL(request.url).origin`.

### proxy.ts — not middleware.ts
Next.js 16 uses `proxy.ts` with export named `proxy`. Don't rename.

### Never run `npm install` from this Google Drive folder
Google Drive file locks will break it. Packages are installed on the VPS via `npm ci` during the GitHub Actions deploy.

### Jobber refresh writes use the admin client
`lib/jobber.ts` writes rotated tokens via `createAdminClient()` (service role), NOT the user-session client. RLS on `jobber_tokens` doesn't allow user-session UPDATE, and refresh-token rotation is ON for the Lynxedo Jobber app — every refresh returns a new refresh_token and immediately invalidates the old one. If the save fails silently (which is what RLS-blocked writes do), the next refresh 401s and the user has to disconnect/reconnect. Don't switch this back to the user-session client.

### Call-log times: display the naive datetime, don't TZ-convert
Supabase `call_datetime` is stored as naive Texas-local time labeled `+00:00`. `formatDateTime` in `app/call-log/page.tsx` parses the date/time parts directly and formats — it does NOT pass them through `new Date()`, which would let the browser convert from "UTC" to local and produce times 5 hours off. See timezone section in MASTER_REFERENCE.md.

---

## Key Locations

| Thing | Location |
|-------|---------|
| Edit source files | Here — `Google Drive > My Drive > Lynxedo > Website` |
| Production runtime | VPS at `/opt/lynxedo/app/` — never edit directly |
| API keys (.env.local) | VPS at `/opt/lynxedo/app/.env.local` — reference copy here in this folder |
| Full platform docs | `Google Drive > My Drive > Lynxedo > Reference > LYNXEDO_MASTER_REFERENCE.md` |
| VPS restore guide | `Google Drive > My Drive > Lynxedo > Reference > VPS_RESTORE_GUIDE.md` |
| SSH to VPS | `ssh root@5.78.42.57` — private key saved in Ben's 1Password as "Lynxedo VPS SSH Key" |

---

## If the VPS Needs to Be Rebuilt

See `Google Drive > My Drive > Lynxedo > Reference > VPS_RESTORE_GUIDE.md`.
