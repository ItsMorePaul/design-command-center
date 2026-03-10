#!/bin/bash
# deploy.sh - Single-command deploy: push code + upload entire DB to Railway
#
# Usage:
#   DCC_DEPLOY_OK=1 ./scripts/deploy.sh          # full deploy (code + data)
#   DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data    # data-only (no git push)
#
# How it works:
#   Uploads the local SQLite file directly to Railway's /api/upload-db endpoint.
#   This is byte-for-byte identical — no table-by-table sync, no hardcoded lists.
#   Any new tables, columns, or data added locally will appear on Railway exactly.
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

# ── Backup Railway before any changes ─────────────────────────────
log "Backing up Railway production data..."
BACKUP_TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$DCC_DIR/backups/railway/pre_deploy_${BACKUP_TS}"
mkdir -p "$BACKUP_DIR"

curl -sf "$RAILWAY_URL/api/data"           > "$BACKUP_DIR/data.json" || true
curl -sf "$RAILWAY_URL/api/capacity"       > "$BACKUP_DIR/capacity.json" || true
curl -sf "$RAILWAY_URL/api/priorities"     > "$BACKUP_DIR/priorities.json" || true
curl -sf "$RAILWAY_URL/api/business-lines" > "$BACKUP_DIR/business_lines.json" || true
curl -sf "$RAILWAY_URL/api/brandOptions"   > "$BACKUP_DIR/brand_options.json" || true
curl -sf "$RAILWAY_URL/api/notes"          > "$BACKUP_DIR/notes.json" || echo "[]" > "$BACKUP_DIR/notes.json"

echo "$BACKUP_DIR" > "$DCC_DIR/backups/railway/LATEST_PRE_DEPLOY"
log "Backup saved: $BACKUP_DIR"

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

PASS=true

# Health check
if curl -sf "$RAILWAY_URL/api/health" &>/dev/null; then
  log "Health check: PASS"
else
  err "Health check: FAIL"
  PASS=false
fi

# Compare ALL table counts dynamically
REMOTE_TABLES=$(echo "$BODY" | jq -r '.tables | to_entries[] | "\(.key) \(.value)"' 2>/dev/null)
if [[ -n "$REMOTE_TABLES" ]]; then
  echo ""
  printf "%-30s %10s %10s %s\n" "Table" "Local" "Railway" "Status"
  printf "%-30s %10s %10s %s\n" "─────" "─────" "───────" "──────"

  for TABLE in $TABLES; do
    L_COUNT=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM \"$TABLE\";")
    R_COUNT=$(echo "$BODY" | jq -r ".tables.\"$TABLE\" // \"?\"" 2>/dev/null)
    if [[ "$L_COUNT" == "$R_COUNT" ]]; then
      printf "%-30s %10s %10s MATCH\n" "$TABLE" "$L_COUNT" "$R_COUNT"
    else
      printf "%-30s %10s %10s MISMATCH\n" "$TABLE" "$L_COUNT" "$R_COUNT"
      PASS=false
    fi
  done
fi

echo ""
if [[ "$PASS" == "true" ]]; then
  log "DEPLOYMENT SUCCESSFUL - Railway is an exact copy of local."
else
  err "DEPLOYMENT HAS MISMATCHES - check above."
  warn "Railway backup at: $BACKUP_DIR"
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
