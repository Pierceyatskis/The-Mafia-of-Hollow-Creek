// Hollow Creek - multiplayer lobby + game server
// ------------------------------------------------
// Lobby (create/join/leave/roster) plus a server-authoritative game, driven by
// the pure-logic engine in game.js. Clients never see full state - only their
// own redacted view (see game.js's getPlayerView).

const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const G = require('./game.js');
const Scoring = require('./scoring.js');

const PORT = process.env.PORT || 8080;

// Phase durations. Server owns these - clients render a countdown from
// phaseEndsAt, they never run their own independent clock. Discussion and
// voting time are also host-configurable per room (see sanitizeDurationMs
// below and room.discussMs/room.voteMs) - these constants are just the
// defaults a room falls back to until the host picks something else.
const NIGHT_DURATION_MS = Number(process.env.NIGHT_DURATION_MS) || 60000;
const DAY_DISCUSS_DURATION_MS = Number(process.env.DAY_DISCUSS_DURATION_MS) || 90000;
const DAY_VOTE_DURATION_MS = Number(process.env.DAY_VOTE_DURATION_MS) || 105000; // was 45s - extended by an extra minute of actual voting time
const DAY_REVEAL_DURATION_MS = Number(process.env.DAY_REVEAL_DURATION_MS) || 12000;
const FARMER_REVENGE_DURATION_MS = Number(process.env.FARMER_REVENGE_DURATION_MS) || 20000;
const MIN_DISCUSS_SECONDS = 30, MAX_DISCUSS_SECONDS = 300;
const MIN_VOTE_SECONDS = 30, MAX_VOTE_SECONDS = 300;
// Voice/stage feature - off unless a host explicitly turns it on for their room.
const DEFAULT_VOICE_ENABLED = false;
const STAGE_TURN_SECONDS = 30;
const DONATE_SECONDS = 5;

// Clamps a host-supplied seconds value into range and converts to ms,
// falling back to the given default for anything not a finite number.
function sanitizeDurationMs(raw, minSeconds, maxSeconds, defaultMs) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultMs;
  return Math.max(minSeconds, Math.min(maxSeconds, Math.round(n))) * 1000;
}

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

// Both values ride back out to every other client and land straight in an
// HTML attribute (avatarHTML's inline style="...background:COLOR;" and an
// <img src> built from IMG[avatarKey]) - strict allowlists here, not just
// truncation, so a hostile client can't break out of that attribute.
function sanitizeColor(raw) {
  const s = String(raw || '');
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : null;
}
function sanitizeAvatarKey(raw) {
  const s = String(raw || '');
  return /^avatar[0-9]{1,3}$/.test(s) ? s : null;
}

// Fixed set, confirmed final - a kick or host-mute must pick one of these
// (an 'other' pick also carries a free-text note, sanitizeModerationNote below).
const MODERATION_REASON_LABELS = {
  'toxic': 'Toxic behavior',
  'inappropriate-name': 'Inappropriate name',
  'inappropriate-language': 'Inappropriate language',
  'other': 'Other'
};
function sanitizeModerationReason(raw) {
  const s = String(raw || '');
  return Object.prototype.hasOwnProperty.call(MODERATION_REASON_LABELS, s) ? s : null;
}
function sanitizeModerationNote(raw) {
  return String(raw || '').trim().slice(0, 200);
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

function createRoom(socket, name, isPublic, avatarKey, color, initialVoiceEnabled, gameIconKey) {
  const code = makeRoomCode();
  const id = makePlayerId();
  // draftConfig: the host's in-progress (not yet started) setup-screen
  // choices - null until the host's client sends its first hostConfigUpdate.
  // Lets a waiting (non-host) player see live seat/mafia/role choices
  // instead of nothing at all before the game starts. Seeded with just
  // {voiceEnabled} when a quick-matcher's search created this room (see the
  // 'quick_match' handler) - otherwise a second searcher with the same mic
  // preference couldn't match into it until the host's client sent its own
  // first real edit.
  rooms[code] = {
    players: [{ id, name, socket, avatarKey, color, gameIconKey }], hostId: id, started: false, state: null, timer: null,
    phaseEndsAt: null, isPublic: !!isPublic,
    draftConfig: typeof initialVoiceEnabled === 'boolean' ? { voiceEnabled: initialVoiceEnabled } : null
  };
  socket.roomCode = code;
  socket.playerId = id;
  socket.send(JSON.stringify({ type: 'created', roomCode: code, playerId: id }));
  broadcastRoster(code);
  return code;
}

function joinRoom(socket, code, name, avatarKey, color, gameIconKey) {
  const room = rooms[code];
  const id = makePlayerId();
  room.players.push({ id, name, socket, avatarKey, color, gameIconKey });
  socket.roomCode = code;
  socket.playerId = id;
  socket.send(JSON.stringify({ type: 'joined', roomCode: code, playerId: id }));
  // A player joining mid-setup should see the host's current choices right
  // away, not just whatever the next edit happens to broadcast.
  if (room.draftConfig) {
    socket.send(JSON.stringify(Object.assign({ type: 'configUpdate' }, room.draftConfig)));
  }
  broadcastRoster(code);
}

function broadcastRoster(code) {
  const room = rooms[code];
  if (!room) return;
  const roster = room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId, avatarKey: p.avatarKey || null, color: p.color || null }));
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

  // A disconnected human keeps their seat in the game - see the 'rejoin'
  // handler, which finds this same seat by id and marks it connected again -
  // but must stop blocking resolution in the meantime: treat them like a
  // placeholder for early-resolution checks and fallback actions.
  if (room.started && room.state) {
    const sp = G.byId(room.state, playerId);
    if (sp) sp.connected = false;
    handlePlayerLeftStage(room, playerId);
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
    // Merged mute state (self-muted OR host-muted) decorated on here rather
    // than in game.js, since muting is a voice/session concern, not a mafia
    // rule - see room.stage. Viewers only ever see this one boolean; which
    // of the two caused it is never exposed (see the 'hostMute'/'selfMuteToggle'
    // handlers below).
    if (room.stage) {
      view.players.forEach(p => {
        p.muted = room.stage.selfMuted.has(p.id) || room.stage.hostMuted.has(p.id);
      });
    }
    rp.socket.send(JSON.stringify({ type: 'gameState', view, phaseEndsAt: room.phaseEndsAt }));
  });
}

// Humans who still have a live, open socket - a disconnected human's seat
// stays in the game (see removePlayer) but no longer counts toward "has
// everyone submitted yet", so the rest of the table isn't stuck waiting on them.
function connectedLivingHumans(room) {
  return room.state.players.filter(p => p.alive && p.isHuman && p.connected !== false);
}

// Live spotlight tally - identity-free counts only (see G.spotlightCounts),
// so it's safe to send to every player regardless of who cast what.
function broadcastSpotlightCounts(room) {
  const counts = G.spotlightCounts(room.state);
  const msg = JSON.stringify({ type: 'spotlightCounts', counts });
  room.players.forEach(rp => {
    if (rp.socket.readyState === WebSocket.OPEN) rp.socket.send(msg);
  });
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

// Live "who has voted" list for the day vote - unlike night, the fact that
// someone has voted (not who they voted FOR) is meant to be public in real
// time, so every connected player's id who has submitted is sent to everyone,
// letting each client paint a checkmark over that player's avatar.
function broadcastDayVoteProgress(room) {
  const votedIds = connectedLivingHumans(room).filter(p => room.dayVoteSubmitted.has(p.id)).map(p => p.id);
  const msg = JSON.stringify({ type: 'dayVoteProgress', votedIds });
  room.players.forEach(rp => {
    if (rp.socket.readyState === WebSocket.OPEN) rp.socket.send(msg);
  });
}

// ---- voice/stage feature (floor control) ----
// A transport/session concern layered on top of the game (like
// room.draftConfig/room.dayVoteSubmitted), not a mafia rule - kept out of
// game.js entirely. See room.stage's shape in the 'start' handler.

// Mints a fresh, short-lived TURN credential using coturn's REST-API-style
// mechanism (username = an expiry timestamp, password = HMAC-SHA1 of that
// username with the shared secret) - the secret itself never reaches a
// client, only ever this derived, time-limited pair. Falls back to a plain
// public STUN server (no relay, direct-P2P/same-network only) when the TURN
// env vars aren't configured, so local dev still works without a real droplet.
const TURN_CREDENTIAL_TTL_SECONDS = 3600;
function buildIceServers() {
  const host = process.env.TURN_HOST;
  const secret = process.env.TURN_SHARED_SECRET;
  if (!host || !secret) {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
  const port = process.env.TURN_PORT || '3478';
  const tlsPort = process.env.TURN_TLS_PORT || '5349';
  const username = String(Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS);
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return [
    { urls: 'stun:' + host + ':' + port },
    { urls: 'turn:' + host + ':' + port, username, credential },
    { urls: 'turns:' + host + ':' + tlsPort + '?transport=tcp', username, credential }
  ];
}

function stageLivingCount(room) {
  return G.living(room.state).length;
}
function stageVoteOffThreshold(room) {
  return Math.ceil(stageLivingCount(room) * 0.75);
}

// Clears the current turn's timer and per-turn tallies without touching who's
// speaking or queued - shared by startSpeakerTurn and the round-boundary resets.
function resetStageTurnTallies(room) {
  if (!room.stage) return;
  if (room.stage.turnTimer) { clearTimeout(room.stage.turnTimer); room.stage.turnTimer = null; }
  room.stage.turnDeadline = null;
  room.stage.donateUsedBy.clear();
  room.stage.voteOffStageVotes.clear();
  room.stage.reactedBy.clear();
}

// Fully resets the stage to idle/empty - the start of every new day round
// and the moment all votes are in (see beginDayDiscussPhase,
// resolveDayVotePhase, beginFarmerRevengeWait). Never touches
// selfMuted/hostMuted, which persist the whole game, not per-round.
function resetStage(room) {
  if (!room.stage) return;
  resetStageTurnTallies(room);
  room.stage.speakerId = null;
  room.stage.queue = [];
  room.stage.turnStartedAt = null;
  broadcastStageState(room);
}

function startSpeakerTurn(room, playerId) {
  resetStageTurnTallies(room);
  room.stage.speakerId = playerId;
  room.stage.turnStartedAt = Date.now();
  broadcastStageState(room);
}

// If nobody's currently speaking and someone's waiting, promotes the front of
// the queue - one code path for both "first speaker of the round" and "next
// speaker after a turn ends", per the plan's design decision.
function advanceStageIfIdle(room) {
  if (!room.stage || room.stage.speakerId) return;
  if (!room.stage.queue.length) { broadcastStageState(room); return; }
  const nextId = room.stage.queue.shift();
  startSpeakerTurn(room, nextId);
}

// Ends whoever's currently speaking's turn - shared by Leave Stage, reaching
// the Vote Off Stage threshold, and timer expiry.
function endSpeakerTurn(room) {
  if (!room.stage) return;
  resetStageTurnTallies(room);
  room.stage.speakerId = null;
  advanceStageIfIdle(room);
}

// Called after every joinQueue - the 30s timer only starts once there's
// actual demand for the stage (a second person waiting); a solo speaker with
// an empty queue is never put under pressure.
function maybeStartStageTimer(room) {
  if (!room.stage || !room.stage.speakerId) return;
  if (room.stage.queue.length < 1 || room.stage.turnDeadline !== null) return;
  room.stage.turnDeadline = Date.now() + STAGE_TURN_SECONDS * 1000;
  room.stage.turnTimer = setTimeout(() => endSpeakerTurn(room), STAGE_TURN_SECONDS * 1000);
  broadcastStageState(room);
}

// Personalized per recipient (like sendGameState) since `you` is specific to
// each viewer - a dedicated, frequent broadcast (every queue join/leave/
// donate/vote-off-stage click) kept separate from the heavier gameState
// payload, same reasoning as dayVoteProgress vs the full gameState.
function broadcastStageState(room) {
  if (!room.stage) return;
  const threshold = stageVoteOffThreshold(room);
  const count = room.stage.voteOffStageVotes.size;
  const reactionCounts = { up: 0, down: 0, smile: 0 };
  room.stage.reactedBy.forEach(r => { if (reactionCounts[r] !== undefined) reactionCounts[r]++; });
  room.players.forEach(rp => {
    if (rp.socket.readyState !== WebSocket.OPEN) return;
    rp.socket.send(JSON.stringify({
      type: 'stageState',
      speakerId: room.stage.speakerId,
      queue: room.stage.queue,
      turnDeadline: room.stage.turnDeadline,
      voteOffStageCount: count,
      voteOffStageThreshold: threshold,
      reactions: reactionCounts,
      you: {
        votedOffStage: room.stage.voteOffStageVotes.has(rp.id),
        donated: room.stage.donateUsedBy.has(rp.id),
        reaction: room.stage.reactedBy.get(rp.id) || null
      }
    }));
  });
}

// Called from removePlayer on disconnect - a dropped speaker or queued
// player must not permanently freeze the stage for everyone else.
function handlePlayerLeftStage(room, playerId) {
  if (!room.stage) return;
  if (room.stage.speakerId === playerId) { endSpeakerTurn(room); return; }
  const idx = room.stage.queue.indexOf(playerId);
  if (idx !== -1) { room.stage.queue.splice(idx, 1); broadcastStageState(room); }
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
    if (eligible.every(p => room.dayVoteSubmitted.has(p.id))) { resolveDayVotePhase(room); return; }
    broadcastDayVoteProgress(room);
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
  const discussMs = room.discussMs || DAY_DISCUSS_DURATION_MS;
  room.state.phase = 'day-discuss';
  room.state.spotlights = {};
  room.phaseEndsAt = Date.now() + discussMs;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => beginDayVotePhase(room), discussMs);
  resetStage(room);
  sendGameState(room);
  broadcastSpotlightCounts(room);
}

function beginDayVotePhase(room) {
  const voteMs = room.voteMs || DAY_VOTE_DURATION_MS;
  room.state.phase = 'day-vote';
  room.dayVoteSubmitted = new Set();
  room.phaseEndsAt = Date.now() + voteMs;
  clearPhaseTimer(room);
  room.timer = setTimeout(() => resolveDayVotePhase(room), voteMs);
  sendGameState(room);
  broadcastDayVoteProgress(room);
}

function resolveDayVotePhase(room) {
  clearPhaseTimer(room);
  // The exact moment the stage stops being live (5g) - covers both the
  // farmer-revenge and the straight-to-reveal paths below, since both
  // start from here.
  resetStage(room);
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
      const code = createRoom(socket, name, msg.isPublic, sanitizeAvatarKey(msg.avatarKey), sanitizeColor(msg.color), undefined, sanitizeAvatarKey(msg.gameIconKey));
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
      joinRoom(socket, code, name, sanitizeAvatarKey(msg.avatarKey), sanitizeColor(msg.color), sanitizeAvatarKey(msg.gameIconKey));
      console.log(`${name} joined room ${code}`);
    }

    else if (msg.type === 'quick_match') {
      const name = sanitizeName(msg.name);
      const avatarKey = sanitizeAvatarKey(msg.avatarKey);
      const color = sanitizeColor(msg.color);
      const gameIconKey = sanitizeAvatarKey(msg.gameIconKey);
      // A searcher who didn't state a preference is treated as "without mic"
      // (matches DEFAULT_VOICE_ENABLED=false) rather than matching anything.
      const wantsVoice = msg.micPreference === 'with';
      const openCode = Object.keys(rooms).find(c => {
        const r = rooms[c];
        if (!r.isPublic || r.started || r.players.length >= G.MAX_PLAYERS) return false;
        const roomWantsVoice = r.draftConfig ? !!r.draftConfig.voiceEnabled : DEFAULT_VOICE_ENABLED;
        return roomWantsVoice === wantsVoice;
      });
      if (openCode) {
        joinRoom(socket, openCode, name, avatarKey, color, gameIconKey);
        console.log(`${name} quick-matched into room ${openCode}`);
      } else {
        const code = createRoom(socket, name, true, avatarKey, color, wantsVoice, gameIconKey);
        console.log(`Room ${code} created via quick-match by ${name}`);
      }
    }

    else if (msg.type === 'leave') {
      removePlayer(socket);
    }

    else if (msg.type === 'rejoin') {
      // A refreshed/reloaded tab trying to step back into the exact seat it
      // had a moment ago - see the client's ACTIVE_SESSION_KEY/loadActiveSession.
      // Pre-start, a seat isn't durable game state yet, so this just falls
      // through to a normal joinRoom (a fresh id, but the same room) rather
      // than trying to preserve identity that doesn't mean anything yet.
      // Once started, the real seat lives in room.state.players (game.js),
      // marked connected:false by removePlayer on the original disconnect -
      // reconnecting means finding that same seat again and marking it
      // connected, not creating a new one.
      const code = (msg.roomCode || '').toUpperCase();
      const room = rooms[code];
      if (!room) {
        socket.send(JSON.stringify({ type: 'rejoinFailed', message: 'That room no longer exists.' }));
        return;
      }
      const name = sanitizeName(msg.name);
      const avatarKey = sanitizeAvatarKey(msg.avatarKey);
      const color = sanitizeColor(msg.color);
      const gameIconKey = sanitizeAvatarKey(msg.gameIconKey);

      if (!room.started) {
        if (room.players.length >= G.MAX_PLAYERS) {
          socket.send(JSON.stringify({ type: 'rejoinFailed', message: 'That room is full.' }));
          return;
        }
        joinRoom(socket, code, name, avatarKey, color, gameIconKey);
        return;
      }

      const playerId = String(msg.playerId || '');
      const sp = G.byId(room.state, playerId);
      if (!sp || !sp.isHuman) {
        socket.send(JSON.stringify({ type: 'rejoinFailed', message: 'Your seat in that game is gone.' }));
        return;
      }
      sp.connected = true;
      const existingEntry = room.players.find(p => p.id === playerId);
      if (existingEntry) { existingEntry.socket = socket; }
      else { room.players.push({ id: playerId, name: sp.name, socket, avatarKey, color, gameIconKey }); }
      socket.roomCode = code;
      socket.playerId = playerId;
      socket.send(JSON.stringify({ type: 'rejoined', roomCode: code, playerId, started: true }));
      sendGameState(room);
      if (room.stage) broadcastStageState(room);
      console.log(`${sp.name} reconnected to room ${code}`);
    }

    else if (msg.type === 'kick') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player) return;
      if (player.id !== room.hostId) {
        socket.send(JSON.stringify({ type: 'error', message: 'Only the host can remove a player.' }));
        return;
      }
      const reason = sanitizeModerationReason(msg.reason);
      if (!reason) {
        socket.send(JSON.stringify({ type: 'error', message: 'Choose a reason before removing a player.' }));
        return;
      }
      const note = reason === 'other' ? sanitizeModerationNote(msg.note) : '';
      const targetId = String(msg.targetId || '');
      if (!targetId || targetId === room.hostId) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      const label = MODERATION_REASON_LABELS[reason] + (note ? ': ' + note : '');
      if (target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({ type: 'kicked', message: 'The host removed you from the room.', reason: label }));
      }
      removePlayer(target.socket);
      target.socket.close();
      console.log(`${target.name} was kicked from room ${socket.roomCode} - reason: ${label}`);
    }

    else if (msg.type === 'hostMute') {
      // Stops voice transmission without removing the player - independent
      // of selfMuteToggle below (a host-mute and a self-mute are two
      // separate flags, merged into one 'muted' boolean only when sent to
      // clients - see sendGameState).
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (player.id !== room.hostId) return;
      const reason = sanitizeModerationReason(msg.reason);
      if (!reason) return;
      const note = reason === 'other' ? sanitizeModerationNote(msg.note) : '';
      const targetId = String(msg.targetId || '');
      if (!targetId || targetId === room.hostId) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      room.stage.hostMuted.set(targetId, { reason, note });
      console.log(`${target.name} was muted in room ${socket.roomCode} - reason: ${MODERATION_REASON_LABELS[reason]}${note ? ': ' + note : ''}`);
      sendGameState(room);
    }

    else if (msg.type === 'hostUnmute') {
      // A no-op if the target isn't actually host-muted - deliberately safe
      // to call unconditionally from a client that only ever sees the merged
      // 'muted' boolean and can't tell which flag caused it (see index.html's
      // moderation tab).
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (player.id !== room.hostId) return;
      room.stage.hostMuted.delete(String(msg.targetId || ''));
      sendGameState(room);
    }

    else if (msg.type === 'selfMuteToggle') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (room.stage.selfMuted.has(player.id)) room.stage.selfMuted.delete(player.id);
      else room.stage.selfMuted.add(player.id);
      sendGameState(room);
    }

    else if (msg.type === 'joinQueue') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage || !room.voiceEnabled) return;
      if (room.state.phase !== 'day-discuss' && room.state.phase !== 'day-vote') return;
      const sp = G.byId(room.state, player.id);
      // Silenced blocks requesting the floor, same rule as text chat.
      if (!sp || !sp.alive || sp.silencedToday) return;
      if (room.stage.speakerId === player.id || room.stage.queue.includes(player.id)) return;
      room.stage.queue.push(player.id);
      if (!room.stage.speakerId) {
        advanceStageIfIdle(room); // stage was idle - this player is promoted immediately
      } else {
        maybeStartStageTimer(room); // starts the 30s timer if this is the first person to queue up
        broadcastStageState(room);
      }
    }

    else if (msg.type === 'leaveQueue') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      const idx = room.stage.queue.indexOf(player.id);
      if (idx === -1) return;
      room.stage.queue.splice(idx, 1);
      broadcastStageState(room);
    }

    else if (msg.type === 'leaveStage') {
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (room.stage.speakerId !== player.id) return;
      endSpeakerTurn(room);
    }

    else if (msg.type === 'donateTime') {
      // Confirmed: any player in the room can donate, not just those in the
      // queue - deliberately no alive-check, unlike voteOffStage below.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (!room.stage.speakerId || room.stage.speakerId === player.id) return;
      if (room.stage.turnDeadline === null) return; // timer hasn't started yet - nothing to donate to
      if (room.stage.donateUsedBy.has(player.id)) return; // max 5s per person per turn, spent in one press
      room.stage.donateUsedBy.add(player.id);
      room.stage.turnDeadline += DONATE_SECONDS * 1000;
      clearTimeout(room.stage.turnTimer);
      room.stage.turnTimer = setTimeout(() => endSpeakerTurn(room), room.stage.turnDeadline - Date.now());
      broadcastStageState(room);
    }

    else if (msg.type === 'voteOffStage') {
      // Threshold is living players only (confirmed with the user, not
      // all-connected) - see stageVoteOffThreshold.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (!room.stage.speakerId || room.stage.speakerId === player.id) return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive) return;
      room.stage.voteOffStageVotes.add(player.id);
      if (room.stage.voteOffStageVotes.size >= stageVoteOffThreshold(room)) {
        endSpeakerTurn(room);
      } else {
        broadcastStageState(room);
      }
    }

    else if (msg.type === 'retractVoteOffStage') {
      // Retractable/changeable before the threshold is reached, same
      // pattern as a day-vote can be changed before that phase resolves.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      room.stage.voteOffStageVotes.delete(player.id);
      broadcastStageState(room);
    }

    else if (msg.type === 'stageReaction') {
      // GAP_COMPARISON Item 4 - real synced reactions, same pattern as the
      // vote-off-stage tally above: one reaction per living player per
      // turn, clicking your current reaction again clears it, cleared for
      // everyone the moment the turn changes (resetStageTurnTallies).
      // reaction is never trusted beyond this fixed set.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.stage) return;
      if (!room.stage.speakerId || room.stage.speakerId === player.id) return;
      if (!['up', 'down', 'smile'].includes(msg.reaction)) return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive) return;
      if (room.stage.reactedBy.get(player.id) === msg.reaction) {
        room.stage.reactedBy.delete(player.id);
      } else {
        room.stage.reactedBy.set(player.id, msg.reaction);
      }
      broadcastStageState(room);
    }

    else if (msg.type === 'requestIceConfig') {
      // Mints a fresh credential per request rather than caching one
      // server-side per room - cheap to generate, and avoids ever handing a
      // client a credential that's already stale.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player) return;
      socket.send(JSON.stringify({ type: 'iceConfig', iceServers: buildIceServers() }));
    }

    else if (msg.type === 'voiceOffer' || msg.type === 'voiceAnswer' || msg.type === 'voiceIceCandidate') {
      // Pure relay between two specific players, same shape as whisper -
      // the server never inspects the SDP/candidate payload itself, just
      // routes it to the right socket. fromId is set here, from the
      // authenticated sender, never trusted from the client's own payload.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || !room.started || !room.voiceEnabled) return;
      const targetId = String(msg.targetId || '');
      const target = room.players.find(p => p.id === targetId);
      if (!target || target.socket.readyState !== WebSocket.OPEN) return;
      target.socket.send(JSON.stringify(Object.assign({}, msg, { fromId: player.id })));
    }

    else if (msg.type === 'hostConfigUpdate') {
      // Lets a waiting (non-host) player see the setup screen's seats/mafia
      // count/roles live, as the host adjusts them - purely informational,
      // never itself starts or validates a game (that's still `start`'s job).
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !player || room.started) return;
      if (player.id !== room.hostId) return;

      let playerCount = Number(msg.playerCount);
      if (!Number.isFinite(playerCount)) playerCount = G.MIN_PLAYERS;
      playerCount = Math.max(G.MIN_PLAYERS, Math.min(G.MAX_PLAYERS, Math.round(playerCount)));

      let mafiaCount = Number(msg.mafiaCount);
      if (!Number.isFinite(mafiaCount)) mafiaCount = 0;
      mafiaCount = Math.max(0, Math.min(G.MAX_MAFIA_COUNT, Math.round(mafiaCount)));

      const roles = sanitizeRolesConfig(msg.roles);
      const discussMs = sanitizeDurationMs(msg.discussSeconds, MIN_DISCUSS_SECONDS, MAX_DISCUSS_SECONDS, DAY_DISCUSS_DURATION_MS);
      const voteMs = sanitizeDurationMs(msg.voteSeconds, MIN_VOTE_SECONDS, MAX_VOTE_SECONDS, DAY_VOTE_DURATION_MS);
      const voiceEnabled = !!msg.voiceEnabled;
      room.draftConfig = { playerCount, mafiaCount, roles, discussSeconds: discussMs / 1000, voteSeconds: voteMs / 1000, voiceEnabled };
      room.players.forEach(rp => {
        if (rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify(Object.assign({ type: 'configUpdate' }, room.draftConfig)));
        }
      });
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
      const seats = room.players.map(p => ({ id: p.id, name: p.name, avatarKey: p.avatarKey, gameIconKey: p.gameIconKey, color: p.color }));
      const config = { playerCount, mafiaCount, roles };
      // Host-configurable per room (Accessibility/Settings follow-up) - kept
      // on the room so every phase for the rest of this room's life (this
      // game and any "play again" rematch) uses the same chosen durations
      // instead of always falling back to the module-wide defaults.
      room.discussMs = sanitizeDurationMs(msg.discussSeconds, MIN_DISCUSS_SECONDS, MAX_DISCUSS_SECONDS, DAY_DISCUSS_DURATION_MS);
      room.voteMs = sanitizeDurationMs(msg.voteSeconds, MIN_VOTE_SECONDS, MAX_VOTE_SECONDS, DAY_VOTE_DURATION_MS);
      room.voiceEnabled = !!msg.voiceEnabled;
      // Floor-control state for the voice/stage feature - a transport/session
      // concern layered on top of the game, not a mafia rule, so it lives
      // here rather than in game.js's state. selfMuted/hostMuted persist the
      // whole game (rebuilt fresh only here, on a brand new start/play-again);
      // everything else is per-round or per-turn, reset in beginDayDiscussPhase
      // and startSpeakerTurn respectively.
      room.stage = {
        speakerId: null, queue: [], turnDeadline: null, turnStartedAt: null, turnTimer: null,
        donateUsedBy: new Set(), voteOffStageVotes: new Set(),
        selfMuted: new Set(), hostMuted: new Map(), reactedBy: new Map()
      };

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

    else if (msg.type === 'typing') {
      // Ephemeral presence relay for the "X is typing..." indicator - never
      // persisted anywhere (not chatLog, not getPlayerView). playerId/name
      // are always server-set from the authenticated socket, same as every
      // other relay in this file (whisper, voice signaling) - never trust
      // a client-asserted identity.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started) return;
      if (room.state.phase !== 'day-discuss' && room.state.phase !== 'day-vote') return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || sp.silencedToday) return;
      room.players.forEach(rp => {
        if (rp.id !== player.id && rp.socket.readyState === WebSocket.OPEN) {
          rp.socket.send(JSON.stringify({ type: 'typingIndicator', playerId: player.id, name: sp.name }));
        }
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

    else if (msg.type === 'spotlight') {
      // A live discussion-time signal, not a vote - never blocks/early-
      // resolves anything, can be set and withdrawn as often as the
      // discussion moves. Valid during both day sub-phases, same as chat.
      const { room, player } = getRoomAndPlayer(socket);
      if (!room || !room.started || (room.state.phase !== 'day-discuss' && room.state.phase !== 'day-vote')) return;
      const sp = G.byId(room.state, player.id);
      if (!sp || !sp.alive || !sp.isHuman) return;
      const targetId = msg.targetId ? String(msg.targetId) : null;
      if (targetId) {
        const target = G.byId(room.state, targetId);
        if (!target || !target.alive || target.id === player.id) return;
      }
      G.recordSpotlight(room.state, player.id, targetId);
      broadcastSpotlightCounts(room);
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

// Test-only introspection - never imported in production (this file is
// always the process entry point, run directly via `node server.js`).
// test-server.js requires this module in-process specifically to verify
// server-internal state that's no longer observable over the wire, like a
// private role's log, now that those are correctly scoped off the public
// case file (see game.js's detectiveLog/consigliereLog/morticianLog).
module.exports = { rooms };
