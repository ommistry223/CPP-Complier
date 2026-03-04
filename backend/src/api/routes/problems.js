const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/problems  —  list all (optionally filtered by published)
router.get('/', async (req, res) => {
  try {
    const published = req.query.published === 'true';
    const problems = await db.getProblems({ published });
    res.json({ status: 'ok', problems });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/problems/:id  —  returns a single problem by ID (used for overtime bonus question display)
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM test_cases t WHERE t.problem_id = p.id AND t.is_sample = true) AS tc_count
       FROM problems p WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ status: 'error', message: 'Problem not found' });
    res.json({ status: 'ok', problem: rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/problems/:id/testcases  —  returns only SAMPLE (visible) test cases
router.get('/:id/testcases', async (req, res) => {
  try {
    const samples = await db.getSampleTestCases(req.params.id);
    res.json({ status: 'ok', samples, total: samples.length });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/problems/:id/testcases/all  —  all test cases including hidden (admin)
router.get('/:id/testcases/all', async (req, res) => {
  try {
    const testcases = await db.getAllTestCases(req.params.id);
    res.json({ status: 'ok', testcases });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/problems/:id/testcases  —  add a test case (admin)
router.post('/:id/testcases', async (req, res) => {
  try {
    const { input, expected_output, is_sample } = req.body;
    if (!input || expected_output === undefined || expected_output === null) {
      return res.status(400).json({ status: 'error', message: 'input and expected_output are required' });
    }
    const tc = await db.addTestCase(req.params.id, { input, expected_output, is_sample });
    res.json({ status: 'ok', testcase: tc });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/problems/testcases/:tcId  —  delete a test case (admin)
router.delete('/testcases/:tcId', async (req, res) => {
  try {
    await db.deleteTestCase(req.params.tcId);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Hints ─────────────────────────────────────────────────

// GET /api/problems/:id/hints  —  get hints for a problem
router.get('/:id/hints', async (req, res) => {
  try {
    const hints = await db.getHints(req.params.id);
    res.json({ status: 'ok', hints });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/problems/:id/hints  —  add a hint (admin)
router.post('/:id/hints', async (req, res) => {
  try {
    const { content, order_index } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ status: 'error', message: 'content is required' });
    }
    const hint = await db.addHint(req.params.id, content.trim(), order_index ?? 0);
    res.json({ status: 'ok', hint });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/problems/hints/:hintId  —  delete a hint (admin)
router.delete('/hints/:hintId', async (req, res) => {
  try {
    await db.deleteHint(req.params.hintId);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
