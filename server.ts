import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'shared.db');

app.use(cors());
app.use(express.json());

let db;
try {
  db = new sqlite3.Database(DB_PATH);
  console.log('Database connected:', DB_PATH);
} catch (e) {
  console.error('Database connection error:', e);
}

// Helper to run SQL
const run = (sql, params = []) => new Promise((resolve, reject) => {
  if (!db) return reject(new Error('Database not connected'));
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  if (!db) return reject(new Error('Database not connected'));
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

// ============ PROJECTS ============
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await all('SELECT * FROM projects ORDER BY createdAt DESC');
    // Parse timeline, customLinks, and designers JSON
    res.json(projects.map(p => ({
      ...p, 
      timeline: p.timeline ? JSON.parse(p.timeline) : [],
      customLinks: p.customLinks ? JSON.parse(p.customLinks) : [],
      designers: p.designers ? JSON.parse(p.designers) : []
    })));
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { id, name, status, dueDate, assignee, url, description, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks, designers, startDate, endDate, timeline } = req.body;
    const projectId = id || Date.now().toString();
    const timelineJson = JSON.stringify(timeline || []);
    const customLinksJson = JSON.stringify(customLinks || []);
    const designersJson = JSON.stringify(designers || []);
    await run(
      `INSERT OR REPLACE INTO projects (id, name, status, dueDate, assignee, url, description, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks, designers, startDate, endDate, timeline, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [projectId, name, status || 'active', dueDate, assignee, url, description, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinksJson, designersJson, startDate, endDate, timelineJson]
    );
    // Update DB version
    await updateDbVersion()
    res.json({id: projectId, ...req.body});
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    await updateDbVersion()
    res.json({success: true});
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ TEAM ============
app.get('/api/team', async (req, res) => {
  try {
    const team = await all('SELECT * FROM team ORDER BY name');
    // Parse brands and timeOff JSON
    res.json(team.map(m => ({
      ...m, 
      brands: JSON.parse(m.brands || '[]'),
      timeOff: m.timeOff ? JSON.parse(m.timeOff) : []
    })));
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/api/team', async (req, res) => {
  try {
    const { id, name, role, brands, status, slack, email, avatar, timeOff } = req.body;
    const memberId = id || Date.now().toString();
    const brandsJson = JSON.stringify(brands || []);
    const timeOffJson = JSON.stringify(timeOff || []);
    await run(
      `INSERT OR REPLACE INTO team (id, name, role, brands, status, slack, email, avatar, timeOff, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [memberId, name, role, brandsJson, status || 'offline', slack, email, avatar, timeOffJson]
    );
    await updateDbVersion()
    res.json({id: memberId, ...req.body});
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/team/:id', async (req, res) => {
  try {
    await run('DELETE FROM team WHERE id = ?', [req.params.id]);
    await updateDbVersion()
    res.json({success: true});
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ BRAND OPTIONS ============
app.get('/api/brandOptions', async (req, res) => {
  try {
    const brands = await all('SELECT name FROM brand_options ORDER BY name');
    res.json(brands.map(b => b.name));
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ COMBINED DATA ============
app.get('/api/data', async (req, res) => {
  try {
    const projects = await all('SELECT * FROM projects ORDER BY createdAt DESC').then(p => p.map(proj => ({
      ...proj, 
      timeline: proj.timeline ? JSON.parse(proj.timeline) : [],
      customLinks: proj.customLinks ? JSON.parse(proj.customLinks) : [],
      designers: proj.designers ? JSON.parse(proj.designers) : []
    })));
    const team = await all('SELECT * FROM team ORDER BY name').then(m => m.map(t => ({
      ...t, 
      brands: JSON.parse(t.brands || '[]'),
      timeOff: t.timeOff ? JSON.parse(t.timeOff) : []
    })));
    const brands = await all('SELECT name FROM brand_options ORDER BY name').then(b => b.map(x => x.name));
    res.json({ projects, team, brandOptions: brands });
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ CALENDAR DATA ============
app.get('/api/calendar', async (req, res) => {
  try {
    const projects = await all('SELECT * FROM projects').then(p => p.map(proj => ({
      ...proj,
      timeline: proj.timeline ? JSON.parse(proj.timeline) : []
    })));
    const team = await all('SELECT * FROM team').then(m => m.map(t => ({
      ...t,
      timeOff: t.timeOff ? JSON.parse(t.timeOff) : []
    })));
    
    // Find date range - start from current month
    const now = new Date();
    let minDate = new Date(now.getFullYear(), now.getMonth(), 1); // Start of current month
    let maxDate = new Date(now.getFullYear(), now.getMonth(), 1); // Start of current month
    
    // Check project dates
    projects.forEach(proj => {
      if (proj.startDate) {
        const d = new Date(proj.startDate);
        if (d < minDate) minDate = d;
      }
      if (proj.endDate) {
        const d = new Date(proj.endDate);
        if (d > maxDate) maxDate = d;
      }
      // Check timeline ranges
      if (proj.timeline) {
        proj.timeline.forEach((t: { startDate: string; endDate: string }) => {
          if (t.startDate) {
            const d = new Date(t.startDate);
            if (d < minDate) minDate = d;
          }
          if (t.endDate) {
            const d = new Date(t.endDate);
            if (d > maxDate) maxDate = d;
          }
        });
      }
    });
    
    // Check team time off dates
    team.forEach(member => {
      if (member.timeOff) {
        member.timeOff.forEach((off: { startDate: string; endDate: string }) => {
          if (off.startDate) {
            const d = new Date(off.startDate);
            if (d < minDate) minDate = d;
          }
          if (off.endDate) {
            const d = new Date(off.endDate);
            if (d > maxDate) maxDate = d;
          }
        });
      }
    });
    
    // Add 3 months to max date
    maxDate.setMonth(maxDate.getMonth() + 3);
    
    // Generate months
    const months: any[] = [];
    // Start from the month of minDate
    const startMonth = minDate.getMonth();
    const startYear = minDate.getFullYear();
    const current = new Date(startYear, startMonth, 1);
    while (current <= maxDate) {
      const monthName = current.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
      
      const days: any[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayOfWeek = new Date(current.getFullYear(), current.getMonth(), d).getDay();
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
        
        const events: any[] = [];
        
        // Add project timeline events
        projects.forEach(proj => {
          if (proj.timeline) {
            proj.timeline.forEach((t: { name: string; startDate: string; endDate: string }) => {
              if (t.startDate && t.endDate && dateStr >= t.startDate && dateStr <= t.endDate) {
                events.push({
                  type: 'project',
                  name: t.name,
                  projectName: proj.name,
                  startDate: t.startDate,
                  endDate: t.endDate,
                  color: '#6366f1'
                });
              }
            });
          }
        });
        
        // Add team time off events
        team.forEach(member => {
          if (member.timeOff) {
            member.timeOff.forEach((off: { name: string; startDate: string; endDate: string }) => {
              if (off.startDate && off.endDate && dateStr >= off.startDate && dateStr <= off.endDate) {
                events.push({
                  type: 'timeoff',
                  name: off.name || 'Time Off',
                  person: member.name,
                  startDate: off.startDate,
                  endDate: off.endDate,
                  color: '#ef4444'
                });
              }
            });
          }
        });
        
        days.push({
          day: d,
          date: dateStr,
          dayName,
          events
        });
      }
      
      months.push({
        name: monthName,
        year: current.getFullYear(),
        month: current.getMonth() + 1,
        days
      });
      
      current.setMonth(current.getMonth() + 1);
    }
    
    res.json({ months, startDate: minDate.toISOString().split('T')[0], endDate: maxDate.toISOString().split('T')[0] });
  } catch (e) { res.status(500).json({error: e.message}); }
});

// Serve static files in production
const DIST_PATH = path.join(process.cwd(), 'dist');
const isProduction = process.env.NODE_ENV === 'production';

// Seed endpoint - replaces all data
app.post('/api/seed', async (req, res) => {
  try {
    const { projects, team } = req.body
    
    // Clear and insert projects
    if (projects) {
      await run('DELETE FROM projects')
      for (const p of projects) {
        await run(`INSERT INTO projects (id, name, status, dueDate, assignee, url, description, businessLine, deckLink, prdLink, briefLink, startDate, endDate, timeline, deckName, prdName, briefName, figmaLink, customLinks, designers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, p.name, p.status || 'active', p.dueDate || null, p.assignee || null, p.url || '', p.description || '', p.businessLine || null, p.deckLink || '', p.prdLink || '', p.briefLink || '', p.startDate || null, p.endDate || null, JSON.stringify(p.timeline || []), p.deckName || '', p.prdName || '', p.briefName || '', p.figmaLink || '', JSON.stringify(p.customLinks || []), JSON.stringify(p.designers || [])])
      }
    }
    
    // Clear and insert team
    if (team) {
      await run('DELETE FROM team')
      for (const t of team) {
        await run(`INSERT INTO team (id, name, role, brands, status, slack, email, avatar, timeOff) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.name, t.role || '', JSON.stringify(t.brands || []), t.status || 'offline', t.slack || '', t.email || '', t.avatar || '', JSON.stringify(t.timeOff || [])])
      }
    }
    
    // Update DB version on seed
    await updateDbVersion()
    
    res.json({ success: true })
  } catch (e) { res.status(500).json({error: e.message}); }
})

if (isProduction) {
  try {
    app.use(express.static(DIST_PATH));
    // Explicitly serve index.html for root
    app.get('/', (req, res) => {
      res.sendFile(path.join(DIST_PATH, 'index.html'));
    });
  } catch (e) {
    console.error('Error serving static files:', e);
  }
}

// ============ VERSION TRACKING ============
// Site version: manually updated in code when commits are made (vYYMMDD.hhmm)
// DB version: stored in DB, auto-updates on data changes

const SITE_VERSION = 'v260219.1329'  // Manual update on code changes
const SITE_TIME = '1329'

const VERSION_KEY = 'dcc_versions'

// Generate version parts for DB updates
const generateDbVersionParts = () => {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return { 
    versionNumber: `v${yy}${mm}${dd}`, 
    versionTime: `${hh}${min}` 
  }
}

// Update DB version helper
const updateDbVersion = async () => {
  const { versionNumber, versionTime } = generateDbVersionParts()
  await run("UPDATE app_versions SET db_version = ?, db_time = ?, updated_at = datetime('now') WHERE key = ?", [versionNumber, versionTime, VERSION_KEY])
}

// Initialize versions table
const initVersions = async () => {
  try {
    const existing = await get("SELECT * FROM app_versions WHERE key = ?", [VERSION_KEY])
    if (!existing) {
      const { versionNumber, versionTime } = generateDbVersionParts()
      await run("INSERT INTO app_versions (key, db_version, db_time, updated_at) VALUES (?, ?, ?, datetime('now'))", 
        [VERSION_KEY, versionNumber, versionTime])
    }
  } catch (e) {
    console.log('Version init:', e.message)
  }
}

// Ensure table exists
run("CREATE TABLE IF NOT EXISTS app_versions (key TEXT PRIMARY KEY, db_version TEXT, db_time TEXT, updated_at TEXT)").then(() => initVersions())

// Get versions - returns site version from code, DB version from database
app.get('/api/versions', async (req, res) => {
  try {
    const existing = await get("SELECT * FROM app_versions WHERE key = ?", [VERSION_KEY])
    res.json({
      site_version: SITE_VERSION,
      site_time: SITE_TIME,
      db_version: existing?.db_version || '',
      db_time: existing?.db_time || ''
    })
  } catch (e) { res.status(500).json({error: e.message}); }
})

// Update DB version (automatic on data changes - handled in individual endpoints)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Production mode: ${isProduction}`);
});
