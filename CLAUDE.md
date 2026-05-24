# CLAUDE.md — Lynxedo Website (Next.js App)

This folder contains the source code for the Lynxedo platform at lynxedo.com.

**Platform context:**
- `Lynxedo/CLAUDE.md` — root quick start (file map, safety rules)
- `Lynxedo/Reference/LYNXEDO_MASTER_REFERENCE.md` — full platform state (tables, env vars, quirks, file structure)

---

## Deploying Code Changes

**Two environments — always ask Ben which one to push to.**

| Environment | URL | Branch | PM2 process | Port | VPS path |
|---|---|---|---|---|---|
| **Production** | lynxedo.com | `main` | `lynxedo` | 3000 | `/opt/lynxedo/app/` |
| **Staging** | staging.lynxedo.com | `develop` | `lynxedo-staging` | 3002 | `/opt/lynxedo-staging/app/` |

**Workflow:** Edit files here → `git push origin <branch>` → GitHub Actions auto-deploys in ~60 seconds.

- Push to `develop` triggers `.github/workflows/deploy-staging.yml` → staging only
- Push to `main` triggers `.github/workflows/deploy.yml` → prod only
- The two deploys are completely isolated. Prod is never touched by a staging push.

### Rule: ALWAYS ask "staging or prod?" before pushing.
Heroes is live. Before pushing any code change — new feature, bug fix, tweak — ask Ben explicitly. Default for new/risky work is staging first; promote to prod only after he confirms.

### Promoting staging → prod
Once a feature is tested on staging and Ben says it's good:
```
git checkout main
git merge develop
git push origin main
```

### Important: staging shares the prod database
Both environments read/write the SAME Supabase project. Staging is for testing UI/code changes against real data — NOT for schema migrations or destructive testing. A bad migration on staging hits prod data.

`deploy.bat` is retired. Do not use it.

---

## Standing Rules — Always Follow These

### Every new tool / page needs an SVG icon in railCatalog.tsx
The Hub icon rail, mobile bottom bar, and Tools sidebar all pull their glyphs from a single catalog at `components/hub/railCatalog.tsx`. When you add a new tool, page, or anything else that users navigate to inside Hub:

1. Add a `CatalogId` entry (snake-case kebab id) to the `CatalogId` union.
2. Add an SVG path constant in `PATHS` — drawn in the same stroked-outline style (24×24, stroke-width 1.8). Heroicons outline is a good reference.
3. Add the `CatalogIcon` case in the switch.
4. Add a `CATALOG` row with `pickable: true` (and `requires:` if it's permission-gated) so it shows up in Settings → My Hub.
5. Reference it everywhere — sidebars, the rail, anywhere a per-tool icon is shown. No emoji for tool glyphs; emoji are only OK for chat markers (`#` rooms, `🔒` private rooms, status dots, etc.).

This keeps the rail visually consistent and lets users promote any tool to a rail slot via the picker.



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

## New Computer Setup (so Claude can push and deploy)

Before Claude can push to GitHub on a new Mac, do this once:

### 1. Install the SSH key
The private key is saved in Ben's 1Password as **"Lynxedo VPS SSH Key"**.

Copy the private key contents, then run in Terminal:
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
# Paste the key into this file:
nano ~/.ssh/id_ed25519
# Save with Ctrl+O, Enter, Ctrl+X
chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
```

### 2. Verify it works
```bash
ssh -T git@github.com
# Should say: Hi lynxedo! You've successfully authenticated...
```

### 3. Make sure the git remote uses SSH (not HTTPS)
```bash
cd "/Users/bensimpson/ben@heroeslawntx.com - Google Drive/My Drive/Lynxedo/Website"
git remote set-url origin git@github.com:lynxedo/app.git
```

That's it — Claude can now push from this machine any time.

**Public key** (already registered on GitHub as "Lynxedo Mac Deploy Key"):
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA1yXacjZ34qfHJVGJ1dMUyi7SjHA7nmiWTKmXZ5x073 ben@lynxedo-vps
```
If it's a brand-new machine, add this public key to GitHub at github.com/settings/keys.

---

## If the VPS Needs to Be Rebuilt

See `Google Drive > My Drive > Lynxedo > Reference > VPS_RESTORE_GUIDE.md`.
