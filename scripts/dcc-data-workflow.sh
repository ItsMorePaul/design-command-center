#!/bin/bash
# dcc-data-workflow.sh - Safe bidirectional sync workflow for DCC
# 
# WORKFLOW OVERVIEW:
# Phase 1: PULL (Railway → Local) - with backup, merge preview, selective apply
# Phase 2: LOCAL WORK - edit locally, verify changes
# Phase 3: PUSH (Local → Railway) - with backup, diff confirmation
#
# Usage: ./scripts/dcc-data-workflow.sh [pull|preview|push|status]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCC_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$DCC_DIR/backups/local"
RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_URL="http://localhost:3001"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"
}

# Ensure local server is running
check_local_server() {
    if ! curl -sf "$LOCAL_URL/api/health" &>/dev/null; then
        error "Local server not running on port 3001"
        echo "Start with: cd $DCC_DIR && NODE_ENV=production npm start"
        exit 1
    fi
}

# Create timestamped local backup
backup_local() {
    local label="${1:-manual}"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$BACKUP_DIR/${timestamp}_${label}"
    
    mkdir -p "$backup_path"
    
    log "Creating local backup: ${timestamp}_${label}..."
    
    # Export all local data via API
    curl -sf "$LOCAL_URL/api/data" > "$backup_path/data.json"
    curl -sf "$LOCAL_URL/api/capacity" > "$backup_path/capacity.json"
    curl -sf "$LOCAL_URL/api/priorities" > "$backup_path/priorities.json"
    curl -sf "$LOCAL_URL/api/business-lines" > "$backup_path/business_lines.json"
    curl -sf "$LOCAL_URL/api/brandOptions" > "$backup_path/brand_options.json"
    
    # Also backup raw SQLite
    cp "$DCC_DIR/data/shared.db" "$backup_path/shared.db"
    
    # Create restore script
    cat > "$backup_path/restore.sh" << 'EOF'
#!/bin/bash
# Restore local DB from this backup
BACKUP_DIR="$(dirname "$0")"
DCC_DIR="$(cd "$BACKUP_DIR/../../../" && pwd)"

# Stop server
pkill -f "tsx server.ts" || true
sleep 2

# Restore SQLite
if [ -f "$BACKUP_DIR/shared.db" ]; then
    cp "$BACKUP_DIR/shared.db" "$DCC_DIR/data/shared.db"
    echo "✓ SQLite database restored"
fi

echo "Restore complete. Start server with: cd $DCC_DIR && NODE_ENV=production npm start"
EOF
    chmod +x "$backup_path/restore.sh"
    
    echo "$backup_path" > "$BACKUP_DIR/LATEST"
    log "✓ Backup created: $backup_path"
    echo "$backup_path"
}

# Show diff between Railway and Local
preview_changes() {
    log "Fetching Railway data..."
    local tmp_dir=$(mktemp -d)
    
    curl -sf "$RAILWAY_URL/api/data" > "$tmp_dir/railway_data.json"
    curl -sf "$LOCAL_URL/api/data" > "$tmp_dir/local_data.json"
    
    echo ""
    echo "=== COMPARISON: Railway vs Local ==="
    echo ""
    
    # Count comparison
    printf "%-20s %10s %10s %10s\n" "Table" "Railway" "Local" "Diff"
    printf "%-20s %10s %10s %10s\n" "-----" "-------" "-----" "----"
    
    for table in "projects:projects" "team:team"; do
        local key=$(echo "$table" | cut -d: -f2)
        local name=$(echo "$table" | cut -d: -f1)
        local railway_count=$(jq ".$key | length" "$tmp_dir/railway_data.json" 2>/dev/null || echo "0")
        local local_count=$(jq ".$key | length" "$tmp_dir/local_data.json" 2>/dev/null || echo "0")
        local diff=$((railway_count - local_count))
        printf "%-20s %10d %10d %+10d\n" "$name" "$railway_count" "$local_count" "$diff"
    done
    
    echo ""
    
    # Show sample differences (projects)
    log "Sample: Projects only in Railway (first 5):"
    jq -r '.projects[].name' "$tmp_dir/railway_data.json" 2>/dev/null | sort > "$tmp_dir/railway_projects.txt"
    jq -r '.projects[].name' "$tmp_dir/local_data.json" 2>/dev/null | sort > "$tmp_dir/local_projects.txt"
    comm -23 "$tmp_dir/railway_projects.txt" "$tmp_dir/local_projects.txt" | head -5 | while read name; do
        echo "  + $name"
    done
    
    if [ -s "$tmp_dir/railway_projects.txt" ] && [ -s "$tmp_dir/local_projects.txt" ]; then
        local only_in_railway=$(comm -23 "$tmp_dir/railway_projects.txt" "$tmp_dir/local_projects.txt" | wc -l)
        local only_in_local=$(comm -13 "$tmp_dir/railway_projects.txt" "$tmp_dir/local_projects.txt" | wc -l)
        
        if [ "$only_in_railway" -gt 0 ]; then
            warn "$only_in_railway project(s) in Railway not in Local"
        fi
        if [ "$only_in_local" -gt 0 ]; then
            warn "$only_in_local project(s) in Local not in Railway (will be DELETED if you pull)"
        fi
    fi
    
    rm -rf "$tmp_dir"
}

# Execute pull with selective merge
execute_pull() {
    local backup_path=$(backup_local "pre_pull")
    
    log "Pulling from Railway..."
    "$DCC_DIR/scripts/pull-from-railway.sh"
    
    log "Creating post-pull backup..."
    backup_local "post_pull"
    
    echo ""
    log "✓ Pull complete. Backups:"
    echo "  Pre-pull:  $backup_path"
    echo "  Post-pull: $(cat $BACKUP_DIR/LATEST)"
    echo ""
    warn "To UNDO this pull: $(cat $BACKUP_DIR/LATEST)/restore.sh"
}

# Show current status
show_status() {
    check_local_server
    
    echo ""
    echo "=== DCC DATA WORKFLOW STATUS ==="
    echo ""
    
    # Server status
    echo "Local Server: $LOCAL_URL"
    local local_health=$(curl -sf "$LOCAL_URL/api/health" 2>/dev/null && echo "✓ Running" || echo "✗ Down")
    echo "  Health: $local_health"
    echo ""
    
    # Railway status
    echo "Railway Server: $RAILWAY_URL"
    local railway_health=$(curl -sf "$RAILWAY_URL/api/health" 2>/dev/null && echo "✓ Running" || echo "✗ Down")
    echo "  Health: $railway_health"
    echo ""
    
    # Data counts
    if [ "$local_health" = "✓ Running" ] && [ "$railway_health" = "✓ Running" ]; then
        preview_changes
    fi
    
    # Recent backups
    echo ""
    echo "Recent Local Backups:"
    ls -1t "$BACKUP_DIR"/*_* 2>/dev/null | head -5 | while read backup; do
        echo "  $(basename "$backup")"
    done || echo "  (none)"
}

# Main command handler
case "${1:-status}" in
    status)
        show_status
        ;;
    preview|diff)
        check_local_server
        preview_changes
        ;;
    pull)
        check_local_server
        echo ""
        warn "This will OVERWRITE local database with Railway data"
        echo "Your local changes will be backed up first"
        echo ""
        read -p "Continue? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            execute_pull
        else
            log "Cancelled"
        fi
        ;;
    backup)
        check_local_server
        backup_local "manual"
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "Usage: $0 restore <backup_path>"
            echo "Recent backups:"
            ls -1t "$BACKUP_DIR"/*_* 2>/dev/null | head -5 | while read backup; do
                echo "  $backup"
            done
            exit 1
        fi
        if [ -f "$2/restore.sh" ]; then
            bash "$2/restore.sh"
        else
            error "Backup not found: $2"
        fi
        ;;
    *)
        echo "DCC Data Workflow - Safe bidirectional sync"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  status   - Show Railway vs Local comparison"
        echo "  preview  - Preview changes before pulling"
        echo "  pull     - Pull Railway data (with auto-backup)"
        echo "  backup   - Create manual local backup"
        echo "  restore  - Restore from backup path"
        echo ""
        echo "Workflow:"
        echo "  1. $0 status      # Check current state"
        echo "  2. $0 preview     # See what will change"
        echo "  3. $0 pull        # Pull Railway data (auto-backup)"
        echo "  4. # Verify locally, make changes"
        echo "  5. # Tell Wilson to push when ready"
        echo ""
        exit 1
        ;;
esac
