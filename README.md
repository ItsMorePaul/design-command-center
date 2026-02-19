# Design Command Center

A capacity management dashboard for Dow Jones design teams. Track projects, team members, and calendars with sorting, filtering, and real-time data.

**Live URL:** https://design-command-center-production.up.railway.app

## Features

- **Projects** — Track design projects with status, due dates, business lines, designers, and timeline
- **Team** — Manage team members with roles, brands, Slack/email links, and time-off
- **Calendar** — Visual calendar with project timelines, time off, and holidays
- **Sorting & Filtering** — Sort projects by name, business line, designer, due date, or status with filter pills

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS, Vite
- **Backend:** Express, SQLite
- **Deployment:** Railway

## Local Development

```bash
# Install dependencies
npm install

# Run development server (frontend + API)
npm run dev:all
```

Or run separately:

```bash
# Terminal 1: API server
npm run server

# Terminal 2: Frontend
npm run dev
```

Open http://localhost:5173

## Deployment

Connected to GitHub → Railway auto-deploys on push.

## License

Private — Dow Jones Internal Use Only
