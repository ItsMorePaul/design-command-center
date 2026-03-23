import express from 'express';
import { run, get, all, upsertTeamMember } from '../db.js';
import { updateDbVersion, logActivity } from '../version.js';
import { getUserEmail } from '../auth.js';

const router = express.Router();

// ============ TEAM ============

router.get('/team', async (req, res) => {
  try {
    const team = await all('SELECT * FROM team ORDER BY name') as any[];
    res.json(team.map((m: any) => ({
      ...m,
      brands: JSON.parse(m.brands || '[]'),
      timeOff: m.timeOff ? JSON.parse(m.timeOff) : [],
      excluded: !!m.excluded
    })));
  } catch (e: any) { res.status(500).json({error: e.message}); }
});

router.post('/team', async (req, res) => {
  try {
    const { id, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours, excluded, updatedAt: clientUpdatedAt } = req.body;
    const memberId = id || Date.now().toString();

    if (id && clientUpdatedAt) {
      const existing = await get('SELECT updatedAt FROM team WHERE id = ?', [id]) as any
      if (existing && existing.updatedAt && existing.updatedAt !== clientUpdatedAt) {
        return res.status(409).json({ error: 'This team member was modified by another user. Please refresh and try again.' })
      }
    }

    await upsertTeamMember({
      id: memberId, name, role, brands, status, slack, email, avatar, timeOff, weekly_hours, excluded,
    });
    await updateDbVersion()
    const saved = await get('SELECT * FROM team WHERE id = ?', [memberId])
    res.json(saved);
  } catch (e: any) { res.status(500).json({error: e.message}); }
});

router.delete('/team/:id', async (req, res) => {
  try {
    await run('DELETE FROM team WHERE id = ?', [req.params.id]);
    await updateDbVersion()
    res.json({success: true});
  } catch (e: any) { res.status(500).json({error: e.message}); }
});

// ============ HOLIDAYS ============

router.get('/holidays', async (_req, res) => {
  try {
    const holidays = await all('SELECT * FROM holidays ORDER BY date');
    res.json(holidays);
  } catch (e: any) { res.status(500).json({error: e.message}); }
});

router.post('/holidays', async (req, res) => {
  try {
    const { id, name, date } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date required' });
    const holidayId = id || Date.now().toString();
    await run(
      'INSERT OR REPLACE INTO holidays (id, name, date) VALUES (?, ?, ?)',
      [holidayId, name, date]
    );
    updateDbVersion();
    await logActivity('holiday', id ? 'update' : 'create', name, getUserEmail(req), date)
    const holidays = await all('SELECT * FROM holidays ORDER BY date');
    res.json(holidays);
  } catch (e: any) { res.status(500).json({error: e.message}); }
});

router.delete('/holidays/:id', async (req, res) => {
  try {
    const existing = await get('SELECT name FROM holidays WHERE id = ?', [req.params.id]) as any
    await run('DELETE FROM holidays WHERE id = ?', [req.params.id]);
    updateDbVersion();
    await logActivity('holiday', 'delete', existing?.name || req.params.id, getUserEmail(req))
    const holidays = await all('SELECT * FROM holidays ORDER BY date');
    res.json(holidays);
  } catch (e: any) { res.status(500).json({error: e.message}); }
});

export default router;
