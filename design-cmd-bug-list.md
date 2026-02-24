# Design Command Center - Bug & Feature List

## Bugs

### 1. Tooltip z-index Issue
**Date:** 2026-02-18
**Status:** Open
**Description:** Project link icon tooltips appear underneath the left navigation sidebar even with z-index adjustments. The tooltip z-index is set to 9999 but still doesn't render above the sidebar.
**Affected:** Design Command Center - project card link icons
**Notes:** Need to investigate CSS stacking context and overflow properties

### 2. Team Offline Status Icon
**Date:** 2026-02-18
**Status:** Open
**Description:** Change team member offline status icon from gray dot to palm tree (🌴) to match the "away" status palm tree icon
**Affected:** Design Command Center - Team cards
**Notes:** Away uses palm tree, offline should also use palm tree for consistency

---

## Features (To Be Added)

### 1. Gemini Notes Integration
**Date:** 2026-02-24
**Status:** Planned
**Description:** Link Gemini Notes meeting data to DCC team, projects, and capacity sections
**Components:**
- **Team Integration:** Display meeting attendance, action items assigned to each team member
- **Projects Integration:** Link projects mentioned in meetings to project cards, show project-related meeting history
- **Capacity Section:** Show meeting load per designer, action item counts per person

**Data to Import from Gemini Notes:**
- Meeting attendance (who attended which meetings)
- Action items with owners and due dates
- Project tags from each meeting (Backstory, Market Data, Search Redesign, etc.)
- Meeting summaries linked to relevant projects/teams

**Notes:** Requires new database tables (action_items, meeting_history, project_meetings)
