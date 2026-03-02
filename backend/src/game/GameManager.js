const { randomBytes } = require('crypto');
const redisClient = require('../cache/redis');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../rooms.json');

// Local cache
const rooms = new Map();

/** Helper: Write cache to disk as fallback (Async) */
async function syncToDisk() {
    try {
        // Only sync if under reasonable limit to prevent memory/disk bloat
        if (rooms.size > 2000) {
            const keys = [...rooms.keys()];
            for (let i = 0; i < 500; i++) rooms.delete(keys[i]); // FIFO cleanup
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
    syncToDisk(); // Non-blocking async call

    try {
        const data = JSON.stringify(room);
        // Fire and forget Redis sync - local/disk is already done
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

const MAX_GRID_BONUS = 2; // placeholder kept for future use

function makeTeamSlot() {
    return {
        name: null, socketIds: [], knivesUnlocked: 3, knivesUsed: 0,
        solved: [], pendingGridPicks: 0,
        code: ""
    };
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
    const isRejoin = foundRoom.phase !== 'waiting';
    if (!isRejoin) {
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
 * Starts the room regardless of whether teams have joined.
 * Rooms that are already started or finished are skipped.
 */
async function forceStartRoom(roomCode) {
    const room = await loadRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase !== 'waiting') return { skipped: true, reason: room.phase };
    room.phase = 'playing';
    room.questionStartedAt = Date.now();
    await saveRoom(room);
    return { room };
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
    }
    await saveRoom(room);
    return { ok: true, event: 'grid_updated', room };
}

function _endGame(room) {
    const a = room.teams.A; const b = room.teams.B;
    const aGrid = room.grid.filter(c => c === 'A').length;
    const bGrid = room.grid.filter(c => c === 'B').length;
    let winner;
    if (a.solved.length !== b.solved.length) winner = a.solved.length > b.solved.length ? 'A' : 'B';
    else if (aGrid !== bGrid) winner = aGrid > bGrid ? 'A' : 'B';
    else winner = 'tie';
    room.winner = winner; room.phase = 'ended';
    return { ok: true, event: 'game_over', room, data: { winner, reason: 'solved_count', aSolved: a.solved.length, bSolved: b.solved.length } };
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
        teams: { A: pick(room.teams.A), B: pick(room.teams.B) },
    };
}

module.exports = {
    createRoom, joinWithTeamCode, adminStartGame, forceStartRoom, addSocket, removeSocket,
    questionSolved, placeOnGrid, useKnife, getRoom, getRoomByAdminCode, sanitizeRoom,
};
