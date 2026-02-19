const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./design-cmd.db', (err) => {
  if (err) console.error('DB connection error:', err.message);
  else console.log('Connected to SQLite database');
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS team (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    brands TEXT,
    status TEXT DEFAULT 'offline'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    dueDate TEXT,
    designers TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);
});

// Seed initial data if empty
db.get("SELECT COUNT(*) as count FROM team", (err, row) => {
  if (row.count === 0) {
    const initialTeam = [
      { id: '1', name: 'Jason H.', role: 'Senior Designer', brands: ["Barron's", "MarketWatch"], status: 'online' },
      { id: '2', name: 'Fariah K.', role: 'UX Designer', brands: ['IBD'], status: 'online' },
      { id: '3', name: 'Elena M.', role: 'Product Designer', brands: ['Mansion Global'], status: 'away' },
      { id: '4', name: 'Dewey T.', role: 'Design Lead', brands: ['Market Data'], status: 'online' },
      { id: '5', name: 'Andy L.', role: 'Visual Designer', brands: ['FN London'], status: 'offline' },
      { id: '6', name: 'Brian R.', role: 'UI Developer', brands: ['PEN'], status: 'online' },
      { id: '7', name: 'Adrian B.', role: 'Motion Designer', brands: ['Messaging'], status: 'away' }
    ];
    
    const stmt = db.prepare("INSERT INTO team (id, name, role, brands, status) VALUES (?, ?, ?, ?, ?)");
    initialTeam.forEach(member => {
      stmt.run(member.id, member.name, member.role, JSON.stringify(member.brands), member.status);
    });
    stmt.finalize();
    console.log('Seeded initial team data');
  }
});

db.get("SELECT COUNT(*) as count FROM projects", (err, row) => {
  if (row.count === 0) {
    const initialProjects = [
      { id: '1', name: 'Q1 Brand Refresh', status: 'active', startDate: '2026-02-01', endDate: '2026-02-28', designers: ['Jason Miller'] },
      { id: '2', name: 'Mobile App Redesign', status: 'review', startDate: '2026-02-15', endDate: '2026-03-15', designers: ['Fariah Qasim'] },
      { id: '3', name: 'Dashboard Analytics', status: 'active', startDate: '2026-02-10', endDate: '2026-03-01', designers: ['Elena Zou'] },
      { id: '4', name: 'Design System v3', status: 'blocked', startDate: '2026-03-01', endDate: '2026-04-01', designers: ['Dewey Northington'] },
      { id: '5', name: 'Landing Page Update', status: 'done', startDate: '2026-01-15', endDate: '2026-02-10', designers: ['Andy Nelson'] }
    ];
    
    const stmt = db.prepare("INSERT INTO projects (id, name, status, startDate, endDate, designers) VALUES (?, ?, ?, ?, ?, ?)");
    initialProjects.forEach(project => {
      stmt.run(project.id, project.name, project.status, project.startDate, project.endDate, JSON.stringify(project.designers));
    });
    stmt.finalize();
    console.log('Seeded initial projects data');
  }
});

db.get("SELECT COUNT(*) as count FROM brands", (err, row) => {
  if (row.count === 0) {
    const initialBrands = ["Barron's", 'MarketWatch', 'IBD', 'Mansion Global', 'FN London', 'PEN', 'Messaging', 'Market Data'];
    const stmt = db.prepare("INSERT INTO brands (name) VALUES (?)");
    initialBrands.forEach(brand => stmt.run(brand));
    stmt.finalize();
    console.log('Seeded initial brands data');
  }
});

// API Routes

// Team
app.get('/api/team', (req, res) => {
  db.all("SELECT * FROM team", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const team = rows.map(row => ({
      ...row,
      brands: JSON.parse(row.brands || '[]')
    }));
    res.json(team);
  });
});

app.post('/api/team', (req, res) => {
  const { id, name, role, brands, status, slack, email } = req.body;
  db.run(
    "INSERT OR REPLACE INTO team (id, name, role, brands, status, slack, email) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, name, role, JSON.stringify(brands), status, slack || '', email || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, name, role, brands, status, slack, email });
    }
  );
});

app.delete('/api/team/:id', (req, res) => {
  db.run("DELETE FROM team WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// Projects
app.get('/api/projects', (req, res) => {
  db.all("SELECT * FROM projects", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const projects = rows.map(row => ({
      ...row,
      designers: JSON.parse(row.designers || '[]'),
      timeline: JSON.parse(row.timeline || '[]')
    }));
    res.json(projects);
  });
});

app.post('/api/projects', (req, res) => {
  const { id, name, url, status, startDate, endDate, designers, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, timeline } = req.body;
  db.run(
    "INSERT OR REPLACE INTO projects (id, name, url, status, startDate, endDate, designers, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, timeline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, name, url || '', status, startDate || '', endDate || '', JSON.stringify(designers || []), businessLine || '', deckName || '', deckLink || '', prdName || '', prdLink || '', briefName || '', briefLink || '', JSON.stringify(timeline || [])],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, name, url, status, startDate, endDate, designers, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, timeline });
    }
  );
});

app.delete('/api/projects/:id', (req, res) => {
  db.run("DELETE FROM projects WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// Brands
app.get('/api/brands', (req, res) => {
  db.all("SELECT * FROM brands ORDER BY name", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.name));
  });
});

app.post('/api/brands', (req, res) => {
  const { name } = req.body;
  db.run("INSERT OR IGNORE INTO brands (name) VALUES (?)", [name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ name });
  });
});

// Get all data
app.get('/api/data', (req, res) => {
  db.all("SELECT * FROM team", [], (err, teamRows) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all("SELECT * FROM projects", [], (err, projectRows) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all("SELECT * FROM brands ORDER BY name", [], (err, brandRows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          team: teamRows.map(row => ({ ...row, brands: JSON.parse(row.brands || '[]') })),
          projects: projectRows.map(row => ({ ...row, designers: JSON.parse(row.designers || '[]'), timeline: JSON.parse(row.timeline || '[]') })),
          brandOptions: brandRows.map(r => r.name)
        });
      });
    });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Design CMD API running on http://localhost:${PORT}`);
});
