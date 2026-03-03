#!/bin/bash
# Safe sync from local to Railway with explicit confirmation
# Created: 2026-03-03 (post-incident)

LOCAL_DB="/Users/wilson/.openclaw/workspace/design-command-center/data/shared.db"
RAILWAY_URL="https://design-command-center-production.up.railway.app"

echo "=== DCC Safe Sync to Railway ==="
echo ""

# Show current counts
echo "Local counts:"
echo "  Projects: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM projects;')"
echo "  Team: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM team;')"
echo "  Assignments: $(sqlite3 "$LOCAL_DB" 'SELECT COUNT(*) FROM project_assignments;')"
echo ""

echo "Railway current counts:"
echo "  Projects: $(curl -sf "$RAILWAY_URL/api/data" | jq '.projects | length')"
echo "  Team: $(curl -sf "$RAILWAY_URL/api/data" | jq '.team | length')"
echo "  Assignments: $(curl -sf "$RAILWAY_URL/api/capacity" | jq '.assignments | length')"
echo ""

# CRITICAL: Check for Fariah's data
LOCAL_FARIAH=$(sqlite3 "$LOCAL_DB" "SELECT SUM(allocation_percent) FROM project_assignments WHERE designer_id = '2';")
if [ "$LOCAL_FARIAH" = "0.0" ] || [ -z "$LOCAL_FARIAH" ]; then
    echo "⚠️  WARNING: Fariah has 0% allocation in local DB"
    echo "   This will OVERWRITE Railway's Fariah data with zeros!"
    echo ""
fi

# Confirm
echo "⚠️  This will OVERWRITE Railway's database with local data!"
read -p "Type 'yes' to proceed with backup first: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 1
fi

# Backup first
echo ""
echo "Creating backup..."
"$(dirname "$0")/backup-railway.sh"

# Final confirmation
read -p "Backup created. Type 'OVERWRITE' to sync local to Railway: " FINAL_CONFIRM

if [ "$FINAL_CONFIRM" != "OVERWRITE" ]; then
    echo "Cancelled."
    exit 1
fi

# Export local data
PROJECTS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM projects" | jq '.')
TEAM=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM team" | jq '.')
ASSIGNMENTS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_assignments" | jq '.')
PRIORITIES=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM project_priorities" | jq '.')
BUSINESS_LINES=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM business_lines" | jq '.')
BRAND_OPTIONS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM brand_options" | jq '.')

echo ""
echo "Syncing to Railway..."
RESULT=$(curl -s -X POST "$RAILWAY_URL/api/seed" \
  -H "Content-Type: application/json" \
  -d "{\"projects\":$PROJECTS,\"team\":$TEAM,\"assignments\":$ASSIGNMENTS,\"priorities\":$PRIORITIES,\"businessLines\":$BUSINESS_LINES,\"brandOptions\":$BRAND_OPTIONS}")

echo "$RESULT" | jq '.'

echo ""
echo "Verify: $RAILWAY_URL/api/capacity"
