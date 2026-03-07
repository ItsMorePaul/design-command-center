#!/bin/bash
# dcc-verify-sync.sh - Comprehensive sync verification
# Run this after every sync to ensure data integrity

set -e

RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_URL="http://localhost:3001"
DCC_DIR="$HOME/.openclaw/workspace/work/design-command-center"

ERRORS=0
WARNINGS=0

check_count() {
    local name="$1"
    local railway_count="$2"
    local local_count="$3"
    
    if [ "$railway_count" -eq "$local_count" ]; then
        echo "  ✅ $name: $railway_count"
        return 0
    else
        echo "  ❌ $name: Railway=$railway_count, Local=$local_count (DIFF: $((railway_count - local_count)))"
        ((ERRORS++))
        return 1
    fi
}

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  DCC SYNC VERIFICATION                                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 1. Check all table counts
echo "📊 TABLE COUNTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

R_PROJECTS=$(curl -sf "$RAILWAY_URL/api/data" | jq '.projects | length')
L_PROJECTS=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM projects')
check_count "Projects" "$R_PROJECTS" "$L_PROJECTS"

R_TEAM=$(curl -sf "$RAILWAY_URL/api/data" | jq '.team | length')
L_TEAM=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM team')
check_count "Team" "$R_TEAM" "$L_TEAM"

R_ASSIGNMENTS=$(curl -sf "$RAILWAY_URL/api/capacity" | jq '.assignments | length')
L_ASSIGNMENTS=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM project_assignments')
check_count "Assignments" "$R_ASSIGNMENTS" "$L_ASSIGNMENTS"

R_PRIORITIES=$(curl -sf "$RAILWAY_URL/api/priorities" | jq 'length')
L_PRIORITIES=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM project_priorities')
check_count "Priorities" "$R_PRIORITIES" "$L_PRIORITIES"

R_BL=$(curl -sf "$RAILWAY_URL/api/business-lines" | jq 'length')
L_BL=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM business_lines')
check_count "Business Lines" "$R_BL" "$L_BL"

R_BRANDS=$(curl -sf "$RAILWAY_URL/api/data" | jq '.brandOptions | length')
L_BRANDS=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM brand_options')
check_count "Brand Options" "$R_BRANDS" "$L_BRANDS"

R_NOTES=$(curl -sf "$RAILWAY_URL/api/notes" | jq 'length')
L_NOTES=$(sqlite3 "$DCC_DIR/data/shared.db" 'SELECT COUNT(*) FROM notes')
check_count "Notes" "$R_NOTES" "$L_NOTES"

echo ""

# 2. Check project statuses
echo "📋 PROJECT STATUS COUNTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

R_ACTIVE=$(curl -sf "$RAILWAY_URL/api/data" | jq '[.projects[] | select(.status == "active")] | length')
L_ACTIVE=$(sqlite3 "$DCC_DIR/data/shared.db" "SELECT COUNT(*) FROM projects WHERE status = 'active'")
check_count "Active Projects" "$R_ACTIVE" "$L_ACTIVE"

R_DONE=$(curl -sf "$RAILWAY_URL/api/data" | jq '[.projects[] | select(.status == "done")] | length')
L_DONE=$(sqlite3 "$DCC_DIR/data/shared.db" "SELECT COUNT(*) FROM projects WHERE status = 'done'")
check_count "Done Projects" "$R_DONE" "$L_DONE"

echo ""

# 3. Check priority rankings for each business line
echo "🎯 PRIORITY RANKINGS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

BUSINESS_LINES="barron-s ibd mansion-global marketwatch messaging"
for bl in $BUSINESS_LINES; do
    R_ORDER=$(curl -sf "$RAILWAY_URL/api/priorities" | jq -r --arg bl "$bl" 'map(select(.business_line_id == $bl)) | sort_by(.rank) | map(.project_id) | join(",")')
    L_ORDER=$(sqlite3 "$DCC_DIR/data/shared.db" "SELECT project_id FROM project_priorities WHERE business_line_id = '$bl' ORDER BY rank" | tr '\n' ',' | sed 's/,$//')
    
    if [ "$R_ORDER" = "$L_ORDER" ]; then
        echo "  ✅ $bl: priorities match"
    else
        echo "  ❌ $bl: priority mismatch"
        echo "     Railway: $R_ORDER"
        echo "     Local:   $L_ORDER"
        ((ERRORS++))
    fi
done

echo ""

# 4. Check specific projects that often have issues
echo "🔍 SPOT CHECK: Specific Projects"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check BIC project
R_BIC=$(curl -sf "$RAILWAY_URL/api/data" | jq -r '.projects[] | select(.id == "1772155238689") | "\(.name)|\(.status)"')
L_BIC=$(sqlite3 "$DCC_DIR/data/shared.db" "SELECT name || '|' || status FROM projects WHERE id = '1772155238689'")

if [ "$R_BIC" = "$L_BIC" ]; then
    echo "  ✅ BIC Project (1772155238689): $R_BIC"
else
    echo "  ❌ BIC Project mismatch"
    echo "     Railway: $R_BIC"
    echo "     Local:   $L_BIC"
    ((ERRORS++))
fi

echo ""

# 5. Summary
echo "════════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
    echo "✅ ALL CHECKS PASSED - SYNC IS VALID"
    exit 0
else
    echo "❌ SYNC VERIFICATION FAILED"
    echo "   Errors: $ERRORS"
    echo ""
    echo "ACTION REQUIRED:"
    echo "  1. Run: ./scripts/dcc-sync.sh pull"
    echo "  2. Or manually fix discrepancies"
    exit 1
fi
