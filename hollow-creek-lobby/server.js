// Hollow Creek - multiplayer lobby + game server
// ------------------------------------------------
// Lobby (create/join/leave/roster) plus a server-authoritative game, driven by
// the pure-logic engine in game.js. Clients never see full state - only their
// own redacted view (see game.js's getPlayerView).

const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const G = require('./game.js');

const PORT = process.env.PORT || 8080;

// Phase durations. Server owns these - clients render a countdown from
// phaseEndsAt, they never run their own independent clock.
const NIGHT_DURATION_MS = 60000;
const DAY_DISCUSS_DURATION_MS = 90000;
const DAY_VOTE_DURATION_MS = 45000;
const DAY_REVEAL_DURATION_MS = 12000;
const FARMER_REVENGE_DURATION_MS = 20000;

const TOGGLEABLE_ROLES = G.SPECIAL_ROLES.filter(r => r !== 'Mafia');

// ---- tiny static file server for the client page ----
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const MIME_TYPES = { '.js': 'application/javascript', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.css': 'text/css' };
    const type = MIME_TYPES[ext] || 'text/html';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// In-memory room store. Resets if the server restarts - that's a deliberate,
// documented decision for now (real persistence is a later step).
// Shape: { players: [{id, name, socket}], hostId, started, state, timer, phaseEndsAt,
//          nightSubmitted: Set, dayVoteSubmitted: Set }
const rooms = {};

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms[code]);
  return code;
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

function sanitizeName(raw) {
  return String(raw || '').trim().slice(0, 20) || 'Player';
}

function sanitizeRolesConfig(raw) {
  const roles = Object.assign({}, G.DEFAULT_ROLES_CONFIG);
  if (raw && typeof raw === 'object') {
    TOGGLEABLE_ROLES.forEach(r => {
      if (typeof raw[r] === 'boolean') roles[r] = raw[r];
    });
  }
  return roles;
}

function createRoom(socket, name, isPublic) {
  const code = makeRoomCode();
  const id = makePlayerId();
  rooms[code] = { players: [{ id, name, socket }], hostId: id, started: false, state: null, timer: null, phaseEndsAt: null, isPublic: !!isPublic };
  socket.roomCode = code;
  socket.playerId = id;
  socket.send(JSON.stringify({ type: 'created', roomCode: code, playerId: id }));
  broadcastRoster(code);
  return code;
}

function joinRoom(socket, code, name) {
  const room = rooms[code];
  const id = makePlayerId();
  room.players.push({ id, name, socket });
  socket.roomCode = code;
  socket.playerId = id;
  socket.send(JSON.stringify({ type: 'joined', roomCode: code, playerId: id }));
  broadcastRoster(code);
}

function broadcastRoster(code) {
  const room = rooms[code];
  if (!room) return;
  const roster = room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId }));
  const msg = JSON.stringify({ type: 'roster', roomCode: code, players: roster, started: room.started, isPublic: !!room.isPublic });
  room.players.forEach(p => {
    if (p.socket.readyState === WebSocket.OPEN) p.socket.send(msg);
  });
}

function removePlayer(socket) {
  const code = socket.roomCode;
  const room = code ? rooms[code] : null;
  if (!room) return;
  const idx = room.players.findIndex(p => p.socket === socket);
  if (idx === -1) return;
  const wasHost = room.players[idx].id === room.hostId;
  const playerId = room.players[idx].id;
  room.players.splice(idx, 1);

  // A disconnected human keeps their seat in the game (no reconnect support
  // yet - that's a separate follow-up) but must stop blocking resolution:
  // treat them like a placeholder for early-resolution checks and fallback actions.
  if (room.started && room.state) {
    const sp = G.byId(room.state, playerId);
    if (sp) sp.connected = false;
  }

  if (room.players.length === 0) {
    clearPhaseTimer(room);
    delete rooms[code];
    console.log(`Room ${code} closed (empty)`);
    return;
  }
  if (wasHost) room.hostId = room.players[0].id;
  if (!room.started) broadcastRoster(code);
  else maybeEarlyResolve(room);
}

function getRoomAndPlayer(socket) {
  const code = socket.roomCode;
  const room = code ? rooms[code] : null;
  if (!room) return { room: null, player: null };
  const player = room.players.find(p => p.id === socket.playerId);
  return { room, player };
}

// ---- game phase machine ----

function clearPhaseTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

function sendGameState(room) {
  room.players.forEach(rp => {
    if (rp.socket.readyState !== WebSocket.OPEN) return;
    const view = G.getPlayerView(room.state, rp.id);
    rp.socket.send(JSON.stringify({ type: 'gameState', view, phaseEndsAt: room.phaseEndsAt }));
  });
}

// Humans who still have a live, open socket - a disconnected human's seat
// stays in the game (see removePlayer) but no longer counts toward "has
// everyone submitted yet", so the rest of the table isn't stuck waiting on them.
function connectedLivingHumans(room) {
  return room.state.players.filter(p => p.alive && p.isHuman && p.connected !== false);
}

// Called after any submission or disconnect that might complete the current
// phase's set of expected actions, so the round resolves the moment everyone
// who's still here has acted instead of always waiting out the full timer.
function maybeEarlyResolve(room) {
  if (!room.started || !room.state) return;
  if (room.state.phase === 'night') {
    if (connectedLivingHumans(room).every(p => room.nightSubmitted.has(p.id))) resolveNightPhase(room);
  } else if (room.state.phase === 'day-vote') {
    const eligible = connectedLivingHumans(room).filter(p => !p.silencedToday);
    if (eligible.every(p => room.dayVoteSubmitted.has(p.id))) resolveDayVotePhase(room);
  }
}

function beginNightPhase(room) {
  room.state.phase = 'night';
  room.nightSubmitted = new Set();
  room.phaseEndsAt = Date.now() + NIGHT_DURATION_MS;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => resolveNightPhase(room), NIGHT_DURATION_MS);
  sendGameState(room);
}

function resolveNightPhase(room) {
  clearPhaseTimer(room);
  const result = G.resolveNight(room.state);
  sendGameState(room);
  if (result.gameOver) { endGame(room); return; }
  beginDayDiscussPhase(room);
}

function beginDayDiscussPhase(room) {
  room.state.phase = 'day-discuss';
  room.phaseEndsAt = Date.now() + DAY_DISCUSS_DURATION_MS;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => beginDayVotePhase(room), DAY_DISCUSS_DURATION_MS);
  sendGameState(room);
}

function beginDayVotePhase(room) {
  room.state.phase = 'day-vote';
  room.dayVoteSubmitted = new Set();
  room.phaseEndsAt = Date.now() + DAY_VOTE_DURATION_MS;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => resolveDayVotePhase(room), DAY_VOTE_DURATION_MS);
  sendGameState(room);
}

function resolveDayVotePhase(room) {
  clearPhaseTimer(room);
  const result = G.resolveDayVote(room.state);
  sendGameState(room);
  if (result.gameOver) { endGame(room); return; }
  if (result.farmerRevengePending) { beginFarmerRevengeWait(room); return; }
  beginDayRevealPhase(room);
}

function beginFarmerRevengeWait(room) {
  room.state.phase = 'farmer-revenge';
  room.phaseEndsAt = Date.now() + FARMER_REVENGE_DURATION_MS;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => {
    const farmerId = room.state.farmerRevengePending;
    const gameOver = G.resolveFarmerRevenge(room.state, farmerId, null);
    sendGameState(room);
    if (gameOver) { endGame(room); return; }
    beginDayRevealPhase(room);
  }, FARMER_REVENGE_DURATION_MS);
  sendGameState(room);
}

function beginDayRevealPhase(room) {
  room.state.phase = 'day-reveal';
  room.phaseEndsAt = Date.now() + DAY_REVEAL_DURATION_MS;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => {
    G.startNextNight(room.state);
    beginNightPhase(room);
  }, DAY_REVEAL_DURATION_MS);
  sendGameState(room);
}

function endGame(room) {
  clearPhaseTimer(room);
  room.phaseEndsAt = null;
  sendGameState(room);
}

function sanitizeNightAction(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  ['kill', 'investigate', 'protect', 'hideBehind', 'bounty', 'silence'].forEach(k => {
    if (typeof a[k] === 'string') out[k] = a[k];
  });
  return out;
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'create') {
      const name = sanitizeName(msg.name);
      const code = createRoom(socket, name, msg.isPublic);
      console.log(`Room ${code} created by ${name}${msg.isPublic ? ' (public)' : ''}`);
    }

    else if (msg.type === 'join') {
      const code = (msg.roomCode || '').toUpperCase();
      const room = rooms[code];
      if (!room) {
        socket.send(JSON.stringify({ type: 'error', message: 'No room with that code.' }));
        return;
      }
      if (room.started) {
        socket.send(JSON.stringify({ type: 'error', message: 'That game has already started.' }));
        return;
      }
      if (room.players.length >= G.MAX_PLAYERS) {
        socket.send(JSON.stringify({ type: 'error', message: 'That room is full.' }));
        return;
      }
      const name = sanitizeName(msg.name);
      joinRoom(socket, code, name);
      console.log(`${name} joined room ${code}`);
    }

    else if (msg.type === 'quick_match') {
      const name = sanitizeName(msg.name);
      const openCode = Object.keys(rooms).find(c => rooms[c].isPublic && !rooms[c].started && rooms[c].players.length < G.MAX_PLAYERS);
      if (openCode) {
        joinRoom(socket, openCode, name);
        console.log(`${name} quick-matched into room ${openCode}`);
      } else {
        const code = createRoom(socket, name, true);
        console.log(`Room ${code} created via quick-match by ${name}`);
      }
    }

    else if (msg.type === 'leave') {
      removePlayer(socket);
    }

    else if (msg.type === 'kick') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player) return;
      if (player.id !== room.hostId) {
        socket.send(JSON.stringify({ type: 'error', message: 'Only the host can remove a player.' }));
        return;
      }
      const targetId = String(msg.targetId || '');
      if (!targetId || targetId === room.hostId) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      if (target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({ type: 'kicked', message: 'The host removed you from the room.' }));
      }
      removePlayer(target.socket);
      target.socket.close();
      console.log(`${target.name} was kicked from room ${socket.roomCode}`);
    }

    else if (msg.type === 'start') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player) return;
      if (player.id !== room.hostId) {
        socket.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' }));
        return;
      }
      if (room.started) return;

      let playerCount = Number(msg.playerCount);
      if (!Number.isFinite(playerCount)) playerCount = 8;
      playerCount = Math.round(playerCount);

      let mafiaCount = Number(msg.mafiaCount);
      if (!Number.isFinite(mafiaCount)) mafiaCount = 1;
      mafiaCount = Math.max(0, Math.min(G.MAX_MAFIA_COUNT, Math.round(mafiaCount)));

      const roles = sanitizeRolesConfig(msg.roles);
      const seats = room.players.map(p => ({ id: p.id, name: p.name }));
      const config = { playerCount, mafiaCount, roles };

      let state;
      try {
        state = G.createGame(seats, config);
      } catch (e) {
        socket.send(JSON.stringify({ type: 'error', message: e.message }));
        return;
      }

      room.started = true;
      room.state = state;
      console.log(`Room ${socket.roomCode} started with ${seats.length} real player(s), ${room.state.players.length} total seats`);
      beginNightPhase(room);
    }

    else if (msg.type === 'nightAction') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'night') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || !sp.isHuman) return;
      room.state.pendingNightVotes[player.id] = sanitizeNightAction(msg.action);
      room.nightSubmitted.add(player.id);
      maybeEarlyResolve(room);
    }

    else if (msg.type === 'dayChat') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started) return;
      if (room.state.phase !== 'day-discuss' && room.state.phase !== 'day-vote') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || sp.silencedToday) return;
      const text = String(msg.text || '').trim().slice(0, 300);
      if (!text) return;
      const entry = { playerId: player.id, name: sp.name, text, ts: Date.now() };
      room.state.chatLog.push(entry);
      room.players.forEach(rp => {
        if (rp.socket.readyState === WebSocket.OPEN) rp.socket.send(JSON.stringify(Object.assign({ type: 'chatMsg' }, entry)));
      });
    }

    else if (msg.type === 'mafiaChat') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'night') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || sp.align !== 'mafia') return;
      const text = String(msg.text || '').trim().slice(0, 300);
      if (!text) return;
      const entry = { playerId: player.id, name: sp.name, text, ts: Date.now() };
      room.state.mafiaChatLog.push(entry);
      // Scoped strictly to players whose CURRENT align is 'mafia' - never to
      // town-aligned players, and never broadcast wider than the room's own
      // connected sockets (placeholders have no socket to reach anyway).
      room.players.forEach(rp => {
        const rsp = G.byId(room.state, rp.id);
        if (rsp && rsp.align === 'mafia' && rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify(Object.assign({ type: 'mafiaChatMsg' }, entry)));
        }
      });
    }

    else if (msg.type === 'dayVote') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'day-vote') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || !sp.isHuman || sp.silencedToday) return;
      const targetId = msg.targetId ? String(msg.targetId) : null;
      room.state.pendingDayVotes[player.id] = targetId;
      room.dayVoteSubmitted.add(player.id);
      maybeEarlyResolve(room);
    }

    else if (msg.type === 'farmerRevenge') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'farmer-revenge') return;
      if (room.state.farmerRevengePending !== player.id) return;
      clearPhaseTimer(room);
      const targetId = msg.targetId ? String(msg.targetId) : null;
      const gameOver = G.resolveFarmerRevenge(room.state, player.id, targetId);
      sendGameState(room);
      if (gameOver) { endGame(room); } else { beginDayRevealPhase(room); }
    }
  });

  socket.on('close', () => {
    removePlayer(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Hollow Creek server running at http://localhost:${PORT}`);
  console.log(`Open that address in a browser to test - open it in a few tabs to simulate multiple players.`);
});
