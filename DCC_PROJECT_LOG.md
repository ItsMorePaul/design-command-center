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

### Site Version
- Stored in `server.ts` as two constants:
  ```ts
  const SITE_VERSION = 'vYYMMDD|HHMM'  // e.g., 'v260226|1905'
  const SITE_TIME = 'HHMM'              // e.g., '1905'
  ```
- **Update BOTH on every commit.** Never update one without the other.
- Use Pacific Time (PST/PDT).

### DB Version
- Auto-updates on every write operation via `updateDbVersion()` in `server.ts`.
- Timestamps itself in Pacific Time from the actual moment of the DB write.
- **Do not manually set DB version** unless doing a checkpoint — the server manages it.

### UI Display Format
- Displayed in sidebar footer as: `Site: 2026.2.26 1905` / `DB: 2026.2.26 1905`
- Formatting done by `formatVersionDisplay()` in `src/App.tsx` — converts `vYYMMDD|HHMM` to human-readable.

### On every "save site" checkpoint
1. Update `SITE_VERSION` and `SITE_TIME` in `server.ts`
2. DB version updates itself automatically — read current value from DB for documentation
3. Commit locally: `git add -A && git commit -m "..."`
4. Tag the commit (see checkpoint format below)
5. Document in this file under **Checkpoints**

---

## "Save Site" Protocol

When Paul says **"save site"**, Wilson will:

1. Update `SITE_VERSION` + `SITE_TIME` in `server.ts` to current date/time
2. Run: `git add -A && git commit -m "<description of session work>"`
3. Create a git tag: `git tag -a <tag-name> -m "<description>"`
4. Read current DB version from DB: `sqlite3 data/shared.db "SELECT db_version, db_time FROM app_versions WHERE key='dcc_versions';"`
5. Document the checkpoint in this file with full rollback instructions

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
**Site version:** `v260226|1905` → displays as `2026.2.26 1905`  
**DB version at save:** `v260226|1905` → displays as `2026.2.26 1905`

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

*Log started: 2026-02-26*  
*Maintained by: Wilson 🦉*
