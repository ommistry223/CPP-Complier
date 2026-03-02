const express = require('express');
const router = express.Router();
const { randomBytes } = require('crypto');
const GameManager = require('../../game/GameManager');
const redisClient = require('../../cache/redis');
const logger = require('../../utils/logger');
const { broadcastToRoom } = require('../../utils/broadcaster');

const rand = (n) => randomBytes(n).toString('hex').toUpperCase();

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/bulk-create
   Body: { pairs: number (1-50), questionCount: number }
   Creates N rooms at once and stores tournament data in Redis.
═══════════════════════════════════════════════════════════ */
router.post('/bulk-create', async (req, res) => {
    const { pairs = 1, questionCount = 17, name = 'Tournament' } = req.body;

    if (pairs < 1 || pairs > 50) {
        return res.status(400).json({ error: 'pairs must be between 1 and 50' });
    }

    try {
        const tournamentId = 'T-' + rand(3);
        const results = [];

        // Create all rooms in parallel
        const roomPromises = Array.from({ length: pairs }, (_, i) =>
            GameManager.createRoom(questionCount).then(room => ({
                pairNo: i + 1,
                roomCode: room.code,
                teamACode: room.teamACode,
                teamBCode: room.teamBCode,
            }))
        );

        const pairs_data = await Promise.all(roomPromises);
        results.push(...pairs_data);

        // Store tournament in Redis (24h TTL)
        const tournamentData = {
            id: tournamentId,
            name,
            questionCount,
            createdAt: Date.now(),
            rooms: pairs_data.map(p => p.roomCode),
            pairs: pairs_data,
        };
        await redisClient.set(
            `tournament:${tournamentId}`,
            JSON.stringify(tournamentData),
            'EX',
            86400
        );

        logger.info(`Tournament ${tournamentId} created with ${pairs} rooms`);

        res.json({
            status: 'ok',
            tournamentId,
            name,
            totalPairs: pairs,
            pairs: results,
            leaderboardUrl: `/leaderboard/${tournamentId}`,
        });
    } catch (err) {
        logger.error('Tournament bulk-create error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/:id/notify-countdown
   Body: { seconds?: number }
   Broadcasts a game_countdown event to all connected clients
   in all rooms of this tournament. The frontend then shows
   a visual countdown. Admin calls /start after the timer ends.
═══════════════════════════════════════════════════════════ */
router.post('/:id/notify-countdown', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });

        const tournament = JSON.parse(data);
        const seconds = Math.min(Math.max(parseInt(req.body.seconds) || 30, 5), 60);
        const endsAt = Date.now() + seconds * 1000;

        // Broadcast countdown to every room in parallel
        await Promise.all(
            tournament.rooms.map(roomCode =>
                broadcastToRoom(roomCode, {
                    type: 'game_countdown',
                    endsAt,
                    seconds,
                    tournamentName: tournament.name,
                })
            )
        );

        logger.info(`Tournament ${req.params.id}: countdown broadcast (${seconds}s)`);
        res.json({ status: 'ok', endsAt, seconds });
    } catch (err) {
        logger.error('Tournament notify-countdown error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/:id/start
   Starts ALL rooms in the tournament simultaneously.
   Rooms where only one (or no) team has joined are force-started;
   teams that join later will enter a running game.
   Returns: { started: [...roomCodes], skipped: [...roomCodes] }
═══════════════════════════════════════════════════════════ */
router.post('/:id/start', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });

        const tournament = JSON.parse(data);
        const started = [];
        const skipped = [];
        const errors  = [];

        // Start all rooms in parallel
        await Promise.all(
            tournament.rooms.map(async (roomCode) => {
                const result = await GameManager.forceStartRoom(roomCode);
                if (result.error) {
                    errors.push({ roomCode, reason: result.error });
                } else if (result.skipped) {
                    skipped.push({ roomCode, reason: result.reason });
                } else {
                    started.push(roomCode);
                    // Broadcast game_started to any clients already in the room
                    await broadcastToRoom(roomCode, {
                        type: 'game_started',
                        room: GameManager.sanitizeRoom(result.room),
                    });
                }
            })
        );

        logger.info(`Tournament ${req.params.id}: started=${started.length}, skipped=${skipped.length}`);

        res.json({
            status: 'ok',
            tournamentId: req.params.id,
            totalRooms: tournament.rooms.length,
            started: started.length,
            skipped: skipped.length,
            errors:  errors.length,
            details: { started, skipped, errors },
        });
    } catch (err) {
        logger.error('Tournament start error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   GET /api/tournament/:id/leaderboard
   Returns all teams from all rooms in this tournament,
   sorted by score descending.
═══════════════════════════════════════════════════════════ */
router.get('/:id/leaderboard', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });

        const tournament = JSON.parse(data);

        // Fetch all room states in parallel
        const roomStates = await Promise.all(
            tournament.rooms.map(code => GameManager.getRoom(code))
        );

        const leaderboard = [];
        roomStates.forEach((room, idx) => {
            if (!room) return;
            const pairNo = idx + 1;
            ['A', 'B'].forEach(tid => {
                const team = room.teams[tid];
                leaderboard.push({
                    rank: 0,
                    pairNo,
                    teamId: tid,
                    teamName: team.name || `Pair ${pairNo} - Team ${tid}`,
                    solved: team.solved?.length || 0,
                    roomCode: room.code,
                    phase: room.phase,
                    isWinner: room.winner === tid,
                });
            });
        });

        // Sort by score DESC, then solved DESC
        leaderboard.sort((a, b) => b.solved - a.solved);
        leaderboard.forEach((e, i) => { e.rank = i + 1; });

        res.json({
            status: 'ok',
            tournament: {
                id: tournament.id,
                name: tournament.name,
                totalPairs: tournament.rooms.length,
                createdAt: tournament.createdAt,
            },
            leaderboard,
        });
    } catch (err) {
        logger.error('Leaderboard fetch error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════
   GET /api/tournament/:id  — tournament metadata
═══════════════ */
router.get('/:id', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });
        const tournament = JSON.parse(data);
        res.json({ status: 'ok', tournament });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
