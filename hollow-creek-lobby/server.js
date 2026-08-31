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
const Scoring = require('./scoring.js');

const PORT = process.env.PORT || 8080;

// Phase durations. Server owns these - clients render a countdown from
// phaseEndsAt, they never run their own independent clock.
const NIGHT_DURATION_MS = Number(process.env.NIGHT_DURATION_MS) || 60000;
const DAY_DISCUSS_DURATION_MS = Number(process.env.DAY_DISCUSS_DURATION_MS) || 90000;
const DAY_VOTE_DURATION_MS = Number(process.env.DAY_VOTE_DURATION_MS) || 105000; // was 45s - extended by an extra minute of actual voting time
const DAY_REVEAL_DURATION_MS = Number(process.env.DAY_REVEAL_DURATION_MS) || 12000;
const FARMER_REVENGE_DURATION_MS = Number(process.env.FARMER_REVENGE_DURATION_MS) || 20000;

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

// Live "N of M have decided" counter for the night phase - counts only,
// never identities or choices, so it's safe to send to every player
// including ones who haven't acted yet themselves.
function broadcastNightProgress(room) {
  const total = connectedLivingHumans(room).length;
  const submitted = connectedLivingHumans(room).filter(p => room.nightSubmitted.has(p.id)).length;
  const msg = JSON.stringify({ type: 'nightProgress', submitted, total });
  room.players.forEach(rp => {
    if (rp.socket.readyState === WebSocket.OPEN) rp.socket.send(msg);
  });
}

// Called after any submission or disconnect that might complete the current
// phase's set of expected actions, so the round resolves the moment everyone
// who's still here has acted instead of always waiting out the full timer.
function maybeEarlyResolve(room) {
  if (!room.started || !room.state) return;
  if (room.state.phase === 'night') {
    if (connectedLivingHumans(room).every(p => room.nightSubmitted.has(p.id))) { resolveNightPhase(room); return; }
    broadcastNightProgress(room);
  } else if (room.state.phase === 'day-vote') {
    // Silenced blocks speaking only, not voting - every living connected
    // human is eligible to vote, silenced or not.
    const eligible = connectedLivingHumans(room);
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
  broadcastNightProgress(room);
}

function resolveNightPhase(room) {
  clearPhaseTimer(room);
  const result = G.resolveNight(room.state);
  room.lastNightResult = result; // held onto so scoring can see this round's night outcome once the day vote also resolves
  // No sendGameState here - beginDayDiscussPhase (or endGame) sends the next
  // broadcast momentarily with the correct phaseEndsAt already set. Sending
  // here too would double-broadcast the same transition with a stale timer,
  // which is what caused the client's phase-transition screen to flicker.
  if (result.gameOver) { endGame(room); return; }
  beginDayDiscussPhase(room);
}

// Runs scoring.js once the round is fully resolved (night + day, including
// farmer revenge if it fired), before the client advances to the next round.
// Each real player gets ONLY their own breakdown - never anyone else's.
function finishRoundScoring(room, dayResult, revengeResult) {
  const night = room.state.night;
  const roundScores = Scoring.scoreRound(room.state, {
    night, nightResult: room.lastNightResult || {}, dayResult, revengeResult: revengeResult || null
  });
  room.players.forEach(rp => {
    const entry = roundScores[rp.id];
    room.cumulativeScores[rp.id] = (room.cumulativeScores[rp.id] || 0) + (entry ? entry.total : 0);
    if (rp.socket.readyState === WebSocket.OPEN) {
      rp.socket.send(JSON.stringify({
        type: 'roundScore', night,
        total: entry ? entry.total : 0,
        breakdown: entry ? entry.breakdown : [],
        cumulativeTotal: room.cumulativeScores[rp.id]
      }));
    }
  });
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
  // No sendGameState here - see the note in resolveNightPhase. Whichever of
  // beginFarmerRevengeWait/endGame/beginDayRevealPhase runs next sends the
  // real broadcast with its own correct phaseEndsAt.
  if (result.farmerRevengePending) { room.lastDayResult = result; beginFarmerRevengeWait(room); return; }
  finishRoundScoring(room, result, null);
  if (result.gameOver) { endGame(room); return; }
  beginDayRevealPhase(room);
}

function beginFarmerRevengeWait(room) {
  room.state.phase = 'farmer-revenge';
  room.phaseEndsAt = Date.now() + FARMER_REVENGE_DURATION_MS;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => {
    const farmerId = room.state.farmerRevengePending;
    const result = G.resolveFarmerRevenge(room.state, farmerId, null);
    finishRoundScoring(room, room.lastDayResult, result);
    if (result.gameOver) { endGame(room); return; }
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
  // Each real player's total across the whole just-finished game, so the
  // client can fold it into its own local (Task 21) average-score tracking.
  room.players.forEach(rp => {
    if (rp.socket.readyState === WebSocket.OPEN) {
      rp.socket.send(JSON.stringify({ type: 'finalScore', total: room.cumulativeScores[rp.id] || 0 }));
    }
  });
}

function sanitizeNightAction(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  ['kill', 'investigate', 'protect', 'hideBehind', 'bounty', 'silence', 'vigilanteKill', 'consigliereInvestigate', 'morticianInvestigate', 'frameTarget', 'cultConvert'].forEach(k => {
    if (typeof a[k] === 'string') out[k] = a[k];
  });
  return out;
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // A socket asking to create/join/quick-match while still seated in a
    // previous room (the client should always send 'leave' first, but never
    // trust that alone) would otherwise leave a phantom, un-cleanable player
    // behind in that old room. Leave it cleanly before starting a new one.
    if ((msg.type === 'create' || msg.type === 'join' || msg.type === 'quick_match') && socket.roomCode && rooms[socket.roomCode]) {
      removePlayer(socket);
    }

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
      room.cumulativeScores = {};
      room.lastNightResult = null;
      room.lastDayResult = null;
      room.lastConfig = config; // remembered so "Play again" can offer the same presets
      console.log(`Room ${socket.roomCode} started with ${seats.length} real player(s), ${room.state.players.length} total seats`);
      beginNightPhase(room);
    }

    else if (msg.type === 'playAgain') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player) return;
      if (player.id !== room.hostId) {
        socket.send(JSON.stringify({ type: 'error', message: 'Only the host can start a new game.' }));
        return;
      }
      if (!room.started || !room.state || !room.state.gameOver) return;
      clearPhaseTimer(room);
      room.started = false;
      room.state = null;
      room.phaseEndsAt = null;
      room.cumulativeScores = {};
      room.lastNightResult = null;
      room.lastDayResult = null;
      // Same room, same players, same host - just back to the lobby with
      // last game's presets pre-filled so the host doesn't have to redo them.
      room.players.forEach(rp => {
        if (rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify({ type: 'returnToLobby', roomCode: socket.roomCode, config: room.lastConfig || null }));
        }
      });
      broadcastRoster(socket.roomCode);
      console.log(`Room ${socket.roomCode} returned to lobby for another round`);
    }

    else if (msg.type === 'nightAction') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'night') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || !sp.isHuman) return;
      const sanitized = sanitizeNightAction(msg.action);
      room.state.pendingNightVotes[player.id] = sanitized;
      if (sp.role === 'Doctor' && sanitized.protect) {
        G.recordLivingCountSnapshot(room.state, player.id, sp.role, 'protect');
      }
      if (sp.role === 'Coward' && sanitized.hideBehind) {
        G.recordLivingCountSnapshot(room.state, player.id, sp.role, 'hideBehind');
      }
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
      // Purely mechanical accusation tag: the sender optionally marks the
      // message as directed at another living player. No judgment of the
      // message content - just "who tagged whom, and when" for scoring.js.
      const rawTargetId = msg.targetId ? String(msg.targetId) : null;
      const targetSp = rawTargetId ? G.byId(room.state, rawTargetId) : null;
      const targetId = (targetSp && targetSp.alive && targetSp.id !== player.id) ? targetSp.id : null;
      // replyTo is just a display snapshot the client captured when the
      // sender hit "Reply" on an earlier line - not a reference/lookup, so
      // there's nothing to validate against except shape and length.
      const rawReply = msg.replyTo;
      const replyTo = (rawReply && typeof rawReply === 'object' && typeof rawReply.name === 'string' && typeof rawReply.text === 'string')
        ? { name: String(rawReply.name).slice(0, 40), text: String(rawReply.text).slice(0, 120) }
        : null;
      const entry = { playerId: player.id, name: sp.name, text, ts: Date.now(), targetId, replyTo };
      room.state.chatLog.push(entry);
      if (targetId) G.recordAccusation(room.state, player.id, targetId);
      room.players.forEach(rp => {
        if (rp.socket.readyState === WebSocket.OPEN) rp.socket.send(JSON.stringify(Object.assign({ type: 'chatMsg' }, entry)));
      });
    }

    else if (msg.type === 'mafiaChat') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'night') return;
      const sp = G.byId(room.state, player.id);
      // PREBETA Phase 2 Task 4 - Hitman is mafia-aligned but explicitly cut
      // out of this channel entirely: never receives it, never participates.
      if (!sp || !sp.alive || sp.align !== 'mafia' || sp.role === 'Hitman') return;
      const text = String(msg.text || '').trim().slice(0, 300);
      if (!text) return;
      const entry = { playerId: player.id, name: sp.name, text, ts: Date.now() };
      room.state.mafiaChatLog.push(entry);
      // Scoped strictly to players whose CURRENT align is 'mafia' - never to
      // town-aligned players, and never broadcast wider than the room's own
      // connected sockets (placeholders have no socket to reach anyway).
      // Hitman excluded here too, on the receiving end.
      room.players.forEach(rp => {
        const rsp = G.byId(room.state, rp.id);
        if (rsp && rsp.align === 'mafia' && rsp.role !== 'Hitman' && rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify(Object.assign({ type: 'mafiaChatMsg' }, entry)));
        }
      });
    }

    else if (msg.type === 'cultChat') {
      // PREBETA Phase 2 Task 5 - same double-sided scoping pattern as
      // mafiaChat above (checked here on send, re-checked per recipient on
      // broadcast below), just a different roster: CURRENT align==='cult'.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'night') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || sp.align !== 'cult') return;
      const text = String(msg.text || '').trim().slice(0, 300);
      if (!text) return;
      const entry = { playerId: player.id, name: sp.name, text, ts: Date.now() };
      room.state.cultChatLog.push(entry);
      room.players.forEach(rp => {
        const rsp = G.byId(room.state, rp.id);
        if (rsp && rsp.align === 'cult' && rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify(Object.assign({ type: 'cultChatMsg' }, entry)));
        }
      });
    }

    else if (msg.type === 'ghostChat') {
      // PREBETA Task 9 - a private channel for eliminated players. Not
      // scoped to any single phase the way mafiaChat (night only) or
      // whisper (day-vote only) are - it persists for the rest of the game
      // once a player is eliminated, so no room.state.phase check here.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started) return;
      const sp = G.byId(room.state, player.id);
      if (!sp || sp.alive) return;
      const text = String(msg.text || '').trim().slice(0, 300);
      if (!text) return;
      const entry = { playerId: player.id, name: sp.name, text, ts: Date.now() };
      room.state.ghostChatLog.push(entry);
      // Scoped strictly to players whose CURRENT alive status is false -
      // never sent to a living player under any circumstance, re-checked per
      // recipient here at broadcast time (same double-sided pattern as
      // mafiaChat/whisper above).
      room.players.forEach(rp => {
        const rsp = G.byId(room.state, rp.id);
        if (rsp && !rsp.alive && rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify(Object.assign({ type: 'ghostChatMsg' }, entry)));
        }
      });
    }

    else if (msg.type === 'dayVote') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'day-vote') return;
      const sp = G.byId(room.state, player.id);
      // Silenced blocks speaking (see dayChat above), never voting.
      if (!sp || !sp.alive || !sp.isHuman) return;
      const targetId = msg.targetId ? String(msg.targetId) : null;
      // PREBETA Task 6 - Mayor Ability 1: revealing to double this round's
      // vote is submitted together with the vote itself, not as a separate
      // action. recordMayorReveal is a no-op (returns false) for anyone who
      // isn't a not-yet-revealed Mayor, so this is safe to call unconditionally.
      if (msg.revealMayor === true) G.recordMayorReveal(room.state, player.id);
      G.recordDayVoteSubmission(room.state, player.id, targetId);
      room.dayVoteSubmitted.add(player.id);
      maybeEarlyResolve(room);
    }

    else if (msg.type === 'whisper') {
      // Bug 14: previously had no server implementation at all - the
      // multiplayer client hard-disabled the whisper tab unconditionally.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'day-vote') return;
      const sp = G.byId(room.state, player.id);
      // Whispering is speaking - silenced blocks it, same as dayChat.
      if (!sp || !sp.alive || sp.silencedToday) return;
      const targetId = msg.targetId ? String(msg.targetId) : null;
      const targetSp = targetId ? G.byId(room.state, targetId) : null;
      if (!targetSp || !targetSp.alive || targetSp.id === player.id) return;
      const usedByPlayer = room.state.whisperLog.filter(w => w.fromId === player.id).length;
      if (usedByPlayer >= 3) {
        socket.send(JSON.stringify({ type: 'error', message: "You're out of whispers for this round." }));
        return;
      }
      const text = String(msg.text || '').trim().slice(0, 140);
      if (!text) return;
      const entry = { fromId: player.id, toId: targetSp.id, text, ts: Date.now() };
      room.state.whisperLog.push(entry);
      // The full whisper thread is still delivered privately - only the
      // sender and the target ever get this message.
      const targetPlayer = room.players.find(rp => rp.id === targetSp.id);
      if (targetPlayer && targetPlayer.socket.readyState === WebSocket.OPEN) {
        targetPlayer.socket.send(JSON.stringify(Object.assign({ type: 'whisperMsg' }, entry)));
      }
      socket.send(JSON.stringify(Object.assign({ type: 'whisperMsg' }, entry)));

      // Everyone else still gets to know a whisper happened, just not what
      // was said - drop it into the general chat log as an announcement.
      // The stored entry keeps the real text (getPlayerView redacts it per
      // viewer on resync, same scoping as whisperLog above), but the live
      // broadcast below has to redact it per-socket itself too - this push
      // goes straight to the wire, not through getPlayerView, so sending
      // the raw entry to everyone would leak the text to bystanders.
      // `kind` (not `type`) so it doesn't collide with the chatMsg envelope's
      // own `type` field once the two get merged below.
      const announceEntry = { kind: 'whisperAnnounce', fromId: player.id, fromName: sp.name, toId: targetSp.id, toName: targetSp.name, text, ts: entry.ts };
      room.state.chatLog.push(announceEntry);
      room.players.forEach(rp => {
        if (rp.socket.readyState !== WebSocket.OPEN) return;
        const canSeeText = rp.id === player.id || rp.id === targetSp.id;
        const payload = canSeeText ? announceEntry : Object.assign({}, announceEntry, { text: undefined });
        rp.socket.send(JSON.stringify(Object.assign({ type: 'chatMsg' }, payload)));
      });
    }

    else if (msg.type === 'farmerRevenge') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || room.state.phase !== 'farmer-revenge') return;
      if (room.state.farmerRevengePending !== player.id) return;
      clearPhaseTimer(room);
      const targetId = msg.targetId ? String(msg.targetId) : null;
      // PREBETA Phase 2 Task 4 - this mechanism is now shared between Farmer
      // and Hitman (see resolveDayVote), so the role recorded here has to be
      // whoever's ACTUALLY triggering it, not a hardcoded 'Farmer' - it only
      // ever feeds a scoring breakdown line's display text
      // ("<role> blind guess paid off"), never a branching decision, but a
      // Hitman's revenge showing up labeled "Farmer" there would be wrong.
      const revengeRole = G.byId(room.state, player.id).role;
      G.recordLivingCountSnapshot(room.state, player.id, revengeRole, 'farmerRevenge');
      const result = G.resolveFarmerRevenge(room.state, player.id, targetId);
      finishRoundScoring(room, room.lastDayResult, result);
      if (result.gameOver) { endGame(room); } else { beginDayRevealPhase(room); }
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
