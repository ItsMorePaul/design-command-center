# ⛔ DEPLOYMENT LOCK

**DO NOT PUSH CODE TO RAILWAY WITHOUT EXPLICIT PERMISSION**

Rule: Paul must say "deploy" or "push" first.

Technical Enforcement:
- Pre-push hook blocks all pushes without `DCC_DEPLOY_OK=1`
- Wilson must NEVER set this env var himself

Violation History: 4+ code deployment violations. Paul is rightfully furious.

---

## 🆕 NEW WORKFLOW: 3-Phase Bidirectional Sync (March 6, 2026)

### The Problem
Old workflow had dangerous gaps:
- Pulling from Railway **overwrote** local data (no merge)
- Pushing to Railway **overwrote** Railway data (no backup verification)
- No way to preview changes before destructive operations
- No rollback after local changes were pulled over

### The Solution
**3-Phase workflow:** Pull → Work → Push
Each phase has safeguards, backups, and verification.

---

## Phase 1: PULL (Railway → Local)

Designers enter data online. You pull it locally to review/merge.

```bash
cd ~/.openclaw/workspace/work/design-command-center

# Step 1: Check current state
./scripts/dcc-data-workflow.sh status

# Step 2: Preview what will change
./scripts/dcc-data-workflow.sh preview

# Step 3: Pull (auto-creates backup)
./scripts/dcc-data-workflow.sh pull
```

**What happens:**
1. Local DB is backed up to `backups/local/`
2. Railway data is fetched via API
3. Local SQLite is overwritten with Railway data
4. Post-pull backup is created
5. **Undo available:** Run the restore script if needed

**Safety:** Your local state is backed up BEFORE the pull. If something goes wrong:
```bash
# Undo the pull
./backups/local/<timestamp>_pre_pull/restore.sh
```

---

## Phase 2: LOCAL WORK

You work locally, make changes, verify everything.

```bash
# Make local changes (edit via UI or directly in SQLite)
# ...

# Create manual backup before big changes
./scripts/dcc-data-workflow.sh backup
```

**Important:** Local changes accumulate until you're ready to push.

---

## Phase 3: PUSH (Local → Railway)

**ONLY when Paul explicitly says "deploy dcc" or "push dcc"**

Wilson will execute:
```bash
./scripts/dcc-push-to-railway.sh
```

**What happens:**
1. Verify `DCC_DEPLOY_OK=1` (enforced by pre-push hook)
2. Create Railway backup (`backups/railway/pre_deploy_*`)
3. Show deployment preview (counts, differences)
4. Push code to GitHub (Railway auto-deploys)
5. Sync data via `/api/seed`
6. Verify deployment (health checks, data counts)

**Safety:** Railway state is backed up BEFORE push. If something goes wrong:
```bash
# Restore Railway to pre-deploy state
./backups/railway/pre_deploy_<timestamp>/restore_railway.sh
```

---

## Command Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `./scripts/dcc-data-workflow.sh status` | Show Railway vs Local comparison | Anytime |
| `./scripts/dcc-data-workflow.sh preview` | Preview changes before pull | Before pulling |
| `./scripts/dcc-data-workflow.sh pull` | Pull Railway data (with backup) | Phase 1 |
| `./scripts/dcc-data-workflow.sh backup` | Create manual local backup | Phase 2 |
| `./scripts/dcc-data-workflow.sh restore <path>` | Restore from backup | Recovery |
| `./scripts/dcc-push-to-railway.sh` | Deploy code + data | Phase 3 (Paul approves) |

---

## Legacy Scripts (Deprecated)

| Script | Status | Why |
|--------|--------|-----|
| `pull-from-railway.sh` | ⚠️ Legacy | Use `dcc-data-workflow.sh pull` instead (has backups) |
| `sync-to-railway-safe.sh` | ⚠️ Legacy | Use `dcc-push-to-railway.sh` instead (integrated workflow) |
| `backup-railway.sh` | ✅ Still used | Called internally by new scripts |

---

## Database Migration Rules

### Rule 1: Local is NOT source of truth
Railway production DB is the canonical source. Local is a working copy.

### Rule 2: Bidirectional sync requires explicit phases
- Pull: Railway → Local (设计师工作在线，你拉到本地)
- Work: Local only (你本地编辑)
- Push: Local → Railway (你确认后推回去)

### Rule 3: Every destructive operation has backup
- Pull: Local backed up first
- Push: Railway backed up first

### Rule 4: Verify after every sync
Always run verification commands to confirm data integrity.

---

## Verification Commands

After ANY operation, verify:

```bash
# Check Railway health
curl -s https://design-command-center-production.up.railway.app/api/health | jq

# Check assignment counts
echo "Railway: $(curl -s $RAILWAY_URL/api/capacity | jq '.assignments | length')"
echo "Local: $(sqlite3 data/shared.db 'SELECT COUNT(*) FROM project_assignments;')"

# Check Fariah's data (critical)
curl -s $RAILWAY_URL/api/capacity | jq '.assignments[] | select(.designer_name | contains("Fariah"))'

# Full sync verification
./scripts/verify-railway-sync.sh
```

---

## Emergency Recovery

### Scenario: Pulled bad data from Railway
```bash
# Restore local to pre-pull state
./backups/local/<timestamp>_pre_pull/restore.sh
```

### Scenario: Pushed bad data to Railway
```bash
# Restore Railway to pre-deploy state
./backups/railway/pre_deploy_<timestamp>/restore_railway.sh
```

### Scenario: Need to rollback code
```bash
# Deploy specific commit to Railway
git push origin <commit-hash>:main --force
# Note: This rolls back CODE but not DATABASE
```

---

## Created: 2026-03-05 after repeated violations
## Updated: 2026-03-06 with 3-phase bidirectional workflow
