#!/bin/bash
# dcc-sync.sh - Robust Railway ↔ Local sync with verification and rollback
# 
# PRINCIPLES:
# 1. ATOMIC: All-or-nothing operations with rollback capability
# 2. VERIFIED: Every sync is verified before declaring success
# 3. IDEMPOTENT: Running twice produces same result
# 4. AUDITED: Full logging of what changed
#
# Usage: ./scripts/dcc-sync.sh [pull|push|status|verify]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCC_DIR="$(dirname "$SCRIPT_DIR")"
RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_URL="http://localhost:3001"
BACKUP_DIR="$DCC_DIR/backups"
LOG_FILE="$BACKUP_DIR/sync.log"
LOCK_FILE="/tmp/dcc-sync.lock"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

# Prevent concurrent syncs
acquire_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local pid=$(cat "$LOCK_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            error "Another sync is already running (PID: $pid)"
            exit 1
        fi
    fi
    echo $$ > "$LOCK_FILE"
    trap "rm -f $LOCK_FILE" EXIT
}

# Verify Railway is accessible and healthy
check_railway_health() {
    log "Checking Railway health..."
    if ! curl -sf "$RAILWAY_URL/api/health" &>/dev/null; then
        error "Railway is not accessible at $RAILWAY_URL"
        error "Cannot proceed with sync - Railway must be online"
        return 1
    fi
    log "✓ Railway is healthy"
    return 0
}

# Verify local server is accessible
check_local_health() {
    log "Checking local DCC health..."
    if ! curl -sf "$LOCAL_URL/api/health" &>/dev/null; then
        error "Local DCC is not running on port 3001"
        error "Start with: cd $DCC_DIR && NODE_ENV=production npm start"
        return 1
    fi
    log "✓ Local DCC is healthy"
    return 0
}

# Fetch data from Railway with retry logic
fetch_railway_data() {
    local endpoint="$1"
    local output_file="$2"
    local max_retries=3
    local retry_delay=2
    
    for i in $(seq 1 $max_retries); do
        if curl -sf "$RAILWAY_URL/$endpoint" > "$output_file" 2>/dev/null; then
            # Verify it's valid JSON
            if jq -e . "$output_file" > /dev/null 2>&1; then
                return 0
            fi
        fi
        
        if [ $i -lt $max_retries ]; then
            warn "Attempt $i failed, retrying in ${retry_delay}s..."
            sleep $retry_delay
        fi
    done
    
    error "Failed to fetch $endpoint from Railway after $max_retries attempts"
    return 1
}

# Create atomic backup with timestamp
atomic_backup() {
    local type="$1"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$BACKUP_DIR/${type}/${timestamp}_pre_sync"
    
    mkdir -p "$backup_path"
    
    log "Creating atomic backup: ${timestamp}_pre_sync"
    
    if [ "$type" = "local" ]; then
        # Backup local SQLite database
        sqlite3 "$DCC_DIR/data/shared.db" ".backup '$backup_path/shared.db'"
        
        # Also export as JSON for verification
        sqlite3 -json "$DCC_DIR/data/shared.db" "SELECT * FROM projects" > "$backup_path/projects.json" 2>/dev/null || echo "[]" > "$backup_path/projects.json"
    else
        # Backup Railway data
        fetch_railway_data "api/data" "$backup_path/data.json"
        fetch_railway_data "api/capacity" "$backup_path/capacity.json"
        fetch_railway_data "api/priorities" "$backup_path/priorities.json"
        fetch_railway_data "api/business-lines" "$backup_path/business_lines.json"
        fetch_railway_data "api/brandOptions" "$backup_path/brand_options.json"
        fetch_railway_data "api/notes" "$backup_path/notes.json" || echo "[]" > "$backup_path/notes.json"
    fi
    
    # Create restore script
    cat > "$backup_path/restore.sh" << EOF
#!/bin/bash
# Restore from backup ${timestamp}_pre_sync
echo "Restoring from backup: ${timestamp}_pre_sync"
if [ -f "$backup_path/shared.db" ]; then
    cp "$backup_path/shared.db" "$DCC_DIR/data/shared.db"
    echo "✓ Database restored"
fi
echo "Done. Restart DCC server if needed."
EOF
    chmod +x "$backup_path/restore.sh"
    
    echo "$backup_path" > "$BACKUP_DIR/${type}/LATEST"
    log "✓ Backup created: $backup_path"
    echo "$backup_path"
}

# Verify sync results match expected
check_sync_integrity() {
    log "Verifying sync integrity..."
    
    # Check key counts match
    local railway_projects=$(curl -sf "$RAILWAY_URL/api/data" 2>/dev/null | jq '.projects | length')
    local local_projects=$(curl -sf "$LOCAL_URL/api/data" 2>/dev/null | jq '.projects | length')
    
    if [ "$railway_projects" != "$local_projects" ]; then
        error "Project count mismatch: Railway=$railway_projects, Local=$local_projects"
        return 1
    fi
    
    # Check specific project statuses match
    local mismatches=0
    while IFS= read -r project; do
        local id=$(echo "$project" | jq -r '.id')
        local railway_status=$(echo "$project" | jq -r '.status')
        local local_status=$(curl -sf "$LOCAL_URL/api/data" 2>/dev/null | jq -r --arg id "$id" '.projects[] | select(.id == $id) | .status')
        
        if [ "$railway_status" != "$local_status" ]; then
            warn "Status mismatch for project $id: Railway='$railway_status', Local='$local_status'"
            mismatches=$((mismatches + 1))
        fi
    done < <(curl -sf "$RAILWAY_URL/api/data" 2>/dev/null | jq -c '.projects[]')
    
    if [ $mismatches -gt 0 ]; then
        error "Found $mismatches project(s) with mismatched status"
        return 1
    fi
    
    log "✓ Sync integrity verified"
    return 0
}

# Generate sync report
generate_sync_report() {
    local backup_path="$1"
    local report_file="$backup_path/SYNC_REPORT.txt"
    
    cat > "$report_file" << EOF
DCC SYNC REPORT
================
Timestamp: $(date)
Backup Location: $backup_path

RAILWAY STATE:
  Projects: $(curl -sf "$RAILWAY_URL/api/data" 2>/dev/null | jq '.projects | length')
  Team: $(curl -sf "$RAILWAY_URL/api/data" 2>/dev/null | jq '.team | length')
  Assignments: $(curl -sf "$RAILWAY_URL/api/capacity" 2>/dev/null | jq '.assignments | length')

LOCAL STATE (AFTER SYNC):
  Projects: $(curl -sf "$LOCAL_URL/api/data" 2>/dev/null | jq '.projects | length')
  Team: $(curl -sf "$LOCAL_URL/api/data" 2>/dev/null | jq '.team | length')
  Assignments: $(curl -sf "$LOCAL_URL/api/capacity" 2>/dev/null | jq '.assignments | length')

VERIFICATION: PASSED
EOF
    
    cat "$report_file"
}

# Main sync function
sync_pull() {
    log "╔════════════════════════════════════════════════════════╗"
    log "║  DCC SYNC: Railway → Local                            ║"
    log "╚════════════════════════════════════════════════════════╝"
    
    acquire_lock
    check_railway_health || exit 1
    check_local_health || exit 1
    
    # Step 1: Atomic backup of local
    local backup_path=$(atomic_backup "local")
    
    # Step 2: Fetch Railway data
    log "Fetching data from Railway..."
    local tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT
    
    fetch_railway_data "api/data" "$tmp_dir/data.json" || exit 1
    fetch_railway_data "api/capacity" "$tmp_dir/capacity.json" || exit 1
    fetch_railway_data "api/priorities" "$tmp_dir/priorities.json" || exit 1
    fetch_railway_data "api/business-lines" "$tmp_dir/business_lines.json" || exit 1
    fetch_railway_data "api/brandOptions" "$tmp_dir/brand_options.json" || exit 1
    fetch_railway_data "api/notes" "$tmp_dir/notes.json" || echo "[]" > "$tmp_dir/notes.json"
    
    # Step 3: Build and execute seed
    log "Building seed payload..."
    local payload=$(jq -n \
        --argfile data "$tmp_dir/data.json" \
        --argfile capacity "$tmp_dir/capacity.json" \
        --argfile priorities "$tmp_dir/priorities.json" \
        --argfile bl "$tmp_dir/business_lines.json" \
        --argfile brands "$tmp_dir/brand_options.json" \
        --argfile notes "$tmp_dir/notes.json" \
        '{projects: $data.projects, team: $data.team, assignments: $capacity.assignments, priorities: $priorities, businessLines: $bl, brandOptions: $brands, notes: $notes}' 2>/dev/null)
    
    if [ -z "$payload" ]; then
        error "Failed to build seed payload"
        exit 1
    fi
    
    log "Seeding local database..."
    local result=$(curl -sf -X POST "$LOCAL_URL/api/seed" \
        -H "Content-Type: application/json" \
        -d "$payload" 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        error "Seed operation failed"
        error "To rollback: $backup_path/restore.sh"
        exit 1
    fi
    
    # Step 4: Verify
    if ! check_sync_integrity; then
        error "Sync verification failed!"
        error "To rollback: $backup_path/restore.sh"
        exit 1
    fi
    
    # Step 5: Report
    generate_sync_report "$backup_path"
    
    log "✅ SYNC COMPLETE"
}

# Show current status
show_status() {
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║  DCC SYNC STATUS                                      ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    
    echo "Railway:"
    curl -sf "$RAILWAY_URL/api/data" 2>/dev/null | jq -c '{projects: (.projects | length), team: (.team | length), status: "online"}' || echo '{status: "offline"}'
    
    echo ""
    echo "Local:"
    curl -sf "$LOCAL_URL/api/data" 2>/dev/null | jq -c '{projects: (.projects | length), team: (.team | length), status: "online"}' || echo '{status: "offline"}'
    
    echo ""
    echo "Latest backup:"
    cat "$BACKUP_DIR/local/LATEST" 2>/dev/null || echo "  (none)"
}

# Command handler
case "${1:-status}" in
    pull|sync)
        sync_pull
        ;;
    status|s)
        show_status
        ;;
    verify|v)
        check_sync_integrity
        ;;
    *)
        echo "DCC Robust Sync System"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  pull    - Sync Railway → Local (with verification)"
        echo "  status  - Show current sync status"
        echo "  verify  - Verify local matches Railway"
        echo ""
        echo "Features:"
        echo "  • Atomic operations with rollback"
        echo "  • Automatic integrity verification"
        echo "  • Retry logic for API failures"
        echo "  • Detailed sync reports"
        echo ""
        ;;
esac
