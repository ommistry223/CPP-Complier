require('dotenv').config();
const { pool } = require('./index');
const logger = require('../utils/logger');

const migrations = [
    // Migration 1: Users
    `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'setter')),
    rating INTEGER DEFAULT 1200,
    problems_solved INTEGER DEFAULT 0,
    total_submissions INTEGER DEFAULT 0,
    avatar_url TEXT,
    bio TEXT,
    country VARCHAR(100),
    github_url TEXT,
    linkedin_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  `,

    // Migration 2: Problems
    `
  DO $$ BEGIN
    CREATE TYPE difficulty_level AS ENUM ('Easy', 'Medium', 'Hard');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  CREATE TABLE IF NOT EXISTS problems (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    difficulty difficulty_level NOT NULL,
    tags TEXT[] DEFAULT '{}',
    constraints TEXT,
    input_format TEXT,
    output_format TEXT,
    time_limit INTEGER DEFAULT 2000,
    memory_limit INTEGER DEFAULT 256,
    accepted_count INTEGER DEFAULT 0,
    submission_count INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT false,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_problems_slug ON problems(slug);
  CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
  CREATE INDEX IF NOT EXISTS idx_problems_tags ON problems USING GIN(tags);
  `,

    // Migration 3: Test Cases
    `
  CREATE TABLE IF NOT EXISTS test_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    input TEXT NOT NULL,
    expected_output TEXT NOT NULL,
    is_sample BOOLEAN DEFAULT false,
    order_index INTEGER DEFAULT 0,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_test_cases_problem ON test_cases(problem_id);
  `,

    // Migration 4: Submissions
    `
  DO $$ BEGIN
    CREATE TYPE submission_status AS ENUM (
      'pending', 'queued', 'running', 'accepted', 'wrong_answer',
      'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error',
      'compilation_error', 'system_error'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    contest_id UUID,
    language VARCHAR(50) NOT NULL,
    code TEXT NOT NULL,
    code_hash VARCHAR(64),
    status submission_status DEFAULT 'pending',
    verdict TEXT,
    time_taken INTEGER,
    memory_used INTEGER,
    test_cases_passed INTEGER DEFAULT 0,
    total_test_cases INTEGER DEFAULT 0,
    error_message TEXT,
    compiled_at TIMESTAMP WITH TIME ZONE,
    executed_at TIMESTAMP WITH TIME ZONE,
    worker_id VARCHAR(100),
    job_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
  CREATE INDEX IF NOT EXISTS idx_submissions_code_hash ON submissions(code_hash);
  CREATE INDEX IF NOT EXISTS idx_submissions_contest ON submissions(contest_id);
  `,

    // Migration 5: Contests
    `
  DO $$ BEGIN
    CREATE TYPE contest_status AS ENUM ('draft', 'upcoming', 'active', 'ended');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  CREATE TABLE IF NOT EXISTS contests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    rules TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status contest_status DEFAULT 'draft',
    is_public BOOLEAN DEFAULT true,
    max_participants INTEGER,
    penalty_time INTEGER DEFAULT 20,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);
  CREATE INDEX IF NOT EXISTS idx_contests_start_time ON contests(start_time);
  `,

    // Migration 6: Contest Problems
    `
  CREATE TABLE IF NOT EXISTS contest_problems (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 100,
    order_index INTEGER DEFAULT 0,
    UNIQUE(contest_id, problem_id)
  );
  `,

    // Migration 7: Contest Registrations
    `
  CREATE TABLE IF NOT EXISTS contest_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(contest_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_contest_reg_contest ON contest_registrations(contest_id);
  CREATE INDEX IF NOT EXISTS idx_contest_reg_user ON contest_registrations(user_id);
  `,

    // Migration 8: Leaderboard
    `
  CREATE TABLE IF NOT EXISTS leaderboard (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER DEFAULT 0,
    penalty INTEGER DEFAULT 0,
    problems_solved INTEGER DEFAULT 0,
    last_accepted_at TIMESTAMP WITH TIME ZONE,
    rank INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(contest_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_leaderboard_contest ON leaderboard(contest_id);
  CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(contest_id, score DESC);
  `,

    // Migration 9: Problem Solutions (editorial)
    `
  CREATE TABLE IF NOT EXISTS editorials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    approach TEXT,
    complexity TEXT,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(problem_id)
  );
  `,

    // Migration 10: Discussions
    `
  CREATE TABLE IF NOT EXISTS discussions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
    contest_id UUID REFERENCES contests(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    upvotes INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    is_pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS discussion_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    discussion_id UUID NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES discussion_comments(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    upvotes INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  `,

    // Migration 11: Code Cache (for deduplication)
    `
  CREATE TABLE IF NOT EXISTS code_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_hash VARCHAR(64) UNIQUE NOT NULL,
    language VARCHAR(50) NOT NULL,
    problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    status submission_status NOT NULL,
    time_taken INTEGER,
    memory_used INTEGER,
    test_cases_passed INTEGER DEFAULT 0,
    total_test_cases INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
  );

  CREATE INDEX IF NOT EXISTS idx_code_cache_hash ON code_cache(code_hash, language, problem_id);
  `,

    // Migration 12: Worker Metrics
    `
  CREATE TABLE IF NOT EXISTS worker_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id VARCHAR(100) NOT NULL,
    submissions_processed INTEGER DEFAULT 0,
    avg_execution_time FLOAT DEFAULT 0,
    cpu_usage FLOAT DEFAULT 0,
    memory_usage FLOAT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_worker_metrics_worker ON worker_metrics(worker_id);
  `,

    // Migration 13: Game Submissions (store game contest results without requiring a user account)
    `
  CREATE TABLE IF NOT EXISTS game_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(20) NOT NULL,
    team_id   CHAR(1) NOT NULL,
    problem_id UUID REFERENCES problems(id) ON DELETE SET NULL,
    language   VARCHAR(50) NOT NULL,
    code       TEXT NOT NULL,
    verdict    VARCHAR(50) NOT NULL,
    test_cases_passed INTEGER DEFAULT 0,
    total_test_cases  INTEGER DEFAULT 0,
    time_taken INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_game_sub_room    ON game_submissions(room_code, team_id);
  CREATE INDEX IF NOT EXISTS idx_game_sub_problem ON game_submissions(problem_id);
  CREATE INDEX IF NOT EXISTS idx_game_sub_verdict ON game_submissions(verdict);
  `,

    // Migration 14: Add problem_set column to problems (Set A / Set B / Both / none)
    `
  ALTER TABLE problems ADD COLUMN IF NOT EXISTS problem_set VARCHAR(10) DEFAULT 'none';
  CREATE INDEX IF NOT EXISTS idx_problems_set ON problems(problem_set);
  `,

    // Migration 15: Add bonus points column to problems
    `
  ALTER TABLE problems ADD COLUMN IF NOT EXISTS bonus INTEGER DEFAULT 0;
  `
];

async function migrate() {
    const client = await pool.connect();
    try {
        logger.info('Starting database migrations...');
        await client.query('BEGIN');

        for (let i = 0; i < migrations.length; i++) {
            logger.info(`Running migration ${i + 1}/${migrations.length}...`);
            await client.query(migrations[i]);
        }

        await client.query('COMMIT');
        logger.info('All migrations completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Migration failed:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((err) => {
    console.error(err);
    process.exit(1);
});
