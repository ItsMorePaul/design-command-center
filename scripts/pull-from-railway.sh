#!/bin/bash
# Pull data from Railway production DB to local SQLite
# Reverse of sync-to-railway.sh

RAILWAY_URL="https://design-command-center-production.up.railway.app"
LOCAL_SERVER="http://localhost:3001"
DCC_DIR="$HOME/.openclaw/workspace/design-command-center"

echo "Fetching data from Railway..."
DATA=$(curl -sf "$RAILWAY_URL/api/data")

if [ $? -ne 0 ] || [ -z "$DATA" ]; then
    echo "ERROR: Failed to fetch from Railway. Is the URL correct and the server running?"
    exit 1
fi

# Extract projects and team arrays from the /api/data response
PROJECTS=$(echo "$DATA" | jq '.projects')
TEAM=$(echo "$DATA" | jq '.team')

if [ "$PROJECTS" = "null" ] || [ "$TEAM" = "null" ]; then
    echo "ERROR: Response missing projects or team data."
    exit 1
fi

PROJECT_COUNT=$(echo "$PROJECTS" | jq 'length')
TEAM_COUNT=$(echo "$TEAM" | jq 'length')
echo "Fetched $PROJECT_COUNT projects, $TEAM_COUNT team members from Railway."

# Check if local server is running, start if not
if ! curl -sf "$LOCAL_SERVER/api/health" &>/dev/null; then
    echo "Local server not running on port 3001. Starting it now..."
    cd "$DCC_DIR"
    NODE_ENV=production npm start &>/tmp/dcc-server.log &
    SERVER_PID=$!
    
    # Wait for server to be ready (max 30 seconds)
    for i in {1..30}; do
        if curl -sf "$LOCAL_SERVER/api/health" &>/dev/null; then
            echo "Server ready (PID: $SERVER_PID)"
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

echo "Seeding local database via $LOCAL_SERVER/api/seed ..."
RESULT=$(curl -sf -X POST "$LOCAL_SERVER/api/seed" \
  -H "Content-Type: application/json" \
  -d "{\"projects\":$PROJECTS,\"team\":$TEAM}")

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to seed local DB."
    exit 1
fi

echo "Success! Local DB updated with Railway production data."
echo "Response: $RESULT"
