# Lynxedo VPS Migration — Setup Notes

**Created:** May 13, 2026 (Cowork session)
**Status:** VPS provisioned. Software install pending (separate Claude Code session).

---

## Hetzner VPS — Provisioned

| Field | Value |
|---|---|
| **Public IPv4** | **5.78.42.57** |
| Provider | Hetzner Cloud |
| Project | Lynxedo-old |
| Server name | `lynxedo-prod` |
| Location | Hillsboro, OR (us-west) |
| Plan | **CCX13** (2 vCPU AMD dedicated / 8 GB RAM / 80 GB SSD / 1 TB traffic) |
| OS | Ubuntu 24.04 LTS |
| Backups | ✅ Enabled (daily, 20% surcharge) |
| Monthly cost | $24.59/mo ($19.99 server + $4.00 backups + $0.60 IPv4) |

### Plan note
CCX13 is dedicated CPU (General Purpose tier) — no shared CPU contention. 8GB RAM comfortably handles `npm run build` + Playwright + Node MCP + Python running simultaneously. Previous server (CPX21, 4GB shared, Ashburn) has been replaced — delete it from the Hetzner dashboard to stop billing.


### SSH key
- **Key name in Hetzner:** Ben Windows
- **Private key on Windows machine:** `C:\Users\simps\.ssh\id_ed25519`
- **Public key fingerprint** (`ben@lynxedo-vps`): `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA1yXacjZ34qfHJVGJ1dMUyi7SjHA7nmiWTKmXZ5x073`
- **Generator script:** `H:\Shared drives\Claude\Projects\App\lynxedo\generate-ssh-key.ps1`

### First connect command (run from PowerShell on Ben's Windows machine)
```
ssh root@5.78.42.57
```
First connect will ask to confirm the host fingerprint — type `yes`.

---

## Cloudflare R2

**Status:** ✅ Enabled May 13, 2026 (Cowork session).

Planned use: object storage for migration backups, future call recordings overflow, lawn satellite tile cache. Free tier: 10 GB storage + 1M Class A ops/month.

No buckets created yet — next Claude Code session will create buckets as needed (e.g. `lynxedo-backups`, `lynxedo-recordings-archive`).

**To get R2 API credentials** when needed: Cloudflare dashboard → R2 → Manage R2 API Tokens → Create API token. Generate an Account ID + Access Key ID + Secret Access Key. Save to `.env.local` as `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

---

## UptimeRobot

**Status:** ✅ Enabled May 13, 2026 (Cowork session).

- One HTTPS monitor on `https://lynxedo.com`
- 5-minute interval
- Email alerts to Ben's default contact
- Free tier (50 monitors max, 5-min interval)

After migration, add monitors for:
- `https://mcp.lynxedo.com` (port 3001 service)
- `https://lawn.lynxedo.com` (port 8000 service)
- Optional: keyword-check monitor that hits `/api/health` and looks for "ok" string

---

## What the next Claude Code session needs to do

This document tracks what's been provisioned. The actual migration work — installing Node.js + Python + cloudflared (Cloudflare Tunnel) on the VPS, copying files, and configuring services — is a separate Claude Code session.

**Decision confirmed:** We are keeping the existing Cloudflare Tunnel (NOT switching to Nginx). The tunnel is already working for `mcp.lynxedo.com`, SSL is handled by Cloudflare automatically, and no ports need to be opened on the VPS. Same tunnel ID, just reinstalled on Linux instead of Windows. No DNS changes needed.

When starting that session, read:
- `H:\Shared drives\Claude\Projects\App\LYNXEDO_MASTER_REFERENCE.md` — full platform context
- `H:\Shared drives\Claude\Projects\App\lynxedo\CLAUDE.md` — standing rules
- `H:\Shared drives\Claude\Projects\App\VPS_MIGRATION_GUIDE.md` — full migration guide
- This file — for VPS connection details

### Migration-day rough checklist (for the next session, not for now)
1. SSH in as root with the key above
2. Create non-root user, disable root SSH login, install ufw, fail2ban (only port 22 open — Cloudflare Tunnel handles all web traffic)
3. Install Node.js 22+, Python 3.12+, Git, PM2, rclone
4. Install cloudflared + copy tunnel credentials JSON → register as systemd service
5. Clone the Lynxedo app from GitHub → `/opt/lynxedo/app/`; copy other projects from Google Drive
6. Update all hardcoded Windows paths → Linux equivalents (see VPS_MIGRATION_GUIDE.md mapping table)
7. Copy all `.env` files from Google Drive backups to VPS
8. Fresh `npm install` + Python venv install (Linux-compatible binaries)
9. Set up PM2 for Node.js services; systemd for Cloudflare Tunnel + Python lawn tool
10. Set up cron jobs: Unitel script + healthcheck + nightly R2 backup
11. Transfer all existing call recordings from Google Drive → `/data/call-recordings/` on VPS; verify file count
12. `npm run build` the Lynxedo app
13. Set up GitHub Actions auto-deploy — generate deploy key on VPS, add secrets to GitHub repo, create `.github/workflows/deploy.yml`, push to confirm it works (see VPS_MIGRATION_GUIDE.md for full steps)
13. Run the post-migration verification checklist (see VPS_MIGRATION_GUIDE.md)
14. Monitor for 24 hours — confirm scheduled tasks fire, Slack alerts work, call recordings flow
15. Decommission Windows services (stop bat files, disable scheduled tasks — don't delete yet)
