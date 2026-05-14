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
