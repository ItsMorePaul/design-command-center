#!/bin/bash
# Verify Railway → Local sync completed successfully
# Exit 0 if all data matches, Exit 1 if discrepancies found

RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_SERVER="http://localhost:3001"

ERRORS=0

echo "=== DCC RAILWAY SYNC VERIFICATION ==="
echo ""

# Check local server is running
if ! curl -sf "$LOCAL_SERVER/api/health" &>/dev/null; then
    echo "ERROR: Local server not running on port 3001"
    echo "Start with: cd ~/.openclaw/workspace/design-command-center && npm start"
    exit 1
fi

# Function to compare counts
compare_table() {
    local name=$1
    local railway_endpoint=$2
    local jq_filter=$3
    
    RAILWAY_COUNT=$(curl -sf "$RAILWAY_URL$railway_endpoint" 2>/dev/null | jq "$jq_filter" 2>/dev/null)
    LOCAL_COUNT=$(curl -sf "$LOCAL_SERVER$railway_endpoint" 2>/dev/null | jq "$jq_filter" 2>/dev/null)
    
    if [ -z "$RAILWAY_COUNT" ]; then RAILWAY_COUNT="0"; fi
    if [ -z "$LOCAL_COUNT" ]; then LOCAL_COUNT="0"; fi
    
    printf "%-20s Railway: %-4s Local: %-4s " "$name" "$RAILWAY_COUNT" "$LOCAL_COUNT"
    
    if [ "$RAILWAY_COUNT" -eq "$LOCAL_COUNT" ]; then
        echo "✓"
        return 0
    else
        echo "✗ MISMATCH"
        return 1
    fi
}

# Verify all tables
compare_table "Projects" "/api/data" ".projects | length" || ERRORS=$((ERRORS + 1))
compare_table "Team" "/api/data" ".team | length" || ERRORS=$((ERRORS + 1))
compare_table "Assignments" "/api/capacity" ".assignments | length" || ERRORS=$((ERRORS + 1))
compare_table "Priorities" "/api/priorities" "length" || ERRORS=$((ERRORS + 1))
compare_table "Business Lines" "/api/business-lines" "length" || ERRORS=$((ERRORS + 1))
compare_table "Brand Options" "/api/brandOptions" "length" || ERRORS=$((ERRORS + 1))

echo ""

# Deep verification of priorities (force rankings)
echo "Verifying priority data (Barron's sample):"
RAILWAY_BARRONS=$(curl -sf "$RAILWAY_URL/api/priorities" | jq '[.[] | select(.business_line_id == "barron-s")] | length')
LOCAL_BARRONS=$(curl -sf "$LOCAL_SERVER/api/priorities" | jq '[.[] | select(.business_line_id == "barron-s")] | length')
printf "  Barron's priorities:  Railway: %-4s Local: %-4s " "$RAILWAY_BARRONS" "$LOCAL_BARRONS"
if [ "$RAILWAY_BARRONS" -eq "$LOCAL_BARRONS" ]; then
    echo "✓"
else
    echo "✗ MISMATCH"
    ERRORS=$((ERRORS + 1))
fi

echo ""

if [ $ERRORS -eq 0 ]; then
    echo "✅ ALL DATA MATCHES - Sync successful"
    exit 0
else
    echo "❌ $ERRORS TABLE(S) MISMATCH - Re-run: ./scripts/pull-from-railway.sh"
    exit 1
fi
