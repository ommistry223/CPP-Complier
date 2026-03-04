const { randomBytes } = require('crypto');
const redisClient = require('../cache/redis');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../rooms.json');

// Local cache
const rooms = new Map();

// Active timers: roomCode → timeout handle (game time limit)
const roomTimers = new Map();
// Per-question timers: roomCode → timeout handle
const questionTimers = new Map();

/** Helper: Write cache to disk as fallback (Async) */
async function syncToDisk() {
    try {
        if (rooms.size > 2000) {
            const keys = [...rooms.keys()];
            for (let i = 0; i < 500; i++) rooms.delete(keys[i]);
        }
        const data = JSON.stringify([...rooms.entries()]);
        await fs.promises.writeFile(DB_FILE, data);
    } catch (err) {
        logger.error(`Disk sync error: ${err.message}`);
    }
}

/** Load from disk on startup */
try {
    if (fs.existsSync(DB_FILE)) {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const entries = JSON.parse(data);
        for (const [k, v] of entries) rooms.set(k, v);
        logger.info(`Restored ${rooms.size} rooms from disk fallback.`);
    }
} catch (err) {
    logger.error(`Disk load error: ${err.message}`);
}

const rand = (n) => randomBytes(n).toString('hex').toUpperCase();

/** Helper: Sync a room to Redis/Disk */
async function saveRoom(room) {
    if (!room) return;
    rooms.set(room.code, room);
    syncToDisk();

    try {
        const data = JSON.stringify(room);
        redisClient.set(`room:${room.code}`, data, 'EX', 86400).catch(e => logger.error("Redis Sync Error (Room)", e));
        redisClient.set(`admin:${room.adminCode}`, room.code, 'EX', 86400).catch(e => logger.error("Redis Sync Error (Admin)", e));
        redisClient.set(`code:${room.teamACode}`, JSON.stringify({ roomCode: room.code, teamId: 'A' }), 'EX', 86400).catch(e => logger.error("Redis Sync Error (CodeA)", e));
        redisClient.set(`code:${room.teamBCode}`, JSON.stringify({ roomCode: room.code, teamId: 'B' }), 'EX', 86400).catch(e => logger.error("Redis Sync Error (CodeB)", e));
    } catch (err) {
        logger.error(`Serialization error in saveRoom: ${err.message}`);
    }
}

/** Helper: Load a room from Redis or local cache */
async function loadRoom(roomCode) {
    if (rooms.has(roomCode)) return rooms.get(roomCode);
    try {
        const data = await redisClient.get(`room:${roomCode}`);
        if (data) {
            const room = JSON.parse(data);
            rooms.set(roomCode, room);
            return room;
        }
    } catch (err) { }
    return null;
}

const MAX_GRID_BONUS = 2;

function makeTeamSlot() {
    return {
        name: null, socketIds: [], knivesUnlocked: 3, knivesUsed: 0,
        solved: [], pendingGridPicks: 0,
        code: ""
    };
}

/**
 * Schedule (or reschedule) a room timer.
 * When it fires, force-end the room by grid cell count.
 * The broadcast callback is injected from server.js to avoid circular deps.
 */
let _broadcastFn = null;
function setBroadcastFn(fn) { _broadcastFn = fn; }

function scheduleRoomTimer(roomCode, endsAt) {
    // Clear existing timer for this room
    if (roomTimers.has(roomCode)) clearTimeout(roomTimers.get(roomCode));

    const msLeft = endsAt - Date.now();
    if (msLeft <= 0) return;

    const handle = setTimeout(async () => {
        roomTimers.delete(roomCode);
        const room = await loadRoom(roomCode);
        if (!room || room.phase === 'ended') return;

        // Force end: determine winner by grid cells
        const endResult = _endGame(room);
        await saveRoom(room);
        logger.info(`Room ${roomCode}: time expired → winner=${room.winner}`);

        if (_broadcastFn) {
            _broadcastFn(roomCode, {
                type: 'game_over',
                room: sanitizeRoom(room),
                data: { ...endResult.data, reason: 'time_expired' },
            });
        }
    }, msLeft);

    // Node.js: prevent the timer from keeping process alive
    if (handle.unref) handle.unref();
    roomTimers.set(roomCode, handle);
}

/**
 * Schedule (or reschedule) a per-question timer.
 * When it fires, auto-advance to the next question (nobody solved in time).
 */
function scheduleQuestionTimer(roomCode, questionIdx, questionTimeLimitMs) {
    if (questionTimers.has(roomCode)) clearTimeout(questionTimers.get(roomCode));
    if (!questionTimeLimitMs || questionTimeLimitMs <= 0) return;

    const handle = setTimeout(async () => {
        questionTimers.delete(roomCode);
        const room = await loadRoom(roomCode);
        if (!room || room.phase === 'ended') return;
        // Only fire if we are still on the same question in 'playing' phase
        if (room.phase !== 'playing' || room.currentQuestionIdx !== questionIdx) return;

        logger.info(`Room ${roomCode}: Q${questionIdx + 1} time expired`);

        if (room.currentQuestionIdx >= room.questionCount - 1) {
            // Last question — timer expired but don't end the game.
            // Teams can still solve it; game only ends via global timer or normal solve flow.
            await saveRoom(room);
            if (_broadcastFn) _broadcastFn(roomCode, {
                type: 'question_expired',
                room: sanitizeRoom(room),
                data: { expiredIdx: questionIdx, isLastQuestion: true },
            });
        } else {
            room.currentQuestionIdx++;
            room.questionStartedAt = Date.now();
            room.phase = 'playing';
            await saveRoom(room);
            // Schedule timer for the next question
            scheduleQuestionTimer(roomCode, room.currentQuestionIdx, room.questionTimeLimitMs);
            if (_broadcastFn) _broadcastFn(roomCode, {
                type: 'question_expired',
                room: sanitizeRoom(room),
                data: { expiredIdx: questionIdx },
            });
        }
    }, questionTimeLimitMs);

    if (handle.unref) handle.unref();
    questionTimers.set(roomCode, handle);
}

async function createRoom(questionCount = 17) {
    const roomCode = rand(3);
    const room = {
        code: roomCode,
        adminCode: 'ADM-' + rand(2), teamACode: 'A-' + rand(3), teamBCode: 'B-' + rand(3),
        phase: 'waiting', teams: { A: makeTeamSlot(), B: makeTeamSlot() },
        grid: Array(9).fill(null), currentQuestionIdx: 0, questionCount,
        winner: null, lastSolvedBy: null, isBonusQuestion: false,
        questionStartedAt: null, createdAt: Date.now(),
        timeLimitMs: null,          // null = no game time limit
        endsAt: null,                // timestamp when game auto-ends
        questionTimeLimitMs: null,   // null = no per-question time limit
    };
    await saveRoom(room);
    logger.info(`ROOM CREATED: ${room.code} (Admin: ${room.adminCode})`);
    return room;
}

async function joinWithTeamCode(teamCode, teamName) {
    // Check local/disk first
    let foundRoom = null;
    let tid = null;
    for (const r of rooms.values()) {
        if (r.teamACode === teamCode) { foundRoom = r; tid = 'A'; break; }
        if (r.teamBCode === teamCode) { foundRoom = r; tid = 'B'; break; }
    }

    if (!foundRoom) {
        let entry = await redisClient.get(`code:${teamCode}`);
        if (entry) {
            entry = JSON.parse(entry);
            foundRoom = await loadRoom(entry.roomCode);
            tid = entry.teamId;
        }
    }

    if (!foundRoom) return { error: 'Invalid team code' };
    // Allow rejoining if already playing (reconnect scenario)
    if (foundRoom.phase === 'ended') return { error: 'Game is already over' };
    // Always set team name on first join; also set it on late joins (e.g. tournament
    // started before the team joined — their name would still be null)
    if (teamName && !foundRoom.teams[tid].name) {
        foundRoom.teams[tid].name = teamName;
    }
    await saveRoom(foundRoom);
    return { room: foundRoom, teamId: tid };
}

async function adminStartGame(adminCode) {
    let room = null;
    const roomCode = await redisClient.get(`admin:${adminCode}`);
    if (roomCode) room = await loadRoom(roomCode);

    if (!room) {
        for (const r of rooms.values()) { if (r.adminCode === adminCode) { room = r; break; } }
    }

    if (!room) return { error: 'Room not found' };
    if (!room.teams.A.name || !room.teams.B.name) return { error: 'Both teams must join before starting' };
    if (room.phase !== 'waiting') return { error: 'Game already started' };
    room.phase = 'playing';
    room.questionStartedAt = Date.now();
    await saveRoom(room);
    return { room };
}

/**
 * forceStartRoom — used by tournament bulk-start.
 * @param {string} roomCode
 * @param {string[]} [questionIds]        - ordered list of problem IDs for this room
 * @param {number}  [timeLimitMs]          - optional total game time limit in ms
 * @param {number}  [questionTimeLimitMs]  - optional per-question time limit in ms
 */
async function forceStartRoom(roomCode, questionIds, timeLimitMs, questionTimeLimitMs) {
    const room = await loadRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase !== 'waiting') return { skipped: true, reason: room.phase };
    room.phase = 'playing';
    room.questionStartedAt = Date.now();
    if (Array.isArray(questionIds) && questionIds.length > 0) {
        room.questionIds = questionIds;
        room.questionCount = questionIds.length;
    }
    if (timeLimitMs && timeLimitMs > 0) {
        room.timeLimitMs = timeLimitMs;
        room.endsAt = Date.now() + timeLimitMs;
        scheduleRoomTimer(roomCode, room.endsAt);
    }
    if (questionTimeLimitMs && questionTimeLimitMs > 0) {
        room.questionTimeLimitMs = questionTimeLimitMs;
        scheduleQuestionTimer(roomCode, 0, questionTimeLimitMs);
    }
    await saveRoom(room);
    return { room };
}

/**
 * extendTime — add extra milliseconds to a running room's timer.
 * @param {string} roomCode
 * @param {number} extraMs
 */
/**
 * setQuestionTimeLimit — set a per-question time limit on a live room.
 * Schedules a timer for the current question immediately.
 */
async function setQuestionTimeLimit(roomCode, questionTimeLimitMs) {
    const room = await loadRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase === 'ended') return { error: 'Game already ended' };
    room.questionTimeLimitMs = questionTimeLimitMs;
    // If currently in playing phase, start the timer now for remaining time
    if (room.phase === 'playing' && room.questionStartedAt) {
        const elapsed = Date.now() - room.questionStartedAt;
        const remaining = questionTimeLimitMs - elapsed;
        if (remaining > 0) {
            scheduleQuestionTimer(roomCode, room.currentQuestionIdx, remaining);
        }
    }
    await saveRoom(room);
    logger.info(`Room ${roomCode}: question time limit set to ${questionTimeLimitMs}ms`);
    return { ok: true, questionTimeLimitMs };
}

async function extendTime(roomCode, extraMs) {
    const room = await loadRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase === 'ended') return { error: 'Game already ended' };
    if (!room.endsAt) return { error: 'Room has no time limit set' };
    room.endsAt = room.endsAt + extraMs;
    scheduleRoomTimer(roomCode, room.endsAt);
    await saveRoom(room);
    logger.info(`Room ${roomCode}: time extended +${extraMs}ms → endsAt ${room.endsAt}`);
    return { ok: true, endsAt: room.endsAt };
}

/**
 * setTimeLimit — set (or reset) a time limit on any live room.
 * @param {string} roomCode
 * @param {number} timeLimitMs
 */
async function setTimeLimit(roomCode, timeLimitMs) {
    const room = await loadRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase === 'ended') return { error: 'Game already ended' };
    room.timeLimitMs = timeLimitMs;
    room.endsAt = Date.now() + timeLimitMs;
    scheduleRoomTimer(roomCode, room.endsAt);
    await saveRoom(room);
    logger.info(`Room ${roomCode}: time limit set to ${timeLimitMs}ms → endsAt ${room.endsAt}`);
    return { ok: true, endsAt: room.endsAt };
}

async function addSocket(roomCode, teamId, socketId) {
    const room = await loadRoom(roomCode);
    if (room) {
        if (!room.teams[teamId].socketIds.includes(socketId)) {
            room.teams[teamId].socketIds.push(socketId);
            await saveRoom(room);
        }
    }
}

async function removeSocket(socketId) {
    for (const room of rooms.values()) {
        let changed = false;
        for (const tid of ['A', 'B']) {
            const arr = room.teams[tid].socketIds;
            const i = arr.indexOf(socketId);
            if (i !== -1) { arr.splice(i, 1); changed = true; }
        }
        if (changed) await saveRoom(room);
    }
}

async function getRoomByAdminCode(adminCode) {
    for (const r of rooms.values()) { if (r.adminCode === adminCode) return r; }
    const code = await redisClient.get(`admin:${adminCode}`);
    return code ? await loadRoom(code) : null;
}

async function getRoom(roomCode) { return await loadRoom(roomCode); }

function calcScore() { return null; } // stub — scoring removed

async function questionSolved(roomCode, teamId, questionIdx) {
    const room = await loadRoom(roomCode);
    if (!room || room.phase === 'ended') return { ok: false, error: 'Room not found or game over' };
    if (questionIdx !== room.currentQuestionIdx) return { ok: false, error: 'Wrong question index' };
    if (room.teams[teamId].solved.includes(questionIdx)) return { ok: false, error: 'Already solved' };

    // Cancel the per-question timer since someone solved it
    if (questionTimers.has(roomCode)) {
        clearTimeout(questionTimers.get(roomCode));
        questionTimers.delete(roomCode);
    }

    room.teams[teamId].solved.push(questionIdx);
    room.lastSolvedBy = teamId;

    // Knife phase (Q0-Q2): grid pick (no knife unlock — teams already have 3 from start)
    if (questionIdx < 3) {
        room.phase = 'grid_pick';
        room.teams[teamId].pendingGridPicks = 1;
        room.isBonusQuestion = false;
        await saveRoom(room);
        return { ok: true, event: 'question_solved', room, data: { teamId } };
    }

    room.phase = 'grid_pick';
    room.teams[teamId].pendingGridPicks = (questionIdx === room.questionCount - 1) ? 2 : 1;
    room.isBonusQuestion = (questionIdx === room.questionCount - 1);
    await saveRoom(room);
    return { ok: true, event: room.isBonusQuestion ? 'bonus_solved' : 'question_solved', room, data: { teamId } };
}

async function placeOnGrid(roomCode, teamId, cellIdx) {
    const room = await loadRoom(roomCode);
    if (!room || room.phase !== 'grid_pick' || room.lastSolvedBy !== teamId || room.grid[cellIdx] !== null) return { ok: false, error: 'Invalid pick' };

    room.grid[cellIdx] = teamId;
    room.teams[teamId].pendingGridPicks--;

    const win = checkWin(room.grid);
    if (win) {
        room.winner = win; room.phase = 'ended';
        await saveRoom(room);
        return { ok: true, event: 'game_over', room, data: { winner: win, reason: 'tic_tac_toe' } };
    }

    if (room.teams[teamId].pendingGridPicks <= 0) {
        if (room.currentQuestionIdx >= room.questionCount - 1) {
            const end = _endGame(room);
            await saveRoom(room);
            return end;
        }
        room.currentQuestionIdx++;
        room.questionStartedAt = Date.now();
        room.phase = 'playing';
        // Restart per-question timer for the new question
        if (room.questionTimeLimitMs) {
            scheduleQuestionTimer(roomCode, room.currentQuestionIdx, room.questionTimeLimitMs);
        }
    }
    await saveRoom(room);
    return { ok: true, event: 'grid_updated', room };
}

function _endGame(room) {
    const aGrid = room.grid.filter(c => c === 'A').length;
    const bGrid = room.grid.filter(c => c === 'B').length;
    // Winner decided purely by grid cell count; equal = draw
    const winner = aGrid > bGrid ? 'A' : bGrid > aGrid ? 'B' : 'tie';
    room.winner = winner; room.phase = 'ended';
    return { ok: true, event: 'game_over', room, data: { winner, reason: 'grid_cells', aGrid, bGrid } };
}

async function useKnife(roomCode, teamId, targetCellIdx) {
    const room = await loadRoom(roomCode);
    if (!room) return { ok: false, error: 'Room not found' };
    // Knives restricted to battle phase only (Q4-Q6, idx >= 3)
    if (room.currentQuestionIdx < 3) return { ok: false, error: 'Knives can only be used in the Battle Phase (Q4-Q6)' };
    const team = room.teams[teamId];
    const opponentId = teamId === 'A' ? 'B' : 'A';
    if (team.knivesUnlocked - team.knivesUsed <= 0) return { ok: false, error: 'No knives left' };

    // Always consume knife regardless of outcome
    team.knivesUsed++;

    const cellOwner = room.grid[targetCellIdx];
    const isHit = cellOwner === opponentId;
    if (isHit) {
        // Remove opponent's cell
        room.grid[targetCellIdx] = null;
    }
    // Empty or own cell → knife is wasted (consumed but no effect)

    await saveRoom(room);
    return { ok: true, event: 'knife_used', room, data: { teamId, targetCellIdx, wasted: !isHit } };
}

function checkWin(grid) {
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    for (const [a, b, c] of lines) if (grid[a] && grid[a] === grid[b] && grid[a] === grid[c]) return grid[a];
    return null;
}

function sanitizeRoom(room) {
    const pick = (t) => ({
        name: t.name, knivesUnlocked: t.knivesUnlocked, knivesUsed: t.knivesUsed,
        solved: t.solved, pendingGridPicks: t.pendingGridPicks,
    });
    return {
        code: room.code, phase: room.phase, grid: room.grid,
        currentQuestionIdx: room.currentQuestionIdx, questionCount: room.questionCount,
        winner: room.winner, lastSolvedBy: room.lastSolvedBy,
        isBonusQuestion: room.isBonusQuestion, questionStartedAt: room.questionStartedAt,
        timeLimitMs: room.timeLimitMs || null,
        endsAt: room.endsAt || null,
        questionTimeLimitMs: room.questionTimeLimitMs || null,
        teams: { A: pick(room.teams.A), B: pick(room.teams.B) },
    };
}

module.exports = {
    createRoom, joinWithTeamCode, adminStartGame, forceStartRoom,
    extendTime, setTimeLimit, setQuestionTimeLimit, setBroadcastFn,
    addSocket, removeSocket,
    questionSolved, placeOnGrid, useKnife, getRoom, getRoomByAdminCode, sanitizeRoom,
};
