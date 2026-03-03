const express = require('express');
const router = express.Router();
const GameManager = require('../../game/GameManager');
const db = require('../../db');

// Create a room (REST fallback / pre-flight)
router.post('/create', (req, res) => {
    const { teamName } = req.body;
    if (!teamName) return res.status(400).json({ error: 'teamName required' });
    const room = GameManager.createRoom(teamName);
    res.json({ code: room.code });
});

// Get room-specific questions (returns only the questions assigned to this room/tournament)
router.get('/:code/questions', async (req, res) => {
    try {
        const room = await GameManager.getRoom(req.params.code.toUpperCase());
        if (!room) return res.status(404).json({ error: 'Room not found' });

        if (Array.isArray(room.questionIds) && room.questionIds.length > 0) {
            // Fetch questions by IDs and preserve assignment order
            const result = await db.query(
                `SELECT id, title, difficulty, problem_set, time_limit, memory_limit, description, input_format, output_format, constraints, examples
                 FROM problems WHERE id = ANY($1) AND published = true`,
                [room.questionIds]
            );
            // Sort by the order of questionIds on the room
            const map = {};
            for (const row of result.rows) map[row.id] = row;
            const ordered = room.questionIds.map(id => map[id]).filter(Boolean);
            return res.json({ problems: ordered });
        }

        // Fallback: return all published problems (non-tournament rooms)
        const result = await db.query(
            `SELECT id, title, difficulty, problem_set, time_limit, memory_limit, description, input_format, output_format, constraints, examples
             FROM problems WHERE published = true ORDER BY created_at`
        );
        res.json({ problems: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get room state
router.get('/:code', async (req, res) => {
    const room = await GameManager.getRoom(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: GameManager.sanitizeRoom(room) });
});

module.exports = router;
