#!/bin/bash
# deploy.sh - Single-command deploy: push code + seed ALL tables to Railway
#
# Usage:
#   DCC_DEPLOY_OK=1 ./scripts/deploy.sh          # full deploy (code + data)
#   DCC_DEPLOY_OK=1 ./scripts/deploy.sh --data    # data-only (no git push)
#
# Requires:
#   DCC_SEED_SECRET env var (shared with Railway)
#   DCC_DEPLOY_OK=1 env var (deployment gate)
#   Local server running on port 3001

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
  err "DCC_SEED_SECRET not set. Cannot authenticate with Railway /api/seed."
  echo "  Set it: export DCC_SEED_SECRET=<token>"
  echo "  Must match the DCC_SEED_SECRET env var on Railway."
  exit 1
fi

if ! curl -sf "$LOCAL_URL/api/health" &>/dev/null; then
  err "Local server not running on port 3001. Start it: cd $DCC_DIR && npm start"
  exit 1
fi

if [[ ! -f "$LOCAL_DB" ]]; then
  err "Local database not found: $LOCAL_DB"
  exit 1
fi

# ── Backup Railway before any changes ─────────────────────────────
log "Backing up Railway production data..."
BACKUP_TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$DCC_DIR/backups/railway/pre_deploy_${BACKUP_TS}"
mkdir -p "$BACKUP_DIR"

curl -sf "$RAILWAY_URL/api/data"           > "$BACKUP_DIR/data.json"
curl -sf "$RAILWAY_URL/api/capacity"       > "$BACKUP_DIR/capacity.json"
curl -sf "$RAILWAY_URL/api/priorities"     > "$BACKUP_DIR/priorities.json"
curl -sf "$RAILWAY_URL/api/business-lines" > "$BACKUP_DIR/business_lines.json"
curl -sf "$RAILWAY_URL/api/brandOptions"   > "$BACKUP_DIR/brand_options.json"
curl -sf "$RAILWAY_URL/api/notes"          > "$BACKUP_DIR/notes.json" 2>/dev/null || echo "[]" > "$BACKUP_DIR/notes.json"

echo "$BACKUP_DIR" > "$DCC_DIR/backups/railway/LATEST_PRE_DEPLOY"
log "Backup saved: $BACKUP_DIR"

# ── Show preview ──────────────────────────────────────────────────
echo ""
echo -e "${BLUE}=== DEPLOYMENT PREVIEW ===${NC}"
echo ""

# Local counts from SQLite
L_PROJ=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM projects')
L_TEAM=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM team')
L_ASGN=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM project_assignments')
L_PRIO=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM project_priorities')
L_BL=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM business_lines')
L_BO=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM brand_options')
L_NOTES=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM notes')
L_NPL=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM note_project_links')
L_NPPL=$(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM note_people_links')

# Railway counts from backup
R_PROJ=$(jq '.projects | length' "$BACKUP_DIR/data.json")
R_TEAM=$(jq '.team | length' "$BACKUP_DIR/data.json")
R_ASGN=$(jq '.assignments | length' "$BACKUP_DIR/capacity.json")

printf "%-25s %10s → %s\n" "Table" "Railway" "Local (after)"
printf "%-25s %10s → %s\n" "─────" "───────" "─────────────"
printf "%-25s %10s → %s\n" "projects"             "$R_PROJ"  "$L_PROJ"
printf "%-25s %10s → %s\n" "team"                 "$R_TEAM"  "$L_TEAM"
printf "%-25s %10s → %s\n" "project_assignments"  "$R_ASGN"  "$L_ASGN"
printf "%-25s %10s → %s\n" "project_priorities"   "?"        "$L_PRIO"
printf "%-25s %10s → %s\n" "business_lines"       "?"        "$L_BL"
printf "%-25s %10s → %s\n" "brand_options"        "?"        "$L_BO"
printf "%-25s %10s → %s\n" "notes"                "?"        "$L_NOTES"
printf "%-25s %10s → %s\n" "note_project_links"   "?"        "$L_NPL"
printf "%-25s %10s → %s\n" "note_people_links"    "?"        "$L_NPPL"
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

  log "Waiting for Railway to rebuild..."
  ATTEMPTS=0
  while [[ $ATTEMPTS -lt 40 ]]; do
    sleep 5
    if curl -sf "$RAILWAY_URL/api/health" &>/dev/null; then
      log "Railway is back up."
      break
    fi
    echo -n "."
    ATTEMPTS=$((ATTEMPTS + 1))
  done
  echo ""

  if [[ $ATTEMPTS -eq 40 ]]; then
    err "Railway deploy timeout after 200s. Check dashboard."
    exit 1
  fi
fi

# ── Seed ALL tables ──────────────────────────────────────────────
log "Exporting all tables from local SQLite..."

PROJECTS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM projects")
TEAM=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM team")
ASSIGNMENTS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_assignments")
PRIORITIES=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_priorities")
BUSINESS_LINES=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM business_lines")
BRAND_OPTIONS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM brand_options")
NOTES=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM notes")
NOTE_PROJECT_LINKS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM note_project_links")
NOTE_PEOPLE_LINKS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM note_people_links")

# Build the full payload as a temp file (can be large)
PAYLOAD_FILE=$(mktemp)
jq -n \
  --argjson projects "$PROJECTS" \
  --argjson team "$TEAM" \
  --argjson assignments "$ASSIGNMENTS" \
  --argjson priorities "$PRIORITIES" \
  --argjson businessLines "$BUSINESS_LINES" \
  --argjson brandOptions "$BRAND_OPTIONS" \
  --argjson notes "$NOTES" \
  --argjson noteProjectLinks "$NOTE_PROJECT_LINKS" \
  --argjson notePeopleLinks "$NOTE_PEOPLE_LINKS" \
  '{
    projects: $projects,
    team: $team,
    assignments: $assignments,
    priorities: $priorities,
    businessLines: $businessLines,
    brandOptions: $brandOptions,
    notes: $notes,
    noteProjectLinks: $noteProjectLinks,
    notePeopleLinks: $notePeopleLinks
  }' > "$PAYLOAD_FILE"

PAYLOAD_SIZE=$(wc -c < "$PAYLOAD_FILE" | tr -d ' ')
log "Payload size: ${PAYLOAD_SIZE} bytes"

log "Seeding Railway with ALL local data..."
SEED_RESULT=$(curl -s -w "\n%{http_code}" -X POST "$RAILWAY_URL/api/seed" \
  -H "Content-Type: application/json" \
  -H "X-Seed-Secret: $DCC_SEED_SECRET" \
  --data-binary @"$PAYLOAD_FILE")

rm -f "$PAYLOAD_FILE"

HTTP_CODE=$(echo "$SEED_RESULT" | tail -1)
BODY=$(echo "$SEED_RESULT" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
  err "Seed failed with HTTP $HTTP_CODE"
  echo "$BODY"
  echo ""
  err "Rollback: $BACKUP_DIR/restore_railway.sh"
  exit 1
fi

log "Seed response:"
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

# Compare counts
R_PROJ_AFTER=$(curl -sf "$RAILWAY_URL/api/data" | jq '.projects | length')
R_TEAM_AFTER=$(curl -sf "$RAILWAY_URL/api/data" | jq '.team | length')
R_ASGN_AFTER=$(curl -sf "$RAILWAY_URL/api/capacity" | jq '.assignments | length')

check_count() {
  local name=$1 remote=$2 local=$3
  if [[ "$remote" == "$local" ]]; then
    log "$name: $remote (MATCH)"
  else
    err "$name: Railway=$remote, Local=$local (MISMATCH)"
    PASS=false
  fi
}

check_count "projects"            "$R_PROJ_AFTER" "$L_PROJ"
check_count "team"                "$R_TEAM_AFTER" "$L_TEAM"
check_count "project_assignments" "$R_ASGN_AFTER" "$L_ASGN"

echo ""
if [[ "$PASS" == "true" ]]; then
  log "DEPLOYMENT SUCCESSFUL - Railway matches local."
else
  err "DEPLOYMENT HAS MISMATCHES - check above."
  warn "Rollback: bash $BACKUP_DIR/restore_railway.sh"
fi

echo ""
log "Rollback available: $BACKUP_DIR"
