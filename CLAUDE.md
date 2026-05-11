# CLAUDE.md — Lynxedo App (the Routing Tool)

**Why is this folder called "App"?** The routing tool was the first and only tool when this project started, so it was simply called "the app." The Google Drive folder (`H:\Shared drives\Claude\Projects\App\lynxedo\`) and local Windows folder (`C:\Projects\lynxedo`) both carry that name. It is now one tool within the larger Lynxedo platform at lynxedo.com.

Read `H:\Shared drives\Claude\Projects\App\LYNXEDO_MASTER_REFERENCE.md` for full context on this project.

---

## Slack Notifications — Dev Session Protocol

### Step 1 — When Ben gives the green light to start coding
**Automatically run this before touching any code:**
```powershell
powershell -ExecutionPolicy Bypass -File "H:\Shared drives\Claude\Projects\App\lynxedo\notify-dev-start.ps1"
```
Posts a "Lynxedo is in development mode" message to `#ai-updates`. Safe to call multiple times — skips silently if already posted this session (state file exists at `%LOCALAPPDATA%\lynxedo-dev-session\ts.txt`).

### Step 2 — When all changes are complete and server is confirmed stable
**Ask Ben:** *"Should I post that Lynxedo is back to stable?"*

- If **yes**: run the script below, which posts a new "back up and stable" message to `#ai-updates`.
- If **no**: do nothing. The state file stays in place, so the next `notify-dev-start.ps1` run will skip automatically — Ben won't need to re-post the dev mode message if he plans to continue making changes.

```powershell
powershell -ExecutionPolicy Bypass -File "H:\Shared drives\Claude\Projects\App\lynxedo\notify-dev-stable.ps1"
```

---

## Standing Rules — Always Follow These

### After ANY code change to this app:
**Run `deploy.bat`** — do not manually copy files or restart the server any other way.

`deploy.bat` is at `H:\Shared drives\Claude\Projects\App\lynxedo\deploy.bat`

It does three things automatically:
1. Copies changed source files from Google Drive → `C:\Projects\lynxedo`
2. Runs `npm run build`
3. Kills and restarts the server

Never edit files directly in `C:\Projects\lynxedo` — always edit on Google Drive and run deploy.bat.

### Never run `npm install` from this folder (Google Drive)
Google Drive file locks will break it. If packages need to be installed, do it in `C:\Projects\lynxedo`.

### The app runs in production mode
`npm start` — not `npm run dev`. Changes require a full rebuild to take effect. deploy.bat handles this.

### NEXT_PUBLIC_ env vars are baked at build time
Changing `.env.local` alone does nothing. Must rebuild.

### request.url is localhost internally
The Cloudflare tunnel proxies to localhost:3000. `request.url` in API routes returns `http://localhost:3000/...` not `https://lynxedo.com/...`. Always use `process.env.NEXT_PUBLIC_APP_URL` for any redirect URLs — never `new URL(request.url).origin`.

### proxy.ts — not middleware.ts
Next.js 16 uses `proxy.ts` with export named `proxy`. Don't rename.

---

## If the Windows Machine Needs to Be Rebuilt

See `H:\Shared drives\Claude\Projects\App\lynxedo\RESTORE_GUIDE.md` — full step-by-step instructions to restore everything from scratch.

---

## Key Locations

| Thing | Location |
|-------|---------|
| Edit source files | Here — `H:\Shared drives\Claude\Projects\App\lynxedo\` |
| Production runtime | `C:\Projects\lynxedo` |
| Deploy script | `deploy.bat` (this folder) |
| API keys (.env.local) | `C:\Projects\lynxedo\.env.local` (backup copy also here on Drive) |
| Full platform docs | `H:\Shared drives\Claude\Projects\App\LYNXEDO_MASTER_REFERENCE.md` |
| Restore guide | `H:\Shared drives\Claude\Projects\App\lynxedo\RESTORE_GUIDE.md` |
