# ⛔ DEPLOYMENT LOCK

**DO NOT PUSH CODE TO RAILWAY WITHOUT EXPLICIT PERMISSION**

Rule: Paul must say "deploy" or "push" first.

Technical Enforcement:
- Pre-push hook blocks all pushes without `DCC_DEPLOY_OK=1`
- Wilson must NEVER set this env var himself

---

## Why Railway DB Safety Matters

Railway uses an **ephemeral filesystem**. Every code push triggers a rebuild that **destroys the SQLite database**. Designers actively add data on Railway between deploys. If you push code without first capturing the Railway DB, that data is permanently lost.

**Incident (2026-03-12):** A code push wiped 3 new projects added by Dewey Northington. The old backup method (JSON API snapshots) ran after the push and captured empty data. This led to the binary DB download + data drift check safeguards below.

---

## Deploy & Pull — Whole-File Sync (Updated 2026-03-12)

Data flows as a **complete SQLite file** — no table-by-table sync, no hardcoded table lists.
New tables, columns, or data are included automatically.

### Push to Railway (Local → Railway)

**ONLY when Paul explicitly says "deploy dcc" or "push dcc"**

```bash
# Full deploy (code + entire DB file):
DCC_DEPLOY_OK=1 ./scripts/deploy.sh

# Data-only (upload DB without code push):
DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data
```

**What happens:**
1. Validates `DCC_DEPLOY_OK=1` and `DCC_SEED_SECRET`
2. Stops local servers (DB file must be authoritative)
3. Shows all local table counts + runs sanity checks
4. **Downloads full Railway DB binary** to `backups/railway/pre_deploy_*/shared.db`
   - Validates SQLite magic bytes + integrity check
   - **If download fails, deploy is ABORTED** (no data loss possible)
5. **Data drift check** — compares row counts for critical tables (projects, team, assignments, users, business_lines, holidays)
   - **If Railway has MORE rows than local, deploy is BLOCKED**
   - Message: "Run `./scripts/pull-from-railway.sh` first"
6. Pushes code to GitHub (skipped with `--data`)
7. Waits for Railway rebuild (up to 5 minutes)
8. Uploads entire `data/shared.db` to Railway via `POST /api/upload-db`
9. Verifies every table count matches local

### Pull from Railway (Railway → Local)

**Step 1: Turn maintenance ON** (prevents designers from saving data during pull):
```bash
./scripts/maintenance.sh on
```

**Step 2: Pull:**
```bash
./scripts/pull-from-railway.sh
```

**What happens:**
1. Stops local servers (API on :3001 and Vite on :5173) — **must stop before replacing DB**
2. Backs up local DB to `backups/local/pre_pull_*`
3. Downloads entire SQLite file from Railway via `GET /api/download-db`
4. Validates SQLite magic bytes and integrity
5. Replaces local `data/shared.db`
6. Restarts API server (:3001) and Vite dev server (:5173)
7. Site is ready at http://localhost:5173

**Step 3: Turn maintenance OFF:**
```bash
./scripts/maintenance.sh off
```

**CRITICAL:** Never modify `data/shared.db` while the API server is running. The server holds the DB in memory and will overwrite the file on any write. Always use pull/deploy scripts which handle server lifecycle.

### Safe Deploy Workflow (Full Checklist)

```
1. maintenance.sh on            ← Block designers from editing
2. merge-railway.sh             ← Download Railway DB, merge into local
3. Make local code changes       ← Edit, test on localhost:5173
4. [optional] notes sync         ← curl -X POST localhost:3001/api/notes/sync
5. Bump SITE_VERSION in server.ts
6. git commit
7. DCC_DEPLOY_OK=1 deploy.sh    ← Backup, containment check, push, upload
8. maintenance.sh off            ← Unblock designers
```

**If you already have local changes before merging:**
```
1. maintenance.sh on
2. merge-railway.sh             ← Railway data merged INTO your local DB
3. Test locally                  ← Verify nothing broke
4. [optional] notes sync
5. deploy.sh                     ← Containment check ensures Railway data is in local
6. maintenance.sh off
```

**merge-railway.sh can be run with `--dry` to preview without changing anything.**

### Authentication
All endpoints use `X-Seed-Secret` header (from `DCC_SEED_SECRET` env var in `~/.openclaw/.env` and Railway).

---

## Command Reference

| Command | Purpose |
|---------|---------|
| `./scripts/maintenance.sh on` | Turn maintenance ON (block designers) |
| `./scripts/maintenance.sh off` | Turn maintenance OFF |
| `./scripts/maintenance.sh status` | Check maintenance state |
| `./scripts/merge-railway.sh` | Merge Railway data into local (REQUIRED before deploy) |
| `./scripts/merge-railway.sh --dry` | Preview merge diff without changing anything |
| `./scripts/pull-from-railway.sh` | Download Railway DB to local (full replace, not merge) |
| `DCC_DEPLOY_OK=1 ./scripts/deploy.sh` | Push code + DB to Railway (with containment check) |
| `DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data` | Push DB only (no code) |

---

## Safety Mechanisms

| Guard | What It Does | Added |
|-------|-------------|-------|
| Pre-push hook | Blocks push without `DCC_DEPLOY_OK=1` and version bump | 2026-03-05 |
| Binary DB backup | Downloads full Railway SQLite before push. Aborts if download fails. | 2026-03-12 |
| Containment check | Verifies every Railway row ID exists in local DB. Blocks deploy if any missing. | 2026-03-12 |
| merge-railway.sh | Merges Railway data into local: Railway wins for user tables, local wins for computed. | 2026-03-12 |
| Sanity check | Validates local row counts are within expected ranges before upload. | 2026-03-10 |
| Integrity check | Validates SQLite magic bytes + `PRAGMA integrity_check` on all downloads/uploads. | 2026-03-10 |

---

## Backups

| Location | Contains | Created By |
|----------|----------|------------|
| `backups/railway/pre_deploy_*/shared.db` | Full Railway DB binary before deploy | `deploy.sh` |
| `backups/local/pre_pull_*/shared.db` | Full local DB before pull | `pull-from-railway.sh` |

Latest pre-deploy backup path: `cat backups/railway/LATEST_PRE_DEPLOY`

---

## ⚠️ LEGACY SCRIPTS — NEVER USE

These scripts use table-by-table sync via `/api/seed` and **cause data corruption** (duplicate notes, missing tables, lost hidden flags):

| Script | Status |
|--------|--------|
| `dcc-data-workflow.sh` | ❌ DEPRECATED — causes corruption |
| `dcc-push-to-railway.sh` | ❌ DEPRECATED — causes corruption |
| `sync-to-railway-safe.sh` | ❌ DEPRECATED — causes corruption |
| `sync-to-railway.sh` | ❌ DEPRECATED — causes corruption |
| `dcc-sync.sh` | ❌ DEPRECATED — causes corruption |
| `dcc-verify-sync.sh` | ❌ DEPRECATED — use deploy.sh verification |
| `verify-railway-sync.sh` | ❌ DEPRECATED — use deploy.sh verification |

The `/api/seed` endpoint still exists for backwards compatibility but **must not be used** for deployment.

---

## Emergency Recovery

### Bad data pushed to Railway
```bash
# Find the backup:
cat backups/railway/LATEST_PRE_DEPLOY
# Copy the backup DB to local:
cp backups/railway/pre_deploy_<timestamp>/shared.db data/shared.db
# Re-upload:
DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data
```

### Bad data pulled to local
```bash
# Restore from backup:
cp backups/local/pre_pull_<timestamp>/shared.db data/shared.db
# Restart local server
```

### Railway DB wiped by code push (no backup captured)
Data is unrecoverable. This is why the deploy script now downloads the Railway DB
**before** pushing code — so this scenario cannot happen if you use `deploy.sh`.

---

Created: 2026-03-05 after repeated deployment violations
Updated: 2026-03-10 — whole-file sync replaces table-by-table
Updated: 2026-03-12 — binary DB backup before push, data drift check, maintenance.sh script
