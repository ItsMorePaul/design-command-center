#!/bin/bash
# Backup Railway production DB before risky operations
# Created: 2026-03-03 (post-incident)

RAILWAY_URL="https://design-command-center-production.up.railway.app"
BACKUP_DIR="$HOME/.openclaw/workspace/design-command-center/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "Creating Railway backup at $TIMESTAMP..."

# Fetch all data
curl -sf "$RAILWAY_URL/api/data" > "$BACKUP_DIR/data_${TIMESTAMP}.json"
curl -sf "$RAILWAY_URL/api/capacity" > "$BACKUP_DIR/capacity_${TIMESTAMP}.json"
curl -sf "$RAILWAY_URL/api/priorities" > "$BACKUP_DIR/priorities_${TIMESTAMP}.json"
curl -sf "$RAILWAY_URL/api/business-lines" > "$BACKUP_DIR/business_lines_${TIMESTAMP}.json"
curl -sf "$RAILWAY_URL/api/brandOptions" > "$BACKUP_DIR/brand_options_${TIMESTAMP}.json"

# Create restore script
cat > "$BACKUP_DIR/restore_${TIMESTAMP}.sh" << 'EOF'
#!/bin/bash
# Restore Railway from backup
# Usage: ./restore_YYYYMMDD_HHMMSS.sh

RAILWAY_URL="https://design-command-center-production.up.railway.app"
BACKUP_DIR="$(dirname "$0")"
TIMESTAMP="$(basename "$0" | sed 's/restore_//' | sed 's/.sh//')"

echo "Restoring Railway from backup: $TIMESTAMP"

PROJECTS=$(jq '.projects' "$BACKUP_DIR/data_${TIMESTAMP}.json")
TEAM=$(jq '.team' "$BACKUP_DIR/data_${TIMESTAMP}.json")
ASSIGNMENTS=$(jq '.assignments' "$BACKUP_DIR/capacity_${TIMESTAMP}.json")
PRIORITIES=$(jq '.' "$BACKUP_DIR/priorities_${TIMESTAMP}.json")
BUSINESS_LINES=$(jq '.' "$BACKUP_DIR/business_lines_${TIMESTAMP}.json")
BRAND_OPTIONS=$(jq '.' "$BACKUP_DIR/brand_options_${TIMESTAMP}.json")

curl -s -X POST "$RAILWAY_URL/api/seed" \
  -H "Content-Type: application/json" \
  -d "{\"projects\":$PROJECTS,\"team\":$TEAM,\"assignments\":$ASSIGNMENTS,\"priorities\":$PRIORITIES,\"businessLines\":$BUSINESS_LINES,\"brandOptions\":$BRAND_OPTIONS}"

echo "Restore complete. Verify at $RAILWAY_URL/api/capacity"
EOF

chmod +x "$BACKUP_DIR/restore_${TIMESTAMP}.sh"

echo "✓ Backup created: $BACKUP_DIR/data_${TIMESTAMP}.json"
echo "✓ Restore script: $BACKUP_DIR/restore_${TIMESTAMP}.sh"
echo ""
echo "To restore: ./backups/restore_${TIMESTAMP}.sh"
