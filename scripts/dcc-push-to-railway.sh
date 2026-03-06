#!/bin/bash
# dcc-push-to-railway.sh - SAFE push from local to Railway (Phase 3)
# 
# CRITICAL: This script ONLY runs when Paul explicitly says "deploy dcc" or "push dcc"
# It requires BOTH code AND data verification before proceeding.
#
# Usage: DO NOT CALL DIRECTLY. Wilson will run this when Paul approves deployment.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCC_DIR="$(dirname "$SCRIPT_DIR")"
RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_URL="http://localhost:3001"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
info() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }

# Verify deployment is allowed
check_deployment_permission() {
    if [ -z "$DCC_DEPLOY_OK" ]; then
        error "DEPLOYMENT BLOCKED"
        echo ""
        echo "The pre-push hook requires DCC_DEPLOY_OK=1 environment variable"
        echo "Wilson CANNOT set this. Only Paul can approve deployment by saying:"
        echo "  'deploy dcc' or 'push dcc'"
        echo ""
        echo "Current workflow state:"
        echo "  1. You've verified local changes are correct"
        echo "  2. You've told Wilson to push"
        echo "  3. Wilson will now execute this script"
        echo ""
        exit 1
    fi
}

# Verify local server is healthy
check_local_health() {
    log "Checking local server health..."
    if ! curl -sf "$LOCAL_URL/api/health" &>/dev/null; then
        error "Local server not running on port 3001"
        exit 1
    fi
    log "✓ Local server healthy"
}

# Create comprehensive backup of Railway BEFORE any changes
backup_railway() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="$DCC_DIR/backups/railway/pre_deploy_${timestamp}"
    
    mkdir -p "$backup_dir"
    
    log "Creating Railway backup before deployment..."
    
    curl -sf "$RAILWAY_URL/api/data" > "$backup_dir/data.json"
    curl -sf "$RAILWAY_URL/api/capacity" > "$backup_dir/capacity.json"
    curl -sf "$RAILWAY_URL/api/priorities" > "$backup_dir/priorities.json"
    curl -sf "$RAILWAY_URL/api/business-lines" > "$backup_dir/business_lines.json"
    curl -sf "$RAILWAY_URL/api/brandOptions" > "$backup_dir/brand_options.json"
    
    # Create restore script
    cat > "$backup_dir/restore_railway.sh" << EOF
#!/bin/bash
# Restore Railway to state before deployment on ${timestamp}
# Usage: ./restore_railway.sh

RAILWAY_URL="$RAILWAY_URL"
BACKUP_DIR="\$(dirname "\$0")"

echo "Restoring Railway to pre-deploy state (${timestamp})..."

PROJECTS=\$(jq '.projects' "\$BACKUP_DIR/data.json")
TEAM=\$(jq '.team' "\$BACKUP_DIR/data.json")
ASSIGNMENTS=\$(jq '.assignments' "\$BACKUP_DIR/capacity.json")
PRIORITIES=\$(jq '.' "\$BACKUP_DIR/priorities.json")
BUSINESS_LINES=\$(jq '.' "\$BACKUP_DIR/business_lines.json")
BRAND_OPTIONS=\$(jq '.' "\$BACKUP_DIR/brand_options.json")

curl -s -X POST "\$RAILWAY_URL/api/seed" \\
  -H "Content-Type: application/json" \\
  -d "{\\"projects\":\$PROJECTS,\\"team\":\$TEAM,\\"assignments\":\$ASSIGNMENTS,\\"priorities\":\$PRIORITIES,\\"businessLines\":\$BUSINESS_LINES,\\"brandOptions\":\$BRAND_OPTIONS}"

echo "Restore complete. Verify at \$RAILWAY_URL/api/capacity"
EOF
    chmod +x "$backup_dir/restore_railway.sh"
    
    echo "$backup_dir" > "$DCC_DIR/backups/railway/LATEST_PRE_DEPLOY"
    log "✓ Railway backup created: $backup_dir"
    
    # Show what we're about to overwrite
    echo ""
    info "Current Railway state (will be overwritten):"
    echo "  Projects: $(jq '.projects | length' "$backup_dir/data.json")"
    echo "  Team: $(jq '.team | length' "$backup_dir/data.json")"
    echo "  Assignments: $(jq '.assignments | length' "$backup_dir/capacity.json")"
}

# Compare local vs Railway - show diff
show_deployment_preview() {
    echo ""
    info "=== DEPLOYMENT PREVIEW ==="
    echo ""
    
    # Get local counts
    local_local_projects=$(curl -sf "$LOCAL_URL/api/data" | jq '.projects | length')
    local_local_team=$(curl -sf "$LOCAL_URL/api/data" | jq '.team | length')
    local_local_assignments=$(curl -sf "$LOCAL_URL/api/capacity" | jq '.assignments | length')
    
    # Get Railway counts (from backup we just made)
    local backup_dir=$(cat "$DCC_DIR/backups/railway/LATEST_PRE_DEPLOY")
    local railway_projects=$(jq '.projects | length' "$backup_dir/data.json")
    local railway_team=$(jq '.team | length' "$backup_dir/data.json")
    local railway_assignments=$(jq '.assignments | length' "$backup_dir/capacity.json")
    
    printf "%-15s %10s %10s %10s\n" "" "Railway" "Local" "After Push"
    printf "%-15s %10s %10s %10s\n" "Projects" "$railway_projects" "$local_local_projects" "$local_local_projects"
    printf "%-15s %10s %10s %10s\n" "Team" "$railway_team" "$local_local_team" "$local_local_team"
    printf "%-15s %10s %10s %10s\n" "Assignments" "$railway_assignments" "$local_local_assignments" "$local_local_assignments"
    
    echo ""
    warn "⚠️  This will COMPLETELY OVERWRITE Railway database"
    echo "    Railway will match your local state exactly"
    echo ""
}

# Deploy code only (git push)
deploy_code() {
    log "Deploying code to Railway..."
    
    cd "$DCC_DIR"
    
    # Verify we're on main branch
    local current_branch=$(git branch --show-current)
    if [ "$current_branch" != "main" ]; then
        error "Not on main branch (currently: $current_branch)"
        exit 1
    fi
    
    # Show what we're pushing
    info "Commits to push:"
    git log --oneline origin/main..HEAD 2>/dev/null || echo "  (none or already up to date)"
    
    # Check for data/shared.db in commits
    if git diff --name-only HEAD~5..HEAD 2>/dev/null | grep -q "data/shared.db"; then
        error "COMMIT CONTAINS data/shared.db - DO NOT PUSH DB FILES"
        exit 1
    fi
    
    # Push with DCC_DEPLOY_OK (required by pre-push hook)
    log "Pushing to origin/main..."
    git push origin main
    
    log "✓ Code pushed. Railway will auto-deploy..."
    
    # Wait for deployment
    echo ""
    info "Waiting for Railway deployment (this takes ~60-120 seconds)..."
    local attempts=0
    while [ $attempts -lt 30 ]; do
        sleep 5
        if curl -sf "$RAILWAY_URL/api/health" &>/dev/null; then
            log "✓ Railway deployment complete"
            break
        fi
        echo -n "."
        attempts=$((attempts + 1))
    done
    
    if [ $attempts -eq 30 ]; then
        error "Deployment timeout - check Railway dashboard"
        exit 1
    fi
}

# Sync data to Railway
deploy_data() {
    echo ""
    log "Syncing data to Railway..."
    
    # Use the safe sync script
    "$DCC_DIR/scripts/sync-to-railway-safe.sh"
}

# Verify post-deployment state
verify_deployment() {
    echo ""
    log "=== POST-DEPLOYMENT VERIFICATION ==="
    echo ""
    
    # Check Railway health
    if curl -sf "$RAILWAY_URL/api/health" &>/dev/null; then
        log "✓ Railway health check passed"
    else
        error "✗ Railway health check failed"
        return 1
    fi
    
    # Check critical data
    local railway_assignments=$(curl -sf "$RAILWAY_URL/api/capacity" | jq '.assignments | length')
    local local_assignments=$(curl -sf "$LOCAL_URL/api/capacity" | jq '.assignments | length')
    
    if [ "$railway_assignments" -eq "$local_assignments" ]; then
        log "✓ Assignment counts match: $railway_assignments"
    else
        error "✗ Assignment count mismatch: Railway=$railway_assignments, Local=$local_assignments"
        return 1
    fi
    
    # Check Fariah's data (critical from previous incident)
    local fariah_data=$(curl -sf "$RAILWAY_URL/api/capacity" | jq '.assignments[] | select(.designer_name | contains("Fariah")) | {project_name, allocation_percent}')
    if [ -n "$fariah_data" ]; then
        log "✓ Fariah's data present"
        echo "$fariah_data" | jq '.'
    else
        warn "⚠️  No assignments found for Fariah"
    fi
    
    echo ""
    log "✅ DEPLOYMENT SUCCESSFUL"
    echo ""
    info "Rollback available at:"
    echo "  $(cat $DCC_DIR/backups/railway/LATEST_PRE_DEPLOY)/restore_railway.sh"
}

# Main execution
main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     DCC DEPLOYMENT WORKFLOW - Phase 3: PUSH              ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Step 1: Verify deployment permission
    check_deployment_permission
    
    # Step 2: Check local health
    check_local_health
    
    # Step 3: Backup Railway
    backup_railway
    
    # Step 4: Show preview
    show_deployment_preview
    
    # Step 5: Deploy code
    deploy_code
    
    # Step 6: Deploy data
    deploy_data
    
    # Step 7: Verify
    verify_deployment
}

# Run main
main "$@"
