const { Pool } = require('pg');
const logger = require('../utils/logger');

// Each API replica runs with max:50 connections to PgBouncer.
// 8 replicas × 50 = 400 connections → PgBouncer DEFAULT_POOL_SIZE=400 covers this.
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'coderunner',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',

  max: 50,    // was 20 — 50 per replica × 8 replicas = 400 total
  idleTimeoutMillis: 30000,    // close idle clients after 30s
  connectionTimeoutMillis: 3000,  // fail fast on connection timeout (was 2s)
  allowExitOnIdle: true, // let Node exit when pool is empty
});

pool.on('connect', () => {
  logger.debug('New client connected to PostgreSQL');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', err);
});


const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('Database query error:', { text, err: err.message });
    throw err;
  }
};

const getProblems = async ({ published, set } = {}) => {
  const conditions = [];
  const params = [];
  if (published !== undefined) { params.push(published); conditions.push(`is_published = $${params.length}`); }
  if (set && set !== 'all') { params.push(set); conditions.push(`problem_set = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query(`SELECT * FROM problems ${where} ORDER BY created_at DESC`, params);
  return res.rows;
};

// Returns ALL test cases for a problem (hidden + sample) — for server-side judging
const getTestCases = async (problemId) => {
  const res = await query(
    'SELECT id, input, expected_output, is_sample, order_index FROM test_cases WHERE problem_id = $1 ORDER BY order_index ASC',
    [problemId]
  );
  return res.rows;
};

// Returns only the sample (visible) test cases — safe to send to frontend
const getSampleTestCases = async (problemId) => {
  const res = await query(
    'SELECT id, input, expected_output, order_index FROM test_cases WHERE problem_id = $1 AND is_sample = true ORDER BY order_index ASC',
    [problemId]
  );
  return res.rows;
};

// Returns a single problem with its time/memory limits
const getProblemById = async (problemId) => {
  const res = await query(
    'SELECT id, title, time_limit, memory_limit FROM problems WHERE id = $1',
    [problemId]
  );
  return res.rows[0] || null;
};

const getClient = () => pool.connect();

// Admin: add a test case to a problem
const addTestCase = async (problemId, { input, expected_output, is_sample, order_index }) => {
  const res = await query(
    `INSERT INTO test_cases (problem_id, input, expected_output, is_sample, order_index)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [problemId, input, expected_output, is_sample ?? true, order_index ?? 999]
  );
  return res.rows[0];
};

// Admin: delete a test case by ID
const deleteTestCase = async (tcId) => {
  await query('DELETE FROM test_cases WHERE id = $1', [tcId]);
};

// Admin: get all test cases (including hidden) for a problem
const getAllTestCases = async (problemId) => {
  const res = await query(
    `SELECT id, input, expected_output, is_sample, order_index
     FROM test_cases WHERE problem_id = $1 ORDER BY order_index ASC, id ASC`,
    [problemId]
  );
  return res.rows;
};

// Ensure hints table exists (idempotent startup call)
const ensureHintsTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS problem_hints (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_problem_hints_problem ON problem_hints(problem_id);
  `);
};

// Get all hints for a problem (ordered)
const getHints = async (problemId) => {
  const res = await query(
    'SELECT id, content, order_index FROM problem_hints WHERE problem_id = $1 ORDER BY order_index ASC, created_at ASC',
    [problemId]
  );
  return res.rows;
};

// Add a hint
const addHint = async (problemId, content, orderIndex = 0) => {
  const res = await query(
    'INSERT INTO problem_hints (problem_id, content, order_index) VALUES ($1,$2,$3) RETURNING *',
    [problemId, content, orderIndex]
  );
  return res.rows[0];
};

// Delete a hint
const deleteHint = async (hintId) => {
  await query('DELETE FROM problem_hints WHERE id = $1', [hintId]);
};

// Create a new problem
const createProblem = async ({ title, slug, description, difficulty, tags, constraints, input_format, output_format, time_limit, memory_limit, is_published, problem_set }) => {
  const res = await query(
    `INSERT INTO problems (title, slug, description, difficulty, tags, constraints, input_format, output_format, time_limit, memory_limit, is_published, problem_set)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [title, slug, description, difficulty, tags || [], constraints, input_format, output_format, time_limit || 2000, memory_limit || 256, is_published || false, problem_set || 'none']
  );
  return res.rows[0];
};

// Update an existing problem
const updateProblem = async (id, fields) => {
  const { title, description, difficulty, tags, constraints, input_format, output_format, time_limit, memory_limit, is_published, problem_set } = fields;
  const res = await query(
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
       updated_at    = NOW()
     WHERE id = $12 RETURNING *`,
    [title, description, difficulty, tags ? JSON.stringify(tags) : null,
     constraints, input_format, output_format, time_limit, memory_limit,
     is_published, problem_set, id]
  );
  return res.rows[0] || null;
};

module.exports = { query, getClient, pool, getProblems, getTestCases, getSampleTestCases, getProblemById, addTestCase, deleteTestCase, getAllTestCases, ensureHintsTable, getHints, addHint, deleteHint, createProblem, updateProblem };
