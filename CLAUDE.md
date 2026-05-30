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

### Promoting staging → prod — CHERRY-PICKS ONLY
**⚠ NEVER `git merge develop` into `main`.** `develop` and `main` have deliberately
diverged — `develop` carries features that are gated behind external approvals and
cannot all ship at once (e.g. Txt v2 awaiting Toll-Free Verification, Daily Log v2
shipping as a specific commit range, Guardian Session 3 which must go with Txt v2).
A full merge would drag all of that to prod.

Once a feature is tested on staging and Ben says it's good, cherry-pick just that
feature's commit(s) from `develop` onto `main`:
```
git checkout main
git cherry-pick <commit-sha> [<commit-sha> ...]   # only the commits for this feature
git push origin main
```
Find the commits to pick with `git log develop ^main --oneline` (commits on develop
not yet on main). Before pushing, run `npx tsc --noEmit` against main's tree — a
develop-only import can break prod even when the cherry-pick applies cleanly.

This matches the authoritative rule in the root `Lynxedo/CLAUDE.md`
("⚠ Never `git merge develop→main` — use cherry-picks only").

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

## Deploy Failure Recovery

**Symptom:** Push goes to GitHub, GitHub Actions says ✅ green, but `staging.lynxedo.com` or `lynxedo.com` returns 502 / never loads.

**This used to happen often** (Session 77 `RailPermissions`, Session 79 Phase 2.5 `onArrive`, Session 78 JSX paren mismatch). Each time the failure was a TypeScript or JSX error that broke `next build` — but the bigger problem was the deploy script kept charging ahead and PM2 entered a 300+ restart loop against a missing `.next/BUILD_ID`.

### What now prevents this (deploy workflows, May 29 2026)

Both `deploy-staging.yml` and `deploy.yml` have these properties — DO NOT remove them:

1. **`set -euo pipefail`** at the top of every deploy script. Any non-zero exit aborts immediately, so a broken tsc never reaches the pm2 step. The old PM2 process keeps serving the prior good build.
2. **`npx tsc --noEmit` BEFORE `npm run build`.** Catches type/JSX errors in ~15s with a clear file:line, instead of failing 60s into the build.
3. **`pm2 restart` (not `reload`).** Reload is a graceful zero-downtime swap that becomes a no-op when PM2 is already in `errored` state. Restart forces a fresh process and resets the restart counter.
4. **Health check via `curl` after restart.** Polls `http://localhost:3000/` (or `:3002` for staging) up to 30s. If no HTTP 200/307/308, dumps `pm2 logs --err --lines 30` to the Actions log and exits non-zero — the GitHub deploy step turns red.

**Outcome:** A broken commit is now LOUD — Actions goes red, you see exactly which file:line broke, and the old build keeps serving traffic. It's no longer possible to silently end up with a dead PM2 process.

### If staging or prod IS down (manual recovery)

The hardened workflow should make this rare, but if you hit it (or you're recovering from a pre-May-29 push that landed before the fix):

```bash
ssh root@5.78.42.57

# 1. Diagnose
pm2 list                                    # find errored process
pm2 logs lynxedo-staging --lines 50 --err   # see the actual error

# 2. Most common cause: missing or partial .next/ build
ls /opt/lynxedo-staging/app/.next/BUILD_ID  # if "No such file", build never finished

# 3. Manual rebuild + restart
cd /opt/lynxedo-staging/app
npx tsc --noEmit                            # find any type errors first
npm run build                               # rebuild fresh
pm2 restart lynxedo-staging --update-env    # restart (NOT reload)
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3002/   # verify

# Same procedure for prod, swap paths/names/port:
#   /opt/lynxedo/app    lynxedo   :3000
```

### Pre-push self-check (highly recommended for any session that touches JSX or types)

Before pushing a session that adds props, changes type signatures, or refactors JSX, run the **TSC safety dance** that caught the Session 78 JSX bug:

```bash
# From your Mac, scp the changed file(s) into staging, run tsc, restore originals.
# scope the file list to what you actually changed.
FILES="components/hub/marketing/PostComposer.tsx lib/google-business.ts"
cd "Lynxedo/Website"

# Backup originals on the VPS
ssh root@5.78.42.57 "cd /opt/lynxedo-staging/app && for f in $FILES; do cp \$f \$f.orig; done"

# Push your local versions
for f in $FILES; do scp "$f" "root@5.78.42.57:/opt/lynxedo-staging/app/$f"; done

# Run tsc — exit 0 means safe to push
ssh root@5.78.42.57 "cd /opt/lynxedo-staging/app && set -o pipefail && npx tsc --noEmit"

# Restore (so the next deploy doesn't pick up half-applied changes)
ssh root@5.78.42.57 "cd /opt/lynxedo-staging/app && for f in $FILES; do mv \$f.orig \$f; done"
```

The hardened deploy workflow now does this automatically inside CI, so the safety dance is **belt-and-suspenders** — it gives you the failure signal in ~15s on your laptop instead of waiting ~60s for the GH Actions deploy to fail. Worth doing for any large multi-file session.

### `npm install` → `npm ci` migration gotcha (May 29 2026)

The deploy workflows now use `npm ci --legacy-peer-deps` (not `npm install`).
`npm ci` installs exactly what's in `package-lock.json` and **never mutates it**,
so the lock stays authoritative and a future drift fails the deploy loudly.

**One-time trap when switching install → ci:** the *old* `npm install` step had
been silently mutating `package-lock.json` **in the live app dirs** on every
deploy, leaving the working tree dirty (`git status` showed ` M package-lock.json`).
The first post-switch deploy then failed at **`git pull`** — not at npm — because
the incoming lock commit couldn't overwrite the local modification. Symptom: GitHub
emails a failed deploy, but the site stays up (the hardened workflow aborts before
PM2) and `git -C /opt/lynxedo/app rev-parse HEAD` still shows the *old* commit.

Fix — clear the stale mutation in each live app dir, then re-trigger:
```bash
ssh root@5.78.42.57 "cd /opt/lynxedo/app && git checkout -- package-lock.json"          # prod
ssh root@5.78.42.57 "cd /opt/lynxedo-staging/app && git checkout -- package-lock.json"   # staging
# then push (an empty commit works: git commit --allow-empty -m 'ci: re-trigger') to re-run Actions
```
This is a **one-time** cleanup. Because `npm ci` doesn't touch the lock, the working
tree stays clean on every deploy afterward — verify with `git status --short` showing
no ` M package-lock.json`.

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
