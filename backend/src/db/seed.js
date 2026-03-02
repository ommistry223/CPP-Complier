require('dotenv').config();
const { query, pool } = require('./index');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

async function seed() {
    try {
        logger.info('Seeding database...');

        // ── Users ─────────────────────────────────────────────────
        const hashedPassword = await bcrypt.hash('Admin@123', 12);
        await query(`
            INSERT INTO users (username, email, password_hash, role, rating) VALUES
                ('admin',   'admin@coderunner.io',  $1, 'admin',  2500),
                ('setter1', 'setter@coderunner.io', $1, 'setter', 1800),
                ('alice',   'alice@example.com',    $1, 'user',   1650),
                ('bob',     'bob@example.com',      $1, 'user',   1420),
                ('charlie', 'charlie@example.com',  $1, 'user',   1380)
            ON CONFLICT (email) DO NOTHING
        `, [hashedPassword]);

        const setterRes = await query(`SELECT id FROM users WHERE username='setter1'`);
        const setterId = setterRes.rows[0]?.id;

        // ── Problems — 17 for Code Tic-Tac-Toe ────────────────────
        // Q1-Q3: Knife questions · Q4-Q16: Grid questions · Q17: Bonus
        const problems = [
            /* ── Q1 (Knife) ───────────────────────────────────────── */
            {
                title: 'Print Hello World', slug: 'print-hello-world',
                description: 'Write a program that prints exactly `Hello World!` to the output.',
                difficulty: 'Easy', tags: ['Basics'],
                constraints: 'No input.',
                input_format: 'No input.',
                output_format: 'Hello World!',
                time_limit: 1000, memory_limit: 128,
                tests: [{ input: '', output: 'Hello World!', sample: true }],
            },
            /* ── Q2 (Knife) ───────────────────────────────────────── */
            {
                title: 'Sum of Two Numbers', slug: 'sum-two-numbers',
                description: 'Given two integers A and B, print their sum.',
                difficulty: 'Easy', tags: ['Math'],
                constraints: '-10^9 <= A, B <= 10^9',
                input_format: 'Two space-separated integers A B.',
                output_format: 'Single integer: A + B.',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: '2 3', output: '5', sample: true },
                    { input: '-1 1', output: '0', sample: false },
                    { input: '100 200', output: '300', sample: false },
                ],
            },
            /* ── Q3 (Knife) ───────────────────────────────────────── */
            {
                title: 'Maximum of Three Numbers', slug: 'max-three-numbers',
                description: 'Given three integers, print the maximum among them.',
                difficulty: 'Easy', tags: ['Math'],
                constraints: '-10^9 <= each number <= 10^9',
                input_format: 'Three space-separated integers.',
                output_format: 'Single integer (the maximum).',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: '1 2 3', output: '3', sample: true },
                    { input: '10 5 7', output: '10', sample: false },
                    { input: '-1 -2 -3', output: '-1', sample: false },
                ],
            },
            /* ── Q4 ────────────────────────────────────────────────── */
            {
                title: 'Print N Numbers', slug: 'print-n-numbers',
                description: 'Given N, print numbers from 1 to N separated by spaces.',
                difficulty: 'Easy', tags: ['Loop'],
                constraints: '1 <= N <= 100',
                input_format: 'Single integer N.',
                output_format: 'N space-separated integers from 1 to N.',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: '5', output: '1 2 3 4 5', sample: true },
                    { input: '1', output: '1', sample: false },
                    { input: '3', output: '1 2 3', sample: false },
                ],
            },
            /* ── Q5 ────────────────────────────────────────────────── */
            {
                title: 'Factorial', slug: 'factorial',
                description: 'Given a non-negative integer N, compute N! (N factorial).\n\n0! = 1, N! = 1 × 2 × 3 × … × N.',
                difficulty: 'Easy', tags: ['Math', 'Recursion'],
                constraints: '0 <= N <= 12',
                input_format: 'Single integer N.',
                output_format: 'Single integer: N!',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: '5', output: '120', sample: true },
                    { input: '0', output: '1', sample: true },
                    { input: '10', output: '3628800', sample: false },
                ],
            },
            /* ── Q6 ────────────────────────────────────────────────── */
            {
                title: 'Fibonacci Number', slug: 'fibonacci',
                description: 'Given N, return the N-th Fibonacci number.\n\nF(0)=0, F(1)=1, F(N)=F(N-1)+F(N-2).\n\n**Example:** N=6 → 8',
                difficulty: 'Easy', tags: ['Math', 'DP'],
                constraints: '0 <= N <= 30',
                input_format: 'Single integer N.',
                output_format: 'Single integer: F(N).',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: '0', output: '0', sample: true },
                    { input: '1', output: '1', sample: true },
                    { input: '6', output: '8', sample: false },
                    { input: '10', output: '55', sample: false },
                ],
            },
            /* ── Q7 ────────────────────────────────────────────────── */
            {
                title: 'Count Vowels', slug: 'count-vowels',
                description: 'Given a string, count the number of vowels (a,e,i,o,u – case insensitive).\n\n**Example:** "Hello World" → 3',
                difficulty: 'Easy', tags: ['String'],
                constraints: '1 <= |s| <= 10^4',
                input_format: 'A single string (may contain spaces).',
                output_format: 'Single integer: number of vowels.',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: 'Hello World', output: '3', sample: true },
                    { input: 'aeiou', output: '5', sample: true },
                    { input: 'xyz', output: '0', sample: false },
                ],
            },
            /* ── Q8 ────────────────────────────────────────────────── */
            {
                title: 'Reverse a String', slug: 'reverse-string',
                description: 'Given a string, print it in reverse order.\n\n**Example:** "hello" → "olleh"',
                difficulty: 'Easy', tags: ['String'],
                constraints: '1 <= |s| <= 10^5',
                input_format: 'A single string (no spaces).',
                output_format: 'The reversed string.',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: 'hello', output: 'olleh', sample: true },
                    { input: 'abcde', output: 'edcba', sample: false },
                    { input: 'racecar', output: 'racecar', sample: false },
                ],
            },
            /* ── Q9 ────────────────────────────────────────────────── */
            {
                title: 'Check Palindrome', slug: 'check-palindrome',
                description: 'Given a string, print "YES" if it is a palindrome, "NO" otherwise.\n\n**Example:** "racecar" → YES, "hello" → NO',
                difficulty: 'Easy', tags: ['String'],
                constraints: '1 <= |s| <= 10^5',
                input_format: 'A single string (lowercase, no spaces).',
                output_format: '"YES" or "NO".',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: 'racecar', output: 'YES', sample: true },
                    { input: 'hello', output: 'NO', sample: true },
                    { input: 'abcba', output: 'YES', sample: false },
                    { input: 'abc', output: 'NO', sample: false },
                ],
            },
            /* ── Q10 ───────────────────────────────────────────────── */
            {
                title: 'Two Sum', slug: 'two-sum',
                description: 'Given N integers and a target T, find two 0-based indices i<j where arr[i]+arr[j]=T.\n\n**Example:** N=4 T=9, arr=[2,7,11,15] → 0 1',
                difficulty: 'Easy', tags: ['Array', 'Hash Table'],
                constraints: '2 <= N <= 10^4\n-10^9 <= arr[i] <= 10^9',
                input_format: 'Line 1: N and T. Line 2: N integers.',
                output_format: 'Two space-separated 0-based indices.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: '4 9\n2 7 11 15', output: '0 1', sample: true },
                    { input: '3 6\n3 2 4', output: '1 2', sample: true },
                    { input: '2 6\n3 3', output: '0 1', sample: false },
                ],
            },
            /* ── Q11 ───────────────────────────────────────────────── */
            {
                title: 'Valid Parentheses', slug: 'valid-parentheses',
                description: 'Given a string of brackets `(`, `)`, `{`, `}`, `[`, `]`, print "true" if valid, "false" otherwise.\n\nValid means every open bracket is closed in the correct order.\n\n**Example:** "()[]{}" → true, "(]" → false',
                difficulty: 'Easy', tags: ['String', 'Stack'],
                constraints: '1 <= |s| <= 10^4',
                input_format: 'A single string of bracket characters.',
                output_format: '"true" or "false".',
                time_limit: 1000, memory_limit: 128,
                tests: [
                    { input: '()', output: 'true', sample: true },
                    { input: '()[]{}', output: 'true', sample: true },
                    { input: '(]', output: 'false', sample: false },
                    { input: '([)]', output: 'false', sample: false },
                    { input: '{[]}', output: 'true', sample: false },
                ],
            },
            /* ── Q12 ───────────────────────────────────────────────── */
            {
                title: 'Longest Substring Without Repeating Characters', slug: 'longest-substring-without-repeating',
                description: 'Find the length of the **longest substring** without repeating characters.\n\n**Examples:**\n- "abcabcbb" → 3\n- "bbbbb" → 1\n- "pwwkew" → 3',
                difficulty: 'Medium', tags: ['Hash Table', 'String', 'Sliding Window'],
                constraints: '0 <= |s| <= 5×10^4',
                input_format: 'A single string.',
                output_format: 'An integer.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: 'abcabcbb', output: '3', sample: true },
                    { input: 'bbbbb', output: '1', sample: true },
                    { input: 'pwwkew', output: '3', sample: false },
                    { input: '', output: '0', sample: false },
                ],
            },
            /* ── Q13 ───────────────────────────────────────────────── */
            {
                title: 'Maximum Subarray Sum', slug: 'max-subarray-sum',
                description: 'Given an integer array, find the contiguous subarray with the largest sum.\n\n**Example:** [-2,1,-3,4,-1,2,1,-5,4] → 6 (subarray [4,-1,2,1])',
                difficulty: 'Medium', tags: ['Array', 'DP'],
                constraints: '1 <= N <= 10^5\n-10^4 <= arr[i] <= 10^4',
                input_format: 'Line 1: N. Line 2: N integers.',
                output_format: 'Single integer: the maximum subarray sum.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: '9\n-2 1 -3 4 -1 2 1 -5 4', output: '6', sample: true },
                    { input: '1\n1', output: '1', sample: false },
                    { input: '4\n-1 -2 -3 -4', output: '-1', sample: false },
                ],
            },
            /* ── Q14 ───────────────────────────────────────────────── */
            {
                title: 'Count Pairs with Given Sum', slug: 'count-pairs-sum',
                description: 'Given N integers and target K, count all pairs (i,j) where i<j and arr[i]+arr[j]=K.\n\n**Example:** arr=[1,5,7,-1], K=6 → 2',
                difficulty: 'Medium', tags: ['Array', 'Hash Table'],
                constraints: '1 <= N <= 10^5\n-10^6 <= arr[i] <= 10^6',
                input_format: 'Line 1: N and K. Line 2: N integers.',
                output_format: 'Single integer: number of valid pairs.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: '4 6\n1 5 7 -1', output: '2', sample: true },
                    { input: '4 6\n1 5 7 1', output: '1', sample: false },
                    { input: '3 10\n1 2 3', output: '0', sample: false },
                ],
            },
            /* ── Q15 ───────────────────────────────────────────────── */
            {
                title: 'Sort an Array', slug: 'sort-array',
                description: 'Given an array of N integers, sort them in non-decreasing order and print them.\n\n**Example:** 5 3 1 4 2 → 1 2 3 4 5',
                difficulty: 'Easy', tags: ['Array', 'Sorting'],
                constraints: '1 <= N <= 10^5\n-10^9 <= arr[i] <= 10^9',
                input_format: 'Line 1: N. Line 2: N integers.',
                output_format: 'N space-separated sorted integers.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: '5\n5 3 1 4 2', output: '1 2 3 4 5', sample: true },
                    { input: '3\n3 1 2', output: '1 2 3', sample: false },
                    { input: '1\n7', output: '7', sample: false },
                ],
            },
            /* ── Q16 ───────────────────────────────────────────────── */
            {
                title: 'Coin Change (Minimum Coins)', slug: 'coin-change',
                description: 'Given coin denominations and target amount, find the minimum number of coins. Print -1 if impossible.\n\n**Example:** coins=[1,5,6,9], amount=11 → 2 (5+6)',
                difficulty: 'Medium', tags: ['DP', 'Array'],
                constraints: '1 <= N <= 12\n1 <= coins[i] <= 1000\n0 <= amount <= 10^4',
                input_format: 'Line 1: N coins and amount. Line 2: N coin values.',
                output_format: 'Single integer: minimum coins, or -1.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: '4 11\n1 5 6 9', output: '2', sample: true },
                    { input: '3 11\n1 5 6', output: '2', sample: false },
                    { input: '2 3\n5 4', output: '-1', sample: false },
                ],
            },
            /* ── Q17 (Bonus) ───────────────────────────────────────── */
            {
                title: 'Longest Common Subsequence', slug: 'lcs',
                description: 'Given two strings, find the length of their **Longest Common Subsequence** (LCS).\n\nA subsequence keeps the relative order of characters but need not be contiguous.\n\n**Example:** s1="ABCBDAB", s2="BDCAB" → 4',
                difficulty: 'Medium', tags: ['DP', 'String'],
                constraints: '1 <= |s1|, |s2| <= 1000',
                input_format: 'Two lines each with one string.',
                output_format: 'Single integer: length of LCS.',
                time_limit: 2000, memory_limit: 256,
                tests: [
                    { input: 'ABCBDAB\nBDCAB', output: '4', sample: true },
                    { input: 'AGGTAB\nGXTXAYB', output: '4', sample: false },
                    { input: 'abc\nabc', output: '3', sample: false },
                ],
            },
        ];

        // Insert problems + test cases
        for (let i = 0; i < problems.length; i++) {
            const p = problems[i];
            const res = await query(`
                INSERT INTO problems
                    (title, slug, description, difficulty, tags, constraints, input_format, output_format, time_limit, memory_limit, is_published, author_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
                ON CONFLICT (slug) DO UPDATE
                    SET title=EXCLUDED.title, description=EXCLUDED.description,
                        difficulty=EXCLUDED.difficulty, tags=EXCLUDED.tags
                RETURNING id
            `, [p.title, p.slug, p.description, p.difficulty, p.tags,
            p.constraints, p.input_format, p.output_format,
            p.time_limit, p.memory_limit, setterId]);

            const problemId = res.rows[0]?.id;
            if (!problemId) continue;

            // Delete existing test cases then re-insert
            await query(`DELETE FROM test_cases WHERE problem_id = $1`, [problemId]);
            for (let j = 0; j < p.tests.length; j++) {
                const t = p.tests[j];
                await query(`
                    INSERT INTO test_cases (problem_id, input, expected_output, is_sample, order_index)
                    VALUES ($1, $2, $3, $4, $5)
                `, [problemId, t.input, t.output, t.sample, j]);
            }

            logger.info(`  ✓ Q${i + 1}: ${p.title}`);
        }

        // ── Sample Contest ─────────────────────────────────────────
        const adminRes = await query(`SELECT id FROM users WHERE username='admin'`);
        const adminId = adminRes.rows[0]?.id;
        const now = new Date();
        const contestStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const contestEnd = new Date(contestStart.getTime() + 3 * 60 * 60 * 1000);
        await query(`
            INSERT INTO contests (title, slug, description, rules, start_time, end_time, status, is_public, author_id)
            VALUES ('CodeRunner Weekly #1', 'coderunner-weekly-1',
                'Welcome to the first CodeRunner Weekly Contest!',
                '1. No sharing solutions.\n2. Multiple submissions OK.\n3. Score then penalty.',
                $1, $2, 'upcoming', true, $3)
            ON CONFLICT (slug) DO NOTHING
        `, [contestStart, contestEnd, adminId]);

        logger.info('✅ Database seeded successfully! 17 problems ready.');
    } catch (err) {
        logger.error('Seed failed:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
