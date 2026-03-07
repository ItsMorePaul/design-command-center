#!/bin/bash
# rebuild-note-links.sh - Rebuild note_project_links from notes data
# 
# note_project_links is a local-only optimization table derived from notes.projects_raw
# This script rebuilds it after syncing notes from Railway.
# 
# note_people_links requires name→team_id mapping which is complex and not critical
# Those links will be incomplete after sync but core notes data is preserved.

DCC_DIR="$HOME/.openclaw/workspace/work/design-command-center"
DB="$DCC_DIR/data/shared.db"

echo "Rebuilding note_project_links from notes.projects_raw..."

# Clear existing project links
sqlite3 "$DB" "DELETE FROM note_project_links"

# Rebuild from notes that have projects_raw matching project names
# This is a best-effort rebuild - exact project ID matching from text is complex
sqlite3 "$DB" << 'EOF'
INSERT INTO note_project_links (note_id, project_id)
SELECT DISTINCT
    n.id as note_id,
    p.id as project_id
FROM notes n
JOIN projects p ON n.projects_raw LIKE '%' || p.id || '%'
WHERE n.projects_raw != '';
EOF

PROJECT_LINKS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM note_project_links")

echo "✓ Rebuilt note_project_links: $PROJECT_LINKS entries"
echo ""
echo "Note: note_people_links requires complex name→team_id mapping."
echo "These links may be incomplete after sync, but core notes data is preserved."
