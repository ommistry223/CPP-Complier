/**
 * Admin API Routes — /api/admin/*
 * Provides CRUD for problems, tournament management,
 * analytics, and audit log data.
 */
const express = require('express');
const router  = express.Router();
const { randomBytes } = require('crypto');
const db          = require('../../db');
const redisClient = require('../../cache/redis');
const GameManager = require('../../game/GameManager');
const logger      = require('../../utils/logger');
const { broadcastToRoom } = require('../../utils/broadcaster');

const rand = n => randomBytes(n).toString('hex').toUpperCase();

/* ──────────────────────────────────────────────────────────────
   DASHBOARD OVERVIEW  GET /api/admin/stats
────────────────────────────────────────────────────────────── */
router.get('/stats', async (req, res) => {
  try {
    const [pRes, tRes, sRes, gsRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM problems'),
      db.query("SELECT COUNT(*) FROM problems WHERE is_published = true"),
      db.query('SELECT COUNT(*) FROM game_submissions'),
      db.query("SELECT COUNT(*) FROM game_submissions WHERE verdict = 'accepted'"),
    ]);
    const problems    = parseInt(pRes.rows[0].count);
    const published   = parseInt(tRes.rows[0].count);
    const totalSubs   = parseInt(sRes.rows[0].count);
    const acceptedSubs= parseInt(gsRes.rows[0].count);

    // Last 24 h submission trend
    const trendRes = await db.query(
      `SELECT date_trunc('hour', created_at) AS hr, COUNT(*) AS cnt
       FROM game_submissions
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY hr ORDER BY hr`
    );

    res.json({
      problems, published,
      totalSubmissions: totalSubs,
      acceptedSubmissions: acceptedSubs,
      acceptanceRate: totalSubs > 0 ? Math.round((acceptedSubs / totalSubs) * 100) : 0,
      trend: trendRes.rows,
    });
  } catch (err) {
    logger.error('admin/stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   CSV TEMPLATE  GET /api/admin/problems/csv-template
────────────────────────────────────────────────────────────── */
router.get('/problems/csv-template', (req, res) => {
  const header = 'title,difficulty,tags,description,input_format,output_format,constraints,time_limit,memory_limit,problem_set,is_published,tc_input,tc_output,tc_is_sample';
  const example = '"Two Sum",Easy,"Array,Hash Table","Given an array of integers nums and target, return indices of the two numbers such that they add up to target.","Line 1: n (array size)\nLine 2: n integers\nLine 3: target","Two indices separated by space","2 ≤ n ≤ 10^4",2000,256,A,false,"4\n2 7 11 15\n9","0 1",true';
  const csv = [header, example].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="problems_template.csv"');
  res.send(csv);
});

/* ──────────────────────────────────────────────────────────────
   CSV IMPORT  POST /api/admin/problems/import-csv
   Body: { csvContent: "..." }
────────────────────────────────────────────────────────────── */
router.post('/problems/import-csv', async (req, res) => {
  const { csvContent } = req.body;
  if (!csvContent?.trim()) return res.status(400).json({ error: 'csvContent is required' });

  // Parse CSV (handles quoted fields with commas/newlines)
  const parseCSVLine = (line) => {
    const result = [];
    let inQuote = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        result.push(cur.trim()); cur = '';
      } else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  };

  // Split into lines respecting quoted newlines
  const lines = [];
  let cur = '', inQuote = false;
  for (const ch of csvContent) {
    if (ch === '"') inQuote = !inQuote;
    if ((ch === '\n') && !inQuote) { if (cur.trim()) lines.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) lines.push(cur);

  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least 1 data row' });

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const idx = (name) => headers.indexOf(name);

  // Group rows by title → build problem map
  const problemMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const get = (name, def = '') => (cols[idx(name)] ?? def).replace(/\\n/g, '\n');
    const title = get('title');
    if (!title) continue;
    if (!problemMap.has(title)) {
      problemMap.set(title, {
        title, difficulty: get('difficulty', 'Easy'),
        tags: get('tags').split(',').map(t => t.trim()).filter(Boolean),
        description: get('description'),
        input_format: get('input_format'),
        output_format: get('output_format'),
        constraints: get('constraints'),
        time_limit: parseInt(get('time_limit', '2000')) || 2000,
        memory_limit: parseInt(get('memory_limit', '256')) || 256,
        problem_set: get('problem_set', 'none') || 'none',
        is_published: get('is_published', 'false').toLowerCase() === 'true',
        testcases: [],
      });
    }
    const tcInput = get('tc_input');
    const tcOutput = get('tc_output');
    if (tcOutput !== '') {
      const isSample = get('tc_is_sample', 'true').toLowerCase() !== 'false';
      problemMap.get(title).testcases.push({ input: tcInput, expected_output: tcOutput, is_sample: isSample });
    }
  }

  const created = [], skipped = [], errors = [];
  for (const [, p] of problemMap) {
    if (!p.description.trim()) { skipped.push({ title: p.title, reason: 'Missing description' }); continue; }
    const cleanSlug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      const pRes = await db.query(
        `INSERT INTO problems (title, slug, description, difficulty, tags, constraints, input_format, output_format, time_limit, memory_limit, is_published, problem_set)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [p.title, cleanSlug, p.description, p.difficulty, p.tags, p.constraints, p.input_format, p.output_format, p.time_limit, p.memory_limit, p.is_published, p.problem_set]
      );
      const problem = pRes.rows[0];
      for (let i = 0; i < p.testcases.length; i++) {
        const tc = p.testcases[i];
        await db.addTestCase(problem.id, { input: tc.input, expected_output: tc.expected_output, is_sample: tc.is_sample, order_index: i });
      }
      created.push({ id: problem.id, title: p.title, testcases: p.testcases.length });
    } catch (err) {
      if (err.code === '23505') skipped.push({ title: p.title, reason: 'Slug already exists' });
      else errors.push({ title: p.title, reason: err.message });
    }
  }

  logger.info(`CSV import: ${created.length} created, ${skipped.length} skipped, ${errors.length} errors`);
  res.json({ created, skipped, errors, summary: `${created.length} created, ${skipped.length} skipped, ${errors.length} errors` });
});

/* ──────────────────────────────────────────────────────────────
   PROBLEMS  GET /api/admin/problems
────────────────────────────────────────────────────────────── */
router.get('/problems', async (req, res) => {
  try {
    const { set } = req.query;
    const setFilter = (set && set !== 'all') ? `AND p.problem_set = '${set.replace(/'/g, "''")}'` : '';
    const { rows } = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM test_cases t WHERE t.problem_id = p.id) AS tc_count,
              (SELECT COUNT(*) FROM game_submissions g WHERE g.problem_id = p.id) AS sub_count,
              (SELECT COUNT(*) FROM game_submissions g WHERE g.problem_id = p.id AND g.verdict = 'accepted') AS ac_count
       FROM problems p
       WHERE 1=1 ${setFilter}
       ORDER BY p.created_at DESC`
    );
    res.json({ problems: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   CREATE PROBLEM  POST /api/admin/problems
────────────────────────────────────────────────────────────── */
router.post('/problems', async (req, res) => {
  const {
    title, slug, description, difficulty = 'Easy', tags = [],
    constraints, input_format, output_format,
    time_limit = 2000, memory_limit = 256,
    is_published = false, problem_set = 'none', bonus = 0, testcases = [],
  } = req.body;

  if (!title?.trim() || !description?.trim()) {
    return res.status(400).json({ error: 'title and description are required' });
  }

  const cleanSlug = (slug || title)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    const pRes = await db.query(
      `INSERT INTO problems (title, slug, description, difficulty, tags,
         constraints, input_format, output_format, time_limit, memory_limit,
         is_published, problem_set, bonus)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [title.trim(), cleanSlug, description.trim(),
       difficulty, tags, constraints, input_format, output_format,
       time_limit, memory_limit, is_published, problem_set || 'none', bonus || 0]
    );
    const problem = pRes.rows[0];

    // Insert test cases in bulk
    if (testcases.length > 0) {
      for (let i = 0; i < testcases.length; i++) {
        const tc = testcases[i];
        await db.addTestCase(problem.id, {
          input: tc.input || '',
          expected_output: tc.expected_output,
          is_sample: tc.is_sample ?? true,
          order_index: i,
        });
      }
    }

    logger.info(`admin: created problem "${problem.title}" id=${problem.id}`);
    res.status(201).json({ problem });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Slug "${cleanSlug}" already exists. Use a different title.` });
    }
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   UPDATE PROBLEM  PUT /api/admin/problems/:id
────────────────────────────────────────────────────────────── */
router.put('/problems/:id', async (req, res) => {
  const { id } = req.params;
  const {
    title, description, difficulty, tags, constraints,
    input_format, output_format, time_limit, memory_limit, is_published, problem_set, bonus,
  } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE problems SET
         title         = COALESCE($1, title),
         description   = COALESCE($2, description),
         difficulty    = COALESCE($3, difficulty),
         tags          = COALESCE($4, tags),
         constraints   = COALESCE($5, constraints),
         input_format  = COALESCE($6, input_format),
         output_format = COALESCE($7, output_format),
         time_limit    = COALESCE($8, time_limit),
         memory_limit  = COALESCE($9, memory_limit),
         is_published  = COALESCE($10, is_published),
         problem_set   = COALESCE($11, problem_set),
         bonus         = COALESCE($12, bonus),
         updated_at    = NOW()
       WHERE id = $13
       RETURNING *`,
      [title, description, difficulty, tags || null,
       constraints, input_format, output_format, time_limit, memory_limit,
       is_published, problem_set || null, bonus ?? null, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Problem not found' });
    res.json({ problem: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   DELETE PROBLEM  DELETE /api/admin/problems/:id
────────────────────────────────────────────────────────────── */
router.delete('/problems/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM problems WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   PUBLISH / UNPUBLISH  PATCH /api/admin/problems/:id/publish
────────────────────────────────────────────────────────────── */
router.patch('/problems/:id/publish', async (req, res) => {
  const { is_published } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE problems SET is_published=$1, updated_at=NOW() WHERE id=$2 RETURNING id,title,is_published',
      [!!is_published, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Problem not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   TOURNAMENTS  GET /api/admin/tournaments
   Reads all tournaments from Redis (pattern scan)
────────────────────────────────────────────────────────────── */
router.get('/tournaments', async (req, res) => {
  try {
    const keys = await redisClient.keys('tournament:T-*');
    if (!keys.length) return res.json({ tournaments: [] });
    const raw = await redisClient.mget(...keys);
    const tournaments = raw
      .filter(Boolean)
      .map(s => JSON.parse(s))
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ tournaments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   CREATE TOURNAMENT  POST /api/admin/tournaments
────────────────────────────────────────────────────────────── */
router.post('/tournaments', async (req, res) => {
  const {
    name = 'Tournament', description = '',
    pairs = 4, questionCount = 17,
    startDate, endDate,
    visibility = 'private', maxTeams,
    enableLeaderboard = true, enableBonus = true,
  } = req.body;

  if (pairs < 1 || pairs > 50) {
    return res.status(400).json({ error: 'pairs must be 1–50' });
  }

  try {
    const tournamentId = 'T-' + rand(3);
    const roomPromises = Array.from({ length: pairs }, (_, i) =>
      GameManager.createRoom(questionCount).then(room => ({
        pairNo: i + 1,
        roomCode: room.code,
        teamACode: room.teamACode,
        teamBCode: room.teamBCode,
        adminCode: room.adminCode,
      }))
    );
    const pairsData = await Promise.all(roomPromises);

    const tournamentData = {
      id: tournamentId, name, description,
      questionCount, createdAt: Date.now(),
      startDate: startDate || null, endDate: endDate || null,
      status: 'upcoming',
      visibility, maxTeams: maxTeams || pairs * 2,
      enableLeaderboard, enableBonus,
      rooms: pairsData.map(p => p.roomCode),
      pairs: pairsData,
      questionIds: [],
    };

    await redisClient.set(
      `tournament:${tournamentId}`,
      JSON.stringify(tournamentData),
      'EX', 7 * 86400  // 7 days TTL
    );

    logger.info(`Admin tournament created: ${tournamentId} (${pairs} rooms)`);
    res.status(201).json({ tournament: tournamentData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   GET TOURNAMENT QUESTIONS  GET /api/admin/tournaments/:id/questions
   Returns full problem details for manually assigned questions
────────────────────────────────────────────────────────────── */
router.get('/tournaments/:id/questions', async (req, res) => {
  try {
    const raw = await redisClient.get(`tournament:${req.params.id}`);
    if (!raw) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = JSON.parse(raw);
    const ids = tournament.questionIds || [];
    if (!ids.length) return res.json({ questions: [] });
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `SELECT p.*, COUNT(DISTINCT tc.id) AS tc_count
       FROM problems p
       LEFT JOIN test_cases tc ON tc.problem_id = p.id
       WHERE p.id IN (${placeholders})
       GROUP BY p.id`,
      ids
    );
    // preserve insertion order
    const map = Object.fromEntries(rows.map(r => [r.id, r]));
    res.json({ questions: ids.map(id => map[id]).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   SET TOURNAMENT QUESTIONS  PUT /api/admin/tournaments/:id/questions
   Body: { questionIds: ["uuid", ...] }
────────────────────────────────────────────────────────────── */
router.put('/tournaments/:id/questions', async (req, res) => {
  try {
    const raw = await redisClient.get(`tournament:${req.params.id}`);
    if (!raw) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = JSON.parse(raw);
    tournament.questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
    await redisClient.set(`tournament:${req.params.id}`, JSON.stringify(tournament), 'EX', 7 * 86400);
    res.json({ ok: true, questionIds: tournament.questionIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   GET ONE TOURNAMENT  GET /api/admin/tournaments/:id
────────────────────────────────────────────────────────────── */
router.get('/tournaments/:id', async (req, res) => {
  try {
    const data = await redisClient.get(`tournament:${req.params.id}`);
    if (!data) return res.status(404).json({ error: 'Tournament not found' });
    res.json({ tournament: JSON.parse(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   UPDATE TOURNAMENT  PATCH /api/admin/tournaments/:id
────────────────────────────────────────────────────────────── */
router.patch('/tournaments/:id', async (req, res) => {
  try {
    const raw = await redisClient.get(`tournament:${req.params.id}`);
    if (!raw) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = { ...JSON.parse(raw), ...req.body, id: req.params.id };
    await redisClient.set(`tournament:${req.params.id}`, JSON.stringify(tournament), 'EX', 7 * 86400);
    res.json({ tournament });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   START TOURNAMENT  POST /api/admin/tournaments/:id/start
────────────────────────────────────────────────────────────── */
router.post('/tournaments/:id/start', async (req, res) => {
  try {
    const raw = await redisClient.get(`tournament:${req.params.id}`);
    if (!raw) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = JSON.parse(raw);

    let started = 0, skipped = 0;
    for (const roomCode of tournament.rooms) {
      const result = await GameManager.forceStartRoom(roomCode);
      if (result.room) {
        started++;
        broadcastToRoom(roomCode, { type: 'game_started', room: result.room });
      } else { skipped++; }
    }

    tournament.status = 'live';
    tournament.startedAt = Date.now();
    await redisClient.set(`tournament:${req.params.id}`, JSON.stringify(tournament), 'EX', 7 * 86400);

    res.json({ ok: true, started, skipped, status: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   DELETE TOURNAMENT  DELETE /api/admin/tournaments/:id
────────────────────────────────────────────────────────────── */
router.delete('/tournaments/:id', async (req, res) => {
  try {
    await redisClient.del(`tournament:${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   ANALYTICS  GET /api/admin/analytics
────────────────────────────────────────────────────────────── */
router.get('/analytics', async (req, res) => {
  try {
    const [
      totalSubs, accepted, perProblem, last24h, hourly
    ] = await Promise.all([
      db.query('SELECT COUNT(*) FROM game_submissions'),
      db.query("SELECT COUNT(*) FROM game_submissions WHERE verdict = 'accepted'"),
      db.query(
        `SELECT p.title, p.difficulty,
                COUNT(g.id) AS total_subs,
                COUNT(g.id) FILTER (WHERE g.verdict = 'accepted') AS accepted
         FROM problems p
         LEFT JOIN game_submissions g ON g.problem_id = p.id
         GROUP BY p.id, p.title, p.difficulty
         ORDER BY total_subs DESC`
      ),
      db.query(
        `SELECT COUNT(*) FROM game_submissions WHERE created_at > NOW() - INTERVAL '24 hours'`
      ),
      db.query(
        `SELECT to_char(date_trunc('hour', created_at), 'HH24:MI') AS hour,
                COUNT(*) AS submissions,
                COUNT(*) FILTER (WHERE verdict = 'accepted') AS accepted
         FROM game_submissions
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY hour ORDER BY hour`
      ),
    ]);

    res.json({
      totalSubmissions: parseInt(totalSubs.rows[0].count),
      accepted: parseInt(accepted.rows[0].count),
      last24h: parseInt(last24h.rows[0].count),
      perProblem: perProblem.rows,
      hourly: hourly.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   LEADERBOARD FOR TOURNAMENT  GET /api/admin/tournaments/:id/leaderboard
────────────────────────────────────────────────────────────── */
router.get('/tournaments/:id/leaderboard', async (req, res) => {
  try {
    const raw = await redisClient.get(`tournament:${req.params.id}`);
    if (!raw) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = JSON.parse(raw);

    const leaderboard = [];
    for (const roomCode of tournament.rooms) {
      const room = await GameManager.getRoom(roomCode);
      if (!room) continue;
      ['A', 'B'].forEach(tid => {
        const team = room.teams[tid];
        if (team && team.name) {
          leaderboard.push({
            teamName: team.name,
            teamCode: tid === 'A' ? room.teamACode : room.teamBCode,
            roomCode,
            solved: team.solved?.length || 0,
            gridCells: room.grid?.filter(c => c === tid).length || 0,
            phase: room.phase,
            winner: room.winner,
          });
        }
      });
    }

    // Sort: solved DESC, gridCells DESC
    leaderboard.sort((a, b) =>
      b.solved !== a.solved ? b.solved - a.solved : b.gridCells - a.gridCells
    );
    leaderboard.forEach((t, i) => { t.rank = i + 1; });

    res.json({ leaderboard, tournament: { id: tournament.id, name: tournament.name, status: tournament.status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────────────────
   GAME SUBMISSIONS LOG  GET /api/admin/submissions
────────────────────────────────────────────────────────────── */
router.get('/submissions', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const { rows } = await db.query(
      `SELECT g.id, g.room_code, g.team_id, g.language,
              g.verdict, g.test_cases_passed, g.total_test_cases,
              g.time_taken, g.created_at,
              p.title AS problem_title, p.difficulty
       FROM game_submissions g
       LEFT JOIN problems p ON p.id = g.problem_id
       ORDER BY g.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countRes = await db.query('SELECT COUNT(*) FROM game_submissions');
    res.json({ submissions: rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
