import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import path from 'path';
import { searchProjects, searchTeam, searchBusinessLines, searchNotes } from './search';
import { homedir } from 'os';

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'shared.db');
const GEMINI_NOTES_DB = process.env.GEMINI_NOTES_DB || path.join(homedir(), '.openclaw', 'workspace', 'data', 'gemini-notes.db');

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

// ============ HEALTH ============
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

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

// Mark project as done: set status='done' and zero all allocations
app.put('/api/projects/:id/done', async (req, res) => {
  try {
    await run("UPDATE projects SET status = 'done', updatedAt = datetime('now') WHERE id = ?", [req.params.id])
    await run('UPDATE project_assignments SET allocation_percent = 0 WHERE project_id = ?', [req.params.id])
    await updateDbVersion()
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Mark project as undone: restore status to 'active'
app.put('/api/projects/:id/undone', async (req, res) => {
  try {
    await run("UPDATE projects SET status = 'active', updatedAt = datetime('now') WHERE id = ?", [req.params.id])
    await updateDbVersion()
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

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
      timeOff: m.timeOff ? JSON.parse(m.timeOff) : [],
      excluded: !!m.excluded
    })));
  } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/api/team', async (req, res) => {
  try {
    const { id, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours, excluded } = req.body;
    const memberId = id || Date.now().toString();
    const brandsJson = JSON.stringify(brands || []);
    const timeOffJson = JSON.stringify(timeOff || []);
    await run(
      `INSERT OR REPLACE INTO team (id, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours, excluded, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [memberId, name, role, brandsJson, status || 'offline', slack, email, avatar, timeOffJson, weekly_hours ?? 35, excluded ? 1 : 0]
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
// Smart search with word boundaries and relevance scoring

app.get('/api/search', async (req, res) => {
  try {
    const query = (req.query.q as string || '').trim();
    const scopes = {
      projects: req.query.projects !== 'false',
      team: req.query.team !== 'false',
      businessLines: req.query.businessLines !== 'false',
      notes: req.query.notes !== 'false'
    };

    if (!query || query.length < 2) {
      return res.json({ projects: [], team: [], businessLines: [], notes: [] });
    }

    // Run searches based on scopes
    const [projectResults, teamResults, blResults, noteResults] = await Promise.all([
      scopes.projects ? searchProjects(query, all) : Promise.resolve([]),
      scopes.team ? searchTeam(query, all) : Promise.resolve([]),
      scopes.businessLines ? searchBusinessLines(query, all) : Promise.resolve([]),
      scopes.notes ? searchNotes(query, all) : Promise.resolve([])
    ]);

    // Format response (remove score/matches from items, just return the items)
    res.json({
      projects: projectResults.map(r => r.item),
      team: teamResults.map(r => r.item),
      businessLines: blResults.map(r => r.item),
      notes: noteResults.map(r => r.item)
    });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({error: e.message});
  }
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

// ============ NOTES ============
// Gemini meeting notes ingested from gemini-notes.db

// Get notes linked to a specific project (before :id routes)
app.get('/api/notes/by-project/:projectId', async (req, res) => {
  try {
    const notes = await all(
      `SELECT n.* FROM notes n
       JOIN note_project_links npl ON n.id = npl.note_id
       WHERE npl.project_id = ?
       ORDER BY n.date DESC`,
      [req.params.projectId]
    )
    res.json(notes)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// Get notes linked to a specific team member
app.get('/api/notes/by-person/:teamId', async (req, res) => {
  try {
    const notes = await all(
      `SELECT n.* FROM notes n
       JOIN note_people_links npl ON n.id = npl.note_id
       WHERE npl.team_id = ?
       ORDER BY n.date DESC`,
      [req.params.teamId]
    )
    res.json(notes)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// List all notes
app.get('/api/notes', async (req, res) => {
  try {
    const notes = await all('SELECT * FROM notes ORDER BY date DESC, created_at DESC')
    const projectLinks = await all('SELECT * FROM note_project_links')
    const peopleLinks = await all('SELECT * FROM note_people_links')

    const projectMap: Record<string, string[]> = {}
    for (const link of projectLinks as any[]) {
      if (!projectMap[link.note_id]) projectMap[link.note_id] = []
      projectMap[link.note_id].push(link.project_id)
    }

    const peopleMap: Record<string, string[]> = {}
    for (const link of peopleLinks as any[]) {
      if (!peopleMap[link.note_id]) peopleMap[link.note_id] = []
      peopleMap[link.note_id].push(link.team_id)
    }

    res.json((notes as any[]).map(n => ({
      ...n,
      linkedProjectIds: projectMap[n.id] || [],
      linkedTeamIds: peopleMap[n.id] || []
    })))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// Get single note by id
app.get('/api/notes/:id', async (req, res) => {
  try {
    const note = await get('SELECT * FROM notes WHERE id = ?', [req.params.id])
    if (!note) return res.status(404).json({ error: 'Note not found' })

    const projectLinks = await all('SELECT project_id FROM note_project_links WHERE note_id = ?', [req.params.id])
    const peopleLinks = await all('SELECT team_id FROM note_people_links WHERE note_id = ?', [req.params.id])

    res.json({
      ...note,
      linkedProjectIds: (projectLinks as any[]).map(l => l.project_id),
      linkedTeamIds: (peopleLinks as any[]).map(l => l.team_id)
    })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// Sync notes from gemini-notes.db into DCC
app.post('/api/notes/sync', async (req, res) => {
  try {
    // Open the Gemini notes database
    const geminiDb = new sqlite3.Database(GEMINI_NOTES_DB)
    const geminiAll = (sql: string, params: any[] = []) => new Promise<any[]>((resolve, reject) => {
      geminiDb.all(sql, params, (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

    const geminiNotes = await geminiAll('SELECT * FROM notes ORDER BY id')
    geminiDb.close()

    // Get existing DCC projects and team for matching
    const dccProjects = await all('SELECT id, name FROM projects') as { id: string; name: string }[]
    const dccTeam = await all('SELECT id, name FROM team') as { id: string; name: string }[]

    let inserted = 0
    let updated = 0
    let projectLinksCreated = 0
    let peopleLinksCreated = 0

    for (const gNote of geminiNotes as any[]) {
      const noteId = `gemini_${gNote.id}`

      // Clean up title - use filename-derived title if title field is just a date
      let title = gNote.title || ''
      if (!title || /^\w{3}\s\d{1,2},\s\d{4}$/.test(title)) {
        // Extract meeting name from filename
        const fnMatch = gNote.filename?.match(/^(.+?)\s*-\s*\d{4}/) || gNote.filename?.match(/^Notes_\s*"(.+?)"/)
        if (fnMatch) {
          title = fnMatch[1].replace(/_/g, ' ').replace(/Notes\s*"/, '').replace(/"$/, '').trim()
        } else if (gNote.filename) {
          title = gNote.filename.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim()
        }
      }

      const existing = await get('SELECT id FROM notes WHERE id = ?', [noteId])
      if (existing) {
        await run(
          `UPDATE notes SET title = ?, date = ?, content_preview = ?, people_raw = ?, projects_raw = ?,
           drive_url = ?, source_filename = ?, source_created_at = ?, next_steps = ?, details = ?, attachments = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [title, gNote.date || '', gNote.content_preview || '', gNote.people || '',
           gNote.projects || '', gNote.drive_url || '', gNote.filename || '',
           gNote.created_at || '', gNote.next_steps || '', gNote.details || '', gNote.attachments || '', noteId]
        )
        updated++
      } else {
        await run(
          `INSERT INTO notes (id, source_id, source_filename, title, date, content_preview, people_raw, projects_raw, drive_url, source_created_at, next_steps, details, attachments)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [noteId, gNote.id, gNote.filename || '', title, gNote.date || '',
           gNote.content_preview || '', gNote.people || '', gNote.projects || '',
           gNote.drive_url || '', gNote.created_at || '', gNote.next_steps || '', gNote.details || '', gNote.attachments || '']
        )
        inserted++
      }

      // Clear and rebuild links for this note
      await run('DELETE FROM note_project_links WHERE note_id = ?', [noteId])
      await run('DELETE FROM note_people_links WHERE note_id = ?', [noteId])

      // Match note projects to DCC projects
      const noteProjects = (gNote.projects || '').split(',').map((p: string) => p.trim()).filter(Boolean)
      for (const noteProject of noteProjects) {
        const npLower = noteProject.toLowerCase()
        for (const dccProject of dccProjects) {
          const dccLower = dccProject.name.toLowerCase()
          // Match if note project keyword appears in DCC project name or vice versa
          if (dccLower.includes(npLower) || npLower.includes(dccLower) ||
              // Also check word-level matching for multi-word names
              npLower.split(/\s+/).every(word => dccLower.includes(word))) {
            await run(
              'INSERT OR IGNORE INTO note_project_links (note_id, project_id) VALUES (?, ?)',
              [noteId, dccProject.id]
            )
            projectLinksCreated++
          }
        }
      }

      // Match note people to DCC team members
      const peopleRaw = gNote.people || ''
      // Also check the content preview and filename for names
      const searchText = `${peopleRaw} ${gNote.content_preview || ''} ${gNote.filename || ''}`
      for (const member of dccTeam) {
        const nameParts = member.name.split(/\s+/)
        const firstName = nameParts[0]?.toLowerCase()
        const lastName = nameParts[nameParts.length - 1]?.toLowerCase()
        const fullName = member.name.toLowerCase()
        const textLower = searchText.toLowerCase()

        // Match on full name or (first + last name appearing near each other)
        if (textLower.includes(fullName) ||
            (firstName && lastName && textLower.includes(firstName) && textLower.includes(lastName))) {
          await run(
            'INSERT OR IGNORE INTO note_people_links (note_id, team_id) VALUES (?, ?)',
            [noteId, member.id]
          )
          peopleLinksCreated++
        }
      }
    }

    await updateDbVersion()
    res.json({
      success: true,
      stats: { total: geminiNotes.length, inserted, updated, projectLinksCreated, peopleLinksCreated }
    })
  } catch (e: any) {
    console.error('Notes sync error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ==========================================
// Work Knowledge Base API (Gemini Notes KB)
// ==========================================
const WORK_KB_DB = process.env.WORK_KB_DB || path.join(homedir(), '.openclaw', 'workspace', 'kb', 'work', 'data', 'work-kb.db');

// Helper to open KB database (separate from main DCC db)
const getKbDb = () => {
  try {
    const kbDb = new sqlite3.Database(WORK_KB_DB);
    const kbAll = (sql: string, params: any[] = []) => new Promise<any[]>((resolve, reject) => {
      kbDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    const kbGet = (sql: string, params: any[] = []) => new Promise<any>((resolve, reject) => {
      kbDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    return { db: kbDb, all: kbAll, get: kbGet };
  } catch (e) {
    return null;
  }
};

// Get full content for a note from work-kb.db
app.get('/api/notes/:id/full-content', async (req, res) => {
  try {
    const kb = getKbDb()
    if (!kb) {
      return res.status(503).json({ error: 'Work KB not available' })
    }
    // Note IDs in DCC are like "gemini_123", which match source_id in work-kb.db
    const source = await kb.get(
      'SELECT content, content_preview FROM sources WHERE source_id = ?',
      [req.params.id]
    )
    kb.db.close()

    if (!source) {
      return res.status(404).json({ error: 'Full content not found' })
    }

    res.json({ content: (source as any).content || (source as any).content_preview || '' })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// KB Search - full-text search across work knowledge base
app.get('/api/kb/search', async (req, res) => {
  const { q, project, person, limit: limitStr } = req.query as { q?: string; project?: string; person?: string; limit?: string };
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

  const limit = parseInt(limitStr || '10', 10);
  const kb = getKbDb();
  if (!kb) return res.status(503).json({ error: 'Work KB not available' });

  try {
    const ftsQuery = q.replace(/"/g, '""');

    // Source-level FTS search
    let sourceResults = await kb.all(`
      SELECT s.source_id, s.title, s.date, s.content_preview, s.people,
             s.projects, s.drive_url, s.content_type
      FROM sources_fts fts
      JOIN sources s ON fts.rowid = s.id
      WHERE sources_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `, [ftsQuery, limit * 3]);

    // Apply filters
    if (project) {
      const pLower = project.toLowerCase();
      sourceResults = sourceResults.filter((r: any) => (r.projects || '').toLowerCase().includes(pLower));
    }
    if (person) {
      const personLower = person.toLowerCase();
      sourceResults = sourceResults.filter((r: any) => (r.people || '').toLowerCase().includes(personLower));
    }

    // Chunk-level search for additional context
    const chunkResults = await kb.all(`
      SELECT c.source_id, c.content as chunk, c.chunk_index,
             s.title, s.date, s.people, s.projects, s.drive_url
      FROM chunks_fts cfts
      JOIN chunks c ON cfts.rowid = c.id
      JOIN sources s ON c.source_id = s.source_id
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `, [ftsQuery, limit]);

    // Merge results
    const seen = new Set<string>();
    const results: any[] = [];

    for (const r of sourceResults.slice(0, limit)) {
      results.push({ ...r, match_type: 'source' });
      seen.add(r.source_id);
    }
    for (const r of chunkResults) {
      if (!seen.has(r.source_id)) {
        results.push({ ...r, match_type: 'chunk' });
        seen.add(r.source_id);
      }
    }

    kb.db.close();
    res.json({ query: q, results: results.slice(0, limit), total: results.length });
  } catch (e: any) {
    kb.db.close();
    console.error('KB search error:', e);
    res.status(500).json({ error: e.message });
  }
});

// KB Stats
app.get('/api/kb/stats', async (_req, res) => {
  const kb = getKbDb();
  if (!kb) return res.status(503).json({ error: 'Work KB not available' });

  try {
    const sourceCount = await kb.get('SELECT COUNT(*) as count FROM sources');
    const chunkCount = await kb.get('SELECT COUNT(*) as count FROM chunks');
    const dateRange = await kb.get("SELECT MIN(date) as earliest, MAX(date) as latest FROM sources WHERE date IS NOT NULL AND date != ''");
    const projects = await kb.all("SELECT DISTINCT projects FROM sources WHERE projects IS NOT NULL AND projects != ''");

    const uniqueProjects = new Set<string>();
    for (const row of projects) {
      for (const p of (row as any).projects.split(',')) {
        const trimmed = p.trim();
        if (trimmed) uniqueProjects.add(trimmed);
      }
    }

    kb.db.close();
    res.json({
      sources: sourceCount?.count || 0,
      chunks: chunkCount?.count || 0,
      projects: Array.from(uniqueProjects).sort(),
      dateRange: { earliest: dateRange?.earliest, latest: dateRange?.latest }
    });
  } catch (e: any) {
    kb.db.close();
    console.error('KB stats error:', e);
    res.status(500).json({ error: e.message });
  }
});

// KB Recent - get recent notes from KB
app.get('/api/kb/recent', async (req, res) => {
  const { limit: limitStr, project, person } = req.query as { limit?: string; project?: string; person?: string };
  const limit = parseInt(limitStr || '20', 10);
  const kb = getKbDb();
  if (!kb) return res.status(503).json({ error: 'Work KB not available' });

  try {
    let rows = await kb.all(`
      SELECT source_id, title, date, content_preview, people, projects,
             drive_url, content_type, ingested_at
      FROM sources
      ORDER BY date DESC, ingested_at DESC
      LIMIT ?
    `, [limit * 3]);

    if (project) {
      const pLower = project.toLowerCase();
      rows = rows.filter((r: any) => (r.projects || '').toLowerCase().includes(pLower));
    }
    if (person) {
      const personLower = person.toLowerCase();
      rows = rows.filter((r: any) => (r.people || '').toLowerCase().includes(personLower));
    }

    kb.db.close();
    res.json({ results: rows.slice(0, limit) });
  } catch (e: any) {
    kb.db.close();
    console.error('KB recent error:', e);
    res.status(500).json({ error: e.message });
  }
});

// KB Show - get full details of a source
app.get('/api/kb/source/:sourceId', async (req, res) => {
  const kb = getKbDb();
  if (!kb) return res.status(503).json({ error: 'Work KB not available' });

  try {
    const source = await kb.get('SELECT * FROM sources WHERE source_id = ?', [req.params.sourceId]);
    if (!source) {
      kb.db.close();
      return res.status(404).json({ error: 'Source not found' });
    }

    const chunks = await kb.all(
      'SELECT chunk_index, content FROM chunks WHERE source_id = ? ORDER BY chunk_index',
      [req.params.sourceId]
    );

    kb.db.close();
    res.json({ ...source, chunks });
  } catch (e: any) {
    kb.db.close();
    console.error('KB source error:', e);
    res.status(500).json({ error: e.message });
  }
});

// KB Sync - trigger ingestion from Gemini notes into work KB
app.post('/api/kb/sync', async (_req, res) => {
  try {
    const { execSync } = require('child_process');
    const scriptPath = path.join(homedir(), '.openclaw', 'workspace', 'kb', 'work', 'scripts', 'ingest_gemini.py');
    const result = execSync(`python3 "${scriptPath}"`, {
      timeout: 120000,
      encoding: 'utf-8',
      env: { ...process.env, GEMINI_NOTES_DB }
    });

    // Parse the JSON output from the script
    const lines = result.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    let stats;
    try {
      stats = JSON.parse(jsonLine);
    } catch {
      stats = { raw_output: result.trim() };
    }

    res.json({ success: true, stats });
  } catch (e: any) {
    console.error('KB sync error:', e);
    res.status(500).json({ error: e.message || 'KB sync failed' });
  }
});

// Serve static files in production
const DIST_PATH = path.join(process.cwd(), 'dist');
const isProduction = process.env.NODE_ENV === 'production';

// Seed endpoint - replaces all data
app.post('/api/seed', async (req, res) => {
  try {
    const { projects, team, assignments, priorities, businessLines, brandOptions } = req.body
    
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
    
    // Clear and insert project assignments (for capacity sync)
    if (assignments && assignments.length > 0) {
      await run('DELETE FROM project_assignments')
      for (const a of assignments) {
        await run(`INSERT INTO project_assignments (id, project_id, designer_id, allocation_percent, created_at) VALUES (?, ?, ?, ?, ?)`,
          [a.id || `${a.project_id}_${a.designer_id}`, a.project_id, a.designer_id, a.allocation_percent ?? 0, a.created_at || new Date().toISOString()])
      }
    }
    
    // Clear and insert project priorities (force rankings)
    if (priorities && priorities.length > 0) {
      await run('DELETE FROM project_priorities')
      for (const p of priorities) {
        await run(`INSERT INTO project_priorities (business_line_id, project_id, rank) VALUES (?, ?, ?)`,
          [p.business_line_id, p.project_id, p.rank])
      }
    }
    
    // Clear and insert business lines
    if (businessLines && businessLines.length > 0) {
      await run('DELETE FROM business_lines')
      for (const bl of businessLines) {
        await run(`INSERT INTO business_lines (id, name, deckName, deckLink, prdName, prdLink, briefName, briefLink, figmaLink, customLinks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [bl.id, bl.name, bl.deckName || '', bl.deckLink || '', bl.prdName || '', bl.prdLink || '', bl.briefName || '', bl.briefLink || '', bl.figmaLink || '', JSON.stringify(bl.customLinks || [])])
      }
    }
    
    // Clear and insert brand options
    if (brandOptions && brandOptions.length > 0) {
      await run('DELETE FROM brand_options')
      for (const bo of brandOptions) {
        if (typeof bo === 'string') {
          await run(`INSERT INTO brand_options (name) VALUES (?)`, [bo])
        } else {
          await run(`INSERT INTO brand_options (id, name) VALUES (?, ?)`, [bo.id, bo.name])
        }
      }
    }
    
    // Update DB version on seed
    await updateDbVersion()
    
    res.json({ success: true, synced: { 
      projects: projects?.length ?? 0, 
      team: team?.length ?? 0, 
      assignments: assignments?.length ?? 0,
      priorities: priorities?.length ?? 0,
      businessLines: businessLines?.length ?? 0,
      brandOptions: brandOptions?.length ?? 0
    }})
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
// Site version: manually updated in code when commits are made (YYYY.MM.DD.hhmm)
// DB version: stored in DB, auto-updates on data changes
// Format: YYYY.MM.DD.hhmm (e.g., 2026.02.26.2059) → displays as "2026.02.26 2059"

const SITE_VERSION = '2026.03.05.1011'
const SITE_TIME = '1011'

const VERSION_KEY = 'dcc_versions'

// Generate version parts for DB updates
const generateDbVersionParts = () => {
  // Keep DB version clock in Pacific Time so it is directly comparable to local build/version workflow
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  const year = get('year')
  const mm = get('month')
  const dd = get('day')
  const hh = get('hour')
  const min = get('minute')

  return {
    versionNumber: `${year}.${mm}.${dd}.${hh}${min}`,
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
run("CREATE TABLE IF NOT EXISTS project_priorities (business_line_id TEXT NOT NULL, project_id TEXT NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY (business_line_id, project_id))")

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

// Notes tables
run(`CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  source_id INTEGER,
  source_filename TEXT,
  title TEXT NOT NULL DEFAULT '',
  date TEXT,
  content_preview TEXT,
  people_raw TEXT,
  projects_raw TEXT,
  drive_url TEXT,
  source_created_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`).catch(e => console.error('notes init error:', e.message))

run(`CREATE TABLE IF NOT EXISTS note_project_links (
  note_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (note_id, project_id)
)`).catch(e => console.error('note_project_links init error:', e.message))

run(`CREATE TABLE IF NOT EXISTS note_people_links (
  note_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  PRIMARY KEY (note_id, team_id)
)`).catch(e => console.error('note_people_links init error:', e.message))

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

// --- Project Priorities ---

// GET /api/priorities — returns all rows as { business_line_id, project_id, rank }
app.get('/api/priorities', async (req, res) => {
  try {
    const rows = await all('SELECT business_line_id, project_id, rank FROM project_priorities ORDER BY business_line_id, rank ASC')
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// PUT /api/priorities — bulk upsert ranked list for one business line
// Body: { business_line_id: string, project_ids: string[] } (ordered by priority)
app.put('/api/priorities', async (req, res) => {
  const { business_line_id, project_ids } = req.body
  if (!business_line_id || !Array.isArray(project_ids)) {
    return res.status(400).json({ error: 'business_line_id and project_ids required' })
  }
  try {
    await run('DELETE FROM project_priorities WHERE business_line_id = ?', [business_line_id])
    for (let i = 0; i < project_ids.length; i++) {
      await run(
        'INSERT INTO project_priorities (business_line_id, project_id, rank) VALUES (?, ?, ?)',
        [business_line_id, project_ids[i], i + 1]
      )
    }
    await updateDbVersion()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

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
      excluded: !!m.excluded,
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
    const { weekly_hours, excluded } = req.body
    await run('UPDATE team SET weekly_hours = ?, excluded = ?, updatedAt = datetime("now") WHERE id = ?', 
      [weekly_hours || 35, excluded !== undefined ? (excluded ? 1 : 0) : 0, req.params.designerId])
    await updateDbVersion()
    res.json({ success: true })
  } catch (e) { res.status(500).json({error: e.message}); }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Production mode: ${isProduction}`);
});
