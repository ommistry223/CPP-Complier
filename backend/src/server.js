require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const http = require('http');
const { WebSocketServer } = require('ws');
const logger = require('./utils/logger');
const { pool } = require('./db');
const redisClient = require('./cache/redis');
const GameManager = require('./game/GameManager');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));

// ── Rate limiting ─────────────────────────────────────────
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 600,
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: 'rl:',
    }),
    keyGenerator: (req) =>
        req.headers['x-real-ip'] ||
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.ip,
    skip: (req) => req.path === '/health',
    message: { status: 'error', message: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Health Check ──────────────────────────────────────────
app.get('/health', async (req, res) => {
    const health = { status: 'ok', api: 'up', db: 'unknown', redis: 'unknown', pid: process.pid, uptime: Math.floor(process.uptime()) };
    let degraded = false;
    try {
        await Promise.race([pool.query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 2000))]);
        health.db = 'up';
    } catch (err) { health.db = 'down'; health.dbError = err.message; degraded = true; }
    try {
        const pong = await Promise.race([redisClient.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 2000))]);
        health.redis = pong === 'PONG' ? 'up' : 'degraded';
    } catch (err) { health.redis = 'down'; health.redisError = err.message; degraded = true; }
    if (degraded) {
        health.status = 'degraded';
        const totalOutage = health.db === 'down' && health.redis === 'down';
        return res.status(totalOutage ? 503 : 200).json(health);
    }
    res.status(200).json(health);
});

// ── API Routes ────────────────────────────────────────────

const { ensureHintsTable } = require('./db');
ensureHintsTable().catch(err => logger.warn('ensureHintsTable:', err.message));

app.use('/api/compiler', require('./api/routes/compiler'));
app.use('/api/problems', require('./api/routes/problems'));
app.use('/api/game', require('./api/routes/game'));
app.use('/api/tournament', require('./api/routes/tournament'));
app.use('/api/admin', require('./api/routes/admin'));

// ── 404 / Error handlers ──────────────────────────────────
app.use((req, res) => res.status(404).json({ status: 'error', message: 'Route not found' }));
app.use((err, req, res, next) => { logger.error(err.stack); res.status(500).json({ status: 'error', message: 'Something went wrong!' }); });

// ── WebSocket ─────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map();   // clientId → ws
const adminWatchers = new Map();  // roomCode → Set<clientId>
require('./utils/broadcaster').init(clients); // allow HTTP routes to broadcast
let clientIdCounter = 0;

wss.on('connection', (ws) => {
    const clientId = `c${++clientIdCounter}`;
    clients.set(clientId, ws);
    ws._clientId = clientId;
    ws._roomCode = null;
    ws._teamId = null;   // 'A' | 'B' | 'admin'
    ws._adminCode = null;

    logger.info(`WS connected: ${clientId}`);

    const send = (data) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
    };

    const broadcastRoom = async (roomCode, data) => {
        const room = await GameManager.getRoom(roomCode);
        if (!room) return;
        for (const sid of [...room.teams.A.socketIds, ...room.teams.B.socketIds]) {
            const c = clients.get(sid);
            if (c && c.readyState === c.OPEN) c.send(JSON.stringify(data));
        }
    };

    const broadcastAll = async (roomCode, data) => {
        await broadcastRoom(roomCode, data);
        for (const sid of (adminWatchers.get(roomCode) || new Set())) {
            const c = clients.get(sid);
            if (c && c.readyState === c.OPEN) c.send(JSON.stringify(data));
        }
    };

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const { type, payload = {} } = msg;

        switch (type) {

            /* ── ADMIN ──────────────────────── */
            case 'admin_create_room': {
                const room = await GameManager.createRoom(payload.questionCount || 17);
                ws._teamId = 'admin';
                ws._adminCode = room.adminCode;
                ws._roomCode = room.code;
                if (!adminWatchers.has(room.code)) adminWatchers.set(room.code, new Set());
                adminWatchers.get(room.code).add(clientId);
                send({
                    type: 'admin_room_created',
                    roomCode: room.code, adminCode: room.adminCode,
                    teamACode: room.teamACode, teamBCode: room.teamBCode,
                    room: GameManager.sanitizeRoom(room),
                });
                break;
            }

            case 'admin_watch': {
                const room = await GameManager.getRoomByAdminCode(payload.adminCode);
                if (!room) { send({ type: 'error', message: 'Invalid admin code' }); break; }
                ws._teamId = 'admin';
                ws._adminCode = payload.adminCode;
                ws._roomCode = room.code;
                if (!adminWatchers.has(room.code)) adminWatchers.set(room.code, new Set());
                adminWatchers.get(room.code).add(clientId);
                send({
                    type: 'admin_room_state',
                    room: GameManager.sanitizeRoom(room),
                    codes: {
                        roomCode: room.code,
                        adminCode: room.adminCode,
                        teamACode: room.teamACode,
                        teamBCode: room.teamBCode,
                    }
                });
                break;
            }

            case 'admin_start_game': {
                const code = payload.adminCode || ws._adminCode;
                const result = await GameManager.adminStartGame(code);
                if (result.error) { send({ type: 'error', message: result.error }); break; }
                await broadcastAll(result.room.code, { type: 'game_started', room: GameManager.sanitizeRoom(result.room) });
                break;
            }

            /* ── TEAM JOIN ──────────────────── */
            case 'join_with_team_code': {
                const result = await GameManager.joinWithTeamCode(payload.teamCode, payload.teamName);
                if (result.error) { send({ type: 'error', message: result.error }); break; }
                ws._roomCode = result.room.code;
                ws._teamId = result.teamId;
                await GameManager.addSocket(result.room.code, result.teamId, clientId);
                send({ type: 'joined', teamId: result.teamId, room: GameManager.sanitizeRoom(result.room) });
                await broadcastAll(result.room.code, { type: 'room_updated', room: GameManager.sanitizeRoom(result.room) });
                break;
            }

            /* ── GAME EVENTS ────────────────── */
            case 'question_solved': {
                const result = await GameManager.questionSolved(ws._roomCode, ws._teamId, payload.questionIdx);
                if (!result.ok) { send({ type: 'error', message: result.error }); break; }
                await broadcastAll(ws._roomCode, { type: result.event, room: GameManager.sanitizeRoom(result.room), data: result.data });
                break;
            }
            case 'place_on_grid': {
                const result = await GameManager.placeOnGrid(ws._roomCode, ws._teamId, payload.cellIdx);
                if (!result.ok) { send({ type: 'error', message: result.error }); break; }
                await broadcastAll(ws._roomCode, { type: result.event, room: GameManager.sanitizeRoom(result.room), data: result.data });
                break;
            }
            case 'use_knife': {
                const result = await GameManager.useKnife(ws._roomCode, ws._teamId, payload.targetCellIdx);
                if (!result.ok) { send({ type: 'error', message: result.error }); break; }
                await broadcastAll(ws._roomCode, { type: result.event, room: GameManager.sanitizeRoom(result.room), data: result.data });
                break;
            }

            case 'player_typing': {
                if (!ws._roomCode || !ws._teamId) break;
                await broadcastAll(ws._roomCode, { type: 'team_typing', teamId: ws._teamId, isTyping: payload.isTyping });
                break;
            }

            case 'player_react': {
                if (!ws._roomCode || !ws._teamId) break;
                await broadcastAll(ws._roomCode, { type: 'team_reacted', teamId: ws._teamId, emoji: payload.emoji });
                break;
            }

            case 'ping': send({ type: 'pong' }); break;
            default: send({ type: 'error', message: `Unknown event: ${type}` });
        }
    });

    ws.on('close', async () => {
        await GameManager.removeSocket(clientId);
        if (ws._roomCode && adminWatchers.has(ws._roomCode)) adminWatchers.get(ws._roomCode).delete(clientId);
        clients.delete(clientId);
        logger.info(`WS disconnected: ${clientId}`);
    });

    ws.on('error', (err) => logger.error('WS error:', err.message));
    send({ type: 'connected', clientId });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    logger.info(`API + WebSocket Server running on port ${PORT} (PID ${process.pid})`);
});
