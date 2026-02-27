#!/bin/bash
# Pull data from Railway production DB to local SQLite
# Reverse of sync-to-railway.sh

RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_SERVER="http://localhost:3001"
DCC_DIR="$HOME/.openclaw/workspace/design-command-center"

echo "Fetching data from Railway..."

# Fetch main data
DATA=$(curl -sf "$RAILWAY_URL/api/data")
if [ $? -ne 0 ] || [ -z "$DATA" ]; then
    echo "ERROR: Failed to fetch from Railway. Is the URL correct and the server running?"
    exit 1
fi

PROJECTS=$(echo "$DATA" | jq '.projects')
TEAM=$(echo "$DATA" | jq '.team')
PROJECT_COUNT=$(echo "$PROJECTS" | jq 'length')
TEAM_COUNT=$(echo "$TEAM" | jq 'length')
echo "✓ Fetched $PROJECT_COUNT projects, $TEAM_COUNT team members"

# Fetch capacity data (includes project_assignments)
CAPACITY=$(curl -sf "$RAILWAY_URL/api/capacity")
if [ $? -ne 0 ] || [ -z "$CAPACITY" ]; then
    echo "WARNING: Failed to fetch capacity data"
    ASSIGNMENTS="[]"
else
    ASSIGNMENTS=$(echo "$CAPACITY" | jq '.assignments // []')
    echo "✓ Fetched $(echo "$ASSIGNMENTS" | jq 'length') project assignments"
fi

# Fetch priorities (force rankings)
PRIORITIES=$(curl -sf "$RAILWAY_URL/api/priorities")
if [ $? -ne 0 ] || [ -z "$PRIORITIES" ]; then
    echo "WARNING: Failed to fetch priorities"
    PRIORITIES="[]"
else
    echo "✓ Fetched $(echo "$PRIORITIES" | jq 'length') priority entries"
fi

# Fetch business lines
BUSINESS_LINES=$(curl -sf "$RAILWAY_URL/api/business-lines")
if [ $? -ne 0 ] || [ -z "$BUSINESS_LINES" ]; then
    echo "WARNING: Failed to fetch business lines"
    BUSINESS_LINES="[]"
else
    echo "✓ Fetched $(echo "$BUSINESS_LINES" | jq 'length') business lines"
fi

# Fetch brand options
BRAND_OPTIONS=$(curl -sf "$RAILWAY_URL/api/brandOptions")
if [ $? -ne 0 ] || [ -z "$BRAND_OPTIONS" ]; then
    echo "WARNING: Failed to fetch brand options"
    BRAND_OPTIONS="[]"
else
    echo "✓ Fetched $(echo "$BRAND_OPTIONS" | jq 'length') brand options"
fi

# Check if local server is running, start if not
if ! curl -sf "$LOCAL_SERVER/api/health" &>/dev/null; then
    echo ""
    echo "Local server not running on port 3001. Starting it now..."
    cd "$DCC_DIR"
    NODE_ENV=production npm start &>/tmp/dcc-server.log &
    SERVER_PID=$!
    
    # Wait for server to be ready (max 30 seconds)
    for i in {1..30}; do
        if curl -sf "$LOCAL_SERVER/api/health" &>/dev/null; then
            echo "✓ Server ready (PID: $SERVER_PID)"
            break
        fi
        sleep 1
    done
    
    # Final check
    if ! curl -sf "$LOCAL_SERVER/api/health" &>/dev/null; then
        echo "ERROR: Server failed to start within 30 seconds. Check /tmp/dcc-server.log"
        exit 1
    fi
fi

# Seed all data
echo ""
echo "Seeding local database..."
RESULT=$(curl -sf -X POST "$LOCAL_SERVER/api/seed" \
  -H "Content-Type: application/json" \
  -d "{\"projects\":$PROJECTS,\"team\":$TEAM,\"assignments\":$ASSIGNMENTS,\"priorities\":$PRIORITIES,\"businessLines\":$BUSINESS_LINES,\"brandOptions\":$BRAND_OPTIONS}")

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to seed local DB."
    exit 1
fi

echo "✓ Success! Local DB updated from Railway"
echo ""
echo "Synced:"
echo "  - Projects: $PROJECT_COUNT"
echo "  - Team: $TEAM_COUNT"
echo "  - Assignments: $(echo "$ASSIGNMENTS" | jq 'length')"
echo "  - Priorities: $(echo "$PRIORITIES" | jq 'length')"
echo "  - Business Lines: $(echo "$BUSINESS_LINES" | jq 'length')"
echo "  - Brand Options: $(echo "$BRAND_OPTIONS" | jq 'length')"
