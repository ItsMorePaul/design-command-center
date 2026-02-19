#!/bin/bash
# Sync local DB to Railway

LOCAL_DB="/Users/wilson/.openclaw/workspace/design-command-center/data/shared.db"
RAILWAY_URL="https://design-command-center-production.up.railway.app"

echo "Exporting from local..."
PROJECTS=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM projects" | jq '.')
TEAM=$(sqlite3 -json "$LOCAL_DB" "SELECT * FROM team" | jq '.')

echo "Pushing to Railway..."
curl -s -X POST "$RAILWAY_URL/api/seed" \
  -H "Content-Type: application/json" \
  -d "{\"projects\":$PROJECTS,\"team\":$TEAM}"

echo "Done!"
