# Design Command Center — Project Log

**GitHub:** https://github.com/ItsMorePaul/design-command-center  
**Railway (Production):** https://design-command-center-production.up.railway.app  
**Local dev:** http://192.168.0.22:5173 (Vite) + http://localhost:3001 (API)  
**Local repo:** `~/.openclaw/workspace/design-command-center/`

---

## How to Run Locally

```bash
cd ~/.openclaw/workspace/design-command-center

# Start API server (port 3001)
NODE_ENV=production npm start &>> /tmp/dcc-server.log &

# Start Vite dev server (port 5173, network-accessible)
npm run dev &>> /tmp/dcc-vite.log &
```

---

## Versioning Rules (CRITICAL — read before touching versions)

**UI display format:** `Site: 2026.02.26 2059` / `DB: 2026.02.26 2059`

### Site Version — MANUAL, set on every commit
- Two constants in `server.ts` — **update BOTH, every single time, no exceptions:**
  ```ts
  // Format: YYYY.MM.DD.hhmm (periods, no pipe, full year)
  const SITE_VERSION = '2026.02.26.2059'  // Internal code format
  const SITE_TIME = '2059'                 // Just the time portion
  ```
- Use Pacific Time (PST/PDT).
- The internal format is nearly identical to display — just replace last `.` with ` `

### DB Version — FULLY AUTOMATIC. NEVER SET MANUALLY.
- Updates itself on every DB write via `updateDbVersion()` → `generateDbVersionParts()` in `server.ts`
- **Internal format:** `YYYY.MM.DD.hhmm` (e.g., `2026.02.26.2059`)
- **DB storage:** Same format as site version
- ❌ **NEVER** run `sqlite3 ... UPDATE app_versions SET db_version` manually
- ❌ **NEVER** hardcode DB version anywhere outside `generateDbVersionParts()`
- ✅ To READ current DB version for documentation: `sqlite3 data/shared.db "SELECT db_version, db_time FROM app_versions WHERE key='dcc_versions';"`

### UI Display (what users actually see)
- Sidebar footer shows: `Site: 2026.02.26 2059` / `DB: 2026.02.26 2059`
- Formatted by `formatVersionDisplay()` in `src/App.tsx` — simply replaces last `.` with space
- Legacy format `v260226|2059` still supported for backwards compatibility

### On every "save site" checkpoint
1. Update `SITE_VERSION` and `SITE_TIME` in `server.ts` to current PST time
2. Commit: `git add -A && git commit -m "..."`
3. Tag the commit (see format below)
4. READ (never set) DB version: `sqlite3 data/shared.db "SELECT db_version, db_time FROM app_versions WHERE key='dcc_versions';"`
5. Document checkpoint in this file

---

## "Save Site" Protocol

When Paul says **"save site"**, Wilson will:

1. Update `SITE_VERSION` + `SITE_TIME` in `server.ts` to current PST time
2. `git add -A && git commit -m "<description of session work>"`
3. `git tag -a <tag-name> -m "<description>"`
4. READ (never set) current DB version: `sqlite3 data/shared.db "SELECT db_version, db_time FROM app_versions WHERE key='dcc_versions';"`
5. Document the checkpoint in this file with full rollback instructions

> ⚠️ DB version is AUTOMATIC. Wilson must NEVER manually update the DB version table.  
> Only READ it for documentation. The server sets it on every write.

### Tag naming format
```
v<YYMMDD>-<short-descriptor>
```
Examples: `v260226-modal-polish`, `v260226-capacity-gauges`, `v260227-search-redesign`

### To roll back to any checkpoint (local)
```bash
cd ~/.openclaw/workspace/design-command-center
git checkout <tag-name>
# or
git checkout <commit-hash>
```

### To roll back Railway (production)
```bash
# Deploy a specific commit to Railway
git push origin <commit-hash>:main --force
# Then wait ~2 minutes for Railway to redeploy
# Verify: curl https://design-command-center-production.up.railway.app/api/versions
```

> ⚠️ Railway DB is independent. Rolling back code does not roll back Railway's SQLite data.  
> Local DB (`data/shared.db`) and Railway DB are separate — seed endpoint exists at `POST /api/seed` to push local data to Railway.

---

## Checkpoints

---

### ✅ v260226-modal-polish
**Date:** 2026-02-26  
**Time:** ~6:05 PM PST  
**Git tag:** `v260226-modal-polish`  
**Commit:** `e655a9c`  
**Site version:** `2026.2.26 1905`  
**DB version at save:** `2026.2.26 1905`

**To restore:**
```bash
git checkout v260226-modal-polish
```

#### What was built in this session

**Version display fix**
- `server.ts` now has `SITE_VERSION` + `SITE_TIME` as separate constants (both must be updated together)
- `formatVersionDisplay()` added to `App.tsx` — parses `vYYMMDD|HHMM` and renders `YYYY.M.D HHMM`
- Sidebar footer now shows formatted human-readable versions for both Site and DB

**Modal structure — Project + Team Member**
- Both modals converted to consistent `modal-header` / `modal-body` / `modal-footer` layout
- Fixed header (title, bordered bottom), scrollable body, fixed footer (Cancel + Save)
- Old bare `<h2>` + `modal-actions` pattern removed everywhere

**Floating label inputs**
- New `.float-field` CSS class — label sits inside field, animates up + shrinks when focused or filled
- Label color when floated: `var(--color-text-muted)` (gray, not accent blue)
- Works via CSS `:focus ~ label` + `:not(:placeholder-shown) ~ label` + `.has-value` class on wrapper
- Inputs require `placeholder=" "` (single space) for the `:not(:placeholder-shown)` selector to work

**Paired form rows**
- Project modal pairs: Name/Link, Deck Name/Deck Link, PRD Name/PRD Link, Brief Name/Brief Link, Start/End Date
- Team modal pairs: Name/Role, Slack/Email
- Uses existing `.form-row` CSS (2-column grid)

**Project modal section order**
1. Basic Info (Name, Link, Business Lines)
2. Design Artifacts (Deck, PRD, Brief, Figma — paired name+link rows)
3. Custom Links (up to 3, paired columns with trash button)
4. Status (button group) + Schedule (Start/End dates, Timeline Ranges)
5. Designers (checkboxes)

**Team modal section order**
1. Identity (Name, Role — side by side)
2. Contact (Slack, Email — side by side)
3. Status (Online / Away / Offline buttons)
4. Business Lines (checkboxes)
5. Time Off (timeline-style list with edit modal)

**Custom links**
- Layout: `grid-template-columns: 1fr 1fr auto` — two float-field inputs + trash button
- Remove button styled identically to `action-btn delete` (36×36px, gray bg, red on hover, trash icon)

**Time Off — new pattern**
- Replaced inline-editing rows with timeline-range pattern:
  - Header row: "Time Off" label + "+ Add" button
  - List of items: label + formatted date range + pencil/trash actions
  - Pencil opens `showTimeOffModal` — same compact modal as timeline ranges
- New state: `showTimeOffModal`, `editingTimeOff`, `timeOffFormData`
- New handlers: `handleAddTimeOff`, `handleEditTimeOff`, `handleDeleteTimeOff`, `handleSaveTimeOff`

**Timeline modal — also updated**
- Converted from bare layout to `modal-header` / `modal-body` / `modal-footer`
- Uses floating labels + paired Start/End date row
- `maxWidth: 360` (compact)

**Date formatting**
- `formatShortDate(dateStr)` added — converts `2026-02-01` → `Feb 1, 2026`
- Applied to both timeline ranges and time off date displays

---

### ✅ v260226-operating-rules
**Date:** 2026-02-26  
**Time:** ~6:48 PM PST  
**Git tag:** `v260226-operating-rules`  
**Commit:** `618a902`  
**Site version:** `2026.2.26 1848`  
**DB version at save:** `2026.2.26 1905`

**To restore:**
```bash
git checkout v260226-operating-rules
```

#### What was built in this checkpoint
- `DCC_PROJECT_LOG.md` created — full operating manual for this project
- `MEMORY.md` updated with complete DCC operating rules:
  - Versioning rules (SITE_VERSION + SITE_TIME both required)
  - "Save site" protocol (6-step process)
  - Local dev startup commands
  - No-deploy-without-permission rule
  - Railway vs local DB independence note
- VS Code open command documented: `open -a "Visual Studio Code" <path>`

---

### ✅ v260226-dnd-timeline
**Date:** 2026-02-26  
**Time:** 7:14 PM PST  
**Git tag:** `v260226-dnd-timeline`  
**Commit:** `578cf2c`  
**Site version:** `2026.2.26 1914`  
**DB version at save:** `2026.2.26 1912`

**To restore:**
```bash
git checkout v260226-dnd-timeline
```

#### What was built in this checkpoint

**Drag-and-drop timeline reordering**
- Library: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` — React 19 compatible, clean build confirmed before implementing
- New component: `SortableTimelineItem` — wraps each timeline range with drag handle (grip icon), edit, and delete buttons
- `DragEndEvent` imported as type-only (required by `verbatimModuleSyntax`)
- Drag updates `projectFormData.timeline` state via `arrayMove` — persists to DB on Save Changes
- Activation constraint: 5px distance prevents accidental drags on click
- Drag handle: `GripVertical` icon, 40% opacity, full opacity on hover, `cursor: grab`
- `.drag-handle` CSS added to `App.css`

**DB version format bug fixed**
- `generateDbVersionParts()` was returning `vYYMMDD` without the time — now returns `vYYMMDD|HHMM`
- DB version is AUTOMATIC — server sets it on every write, never touch manually

**Docs updated**
- `MEMORY.md` and `DCC_PROJECT_LOG.md` both updated with unambiguous rule: DB version = automatic, never set manually

---

### ✅ v260226-calendar-filter-default
**Date:** 2026-02-26  
**Time:** 8:39 PM PST  
**Git tag:** `v260226-calendar-filter-default`  
**Commit:** `f367382`  
**Site version:** `2026.2.26 2039`  
**DB version at save:** `2026.2.26 1941`

**To restore:**
```bash
git checkout v260226-calendar-filter-default
```

#### What was built in this checkpoint
- Calendar filter default now selects all designers on initial load
- Added useEffect in `App.tsx` that initializes `calendarFilters.designers` with all team member names once team data is loaded
- Only initializes if designers array is empty (preserves user selections after first load)
- Site version updated to `2026.2.26 2039`

---

### ✅ v260226-version-format-docs
**Date:** 2026-02-26  
**Time:** 8:44 PM PST  
**Git tag:** `v260226-version-format-docs`  
**Commit:** `7329564`  
**Site version:** `2026.2.26 2044`  
**DB version at save:** `2026.2.26 1941`

**To restore:**
```bash
git checkout v260226-version-format-docs
```

#### What was built in this checkpoint
**Documentation clarity — version formats**
- Updated `DCC_PROJECT_LOG.md` versioning rules section:
  - Added "INTERNAL CODE FORMAT — used in server.ts only, never shown to users" comment
  - Added explicit warning: "⚠️ CRITICAL: The `vYYMMDD|HHMM` format is INTERNAL CODE ONLY"
  - Clarified that checkpoints must always use DISPLAY format (`2026.2.26 2039`)
- Updated `MEMORY.md` with same clarifications:
  - Added "INTERNAL CODE FORMAT (server.ts only)" labels
  - Added "Display format" vs "Internal format" distinctions
  - Updated all examples to use consistent time (2039)
- Removed all `v260226|2039` → `2026.2.26 2039` conversion arrows from checkpoint entries
- Site version updated to `v260226|2044`

---

### ✅ v260226-save-site
**Date:** 2026-02-26  
**Time:** 8:46 PM PST  
**Git tag:** `v260226-save-site`  
**Commit:** `11763a2`  
**Site version:** `2026.2.26 2046`  
**DB version at save:** `2026.2.26 1941`

**To restore:**
```bash
git checkout v260226-save-site
```

#### What was built in this checkpoint
- "Save site" protocol checkpoint — no new features, just capturing current state
- Site version updated to `v260226|2046`

---

### ✅ v260226-priority-hide-filters
**Date:** 2026-02-26  
**Time:** 8:53 PM PST  
**Git tag:** `v260226-priority-hide-filters`  
**Commit:** `e4f24a4`  
**Site version:** `2026.2.26 2053`  
**DB version at save:** `2026.2.26 1941`

**To restore:**
```bash
git checkout v260226-priority-hide-filters
```

#### What was built in this checkpoint
**Priority view UI cleanup**
- When Priority tab is selected, the "Filter:" row is now completely hidden
- The filter pills (Business Line, Designer, Status) no longer appear in priority mode
- The sort row still shows the "Business Line:" dropdown (required for priority view functionality)
- Changed condition from `{showProjectFilter() && (...)}` to `{projectViewMode === 'list' && showProjectFilter() && (...)}`

---

### ✅ v260226-period-version-format
**Date:** 2026-02-26  
**Time:** 8:59 PM PST  
**Git tag:** `v260226-period-version-format`  
**Commit:** `4c693b6`  
**Site version:** `2026.02.26 2059`  
**DB version at save:** `2026.02.26 2055`

**To restore:**
```bash
git checkout v260226-period-version-format
```

#### What was built in this checkpoint
**Period-based version format**
- Changed internal version format from `v260226|2059` to `2026.02.26.2059`
- Display conversion is now trivial: replace last `.` with space
- `generateDbVersionParts()` now uses full year (2026) instead of 2-digit year (26)
- `formatVersionDisplay()` supports both new and legacy formats for backwards compatibility
- Updated all documentation to reflect new format
- Site version updated to `2026.02.26.2059`

---

*Log started: 2026-02-26*  
*Maintained by: Wilson 🦉*
