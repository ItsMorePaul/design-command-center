# ⛔ DEPLOYMENT LOCK

**DO NOT PUSH CODE TO RAILWAY WITHOUT EXPLICIT PERMISSION**

Rule: Paul must say "deploy" or "push" first.

Technical Enforcement:
- Pre-push hook blocks all pushes without `DCC_DEPLOY_OK=1`
- Wilson must NEVER set this env var himself

---

## Deploy & Pull — Whole-File Sync (Updated 2026-03-10)

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
2. Shows all local table counts
3. Backs up Railway data to `backups/railway/pre_deploy_*`
4. Pushes code to GitHub (skipped with `--data`)
5. Waits for Railway rebuild
6. Uploads entire `data/shared.db` to Railway via `POST /api/upload-db`
7. Verifies every table count matches local

### Pull from Railway (Railway → Local)

```bash
./scripts/pull-from-railway.sh
```

**What happens:**
1. Backs up local DB to `backups/local/pre_pull_*`
2. Downloads entire SQLite file from Railway via `GET /api/download-db`
3. Validates SQLite magic bytes and integrity
4. Replaces local `data/shared.db`
5. **Restart local server** to pick up new data

### Authentication
Both endpoints use `X-Seed-Secret` header (from `DCC_SEED_SECRET` env var in `~/.openclaw/.env` and Railway).

---

## Command Reference

| Command | Purpose |
|---------|---------|
| `DCC_DEPLOY_OK=1 ./scripts/deploy.sh` | Push code + DB to Railway |
| `DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data` | Push DB only (no code) |
| `./scripts/pull-from-railway.sh` | Download Railway DB to local |

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
# Backups are in backups/railway/pre_deploy_<timestamp>/
# Re-upload a known-good local DB:
DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data
```

### Bad data pulled to local
```bash
# Backups are in backups/local/pre_pull_<timestamp>/
cp backups/local/pre_pull_<timestamp>/shared.db data/shared.db
# Restart local server
```

---

Created: 2026-03-05 after repeated deployment violations
Updated: 2026-03-10 — whole-file sync replaces table-by-table
