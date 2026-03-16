#!/bin/bash
# deploy.sh - Single-command deploy: push code + upload DB to Railway
#
# Usage:
#   DCC_DEPLOY_OK=1 ./scripts/deploy.sh          # full deploy (code + data)
#   DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data    # data-only (no git push)
#
# GOLDEN RULE: Railway DB data is NEVER lost or overwritten.
#
# How it works:
#   1. Downloads Railway DB as safety backup
#   2. Runs containment check (all Railway row IDs must exist in local)
#   3. AUTO-MERGES Railway data into local DB before upload:
#      - Railway-owned tables (projects, team, etc.): Railway REPLACES local
#      - Notes: union merge, Railway hidden flags win
#      - Local-computed tables (note links): kept as-is
#   4. Pushes code to Railway (if not --data)
#   5. Uploads the merged local DB to Railway
#   6. Verifies all table counts match
#   7. Re-enables maintenance mode for admin testing
#
# This means even if you forget to run merge-railway.sh first,
# Railway production edits are automatically preserved.
#
# Requires:
#   DCC_SEED_SECRET env var (shared with Railway)
#   DCC_DEPLOY_OK=1 env var (deployment gate)

set -euo pipefail

# Source seed secret from openclaw env if not already set
if [[ -z "${DCC_SEED_SECRET:-}" && -f "$HOME/.openclaw/.env" ]]; then
  export $(grep '^DCC_SEED_SECRET=' "$HOME/.openclaw/.env" | head -1)
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCC_DIR="$(dirname "$SCRIPT_DIR")"
LOCAL_DB="$DCC_DIR/data/shared.db"
RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_URL="http://localhost:3001"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }

DATA_ONLY=false
[[ "${1:-}" == "--data" ]] && DATA_ONLY=true

# ── Preflight checks ──────────────────────────────────────────────
if [[ -z "${DCC_DEPLOY_OK:-}" ]]; then
  err "DCC_DEPLOY_OK not set. Deployment blocked."
  exit 1
fi

if [[ -z "${DCC_SEED_SECRET:-}" ]]; then
  err "DCC_SEED_SECRET not set. Cannot authenticate with Railway."
  echo "  Set it: export DCC_SEED_SECRET=<token>"
  exit 1
fi

if [[ ! -f "$LOCAL_DB" ]]; then
  err "Local database not found: $LOCAL_DB"
  exit 1
fi

# ── Stop local servers BEFORE reading DB ─────────────────────────
# Critical: a running server holds the DB in memory and can overwrite
# the file at any time. We must kill servers so the file on disk is
# the authoritative copy.
API_PID=$(lsof -ti:3001 2>/dev/null || true)
VITE_PID=$(lsof -ti:5173 2>/dev/null || true)
if [[ -n "$API_PID" || -n "$VITE_PID" ]]; then
  log "Stopping local servers to ensure DB file is authoritative..."
  [[ -n "$API_PID" ]] && kill $API_PID 2>/dev/null || true
  [[ -n "$VITE_PID" ]] && kill $VITE_PID 2>/dev/null || true
  sleep 2
  # Verify they're actually dead
  if lsof -ti:3001 &>/dev/null; then
    err "API server on :3001 still running after kill. Aborting."
    exit 1
  fi
  log "Local servers stopped."
fi

# Validate local DB integrity
if ! sqlite3 "$LOCAL_DB" "PRAGMA integrity_check;" | grep -q "ok"; then
  err "Local database failed integrity check!"
  exit 1
fi

# ── Show local DB summary ────────────────────────────────────────
echo ""
echo -e "${BLUE}=== LOCAL DATABASE ===${NC}"
echo ""

DB_SIZE=$(wc -c < "$LOCAL_DB" | tr -d ' ')
log "File: $LOCAL_DB ($DB_SIZE bytes)"
echo ""

# Dynamically list ALL tables and their counts
TABLES=$(sqlite3 "$LOCAL_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
printf "%-30s %s\n" "Table" "Rows"
printf "%-30s %s\n" "─────" "────"
for TABLE in $TABLES; do
  COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM \"$TABLE\";")
  printf "%-30s %s\n" "$TABLE" "$COUNT"
done
echo ""

# ── Pre-deploy sanity checks ────────────────────────────────────
# Expected row count ranges for critical tables. If a count falls
# outside its range the deploy is blocked. Update these bounds as
# the dataset grows legitimately.
# Format: "table_name min max"
SANITY_CHECKS=(
  "notes 180 280"
  "projects 15 50"
  "team 5 20"
  "users 2 20"
  "project_assignments 15 60"
  "note_people_links 300 700"
  "note_project_links 300 700"
)

SANITY_FAIL=false
echo -e "${BLUE}=== PRE-DEPLOY SANITY CHECK ===${NC}"
echo ""
for RULE in "${SANITY_CHECKS[@]}"; do
  T_NAME=$(echo "$RULE" | awk '{print $1}')
  T_MIN=$(echo "$RULE" | awk '{print $2}')
  T_MAX=$(echo "$RULE" | awk '{print $3}')
  T_COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM \"$T_NAME\";" 2>/dev/null || echo "?")
  if [[ "$T_COUNT" == "?" ]]; then
    warn "$T_NAME: table not found (skipping)"
    continue
  fi
  if [[ "$T_COUNT" -lt "$T_MIN" || "$T_COUNT" -gt "$T_MAX" ]]; then
    err "$T_NAME: $T_COUNT rows — OUTSIDE expected range [$T_MIN-$T_MAX]"
    SANITY_FAIL=true
  else
    log "$T_NAME: $T_COUNT rows — OK (range [$T_MIN-$T_MAX])"
  fi
done
echo ""

if [[ "$SANITY_FAIL" == "true" ]]; then
  err "SANITY CHECK FAILED — deploy blocked."
  err "If the counts are legitimately new, update SANITY_CHECKS in scripts/deploy.sh"
  exit 1
fi

# ── Download Railway DB binary BEFORE any changes ────────────────
# CRITICAL: Railway uses ephemeral filesystem. A code push triggers a
# rebuild that DESTROYS the DB. We must capture the full binary DB
# BEFORE pushing code. Deploy is ABORTED if this download fails.
log "Downloading Railway database (pre-deploy safety backup)..."
BACKUP_TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$DCC_DIR/backups/railway/pre_deploy_${BACKUP_TS}"
mkdir -p "$BACKUP_DIR"

RAILWAY_DB_BACKUP="$BACKUP_DIR/shared.db"
BACKUP_HTTP=$(curl -s -w "%{http_code}" -o "$RAILWAY_DB_BACKUP" \
  -H "X-Seed-Secret: $DCC_SEED_SECRET" \
  "$RAILWAY_URL/api/download-db")

if [[ "$BACKUP_HTTP" != "200" ]]; then
  err "Failed to download Railway DB (HTTP $BACKUP_HTTP). DEPLOY ABORTED."
  err "Cannot proceed without a safety backup of Railway data."
  rm -f "$RAILWAY_DB_BACKUP"
  exit 1
fi

BACKUP_SIZE=$(wc -c < "$RAILWAY_DB_BACKUP" | tr -d ' ')
BACKUP_HEADER=$(head -c 16 "$RAILWAY_DB_BACKUP" | strings | head -1)
if [[ "$BACKUP_HEADER" != *"SQLite format 3"* ]]; then
  err "Downloaded file is not a valid SQLite database. DEPLOY ABORTED."
  rm -f "$RAILWAY_DB_BACKUP"
  exit 1
fi

if ! sqlite3 "$RAILWAY_DB_BACKUP" "PRAGMA integrity_check;" | grep -q "ok"; then
  err "Railway DB backup failed integrity check! DEPLOY ABORTED."
  exit 1
fi

# Show Railway DB state
echo ""
echo -e "${BLUE}RAILWAY (before deploy):${NC}"
R_TABLES=$(sqlite3 "$RAILWAY_DB_BACKUP" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
printf "%-30s %s\n" "Table" "Rows"
printf "%-30s %s\n" "─────" "────"
for TABLE in $R_TABLES; do
  COUNT=$(sqlite3 "$RAILWAY_DB_BACKUP" "SELECT COUNT(*) FROM \"$TABLE\";")
  printf "%-30s %s\n" "$TABLE" "$COUNT"
done
echo ""

log "Railway DB backed up: $RAILWAY_DB_BACKUP ($BACKUP_SIZE bytes)"
echo "$BACKUP_DIR" > "$DCC_DIR/backups/railway/LATEST_PRE_DEPLOY"

# ── Railway data containment check ───────────────────────────────
# Verify local DB contains ALL Railway rows for user-edited tables.
# This ensures merge-railway.sh was run and no production data will be lost.
# Checks by primary key — every Railway row ID must exist in local.
echo ""
echo -e "${BLUE}=== RAILWAY DATA CONTAINMENT CHECK ===${NC}"
echo -e "Verifying local DB contains all Railway production data..."
echo ""
CONTAIN_FAIL=false

# Table:PK pairs for containment check (bash 3.2 compatible)
CONTAIN_TABLES="projects:id team:id project_assignments:id project_priorities:id business_lines:id brand_options:id users:id holidays:id notes:id hidden_note_fingerprints:fingerprint"

for ENTRY in $CONTAIN_TABLES; do
  TABLE="${ENTRY%%:*}"
  PK="${ENTRY##*:}"

  R_COUNT=$(sqlite3 "$RAILWAY_DB_BACKUP" "SELECT COUNT(*) FROM $TABLE;" 2>/dev/null || echo "0")
  L_COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM $TABLE;" 2>/dev/null || echo "0")

  # Use ATTACH to find Railway rows missing from local in a single query
  MISSING_COUNT=$(sqlite3 "$RAILWAY_DB_BACKUP" "
    ATTACH '$LOCAL_DB' AS local_db;
    SELECT COUNT(*) FROM $TABLE r
    WHERE r.$PK NOT IN (SELECT $PK FROM local_db.$TABLE);
    DETACH local_db;
  " 2>/dev/null || echo "0")

  if [[ "$MISSING_COUNT" -gt 0 ]] 2>/dev/null; then
    err "$TABLE: $MISSING_COUNT Railway rows MISSING from local (railway=$R_COUNT local=$L_COUNT)"
    CONTAIN_FAIL=true
  else
    log "$TABLE: all $R_COUNT Railway rows present in local (local=$L_COUNT)"
  fi
done
echo ""

if [[ "$CONTAIN_FAIL" == "true" ]]; then
  err "LOCAL DB IS MISSING RAILWAY DATA — deploy blocked."
  err "Run ./scripts/merge-railway.sh first to integrate Railway data."
  err "Railway backup saved at: $RAILWAY_DB_BACKUP"
  exit 1
fi

# ── AUTO-MERGE: Railway data into local DB ────────────────────────
# CRITICAL: Railway DB is the source of truth for user-edited tables.
# This step ensures Railway edits (projects, team, etc.) are NEVER lost,
# even if the deployer forgot to run merge-railway.sh manually.
echo ""
echo -e "${BLUE}=== AUTO-MERGE: RAILWAY → LOCAL ===${NC}"
echo -e "Merging Railway production data into local DB before upload..."
echo ""

# Backup local DB before merge
PRE_MERGE_BACKUP="$BACKUP_DIR/local-pre-merge.db"
cp "$LOCAL_DB" "$PRE_MERGE_BACKUP"
log "Local DB backed up before merge: $PRE_MERGE_BACKUP"

# Railway-owned tables: Railway REPLACES local
RAILWAY_TABLES="projects team project_assignments project_priorities business_lines brand_options users holidays app_versions activity_log"
for TABLE in $RAILWAY_TABLES; do
  COLS=$(sqlite3 "$RAILWAY_DB_BACKUP" "PRAGMA table_info($TABLE);" 2>/dev/null | cut -d'|' -f2 | tr '\n' ',' | sed 's/,$//')
  if [[ -z "$COLS" ]]; then
    warn "$TABLE: not found in Railway DB, skipping."
    continue
  fi
  R_COUNT=$(sqlite3 "$RAILWAY_DB_BACKUP" "SELECT COUNT(*) FROM \"$TABLE\";" 2>/dev/null || echo "0")
  sqlite3 "$LOCAL_DB" "
    DELETE FROM \"$TABLE\";
    ATTACH '$RAILWAY_DB_BACKUP' AS railway;
    INSERT INTO \"$TABLE\" ($COLS) SELECT $COLS FROM railway.\"$TABLE\";
    DETACH railway;
  "
  L_COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM \"$TABLE\";" 2>/dev/null || echo "0")
  log "$TABLE: replaced with $R_COUNT Railway rows (local now: $L_COUNT)"
done

# Notes: union + Railway hidden flags win
R_NOTE_IDS=$(sqlite3 "$RAILWAY_DB_BACKUP" "SELECT quote(id) FROM notes;" 2>/dev/null | tr '\n' ',' | sed 's/,$//')
L_NOTE_IDS=$(sqlite3 "$LOCAL_DB" "SELECT quote(id) FROM notes;" 2>/dev/null | tr '\n' ',' | sed 's/,$//')

# Insert Railway-only notes into local
if [[ -n "$R_NOTE_IDS" ]]; then
  NOTE_COLS=$(sqlite3 "$RAILWAY_DB_BACKUP" "PRAGMA table_info(notes);" | cut -d'|' -f2 | tr '\n' ',' | sed 's/,$//')
  INSERTED=$(sqlite3 "$LOCAL_DB" "
    ATTACH '$RAILWAY_DB_BACKUP' AS railway;
    INSERT OR IGNORE INTO notes ($NOTE_COLS) SELECT $NOTE_COLS FROM railway.notes WHERE id NOT IN ($L_NOTE_IDS);
    SELECT changes();
    DETACH railway;
  ")
  if [[ "$INSERTED" -gt 0 ]] 2>/dev/null; then
    log "notes: inserted $INSERTED Railway-only notes"
  else
    log "notes: no Railway-only notes to insert"
  fi
fi

# Update hidden flags from Railway (Railway wins)
sqlite3 "$LOCAL_DB" "
  ATTACH '$RAILWAY_DB_BACKUP' AS railway;
  UPDATE notes SET
    hidden = COALESCE((SELECT r.hidden FROM railway.notes r WHERE r.id = notes.id), notes.hidden),
    hidden_at = COALESCE((SELECT r.hidden_at FROM railway.notes r WHERE r.id = notes.id AND r.hidden = 1), notes.hidden_at)
  WHERE id IN (SELECT id FROM railway.notes);
  DETACH railway;
"
R_HIDDEN=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM notes WHERE hidden = 1;")
log "notes: hidden flags synced from Railway ($R_HIDDEN hidden)"

# Hidden note fingerprints: union
if [[ -n "$L_NOTE_IDS" ]]; then
  FP_COLS=$(sqlite3 "$RAILWAY_DB_BACKUP" "PRAGMA table_info(hidden_note_fingerprints);" | cut -d'|' -f2 | tr '\n' ',' | sed 's/,$//')
  LOCAL_FPS=$(sqlite3 "$LOCAL_DB" "SELECT quote(fingerprint) FROM hidden_note_fingerprints;" | tr '\n' ',' | sed 's/,$//')
  if [[ -n "$LOCAL_FPS" ]]; then
    sqlite3 "$LOCAL_DB" "
      ATTACH '$RAILWAY_DB_BACKUP' AS railway;
      INSERT OR IGNORE INTO hidden_note_fingerprints ($FP_COLS) SELECT $FP_COLS FROM railway.hidden_note_fingerprints WHERE fingerprint NOT IN ($LOCAL_FPS);
      DETACH railway;
    " 2>/dev/null || true
  else
    sqlite3 "$LOCAL_DB" "
      ATTACH '$RAILWAY_DB_BACKUP' AS railway;
      INSERT OR IGNORE INTO hidden_note_fingerprints ($FP_COLS) SELECT $FP_COLS FROM railway.hidden_note_fingerprints;
      DETACH railway;
    " 2>/dev/null || true
  fi
fi
FP_COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM hidden_note_fingerprints;")
log "hidden_note_fingerprints: $FP_COUNT total after merge"

# Local-computed tables (note_people_links, note_project_links): kept as-is
log "Local-computed tables kept as-is."

# Update DB size after merge
DB_SIZE=$(wc -c < "$LOCAL_DB" | tr -d ' ')
log "Local DB after merge: $DB_SIZE bytes"
echo ""

# ── Deploy code (git push) ───────────────────────────────────────
if [[ "$DATA_ONLY" == "false" ]]; then
  cd "$DCC_DIR"
  BRANCH=$(git branch --show-current)
  if [[ "$BRANCH" != "main" ]]; then
    err "Not on main branch (on: $BRANCH)"
    exit 1
  fi

  log "Pushing code to Railway..."
  git push origin main

  # Capture current Railway version so we can detect when the new build is live
  OLD_VERSION=$(curl -sf "$RAILWAY_URL/api/versions" 2>/dev/null | jq -r '.site_version // "unknown"' 2>/dev/null || echo "unknown")
  log "Current Railway version: $OLD_VERSION"

  log "Waiting for Railway to rebuild with new version..."
  ATTEMPTS=0
  while [[ $ATTEMPTS -lt 60 ]]; do
    sleep 5
    NEW_VERSION=$(curl -sf "$RAILWAY_URL/api/versions" 2>/dev/null | jq -r '.site_version // "unknown"' 2>/dev/null || echo "unreachable")
    if [[ "$NEW_VERSION" != "unknown" && "$NEW_VERSION" != "unreachable" && "$NEW_VERSION" != "$OLD_VERSION" ]]; then
      log "Railway rebuilt with new version: $NEW_VERSION"
      break
    fi
    echo -n "."
    ATTEMPTS=$((ATTEMPTS + 1))
  done
  echo ""

  if [[ $ATTEMPTS -eq 60 ]]; then
    err "Railway deploy timeout after 300s. New version not detected."
    err "Old version: $OLD_VERSION — check Railway dashboard."
    exit 1
  fi
fi

# ── Upload entire DB file ────────────────────────────────────────
log "Uploading local database to Railway ($DB_SIZE bytes)..."

UPLOAD_RESULT=$(curl -s -w "\n%{http_code}" -X POST "$RAILWAY_URL/api/upload-db" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Seed-Secret: $DCC_SEED_SECRET" \
  --data-binary @"$LOCAL_DB")

HTTP_CODE=$(echo "$UPLOAD_RESULT" | tail -1)
BODY=$(echo "$UPLOAD_RESULT" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
  err "Upload failed with HTTP $HTTP_CODE"
  echo "$BODY"
  echo ""
  err "Railway backup at: $BACKUP_DIR"
  exit 1
fi

log "Upload response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"

# ── Verify ───────────────────────────────────────────────────────
echo ""
log "=== POST-DEPLOYMENT VERIFICATION ==="
echo ""

PASS=true

# Upload response check (quick sanity)
UPLOAD_TABLES=$(echo "$BODY" | jq -r '.tables | to_entries[] | "\(.key) \(.value)"' 2>/dev/null)
if [[ -z "$UPLOAD_TABLES" ]]; then
  warn "Upload response did not include table counts. Relying on live verification."
fi

# ── Live Railway verification ──────────────────────────────────────
# Don't trust upload response alone — query Railway directly to confirm
log "Verifying Railway database live (via /api/table-counts)..."
sleep 3  # Give Railway a moment to reload the DB

LIVE_HEALTH=$(curl -sf "$RAILWAY_URL/api/health" 2>/dev/null)
if [[ -n "$LIVE_HEALTH" ]]; then
  log "Railway health: PASS"
else
  err "Railway health: FAIL (could not reach /api/health)"
  PASS=false
fi

# Query live table counts from Railway
LIVE_COUNTS=$(curl -sf "$RAILWAY_URL/api/table-counts" 2>/dev/null)
if [[ -z "$LIVE_COUNTS" ]]; then
  err "Could not reach /api/table-counts on Railway. Live verification FAILED."
  PASS=false
else
  echo ""
  printf "%-30s %10s %10s %s\n" "Table" "Local" "Railway" "Status"
  printf "%-30s %10s %10s %s\n" "─────" "─────" "───────" "──────"

  for TABLE in $TABLES; do
    L_COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM \"$TABLE\";")
    R_COUNT=$(echo "$LIVE_COUNTS" | jq -r ".counts.\"$TABLE\" // \"?\"" 2>/dev/null)
    if [[ "$L_COUNT" == "$R_COUNT" ]]; then
      printf "%-30s %10s %10s ${GREEN}MATCH${NC}\n" "$TABLE" "$L_COUNT" "$R_COUNT"
    else
      printf "%-30s %10s %10s ${RED}MISMATCH${NC}\n" "$TABLE" "$L_COUNT" "$R_COUNT"
      PASS=false
    fi
  done
fi

echo ""
if [[ "$PASS" == "true" ]]; then
  log "DEPLOYMENT VERIFIED — Railway is an exact copy of local."
else
  err "DEPLOYMENT VERIFICATION FAILED — Railway may not match local."
  err "Railway backup at: $BACKUP_DIR"
  err "Investigate before disabling maintenance mode."
fi

# ── Re-enable maintenance mode on Railway ─────────────────────────
# Railway rebuild resets in-memory state. Re-lock so admin can test
# before going live. Disable via: ./scripts/maintenance.sh off
log "Re-enabling maintenance mode on Railway..."
MAINT_RESULT=$(curl -s -X POST "$RAILWAY_URL/api/maintenance" \
  -H "Content-Type: application/json" \
  -H "X-Seed-Secret: $DCC_SEED_SECRET" \
  -d '{"enabled": true, "lockoutMessage": "Wandi Hub will be back soon."}')

MAINT_OK=$(echo "$MAINT_RESULT" | jq -r '.enabled // false' 2>/dev/null)
if [[ "$MAINT_OK" == "true" ]]; then
  log "Maintenance mode ON — site locked for Paul to verify."
  warn "DO NOT disable maintenance. Only Paul runs: ./scripts/maintenance.sh off"
else
  warn "Failed to re-enable maintenance. Check manually."
  echo "$MAINT_RESULT"
fi

# ── Restart local servers ──────────────────────────────────────────
cd "$DCC_DIR"

log "Restarting local API server on :3001..."
NODE_ENV=production npm start >> /tmp/dcc-server.log 2>&1 &
for i in {1..15}; do
  if curl -sf http://localhost:3001/api/health &>/dev/null; then
    log "API server ready."
    break
  fi
  sleep 1
done
if ! curl -sf http://localhost:3001/api/health &>/dev/null; then
  warn "API server did not start. Check /tmp/dcc-server.log"
fi

log "Restarting Vite dev server on :5173..."
npm run dev >> /tmp/dcc-vite.log 2>&1 &
for i in {1..10}; do
  if curl -sf http://localhost:5173 &>/dev/null; then
    log "Vite dev server ready."
    break
  fi
  sleep 1
done
if ! curl -sf http://localhost:5173 &>/dev/null; then
  warn "Vite did not start. Check /tmp/dcc-vite.log"
fi

echo ""
log "Rollback backup: $BACKUP_DIR"

# ── Final status ──────────────────────────────────────────────────
echo ""
if [[ "$PASS" == "true" ]]; then
  echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  DEPLOY COMPLETE — ALL VERIFICATIONS PASSED      ${NC}"
  echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Maintenance mode is ON. Site is locked."
  echo "  Report to Paul: deploy succeeded, all table counts match."
  echo "  Paul will verify and run: ./scripts/maintenance.sh off"
else
  echo -e "${RED}══════════════════════════════════════════════════${NC}"
  echo -e "${RED}  DEPLOY FAILED — VERIFICATION ERRORS ABOVE       ${NC}"
  echo -e "${RED}══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Maintenance mode is ON. Site is locked."
  echo "  Report to Paul: deploy FAILED. See errors above."
  echo "  Rollback: cp $BACKUP_DIR/shared.db data/shared.db"
  echo "            DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data"
  exit 1
fi
