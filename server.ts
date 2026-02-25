import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'shared.db');

interface CalendarEvent {
  type: 'project' | 'timeoff'
  name: string
  color: string
  projectName?: string
  person?: string
  startDate?: string
  endDate?: string
}

interface CalendarDay {
  day: number
  date: string
  dayName: string
  events: CalendarEvent[]
}

interface CalendarMonth {
  name: string
  year: number
  month: number
  days: CalendarDay[]
}

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

interface TeamIdentity {
  id: string
  name: string
}

const syncProjectDesignersToAssignments = async (projectId: string, designerNames: string[]) => {
  const teamRows = await all('SELECT id, name FROM team') as TeamIdentity[]
  const normalizedNames = Array.from(new Set((designerNames || []).map(n => n.trim()).filter(Boolean)))
  const matchingTeam = teamRows.filter(t => normalizedNames.includes(t.name))
  const matchingIds = matchingTeam.map(t => t.id)

  for (const team of matchingTeam) {
    const assignmentId = `${projectId}_${team.id}`
    await run(
      `INSERT OR IGNORE INTO project_assignments (id, project_id, designer_id, allocation_percent, created_at)
       VALUES (?, ?, ?, 0, datetime('now'))`,
      [assignmentId, projectId, team.id]
    )
  }

  if (matchingIds.length > 0) {
    const placeholders = matchingIds.map(() => '?').join(',')
    await run(
      `DELETE FROM project_assignments WHERE project_id = ? AND designer_id NOT IN (${placeholders})`,
      [projectId, ...matchingIds]
    )
  } else {
    await run('DELETE FROM project_assignments WHERE project_id = ?', [projectId])
  }
}

const syncAssignmentToProjectDesigners = async (projectId: string, designerId: string, add: boolean) => {
  const projectRow = await get('SELECT designers FROM projects WHERE id = ?', [projectId]) as { designers?: string } | undefined
  const teamRow = await get('SELECT name FROM team WHERE id = ?', [designerId]) as { name?: string } | undefined
  const designerName = teamRow?.name
  if (!designerName) return

  const currentDesigners = projectRow?.designers ? JSON.parse(projectRow.designers) as string[] : []
  const set = new Set(currentDesigners)

  if (add) {
    set.add(designerName)
  } else {
    set.delete(designerName)
  }

  await run(
    `UPDATE projects SET designers = ?, updatedAt = datetime('now') WHERE id = ?`,
    [JSON.stringify(Array.from(set)), projectId]
  )
}

const reconcileProjectDesignerAssignments = async () => {
  const projects = await all('SELECT id, designers FROM projects') as Array<{ id: string; designers?: string }>
  for (const project of projects) {
    const designers = project.designers ? JSON.parse(project.designers) as string[] : []
    await syncProjectDesignersToAssignments(project.id, designers)
  }
}

// ============ PROJECTS ============
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await all('SELECT * FROM projects ORDER BY createdAt DESC');
    // Parse timeline, customLinks, designers, and businessLines JSON
    res.json(projects.map(p => ({
      ...p, 
      timeline: p.timeline ? JSON.parse(p.timeline) : [],
      customLinks: p.customLinks ? JSON.parse(p.customLinks) : [],
      designers: p.designers ? JSON.parse(p.designers) : [],
      businessLines: p.businessLine ? (() => { try { return JSON.parse(p.businessLine); } catch { return [p.businessLine]; } })() : []
    })));
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { id, name, status, dueDate, assignee, url, description, businessLines, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks, designers, startDate, endDate, timeline } = req.body;
    const projectId = id || Date.now().toString();
    const timelineJson = JSON.stringify(timeline || []);
    const customLinksJson = JSON.stringify(customLinks || []);
    const designersJson = JSON.stringify(designers || []);
    const businessLinesJson = JSON.stringify(businessLines || []);
    await run(
      `INSERT OR REPLACE INTO projects (id, name, status, dueDate, assignee, url, description, businessLine, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks, designers, startDate, endDate, timeline, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [projectId, name, status || 'active', dueDate, assignee, url, description, businessLinesJson, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinksJson, designersJson, startDate, endDate, timelineJson]
    );

    await syncProjectDesignersToAssignments(projectId, designers || [])

    // Update DB version
    await updateDbVersion()
    res.json({id: projectId, ...req.body});
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    await run('DELETE FROM project_assignments WHERE project_id = ?', [req.params.id]);
    await updateDbVersion()
    res.json({success: true});
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ BUSINESS LINES ============
app.get('/api/business-lines', async (req, res) => {
  try {
    const lines = await all('SELECT * FROM business_lines ORDER BY name');
    res.json(lines.map(l => ({
      ...l,
      customLinks: l.customLinks ? JSON.parse(l.customLinks) : []
    })));
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/api/business-lines', async (req, res) => {
  try {
    const { id, name, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks, originalName } = req.body;
    const lineId = id || Date.now().toString();
    const customLinksJson = JSON.stringify(customLinks || []);
    
    // Check if this is a rename (name changed but same id)
    if (originalName && originalName !== name) {
      // Update all projects that have the old name in their businessLines array
      const allProjects = await all("SELECT id, businessLine FROM projects");
      for (const p of allProjects) {
        if (p.businessLine) {
          let bls: string[];
          try {
            bls = JSON.parse(p.businessLine) as string[];
          } catch {
            bls = [p.businessLine];
          }
          if (bls.includes(originalName)) {
            const updated = bls.map((b: string) => b === originalName ? name : b);
            await run("UPDATE projects SET businessLine = ? WHERE id = ?", [JSON.stringify(updated), p.id]);
          }
        }
      }
      // Update all team members that reference the old name in their brands
      const members = await all("SELECT id, brands FROM team");
      for (const m of members) {
        const brands = JSON.parse(m.brands || '[]');
        if (brands.includes(originalName)) {
          const updated = brands.map((b: string) => b === originalName ? name : b);
          await run("UPDATE team SET brands = ? WHERE id = ?", [JSON.stringify(updated), m.id]);
        }
      }
    }
    
    await run(
      `INSERT OR REPLACE INTO business_lines (id, name, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [lineId, name, deckName || '', deckLink || '', prdName || '', prdLink || '', briefName || '', briefLink || '', figmaLink || '', customLinksJson]
    );
    await updateDbVersion()
    res.json({id: lineId, ...req.body});
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/business-lines/:id', async (req, res) => {
  try {
    await run('DELETE FROM business_lines WHERE id = ?', [req.params.id]);
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
    const { id, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours } = req.body;
    const memberId = id || Date.now().toString();
    const brandsJson = JSON.stringify(brands || []);
    const timeOffJson = JSON.stringify(timeOff || []);
    await run(
      `INSERT OR REPLACE INTO team (id, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [memberId, name, role, brandsJson, status || 'offline', slack, email, avatar, timeOffJson, weekly_hours ?? 35]
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
    const brands = await all('SELECT name FROM business_lines ORDER BY name');
    res.json(brands.map(b => b.name));
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ SEARCH ============
// Normalize string for loose search (remove apostrophes, hyphens, etc.)
const normalize = (s: string) => s?.toLowerCase().replace(/['"-]/g, '').replace(/\s+/g, ' ').trim() || '';

app.get('/api/search', async (req, res) => {
  try {
    const query = normalize(req.query.q as string || '');
    const queryOriginal = (req.query.q as string || '').toLowerCase().trim();
    if (!query || query.length < 2) {
      return res.json({ projects: [], team: [], businessLines: [] });
    }

    // Search projects
    const projects = await all('SELECT * FROM projects').then(p => p.map(proj => {
      const customLinks = proj.customLinks ? JSON.parse(proj.customLinks) : [];
      const designers = proj.designers ? JSON.parse(proj.designers) : [];
      const businessLines = proj.businessLine ? (() => { try { return JSON.parse(proj.businessLine); } catch { return [proj.businessLine]; } })() : [];
      
      // Check if main fields match
      const matchesMainFields = 
        normalize(proj.name).includes(query) ||
        businessLines.some((bl: string) => normalize(bl).includes(query)) ||
        normalize(proj.description || '').includes(query) ||
        (Array.isArray(designers) && designers.some((d: string) => normalize(d).includes(query)));
      
      // Build all asset links
      const allLinks = [
        proj.deckName ? { name: proj.deckName, url: proj.deckLink || '', type: 'Deck' } : null,
        proj.prdName ? { name: proj.prdName, url: proj.prdLink || '', type: 'PRD' } : null,
        proj.briefName ? { name: proj.briefName, url: proj.briefLink || '', type: 'Brief' } : null,
        proj.figmaLink ? { name: 'Figma', url: proj.figmaLink, type: 'Figma' } : null,
        ...customLinks.map((l: { name: string; url: string }) => ({ ...l, type: 'Link' }))
      ].filter(Boolean);
      
      // Check if query matches any link type (deck, prd, brief, figma, link)
      const hasDeck = allLinks.some((l: any) => l.type === 'Deck');
      const hasPrd = allLinks.some((l: any) => l.type === 'PRD');
      const hasBrief = allLinks.some((l: any) => l.type === 'Brief');
      const hasFigma = allLinks.some((l: any) => l.type === 'Figma');
      const hasLink = allLinks.some((l: any) => l.type === 'Link');
      
      const queryLower = query.toLowerCase();
      const matchesAssetType = 
        (queryLower.includes('deck') && hasDeck) ||
        (queryLower.includes('prd') && hasPrd) ||
        (queryLower.includes('brief') && hasBrief) ||
        (queryLower.includes('figma') && hasFigma) ||
        (queryLower.includes('link') && hasLink);
      
      // If main fields match or matches asset type, show all links. Otherwise only show matching links.
      const matchedLinks = (matchesMainFields || matchesAssetType)
        ? allLinks 
        : allLinks.filter((l: any) => normalize(l.name).includes(query) || normalize(l.url).includes(query));
      
      return {
        ...proj,
        timeline: proj.timeline ? JSON.parse(proj.timeline) : [],
        customLinks: customLinks,
        matchedLinks: matchedLinks,
        designers: designers,
        businessLines: businessLines
      };
    }).filter(proj => 
      normalize(proj.name).includes(query) ||
      (proj.businessLines || []).some((bl: string) => normalize(bl).includes(query)) ||
      normalize(proj.description || '').includes(query) ||
      (Array.isArray(proj.designers) && proj.designers.some((d: string) => normalize(d).includes(query))) ||
      (proj as any).matchedLinks?.length > 0
    ));

    // Search team members
    const team = await all('SELECT * FROM team').then(m => m.map(t => ({
      ...t,
      brands: JSON.parse(t.brands || '[]'),
      timeOff: t.timeOff ? JSON.parse(t.timeOff) : []
    })).filter(member =>
      normalize(member.name).includes(query) ||
      normalize(member.role).includes(query) ||
      member.brands?.some((b: string) => normalize(b).includes(query))
    ));

    // Search business lines
    const businessLines = await all('SELECT * FROM business_lines').then(l => l.map(bl => {
      const customLinks = bl.customLinks ? JSON.parse(bl.customLinks) : [];
      
      // Check if main field (name) matches
      const matchesMainField = normalize(bl.name).includes(query);
      
      // Build all asset links
      const allLinks = [
        bl.deckName ? { name: bl.deckName, url: bl.deckLink || '', type: 'Deck' } : null,
        bl.prdName ? { name: bl.prdName, url: bl.prdLink || '', type: 'PRD' } : null,
        bl.briefName ? { name: bl.briefName, url: bl.briefLink || '', type: 'Brief' } : null,
        bl.figmaLink ? { name: 'Figma', url: bl.figmaLink, type: 'Figma' } : null,
        ...customLinks.map((l: { name: string; url: string }) => ({ ...l, type: 'Link' }))
      ].filter(Boolean);
      
      // Check if query matches any link type
      const hasDeck = allLinks.some((l: any) => l.type === 'Deck');
      const hasPrd = allLinks.some((l: any) => l.type === 'PRD');
      const hasBrief = allLinks.some((l: any) => l.type === 'Brief');
      const hasFigma = allLinks.some((l: any) => l.type === 'Figma');
      const hasLink = allLinks.some((l: any) => l.type === 'Link');
      
      const queryLower = query.toLowerCase();
      const matchesAssetType = 
        (queryLower.includes('deck') && hasDeck) ||
        (queryLower.includes('prd') && hasPrd) ||
        (queryLower.includes('brief') && hasBrief) ||
        (queryLower.includes('figma') && hasFigma) ||
        (queryLower.includes('link') && hasLink);
      
      // If name matches or matches asset type, show all links. Otherwise only show matching links.
      const matchedLinks = (matchesMainField || matchesAssetType)
        ? allLinks
        : allLinks.filter((l: any) => normalize(l.name).includes(query) || normalize(l.url).includes(query));
      
      return {
        ...bl,
        customLinks: customLinks,
        matchedLinks: matchedLinks
      };
    }).filter(bl =>
      normalize(bl.name).includes(query) ||
      (bl as any).matchedLinks?.length > 0
    ));

    res.json({ projects, team, businessLines });
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ COMBINED DATA ============
app.get('/api/data', async (req, res) => {
  try {
    const projects = await all('SELECT * FROM projects ORDER BY createdAt DESC').then(p => p.map(proj => ({
      ...proj, 
      timeline: proj.timeline ? JSON.parse(proj.timeline) : [],
      customLinks: proj.customLinks ? JSON.parse(proj.customLinks) : [],
      designers: proj.designers ? JSON.parse(proj.designers) : [],
      businessLines: proj.businessLine ? (() => { try { return JSON.parse(proj.businessLine); } catch { return [proj.businessLine]; } })() : []
    })));
    const team = await all('SELECT * FROM team ORDER BY name').then(m => m.map(t => ({
      ...t, 
      brands: JSON.parse(t.brands || '[]'),
      timeOff: t.timeOff ? JSON.parse(t.timeOff) : []
    })));
    const brands = await all('SELECT name FROM business_lines ORDER BY name').then(b => b.map(x => x.name));
    res.json({ projects, team, brandOptions: brands });
  } catch (e) { res.status(500).json({error: e.message}); }
});

// ============ CALENDAR DATA ============
app.get('/api/calendar', async (req, res) => {
  try {
    const projects = await all('SELECT * FROM projects').then(p => p.map(proj => ({
      ...proj,
      timeline: proj.timeline ? JSON.parse(proj.timeline) : [],
      businessLines: proj.businessLine ? (() => { try { return JSON.parse(proj.businessLine); } catch { return [proj.businessLine]; } })() : []
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
    const months: CalendarMonth[] = [];
    // Start from the month of minDate
    const startMonth = minDate.getMonth();
    const startYear = minDate.getFullYear();
    const current = new Date(startYear, startMonth, 1);
    while (current <= maxDate) {
      const monthName = current.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
      
      const days: CalendarDay[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayOfWeek = new Date(current.getFullYear(), current.getMonth(), d).getDay();
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
        
        const events: CalendarEvent[] = [];
        
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
        await run(`INSERT INTO team (id, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.name, t.role || '', JSON.stringify(t.brands || []), t.status || 'offline', t.slack || '', t.email || '', t.avatar || '', JSON.stringify(t.timeOff || []), t.weekly_hours ?? 35])
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

const SITE_VERSION = 'v260225'  // Manual update on code changes
const SITE_TIME = '1242'

const VERSION_KEY = 'dcc_versions'

// Generate version parts for DB updates
const generateDbVersionParts = () => {
  // Keep DB version clock in Pacific Time so it is directly comparable to local build/version workflow
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  const yy = get('year')
  const mm = get('month')
  const dd = get('day')
  const hh = get('hour')
  const min = get('minute')

  return {
    versionNumber: `v${yy}${mm}${dd}`,
    versionTime: `${hh}${min}`,
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

// Capacity schema safety
run(`CREATE TABLE IF NOT EXISTS project_assignments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  designer_id TEXT NOT NULL,
  allocation_percent INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now'))
)`).catch((e) => console.error('project_assignments init error:', e.message))

run("ALTER TABLE team ADD COLUMN weekly_hours INTEGER DEFAULT 35")
  .catch(() => {
    // Column already exists in established databases
  })

run(`CREATE TABLE IF NOT EXISTS business_lines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deckName TEXT DEFAULT '',
  deckLink TEXT DEFAULT '',
  prdName TEXT DEFAULT '',
  prdLink TEXT DEFAULT '',
  briefName TEXT DEFAULT '',
  briefLink TEXT DEFAULT '',
  figmaLink TEXT DEFAULT '',
  customLinks TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
)`).catch((e) => console.error('business_lines init error:', e.message))

// Seed default business lines if empty
const seedBusinessLines = async () => {
  const existing = await get('SELECT COUNT(*) as count FROM business_lines')
  if (existing?.count === 0) {
    const defaultLines = [
      "Barron's", "FN London", "IBD", "Mansion Global", "Market Data", 
      "MarketWatch", "Messaging", "Mobile Apps", "PEN", "The Wall Street Journal"
    ]
    for (const name of defaultLines) {
      await run('INSERT INTO business_lines (id, name) VALUES (?, ?)', [name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(), name])
    }
    console.log('Seeded default business lines')
  }
}
seedBusinessLines().catch(e => console.error('Seed error:', e.message))

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

// ============ CAPACITY MANAGEMENT ============

// Get all capacity data: team availability + project assignments
app.get('/api/capacity', async (req, res) => {
  try {
    // Keep project designer selections and capacity assignments in sync
    await reconcileProjectDesignerAssignments()

    // Get team with weekly hours
    const team = await all('SELECT * FROM team ORDER BY name')
    const teamWithHours = team.map(m => ({
      ...m,
      weekly_hours: m.weekly_hours || 35,
      timeOff: m.timeOff ? JSON.parse(m.timeOff) : []
    }))
    
    // Get project assignments with project and designer details
    const assignments = await all(`
      SELECT pa.*, p.name as project_name, p.businessLine, p.status as project_status,
             t.name as designer_name, t.role as designer_role
      FROM project_assignments pa
      JOIN projects p ON pa.project_id = p.id
      JOIN team t ON pa.designer_id = t.id
      ORDER BY p.name, t.name
    `)
    
    // Note: avoid self-fetching /api/calendar in production (can fail on Railway runtime networking)
    res.json({ team: teamWithHours, assignments })
  } catch (e) { res.status(500).json({error: e.message}); }
})

// Add or update project assignment
app.post('/api/capacity/assignments', async (req, res) => {
  try {
    const { project_id, designer_id, allocation_percent } = req.body
    const id = `${project_id}_${designer_id}`
    await run(
      `INSERT OR REPLACE INTO project_assignments (id, project_id, designer_id, allocation_percent, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, project_id, designer_id, allocation_percent ?? 0]
    )
    await syncAssignmentToProjectDesigners(project_id, designer_id, true)
    await updateDbVersion()
    res.json({ success: true, id })
  } catch (e) { res.status(500).json({error: e.message}); }
})

// Delete project assignment
app.delete('/api/capacity/assignments/:id', async (req, res) => {
  try {
    const existing = await get('SELECT project_id, designer_id FROM project_assignments WHERE id = ?', [req.params.id]) as { project_id?: string; designer_id?: string } | undefined
    await run('DELETE FROM project_assignments WHERE id = ?', [req.params.id])
    if (existing?.project_id && existing?.designer_id) {
      await syncAssignmentToProjectDesigners(existing.project_id, existing.designer_id, false)
    }
    await updateDbVersion()
    res.json({ success: true })
  } catch (e) { res.status(500).json({error: e.message}); }
})

// Update designer's weekly hours
app.put('/api/capacity/availability/:designerId', async (req, res) => {
  try {
    const { weekly_hours } = req.body
    await run('UPDATE team SET weekly_hours = ?, updatedAt = datetime("now") WHERE id = ?', 
      [weekly_hours || 35, req.params.designerId])
    await updateDbVersion()
    res.json({ success: true })
  } catch (e) { res.status(500).json({error: e.message}); }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Production mode: ${isProduction}`);
});
