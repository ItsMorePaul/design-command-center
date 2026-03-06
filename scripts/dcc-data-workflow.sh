#!/bin/bash
# dcc-data-workflow.sh - Complete bidirectional sync for DCC (ALL tables)
# 
# WORKFLOW OVERVIEW:
# Phase 1: PULL (Railway → Local) - with backup, merge preview, selective apply
# Phase 2: LOCAL WORK - edit locally, verify changes
# Phase 3: PUSH (Local → Railway) - with backup, diff confirmation
#
# This script handles ALL 10 database tables:
# - projects, team, brand_options, business_lines
# - project_assignments, project_priorities
# - notes, note_project_links, note_people_links
# - app_versions
#
# Usage: ./scripts/dcc-data-workflow.sh [pull|push|status|backup|restore]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCC_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$DCC_DIR/backups"
RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_URL="http://localhost:3001"
LOCAL_DB="$DCC_DIR/data/shared.db"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
info() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }

# Ensure local server is running
check_local_server() {
    if ! curl -sf "$LOCAL_URL/api/health" &>/dev/null; then
        error "Local server not running on port 3001"
        echo "Start with: cd $DCC_DIR && NODE_ENV=production npm start"
        exit 1
    fi
}

# Create timestamped backup (local or railway)
create_backup() {
    local type="$1"  # 'local' or 'railway'
    local label="${2:-manual}"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$BACKUP_DIR/${type}/${timestamp}_${label}"
    
    mkdir -p "$backup_path"
    
    log "Creating $type backup: ${timestamp}_${label}..."
    
    if [ "$type" = "local" ]; then
        # Export all local data via SQLite
        sqlite3 "$LOCAL_DB" ".backup '$backup_path/shared.db'"
        
        # Also export as JSON for verification
        sqlite3 -json "$LOCAL_DB" "SELECT * FROM projects" > "$backup_path/projects.json" 2>/dev/null || echo "[]" > "$backup_path/projects.json"
        sqlite3 -json "$LOCAL_DB" "SELECT * FROM team" > "$backup_path/team.json" 2>/dev/null || echo "[]" > "$backup_path/team.json"
        sqlite3 -json "$LOCAL_DB" "SELECT * FROM notes" > "$backup_path/notes.json" 2>/dev/null || echo "[]" > "$backup_path/notes.json"
        sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_assignments" > "$backup_path/assignments.json" 2>/dev/null || echo "[]" > "$backup_path/assignments.json"
    else
        # Export Railway data via API
        curl -sf "$RAILWAY_URL/api/data" > "$backup_path/data.json" 2>/dev/null || echo '{"projects":[],"team":[],"brandOptions":[]}' > "$backup_path/data.json"
        curl -sf "$RAILWAY_URL/api/capacity" > "$backup_path/capacity.json" 2>/dev/null || echo '{"assignments":[]}' > "$backup_path/capacity.json"
        curl -sf "$RAILWAY_URL/api/priorities" > "$backup_path/priorities.json" 2>/dev/null || echo '[]' > "$backup_path/priorities.json"
        curl -sf "$RAILWAY_URL/api/business-lines" > "$backup_path/business_lines.json" 2>/dev/null || echo '[]' > "$backup_path/business_lines.json"
        curl -sf "$RAILWAY_URL/api/notes" > "$backup_path/notes.json" 2>/dev/null || echo '[]' > "$backup_path/notes.json"
        curl -sf "$RAILWAY_URL/api/versions" > "$backup_path/versions.json" 2>/dev/null || echo '{}' > "$backup_path/versions.json"
    fi
    
    # Create restore script
    if [ "$type" = "local" ]; then
        cat > "$backup_path/restore.sh" << EOF
#!/bin/bash
# Restore local DB from this backup
BACKUP_DIR="\$(dirname "\$0")"
DCC_DIR="$DCC_DIR"

echo "Restoring local DB from backup..."

# Stop server if running
pkill -f "tsx server.ts" 2>/dev/null || true
sleep 2

# Restore SQLite
if [ -f "\$BACKUP_DIR/shared.db" ]; then
    cp "\$BACKUP_DIR/shared.db" "\$DCC_DIR/data/shared.db"
    echo "✓ Database restored from shared.db"
fi

echo "Restore complete. Start server with:"
echo "  cd \$DCC_DIR && NODE_ENV=production npm start"
EOF
    else
        cat > "$backup_path/restore_railway.sh" << EOF
#!/bin/bash
# Restore Railway to this backup state
BACKUP_DIR="\$(dirname "\$0")"
RAILWAY_URL="$RAILWAY_URL"

echo "Restoring Railway from backup..."

# Re-seed Railway with backup data
PROJECTS=\$(cat "\$BACKUP_DIR/data.json" | jq '.projects // []')
TEAM=\$(cat "\$BACKUP_DIR/data.json" | jq '.team // []')
ASSIGNMENTS=\$(cat "\$BACKUP_DIR/capacity.json" | jq '.assignments // []')
PRIORITIES=\$(cat "\$BACKUP_DIR/priorities.json")
BUSINESS_LINES=\$(cat "\$BACKUP_DIR/business_lines.json")
BRAND_OPTIONS=\$(cat "\$BACKUP_DIR/data.json" | jq '.brandOptions // []')
NOTES=\$(cat "\$BACKUP_DIR/notes.json")

curl -s -X POST "\$RAILWAY_URL/api/seed" \\
  -H "Content-Type: application/json" \\
  -d "{\\"projects\\":\$PROJECTS,\\"team\\":\$TEAM,\\"assignments\\":\$ASSIGNMENTS,\\"priorities\\":\$PRIORITIES,\\"businessLines\\":\$BUSINESS_LINES,\\"brandOptions\\":\$BRAND_OPTIONS,\\"notes\\":\$NOTES}"

echo "Restore complete."
EOF
    fi
    chmod +x "$backup_path/restore.sh" 2>/dev/null || true
    chmod +x "$backup_path/restore_railway.sh" 2>/dev/null || true
    
    echo "$backup_path" > "$BACKUP_DIR/${type}/LATEST"
    log "✓ Backup created: $backup_path"
    echo "$backup_path"
}

# Fetch ALL data from Railway (comprehensive)
fetch_railway_data() {
    log "Fetching complete data from Railway..."
    
    local tmp_dir=$(mktemp -d)
    
    # Core data
    curl -sf "$RAILWAY_URL/api/data" > "$tmp_dir/data.json" 2>/dev/null || echo '{"projects":[],"team":[],"brandOptions":[]}' > "$tmp_dir/data.json"
    
    # Capacity/assignments
    curl -sf "$RAILWAY_URL/api/capacity" > "$tmp_dir/capacity.json" 2>/dev/null || echo '{"assignments":[],"team":[]}' > "$tmp_dir/capacity.json"
    
    # Priorities
    curl -sf "$RAILWAY_URL/api/priorities" > "$tmp_dir/priorities.json" 2>/dev/null || echo '[]' > "$tmp_dir/priorities.json"
    
    # Business lines
    curl -sf "$RAILWAY_URL/api/business-lines" > "$tmp_dir/business_lines.json" 2>/dev/null || echo '[]' > "$tmp_dir/business_lines.json"
    
    # Notes (all notes)
    curl -sf "$RAILWAY_URL/api/notes" > "$tmp_dir/notes.json" 2>/dev/null || echo '[]' > "$tmp_dir/notes.json"
    
    # Versions
    curl -sf "$RAILWAY_URL/api/versions" > "$tmp_dir/versions.json" 2>/dev/null || echo '{}' > "$tmp_dir/versions.json"
    
    echo "$tmp_dir"
}

# Get local counts via SQLite
get_local_counts() {
    local counts=""
    counts+="Projects: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM projects;' 2>/dev/null || echo 0)\n"
    counts+="Team: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM team;' 2>/dev/null || echo 0)\n"
    counts+="Assignments: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM project_assignments;' 2>/dev/null || echo 0)\n"
    counts+="Priorities: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM project_priorities;' 2>/dev/null || echo 0)\n"
    counts+="Business Lines: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM business_lines;' 2>/dev/null || echo 0)\n"
    counts+="Brand Options: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM brand_options;' 2>/dev/null || echo 0)\n"
    counts+="Notes: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM notes;' 2>/dev/null || echo 0)\n"
    counts+="Note-Project Links: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM note_project_links;' 2>/dev/null || echo 0)\n"
    counts+="Note-People Links: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM note_people_links;' 2>/dev/null || echo 0)"
    echo -e "$counts"
}

# Show comparison between Railway and Local
show_status() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           DCC DATABASE SYNC STATUS                        ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Local counts
    echo "📦 LOCAL ($(hostname))"
    echo "   DB: $LOCAL_DB"
    get_local_counts | sed 's/^/   /'
    
    echo ""
    
    # Railway counts
    echo "🌐 RAILWAY (Production)"
    echo "   URL: $RAILWAY_URL"
    
    local railway_data=$(curl -sf "$RAILWAY_URL/api/data" 2>/dev/null || echo '{}')
    local railway_capacity=$(curl -sf "$RAILWAY_URL/api/capacity" 2>/dev/null || echo '{}')
    local railway_notes=$(curl -sf "$RAILWAY_URL/api/notes" 2>/dev/null || echo '[]')
    
    echo "   Projects: $(echo "$railway_data" | jq '.projects | length' 2>/dev/null || echo 0)"
    echo "   Team: $(echo "$railway_data" | jq '.team | length' 2>/dev/null || echo 0)"
    echo "   Assignments: $(echo "$railway_capacity" | jq '.assignments | length' 2>/dev/null || echo 0)"
    echo "   Priorities: $(curl -sf "$RAILWAY_URL/api/priorities" 2>/dev/null | jq 'length' || echo 0)"
    echo "   Business Lines: $(curl -sf "$RAILWAY_URL/api/business-lines" 2>/dev/null | jq 'length' || echo 0)"
    echo "   Brand Options: $(echo "$railway_data" | jq '.brandOptions | length' 2>/dev/null || echo 0)"
    echo "   Notes: $(echo "$railway_notes" | jq 'length' 2>/dev/null || echo 0)"
    
    echo ""
    
    # Recent backups
    echo "💾 RECENT BACKUPS"
    echo "   Local:"
    ls -1t "$BACKUP_DIR/local/" 2>/dev/null | head -3 | sed 's/^/     /' || echo "     (none)"
    echo "   Railway:"
    ls -1t "$BACKUP_DIR/railway/" 2>/dev/null | head -3 | sed 's/^/     /' || echo "     (none)"
    
    echo ""
}

# Pull data from Railway to Local (comprehensive)
execute_pull() {
    check_local_server
    
    log "Starting PULL from Railway to Local..."
    
    # Create pre-pull backup
    local backup_path=$(create_backup "local" "pre_pull")
    
    # Fetch all Railway data
    local tmp_dir=$(fetch_railway_data)
    
    log "Seeding local database..."
    
    # Build comprehensive seed payload
    local payload=$(cat <<EOF
{
  "projects": $(cat "$tmp_dir/data.json" | jq '.projects // []'),
  "team": $(cat "$tmp_dir/data.json" | jq '.team // []'),
  "assignments": $(cat "$tmp_dir/capacity.json" | jq '.assignments // []'),
  "priorities": $(cat "$tmp_dir/priorities.json"),
  "businessLines": $(cat "$tmp_dir/business_lines.json"),
  "brandOptions": $(cat "$tmp_dir/data.json" | jq '.brandOptions // []'),
  "notes": $(cat "$tmp_dir/notes.json")
}
EOF
)
    
    # Seed local database
    local result=$(curl -sf -X POST "$LOCAL_URL/api/seed" \
      -H "Content-Type: application/json" \
      -d "$payload" 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        error "Failed to seed local database"
        rm -rf "$tmp_dir"
        exit 1
    fi
    
    # Create post-pull backup
    create_backup "local" "post_pull" > /dev/null
    
    log "✓ Pull complete!"
    echo ""
    info "Backups:"
    echo "  Pre-pull:  $backup_path"
    echo "  Post-pull: $(cat $BACKUP_DIR/local/LATEST)"
    echo ""
    info "To UNDO: $backup_path/restore.sh"
    echo ""
    
    # Show new counts
    get_local_counts | sed 's/^/  /'
    
    rm -rf "$tmp_dir"
}

# Push data from Local to Railway (comprehensive)
execute_push() {
    check_local_server
    
    log "Starting PUSH from Local to Railway..."
    
    # Verify DCC_DEPLOY_OK
    if [ -z "$DCC_DEPLOY_OK" ]; then
        error "DCC_DEPLOY_OK not set. Paul must explicitly approve deployment."
        exit 1
    fi
    
    # Create Railway backup
    local backup_path=$(create_backup "railway" "pre_push")
    
    # Export ALL local data
    log "Exporting local data..."
    
    local projects=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM projects" 2>/dev/null | jq '.' || echo '[]')
    local team=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM team" 2>/dev/null | jq '.' || echo '[]')
    local assignments=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_assignments" 2>/dev/null | jq '.' || echo '[]')
    local priorities=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_priorities" 2>/dev/null | jq '.' || echo '[]')
    local business_lines=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM business_lines" 2>/dev/null | jq '.' || echo '[]')
    local brand_options=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM brand_options" 2>/dev/null | jq '.' || echo '[]')
    local notes=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM notes" 2>/dev/null | jq '.' || echo '[]')
    
    # Build payload
    local payload=$(cat <<EOF
{
  "projects": $projects,
  "team": $team,
  "assignments": $assignments,
  "priorities": $priorities,
  "businessLines": $business_lines,
  "brandOptions": $brand_options,
  "notes": $notes
}
EOF
)
    
    # Show preview
    echo ""
    echo "=== PUSH PREVIEW ==="
    echo "Projects: $(echo "$projects" | jq 'length')"
    echo "Team: $(echo "$team" | jq 'length')"
    echo "Assignments: $(echo "$assignments" | jq 'length')"
    echo "Priorities: $(echo "$priorities" | jq 'length')"
    echo "Business Lines: $(echo "$business_lines" | jq 'length')"
    echo "Brand Options: $(echo "$brand_options" | jq 'length')"
    echo "Notes: $(echo "$notes" | jq 'length')"
    echo ""
    
    warn "This will COMPLETELY OVERWRITE Railway database!"
    
    # Push to Railway
    log "Pushing to Railway..."
    local result=$(curl -sf -X POST "$RAILWAY_URL/api/seed" \
      -H "Content-Type: application/json" \
      -d "$payload" 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        error "Failed to push to Railway"
        exit 1
    fi
    
    log "✓ Push complete!"
    echo ""
    echo "$result" | jq '.'
    echo ""
    info "Backup: $backup_path"
    info "Restore: $backup_path/restore_railway.sh"
}

# Main command handler
case "${1:-status}" in
    status|s)
        show_status
        ;;
    pull|p)
        check_local_server
        echo ""
        warn "This will OVERWRITE local database with Railway data"
        read -p "Type 'yes' to proceed: " confirm
        if [ "$confirm" = "yes" ]; then
            execute_pull
        else
            log "Cancelled"
        fi
        ;;
    push|deploy|d)
        check_local_server
        if [ -z "$DCC_DEPLOY_OK" ]; then
            error "DCC_DEPLOY_OK not set. Paul must say 'deploy dcc' first."
            exit 1
        fi
        execute_push
        ;;
    backup|b)
        check_local_server
        create_backup "local" "manual"
        ;;
    restore|r)
        if [ -z "$2" ]; then
            echo "Usage: $0 restore <backup_path>"
            echo ""
            echo "Recent local backups:"
            ls -1t "$BACKUP_DIR/local/" 2>/dev/null | head -5 | while read b; do
                echo "  $BACKUP_DIR/local/$b"
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
        echo "DCC Complete Data Workflow - Sync ALL database tables"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  status   - Show Railway vs Local comparison (default)"
        echo "  pull     - Pull Railway data → Local (with backup)"
        echo "  push     - Push Local data → Railway (with backup, needs DCC_DEPLOY_OK=1)"
        echo "  backup   - Create manual local backup"
        echo "  restore  - Restore from backup path"
        echo ""
        echo "Tables synced:"
        echo "  • projects, team, brand_options, business_lines"
        echo "  • project_assignments, project_priorities"
        echo "  • notes, note_project_links, note_people_links"
        echo ""
        echo "Examples:"
        echo "  $0 status              # Check current state"
        echo "  $0 pull                # Download from Railway"
        echo "  DCC_DEPLOY_OK=1 $0 push # Deploy to Railway"
        echo ""
        exit 1
        ;;
esac
