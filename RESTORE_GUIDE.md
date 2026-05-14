# Lynxedo Platform — Windows Machine Restore Guide
**Last Updated:** May 12, 2026 (Session 26)
**Use this when:** The Windows machine is replaced, reset, or a fresh Windows install is needed.
**Who does this:** Claude Code handles all technical steps. Cowork handles browser/dashboard steps.

> Tell Claude Code: "My Windows machine needs to be rebuilt. Follow the restore steps in `H:\Shared drives\Claude\Projects\App\lynxedo\RESTORE_GUIDE.md`"
> Tell Cowork: the same thing for any steps marked **[COWORK]**

---

## Before You Start

Everything needed to restore is on **Google Drive** (`H:\Shared drives\Claude\Projects\`) and in **cloud accounts** (Supabase, Cloudflare, Jobber, etc.). Nothing critical is lost when the Windows machine dies — you're just rebuilding the runtime environment.

**Accounts you'll need access to:**
- Google account (for Google Drive — `H:\` drive)
- Cloudflare account (cloudflare.com)
- Supabase (supabase.com — project `nhvwdulyzolevoeayjum`)
- Jobber Developer Portal (developer.getjobber.com)
- Resend.com (for email SMTP)
- Anthropic (for Claude API key — used by Lawn Size Tool)
- Deepgram (for call transcription — used by Unitel Script)

---

## Step 1 — Fresh Windows Setup

**[COWORK or manual]**

1. Install Windows, create user account `simps`, enable auto-login
2. Install **Google Drive for Desktop** — sign in with the Heroes Google account
3. Wait for `H:\Shared drives\` to appear and fully sync before continuing
4. Install **Node.js** (LTS version) from nodejs.org
5. Install **Python 3.11+** from python.org (needed for Lawn Size Tool)
6. Install **Git** from git-scm.com

---

## Step 2 — Cloudflare Tunnel

**[Claude Code]**

Install cloudflared and restore the tunnel config.

```
1. Download cloudflared installer from https://github.com/cloudflare/cloudflared/releases
   Install to: C:\Program Files (x86)\cloudflared\cloudflared.exe

2. Create the config folder:
   C:\Users\simps\.cloudflared\

3. Create config.yml at C:\Users\simps\.cloudflared\config.yml with:

tunnel: d202d258-5f3c-450d-b01f-33e8c4899df9
credentials-file: C:\Users\simps\.cloudflared\d202d258-5f3c-450d-b01f-33e8c4899df9.json

ingress:
  - hostname: lynxedo.com
    service: http://localhost:3000
  - hostname: mcp.lynxedo.com
    service: http://localhost:3001
  - hostname: lawn.lynxedo.com
    service: http://localhost:8000
  - hostname: routing.lynxedo.com
    service: http://localhost:3000
  - hostname: sandbox.lynxedo.com
    service: http://localhost:4321
  - service: http_status:404
```

4. Get the tunnel credentials JSON file:
   - Go to cloudflare.com → Zero Trust → Networks → Tunnels
   - Find tunnel: d202d258-5f3c-450d-b01f-33e8c4899df9
   - Download or regenerate the credentials JSON
   - Save as: C:\Users\simps\.cloudflared\d202d258-5f3c-450d-b01f-33e8c4899df9.json

5. Test: run start-tunnel.bat (from jobber-mcp folder on Google Drive)
   mcp.lynxedo.com should become reachable
```

---

## Step 3 — Heroes105 MCP Server

**[Claude Code]**

The server files are already on Google Drive. Just install dependencies.

```
1. Open PowerShell
2. cd "H:\Shared drives\Claude\Projects\jobber-mcp"
3. npm install
4. Verify .env file exists in that folder (has Jobber + Captivated + Slack credentials)
   If missing, see "Credentials Reference" section at the bottom of this doc
5. Test: run start-jobber-mcp.bat — should say "Heroes105 MCP Server" and show port 3001
```

---

## Step 4 — Lawn Size Tool

**[Claude Code]**

The Python app is on Google Drive. Need to set up a Python virtual environment locally.

```
1. Create the venv in AppData (NOT on Google Drive — avoids file lock issues):
   IMPORTANT: Run these from your own PowerShell (Start menu → PowerShell), NOT from a
   Claude Code session. Claude's sandbox virtualizes AppData and the venv won't be visible
   to the bat file if created from inside Claude.

   python -m venv C:\Users\simps\AppData\Local\lawn-size-tool\venv

2. Install requirements (do NOT use activate — call pip directly):
   & "C:\Users\simps\AppData\Local\lawn-size-tool\venv\Scripts\pip.exe" install -r "H:\Shared drives\Claude\Projects\Lawn Size\requirements.txt"

3. Verify .env file exists at:
   H:\Shared drives\Claude\Projects\Lawn Size\.env
   (Has MAPBOX_TOKEN and ANTHROPIC_API_KEY)
   If missing, see "Credentials Reference" section below

4. Test: run start-lawn.bat from the jobber-mcp folder on Google Drive
   Should say "Lawn-Size-Tool" and show port 8000
```

---

## Step 5 — Lynxedo App / Routing Tool (Next.js)

**[Claude Code]**

Source files are on Google Drive. Need a local copy for Windows-compatible node_modules.

```
Note: The Google Drive folder is named "App" (H:\Shared drives\Claude\Projects\App\lynxedo\)
because the routing tool was the first and only tool when the project started.
C:\Projects\lynxedo is the local Windows runtime copy of those same files.

1. Create the local folder:
   mkdir C:\Projects\lynxedo

2. Copy source files from Google Drive (excluding node_modules and .next):
   robocopy "H:\Shared drives\Claude\Projects\App\lynxedo" "C:\Projects\lynxedo" /E /XD node_modules .next .git /XF .env.local

3. Install Windows-compatible node_modules:
   cd C:\Projects\lynxedo
   npm install

4. Create .env.local at C:\Projects\lynxedo\.env.local
   Copy from: H:\Shared drives\Claude\Projects\App\lynxedo\.env.local
   (Google Drive has the current production values as a backup)

   Contents should be:
   NEXT_PUBLIC_SUPABASE_URL=https://nhvwdulyzolevoeayjum.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_HBwh2BR-517E3D0-ipu-SQ_0-MGl2qN
   NEXT_PUBLIC_MAPBOX_TOKEN=[see Google Drive .env.local for actual value]
   JOBBER_CLIENT_ID=39cd5aad-e593-48ce-b0f7-220e04352885
   JOBBER_CLIENT_SECRET=[see Google Drive .env.local for actual value]
   JOBBER_REDIRECT_URI=https://lynxedo.com/api/auth/jobber/callback
   NEXT_PUBLIC_APP_URL=https://lynxedo.com
   SUPABASE_SERVICE_ROLE_KEY=[see Google Drive .env.local — required for /admin user management]
   TWILIO_ACCOUNT_SID=[see Google Drive .env.local — starts with AC]
   TWILIO_AUTH_TOKEN=[see Google Drive .env.local]
   TWILIO_PHONE_NUMBER=[E.164 format, e.g. +18321234567 — Responder's Twilio number]
   GUSTO_ACCESS_TOKEN=[see Google Drive .env.local — Phase 1 Gusto sync for timesheet]

5. Build the app:
   cd C:\Projects\lynxedo
   npm run build

6. Test: run start-routing.bat from C:\Projects\lynxedo
   Should say "Lynxedo-App" and show port 3000
   Visit https://lynxedo.com — should load the login page
```

---

## Step 6 — Unitel Script (Call Recordings)

**[Claude Code]**

```
1. Project files are on Google Drive at:
   H:\Shared drives\Claude\Projects\Unitel Script\

2. Install dependencies locally (NOT from Google Drive):
   mkdir C:\Projects\unitel-script  (or wherever — just not on Google Drive)
   Copy source files from Google Drive to that local folder
   cd to local folder
   npm install

   Actually — check the Unitel Script CLAUDE.md for current setup instructions.
   The project has its own detailed restore notes.

3. .env file is at: H:\Shared drives\Claude\Projects\Unitel Script\.env
   (Has Deepgram, Anthropic, Slack, Supabase credentials)
   Verify it contains SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — these are
   required for the script to write new calls to the Call Log UI.

4. Re-register the Windows Scheduled Tasks (both are required):

   Run: setup-scheduled-task.ps1 from the project folder
   This recreates "UnitelDownloadRecordings" — runs every 5 min 8am–6pm (the main script).

   Run: setup-healthcheck-task.ps1 from the project folder
   This recreates "UnitelHealthCheck" — runs every 10 min 8am–6pm. Auto-kills hung or
   duplicate runs, auto-restarts the script if it stops, posts Slack alerts to #call-logs.
   Both .ps1 files live in the project folder on Google Drive.

5. Note: The call_logs table in Supabase already has 426+ rows and is cloud-hosted.
   No backfill needed on restore — new calls will upsert automatically once the script runs.
```

---

## Step 7 — Startup Shortcuts

**[Claude Code]**

Set up the Startup folder so everything auto-starts on login.

```
1. Create a shortcut in the Windows Startup folder:
   Path: C:\Users\simps\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\
   Shortcut name: "Start All Servers"
   Target: H:\Shared drives\Claude\Projects\jobber-mcp\start-all.bat

2. Create desktop shortcuts for all services:
   (Claude Code can recreate these with a PowerShell script — 
    see the "Desktop shortcuts" section in LYNXEDO_MASTER_REFERENCE.md for the full list)
```

---

## Step 8 — Supabase Tables (Reference)

All tables are cloud-hosted in Supabase — no restore action needed, they survive hardware failure.
This section is for reference if schema needs to be recreated from scratch.

**Multi-tenancy foundation** (added Session 25):
- `companies` — one row per subscriber. Heroes Lawn Care UUID: `00000000-0000-0000-0000-000000000002`, google_domain: `heroeslawntx.com`. All tables have a `company_id` FK → companies. RLS enforces isolation via `get_my_company_id()` function. No restore action needed — cloud-hosted.

**Timesheet tables** (added Session 22):
- `employees` — employee roster. Key columns: `id`, `company_id`, `gusto_uuid` (nullable), `user_id` (nullable FK → auth.users), `first_name`, `last_name`, `preferred_name`, `email`, `phone`, `job_title`, `department`, `pay_type`, `flsa_status`, `hourly_rate`, `is_active`, `gusto_synced_at`.
- `time_punches` — individual clock events. Columns: `company_id`, `employee_id`, `punch_type` (in/out), `punched_at`, `note`, `edit_reason`, `original_punched_at`, `lat`, `lng`.
- `time_entries` — computed daily totals. UNIQUE on `(employee_id, date)`. Columns: `company_id`, `clock_in`, `clock_out`, `total_hours`, `regular_hours`, `overtime_hours`.
- `timesheet_settings` — one row per company (UNIQUE on company_id). API queries by RLS — no hardcoded UUID needed. GPS toggle, OT thresholds, pay period config.

**`user_profiles`** has `can_access_timesheet boolean` (Session 22) and `company_id uuid` FK → companies (Session 25).

**Google OAuth** (added Session 23): After restore, verify Supabase → Authentication → Providers → Google has the Client ID and Secret entered. Get them from Google Cloud Console → APIs & Services → Credentials → the OAuth 2.0 Client named "Lynxedo" (Client ID: `212487396039-ome21bo47tkmnm5ojl1gdssgaou45cc4.apps.googleusercontent.com`). Audience must be "Internal". Authorized redirect URI must be `https://nhvwdulyzolevoeayjum.supabase.co/auth/v1/callback`. No code changes needed — this is purely a Supabase + Google Cloud Console configuration.

**Call Log coaching fields** (Session 24): Coaching feedback (grades, wins, improvements, red flags, must-listen) is intentionally NOT shown in the website Call Log UI — data lives in Supabase and is available to the spreadsheet only. The `app/call-log/page.tsx` and `app/api/calls/list/route.ts` files deliberately exclude those columns. Do not restore them to the UI.

---

## Step 9 — Verify Everything

**[Claude Code + manual check]**

```
Run "Start All" from the desktop (or reboot and let it auto-start).

Check each service:
- https://lynxedo.com          → should show Lynxedo login page
- https://mcp.lynxedo.com/mcp  → should respond (MCP server)
- https://lawn.lynxedo.com     → should show the old standalone lawn tool

Log in at https://lynxedo.com — click "Sign in with Google" and use your @heroeslawntx.com Google account
- Dashboard should show 4 tool cards (Route Optimizer, Lawn Calculator, Call Log, Responder)
- Header should show a 👥 icon (User Management) since ben@heroeslawntx.com is admin
- Route Optimizer → should load and show Jobber connect button (or connected if token still valid)
- Lawn Calculator → should accept an address and return a result
- Call Log → should load and show recent call recordings (data is in Supabase, survives machine rebuild)
- lynxedo.com/admin → should show the user list and invite form

If Jobber shows as disconnected: go to Settings → Routing → Connect Jobber → reconnect
```

---

## What Does NOT Need to Be Restored

These are cloud services — they survive any hardware failure automatically:

- **Supabase** — database, auth, user accounts all in the cloud. No action needed.
- **Cloudflare DNS** — domain routing stays in place. No action needed.
- **Jobber OAuth app** — credentials stay in Jobber Developer Portal. No action needed.
- **Resend.com** — email SMTP stays configured. No action needed.
- **Mapbox** — API tokens stay valid. No action needed.

---

## Credentials Reference

If any `.env` files are missing, here's where to find each key:

| Key | Where to Get It |
|-----|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | mapbox.com → Account → Tokens |
| `JOBBER_CLIENT_ID` | developer.getjobber.com → Lynxedo app |
| `JOBBER_CLIENT_SECRET` | developer.getjobber.com → Lynxedo app |
| `TWILIO_ACCOUNT_SID` | twilio.com → Console → Account Info |
| `TWILIO_AUTH_TOKEN` | twilio.com → Console → Account Info |
| `TWILIO_PHONE_NUMBER` | twilio.com → Phone Numbers → Manage |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `DEEPGRAM_API_KEY` | console.deepgram.com → API Keys |
| `SLACK_BOT_TOKEN` | api.slack.com → Apps → Call Recordings → OAuth |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → service_role (secret key) |
| Captivated credentials | H:\Shared drives\Claude\Projects\Captivated\.env |
| MCP server .env | H:\Shared drives\Claude\Projects\jobber-mcp\.env |

**Shortcut:** The Google Drive `.env.local` at `H:\Shared drives\Claude\Projects\App\lynxedo\.env.local` has all the Lynxedo app keys and is kept current. Start there.

---

## Notes for Claude Code

- **Never run `npm install` from a Google Drive folder** — Google Drive file locks break the installation. Always install to a local path (C:\Projects\... or %LOCALAPPDATA%\...).
- **node_modules are OS-specific** — Mac-compiled modules don't work on Windows. Always do a fresh `npm install` on the new machine.
- **After any code changes to the Lynxedo app**, always run `deploy.bat` — it copies files from Google Drive to C:\Projects, rebuilds, and restarts the server. Never edit files directly in C:\Projects.
- **The `.next` build folder** is never backed up — it gets regenerated by `npm run build`. That's normal.
