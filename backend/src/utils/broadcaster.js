/**
 * broadcaster.js
 * Shared broadcast utility so HTTP routes can push WebSocket messages
 * to connected game room clients.
 *
 * Usage:
 *   server.js:          require('./utils/broadcaster').init(clients);
 *   any route/module:   const { broadcastToRoom } = require('../utils/broadcaster');
 */

let _clients = null;

/** Called once by server.js after the 'clients' Map is created */
function init(clientsMap) {
    _clients = clientsMap;
}

/**
 * Broadcast a JSON message to every WebSocket client currently in a room
 * (both teams A and B).
 * @param {string} roomCode
 * @param {object} data
 */
async function broadcastToRoom(roomCode, data) {
    if (!_clients) return;
    const GameManager = require('../game/GameManager');
    const room = await GameManager.getRoom(roomCode);
    if (!room) return;
    const payload = JSON.stringify(data);
    const sids = [...(room.teams.A.socketIds || []), ...(room.teams.B.socketIds || [])];
    for (const sid of sids) {
        const c = _clients.get(sid);
        if (c && c.readyState === 1 /* OPEN */) {
            c.send(payload);
        }
    }
}

module.exports = { init, broadcastToRoom };
