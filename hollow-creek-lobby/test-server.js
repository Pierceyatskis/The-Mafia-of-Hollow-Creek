// Integration tests for server.js - drives the real server over real
// WebSocket connections (same pattern as game.js's own unit tests, but this
// one needs sockets since it's testing the protocol layer, not pure logic).
// Run with: node test-server.js

const path = require('path');
const WebSocket = require(path.join(__dirname, 'node_modules', 'ws'));

const PORT = 8098;
process.env.PORT = PORT;
// day-discuss has no early-resolve path (unlike night/day-vote, which resolve
// the moment everyone's submitted) - shrink it so tests don't have to sit
// through the real 90s discussion timer to reach day-vote.
process.env.DAY_DISCUSS_DURATION_MS = 300;
require('./server.js');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); failures++; }
  else console.log('ok - ' + msg);
}

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    ws.on('open', () => resolve(ws));
  });
}

function once(ws, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for message matching predicate')), timeoutMs || 5000);
    function handler(raw) {
      const msg = JSON.parse(raw);
      if (predicate(msg)) { clearTimeout(t); ws.off('message', handler); resolve(msg); }
    }
    ws.on('message', handler);
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

async function createRoom(name, isPublic) {
  const ws = await connect();
  send(ws, { type: 'create', name, isPublic: !!isPublic });
  const created = await once(ws, m => m.type === 'created');
  return { ws, roomCode: created.roomCode, playerId: created.playerId };
}

async function joinRoom(roomCode, name) {
  const ws = await connect();
  send(ws, { type: 'join', name, roomCode });
  const joined = await once(ws, m => m.type === 'joined' || m.type === 'error');
  return { ws, roomCode: joined.roomCode, playerId: joined.playerId, error: joined.type === 'error' ? joined.message : null };
}

// ============================================================
// Task 1 (server level): start rejects an under-capacity config
// with a clear error instead of ever starting the game.
// ============================================================
async function testUndercapacityStartRejected() {
  const host = await createRoom('Alice');
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0 }); // default 7 roles need 7 seats
  const err = await once(host.ws, m => m.type === 'error' || m.type === 'gameState');
  assert(err.type === 'error', 'start with playerCount:6 and the full default role set is rejected with an error, not silently started');
  assert(err.type === 'error' && /not enough seats/i.test(err.message || ''), 'the rejection message clearly explains the seat shortfall');

  // room must still be usable afterward - a rejected start should not have flipped `started`
  send(host.ws, { type: 'start', playerCount: 8, mafiaCount: 1 });
  const ok = await once(host.ws, m => m.type === 'gameState');
  assert(ok.type === 'gameState', 'the same room can still start successfully with a valid config after a rejected attempt');
  host.ws.close();
}

// ============================================================
// Task 4: host can enable Coward/Farmer/NavySeal through `start`.
// ============================================================
async function testCustomRolesEnabled() {
  const players = [];
  const host = await createRoom('P1');
  players.push(host);
  for (let i = 2; i <= 6; i++) {
    const p = await joinRoom(host.roomCode, 'P' + i);
    players.push(p);
  }

  const roles = { Godfather: true, Coward: true, Farmer: true, NavySeal: true, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false };
  const gsPromises = players.map(p => once(p.ws, m => m.type === 'gameState' || m.type === 'error'));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0, roles });
  const results = await Promise.all(gsPromises);
  results.forEach(r => assert(r.type === 'gameState', 'start with Coward/Farmer/NavySeal enabled succeeds (got ' + r.type + (r.message ? ': ' + r.message : '') + ')'));

  const seenRoles = new Set(results.map(r => r.view && r.view.myRole).filter(Boolean));
  ['Godfather', 'Coward', 'Farmer', 'NavySeal'].forEach(r => {
    assert(seenRoles.has(r), 'custom-enabled role ' + r + ' actually appears in the assigned pool (all 6 seats were real players, so this is exhaustive)');
  });

  players.forEach(p => p.ws.close());
}

// ============================================================
// Task 3: public rooms + quick_match, private-by-code join, and
// host-kick - all against a room that has real game state attached.
// ============================================================
async function testQuickMatchAndPrivateJoin() {
  const pub = await createRoom('PubHost', true);
  const priv = await createRoom('PrivHost', false);

  const qm = await connect();
  send(qm, { type: 'quick_match', name: 'Wanderer' });
  const qmJoined = await once(qm, m => m.type === 'joined');
  assert(qmJoined.roomCode === pub.roomCode, 'quick_match joins the existing PUBLIC open room rather than creating a new one');
  assert(qmJoined.roomCode !== priv.roomCode, 'quick_match never matches into a private (non-public) room');

  const qm2 = await connect();
  send(qm2, { type: 'quick_match', name: 'Wanderer2' });
  const qm2Result = await once(qm2, m => m.type === 'joined' || m.type === 'created');
  assert(qm2Result.type === 'joined' && qm2Result.roomCode === pub.roomCode, 'a second quick_match also lands in the same still-open public room');

  const directJoin = await joinRoom(priv.roomCode, 'InvitedFriend');
  assert(!directJoin.error && directJoin.roomCode === priv.roomCode, 'joining a private room directly by its code still works');

  pub.ws.close(); qm.close(); qm2.close(); priv.ws.close(); directJoin.ws.close();
}

async function testQuickMatchSkipsStartedRoom() {
  const pub = await createRoom('StartedHost', true);
  const p2 = await joinRoom(pub.roomCode, 'P2');
  const p3 = await joinRoom(pub.roomCode, 'P3');
  const p4 = await joinRoom(pub.roomCode, 'P4');
  const p5 = await joinRoom(pub.roomCode, 'P5');
  const p6 = await joinRoom(pub.roomCode, 'P6');
  const started = Promise.all([pub, p2, p3, p4, p5, p6].map(p => once(p.ws, m => m.type === 'gameState')));
  send(pub.ws, { type: 'start', playerCount: 8, mafiaCount: 1 });
  await started;

  const qm = await connect();
  send(qm, { type: 'quick_match', name: 'LateArrival' });
  const result = await once(qm, m => m.type === 'joined' || m.type === 'created');
  assert(result.type === 'created' && result.roomCode !== pub.roomCode, 'quick_match reuses the started flag correctly: an already-started public room is skipped and a fresh one is created instead');

  [pub, p2, p3, p4, p5, p6].forEach(p => p.ws.close());
  qm.close();
}

async function testHostKickDuringActiveGame() {
  const host = await createRoom('KickHost');
  const players = [host];
  for (let i = 2; i <= 6; i++) players.push(await joinRoom(host.roomCode, 'K' + i));

  const started = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
  send(host.ws, { type: 'start', playerCount: 8, mafiaCount: 1 });
  const gsResults = await started;

  const victim = players[1];
  const kickedMsg = once(victim.ws, m => m.type === 'kicked');
  send(host.ws, { type: 'kick', targetId: victim.playerId, reason: 'other', note: 'test' });
  const kicked = await kickedMsg;
  assert(!!kicked, 'the kicked player receives a kicked notification');

  // With the victim gone, everyone else submitting a no-op night action should
  // now resolve the round early instead of waiting on the removed player.
  const remaining = players.filter(p => p !== victim);
  const resolved = Promise.all(remaining.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 8000)));
  remaining.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  const start = Date.now();
  await resolved;
  const elapsed = Date.now() - start;
  assert(elapsed < 5000, 'the room resolves promptly after a host-kick during an active game instead of waiting out the full night timer (took ' + elapsed + 'ms)');

  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// Task 2: a disconnected human stops blocking resolution, and
// their fallback night action is real (not {}).
// ============================================================
async function testDisconnectFallback() {
  const MAX_ATTEMPTS = 15;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const host = await createRoom('D1');
    const players = [host];
    for (let i = 2; i <= 7; i++) players.push(await joinRoom(host.roomCode, 'D' + i));

    const roles = Object.assign({}, require('./game.js').DEFAULT_ROLES_CONFIG);
    const started = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
    send(host.ws, { type: 'start', playerCount: 7, mafiaCount: 0, roles });
    const gsResults = await started;

    const detectiveIdx = gsResults.findIndex(r => r.view.myRole === 'Detective');
    if (detectiveIdx === -1) {
      players.forEach(p => p.ws.close());
      continue; // the lone placeholder got Detective this shuffle - retry
    }

    const detective = players[detectiveIdx];
    const others = players.filter((_, i) => i !== detectiveIdx);

    // Everyone else submits a no-op action; the detective just vanishes.
    others.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
    const watcher = others[0];
    const resolvedPromise = once(watcher.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 8000);
    const start = Date.now();
    detective.ws.close();
    const resolved = await resolvedPromise;
    const elapsed = Date.now() - start;

    assert(elapsed < 5000, 'the room resolves promptly once the disconnected Detective was the only one left to act (took ' + elapsed + 'ms), instead of waiting out the full 60s night timer');

    // A Detective's investigate result is private (never in the public case
    // file - see game.js's detectiveLog), so the only way anyone outside the
    // Detective's own gone socket can confirm the fallback action actually
    // fired is server-internal introspection (see server.js's module.exports).
    const room = require('./server.js').rooms[host.roomCode];
    assert(room.state.detectiveLog.length > 0, 'the disconnected Detective still got a real fallback investigate action recorded (in the private detectiveLog), not an empty {} action');

    others.forEach(p => { try { p.ws.close(); } catch (e) {} });
    return;
  }
  assert(false, 'could not get a real player assigned Detective after ' + MAX_ATTEMPTS + ' attempts (bad luck or a real regression)');
}

// ============================================================
// A socket that creates/joins/quick-matches a second time without ever
// sending 'leave' first must not leave a phantom entry behind in its old
// room - the server should clean that room up as if they'd left properly.
// ============================================================
async function testCreateWithoutLeavingCleansUpOldRoom() {
  const host = await createRoom('PH-Lead');
  const other = await joinRoom(host.roomCode, 'PH-Other');

  const rosterAfterLeave = once(other.ws, m => m.type === 'roster' && m.players.length === 1, 3000);
  send(host.ws, { type: 'create', name: 'PH-Lead2', isPublic: false });
  const created2 = await once(host.ws, m => m.type === 'created');
  assert(created2.roomCode !== host.roomCode, 'sending a second create gives back a brand new room code');

  const rosterUpdate = await rosterAfterLeave;
  assert(rosterUpdate.players.length === 1 && rosterUpdate.players[0].name === 'PH-Other', 'the old room\'s remaining player sees the phantom entry cleaned up (roster drops to just them), not left stuck at 2 forever');

  host.ws.close(); other.ws.close();
}

// ============================================================
// Task 10: confirm real multi-client roster sync - an EXISTING client (not
// just the one joining) receives an updated roster broadcast when someone
// else joins or leaves the room.
// ============================================================
async function testRosterSyncsToExistingClients() {
  const host = await createRoom('RS-Lead');
  const rosterOnJoin = once(host.ws, m => m.type === 'roster' && m.players.length === 2, 3000);
  const p2 = await joinRoom(host.roomCode, 'RS-P2');
  const hostSawJoin = await rosterOnJoin;
  assert(hostSawJoin.players.some(p => p.name === 'RS-P2'), 'the HOST\'s existing connection (not just the joining client) receives an updated roster when a second real player joins');

  const rosterOnLeave = once(host.ws, m => m.type === 'roster' && m.players.length === 1, 3000);
  send(p2.ws, { type: 'leave' });
  const hostSawLeave = await rosterOnLeave;
  assert(hostSawLeave.players.length === 1 && hostSawLeave.players[0].name === 'RS-Lead', 'the HOST\'s existing connection also receives an updated roster when another real player leaves');

  host.ws.close(); p2.ws.close();
}


// ============================================================
// Task 7: mafia-only chat is scoped strictly to align==='mafia' players -
// two mafia-aligned humans can message each other privately during the
// night phase, and a town-aligned human in the same room gets nothing.
// ============================================================
async function testMafiaChatScoping() {
  const MAX_ATTEMPTS = 20;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const host = await createRoom('MC1');
    const players = [host];
    for (let i = 2; i <= 9; i++) players.push(await joinRoom(host.roomCode, 'MC' + i));

    // mafiaCount:2 on top of Godfather+DoubleAgent gives 4 mafia-aligned seats
    // out of 9 real players - decent odds at least 2 real players land mafia.
    // (7 default special roles + 2 mafia = 9 seats needed exactly.)
    const roles = Object.assign({}, require('./game.js').DEFAULT_ROLES_CONFIG);
    const started = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
    send(host.ws, { type: 'start', playerCount: 9, mafiaCount: 2, roles });
    const gsResults = await started;

    const mafiaIdxs = gsResults.map((r, i) => r.view.myAlign === 'mafia' ? i : -1).filter(i => i !== -1);
    const townIdx = gsResults.findIndex(r => r.view.myAlign !== 'mafia');
    if (mafiaIdxs.length < 2 || townIdx === -1) {
      players.forEach(p => { try { p.ws.close(); } catch (e) {} });
      continue; // didn't land 2+ real mafia players and 1+ real town player this shuffle - retry
    }

    const mafiaA = players[mafiaIdxs[0]];
    const mafiaB = players[mafiaIdxs[1]];
    const townC = players[townIdx];

    // The town player listens for ANY message for a short window - if a
    // mafiaChatMsg leaks to them, this promise resolves and the test fails.
    let townLeakSeen = null;
    const townListener = (raw) => { const m = JSON.parse(raw); if (m.type === 'mafiaChatMsg') townLeakSeen = m; };
    townC.ws.on('message', townListener);

    const bReceivedPromise = once(mafiaB.ws, m => m.type === 'mafiaChatMsg', 5000);
    send(mafiaA.ws, { type: 'mafiaChat', text: 'kill the detective tonight' });
    const bReceived = await bReceivedPromise;
    assert(bReceived.text === 'kill the detective tonight' && bReceived.playerId === mafiaA.playerId, 'a mafia-aligned player receives a private mafiaChat message from their teammate');

    await new Promise(r => setTimeout(r, 300));
    townC.ws.off('message', townListener);
    assert(!townLeakSeen, 'a town-aligned player in the same room receives nothing from the mafia chat channel');

    players.forEach(p => { try { p.ws.close(); } catch (e) {} });
    return;
  }
  assert(false, 'could not get 2+ real mafia-aligned players and 1+ real town player after ' + MAX_ATTEMPTS + ' attempts (bad luck or a real regression)');
}

// ============================================================
// Task 18: a dayChat message optionally tagged with a targetId broadcasts
// that tag to the room (purely mechanical accusation tracking, no LLM), and
// a message "tagged" at the sender's own id is not treated as self-accusation.
// ============================================================
async function testDayChatAccusationTag() {
  const host = await createRoom('DC1');
  const p2 = await joinRoom(host.roomCode, 'DC2');
  const players = [host, p2];

  const initialProgress = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0, roles: { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false } });
  await initialProgress;

  const resolvedPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 8000)));
  players.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  await resolvedPromise;

  const p2ReceivedPromise = once(p2.ws, m => m.type === 'chatMsg' && m.text === 'I think it was you');
  send(host.ws, { type: 'dayChat', text: 'I think it was you', targetId: p2.playerId });
  const p2Received = await p2ReceivedPromise;
  assert(p2Received.targetId === p2.playerId, 'a dayChat message tagged with a target id broadcasts that tag to every player in the room');

  const selfTagPromise = once(p2.ws, m => m.type === 'chatMsg' && m.text === 'talking to myself');
  send(host.ws, { type: 'dayChat', text: 'talking to myself', targetId: host.playerId });
  const selfTagResult = await selfTagPromise;
  assert(selfTagResult.targetId === null, 'a dayChat message tagged with the sender\'s own id is not treated as a self-accusation');

  host.ws.close(); p2.ws.close();
}

// ============================================================
// Task 20: after a round fully resolves, every real player gets their OWN
// roundScore message - two different players (the one who correctly voted
// out the mafia player, and the mafia player who was eliminated) see two
// different, individually correct breakdowns for the very same round.
// ============================================================
async function testRoundScoreBreakdown() {
  const host = await createRoom('RS1');
  const players = [host];
  for (let i = 2; i <= 6; i++) players.push(await joinRoom(host.roomCode, 'RS' + i));

  // All 6 seats are real players and mafiaCount:1 with every other special
  // role disabled, so the role pool is deterministic: exactly one Mafia and
  // five Civilians, no placeholders, no shuffle-dependent retry needed.
  const roles = { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false };
  const started = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 1, roles });
  const gsResults = await started;

  const mafiaIdx = gsResults.findIndex(r => r.view.myAlign === 'mafia');
  const townIdx = gsResults.findIndex(r => r.view.myAlign !== 'mafia');
  const mafiaPlayer = players[mafiaIdx];
  const townPlayers = players.filter((p, i) => i !== mafiaIdx);

  // Night: nobody has anything meaningful to submit (no Doctor/Detective/etc
  // enabled) - everyone just passes so the round resolves immediately.
  const voteReachedPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-vote', 8000)));
  players.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  await voteReachedPromise;

  // Every town player correctly votes out the mafia player; the mafia player
  // votes for an arbitrary town player right back (irrelevant to the outcome).
  const roundScorePromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'roundScore', 10000)));
  townPlayers.forEach(p => send(p.ws, { type: 'dayVote', targetId: mafiaPlayer.playerId }));
  send(mafiaPlayer.ws, { type: 'dayVote', targetId: townPlayers[0].playerId });
  const scores = await roundScorePromise;

  const mafiaScore = scores[mafiaIdx];
  const townScore = scores[townIdx];
  assert(mafiaScore.type === 'roundScore' && townScore.type === 'roundScore', 'Task20: every real player receives their own roundScore message once the round resolves');
  assert(townScore.total > 0 && townScore.breakdown.some(b => b.rule === 'town-baseline'), 'Task20: the town player who correctly voted out the mafia player sees a positive breakdown crediting the correct vote, not just a bare number');
  assert(!mafiaScore.breakdown.some(b => b.rule === 'town-baseline'), 'Task20: the eliminated mafia player\'s own breakdown never claims credit for the town-baseline rule');
  assert(JSON.stringify(mafiaScore.breakdown) !== JSON.stringify(townScore.breakdown), 'Task20: two different players in the same room see two different breakdowns for the very same round, not a shared/identical one');

  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// "Play Again": same room/host/players, last game's presets carried over,
// and a genuine second game can be started afterward. Only the host may
// trigger it - a non-host's attempt is rejected, not silently honored.
// ============================================================
async function testPlayAgainSameLobby() {
  const host = await createRoom('PA1');
  const players = [host];
  for (let i = 2; i <= 6; i++) players.push(await joinRoom(host.roomCode, 'PA' + i));

  const roles = { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false };
  const started = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 1, roles });
  const gsResults = await started;

  const mafiaIdx = gsResults.findIndex(r => r.view.myAlign === 'mafia');
  const mafiaPlayer = players[mafiaIdx];
  const townPlayers = players.filter((p, i) => i !== mafiaIdx);
  // Guaranteed non-host regardless of where the shuffle put the mafia role -
  // `host` (players[0]) is the room's real host for the whole test, so any
  // OTHER player id is unambiguously a non-host. townPlayers[0] alone isn't
  // safe here: if the mafia role landed on someone other than the host,
  // townPlayers[0] IS the host, and the "non-host rejected" check below
  // would silently exercise the host's own (successful) request instead.
  const nonHostPlayer = players.find(p => p.playerId !== host.playerId);

  const voteReachedPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-vote', 8000)));
  players.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  await voteReachedPromise;

  // Every town player votes out the mafia player - a deterministic town win
  // in round 1, so the game reaches gameOver without depending on chance.
  const gameOverPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.gameOver, 8000)));
  townPlayers.forEach(p => send(p.ws, { type: 'dayVote', targetId: mafiaPlayer.playerId }));
  send(mafiaPlayer.ws, { type: 'dayVote', targetId: townPlayers[0].playerId });
  await gameOverPromise;

  const rejectPromise = once(nonHostPlayer.ws, m => m.type === 'error', 3000);
  send(nonHostPlayer.ws, { type: 'playAgain' });
  const rejection = await rejectPromise;
  assert(/only the host/i.test(rejection.message || ''), 'Task-PlayAgain: a non-host sending playAgain is rejected with a clear error, not silently honored');

  const returnPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'returnToLobby', 5000)));
  send(host.ws, { type: 'playAgain' });
  const returns = await returnPromise;
  assert(returns.every(r => r.roomCode === host.roomCode), 'Task-PlayAgain: every player is returned to the SAME room, not a new one');
  assert(returns.every(r => r.config && r.config.playerCount === 6 && r.config.mafiaCount === 1), 'Task-PlayAgain: the returned config matches the game that just ended (same presets)');

  const restarted = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState', 5000)));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 1, roles });
  const restartedResults = await restarted;
  assert(restartedResults.every(r => r.view.phase === 'night' && r.view.night === 1), 'Task-PlayAgain: the same host can genuinely start a fresh second game (night 1) in the same room afterward');

  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// PREBETA Task 9: ghost chat. A private channel for eliminated players,
// persisting for the rest of the game (not scoped to a single phase the way
// whisper is day-vote-only). Scoped strictly by CURRENT alive status, both
// on send and on broadcast - never reaches a living player under any
// circumstance, including one deliberately watching raw socket traffic.
// ============================================================
async function testGhostChatScoping() {
  const host = await createRoom('GC1');
  const players = [host];
  for (let i = 2; i <= 6; i++) players.push(await joinRoom(host.roomCode, 'GC' + i));

  // All 6 seats are real players and mafiaCount:1 with every other special
  // role disabled - deterministic pool (one Mafia, five Civilians), no
  // placeholders, so who dies is fully under this test's control rather than
  // left to a placeholder's random pick.
  const roles = { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false };
  const started = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState')));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 1, roles });
  const gsResults = await started;

  const mafiaIdx = gsResults.findIndex(r => r.view.myAlign === 'mafia');
  const mafiaPlayer = players[mafiaIdx];
  const townPlayers = players.filter((p, i) => i !== mafiaIdx);

  // Night 1: the mafia player deliberately kills townPlayers[0] - a
  // controlled first death, not left to a placeholder's random pick.
  // Everyone else passes (no other role enabled has anything to submit).
  const voteReachedPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-vote', 8000)));
  send(mafiaPlayer.ws, { type: 'nightAction', action: { kill: townPlayers[0].playerId } });
  townPlayers.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  await voteReachedPromise;

  // Day 1: everyone still living votes out townPlayers[1] (not the mafia
  // player - eliminating the mafia here would end the game via a town win
  // before this test gets its second death). Now exactly two real players
  // are eliminated: townPlayers[0] (night) and townPlayers[1] (day-vote).
  const livingPlayers = players.filter(p => p.playerId !== townPlayers[0].playerId);
  const revealReachedPromise = Promise.all(livingPlayers.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-reveal', 8000)));
  livingPlayers.forEach(p => send(p.ws, { type: 'dayVote', targetId: townPlayers[1].playerId }));
  await revealReachedPromise;

  const ghostA = townPlayers[0]; // killed night 1
  const ghostB = townPlayers[1]; // voted out day 1
  const livingWitness = mafiaPlayer; // still alive, in the same room

  // The living witness listens for ANY message for a short window - if a
  // ghostChatMsg leaks to them, this promise fails the test below.
  let livingLeakSeen = null;
  const livingListener = (raw) => { const m = JSON.parse(raw); if (m.type === 'ghostChatMsg') livingLeakSeen = m; };
  livingWitness.ws.on('message', livingListener);

  const ghostBReceivedPromise = once(ghostB.ws, m => m.type === 'ghostChatMsg', 5000);
  send(ghostA.ws, { type: 'ghostChat', text: 'so who actually was the mafia' });
  const ghostBReceived = await ghostBReceivedPromise;
  assert(ghostBReceived.text === 'so who actually was the mafia' && ghostBReceived.playerId === ghostA.playerId, 'Task 9: another eliminated player in the same room receives a ghostChat message');

  await new Promise(r => setTimeout(r, 300));
  livingWitness.ws.off('message', livingListener);
  assert(!livingLeakSeen, 'Task 9: a living player in the same room, watching raw socket traffic, receives nothing from the ghost chat channel');

  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// A solo game (1 real player, the rest placeholders) has no other real
// player in room.players to keep the room alive while the lone human's
// socket is down - closing it (a refresh, a network blip, a dev-server
// restart) used to hit room.players.length===0 and delete the room
// outright, so a subsequent rejoin found nothing there and failed. A
// STARTED room must survive that and let the same seat rejoin, exactly
// like a disconnect in a room that still has other real players in it.
// ============================================================
async function testSoloDisconnectSurvivesRoom() {
  const host = await createRoom('Solo1');
  const roles = { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false };
  const started = once(host.ws, m => m.type === 'gameState');
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 1, roles });
  await started;

  send(host.ws, { type: 'nightAction', action: {} });
  await once(host.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 8000);

  host.ws.close();
  await new Promise(r => setTimeout(r, 200)); // let the server's close handler actually run first

  const room = require('./server.js').rooms[host.roomCode];
  assert(!!room, 'a solo started room is NOT deleted just because its one real player disconnected');

  const ws2 = await connect();
  // Both listeners attached before sending - 'rejoined' and the gameState
  // it triggers are sent back-to-back server-side and can arrive in the
  // same batch, so waiting for them one at a time risks the second
  // `once()` attaching its listener after that message already fired.
  const rejoinedPromise = once(ws2, m => m.type === 'rejoined' || m.type === 'rejoinFailed', 3000);
  const gsPromise = once(ws2, m => m.type === 'gameState', 3000);
  send(ws2, { type: 'rejoin', roomCode: host.roomCode, playerId: host.playerId, name: 'Solo1' });
  const rejoinMsg = await rejoinedPromise;
  assert(rejoinMsg.type === 'rejoined', 'the same seat can rejoin the still-alive room after the drop, instead of getting "room no longer exists"');

  const gs = await gsPromise;
  assert(gs.view.phase === 'day-discuss', 'the rejoined player sees the game exactly where it was (still day-discuss), not a reset game');

  try { ws2.close(); } catch (e) {}
}

// ============================================================
// Day chat: the server files accusations from what people actually TYPE
// (no dropdown tag needed), and a short "I agree" reply to someone's
// accusation files the replier against the same target - both end up in
// accusationLog, and the chat entries carry the target for the
// Accusations tab.
// ============================================================
async function testDayChatInferredAccusationAndAgreement() {
  const host = await createRoom('Zed Quill');
  const p2 = await joinRoom(host.roomCode, 'Nan Rowe');
  const players = [host, p2];
  const roles = { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false };
  const startedPromise = once(host.ws, m => m.type === 'gameState');
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0, roles });
  const gs = await startedPromise;
  const target = gs.view.players.find(p => p.id !== host.playerId && p.id !== p2.playerId);

  const resolvedPromise = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 8000)));
  players.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  await resolvedPromise;

  const accusation = "I think it's " + target.name;
  const p2SeesAccusation = once(p2.ws, m => m.type === 'chatMsg' && m.text === accusation);
  send(host.ws, { type: 'dayChat', text: accusation });
  const seen = await p2SeesAccusation;
  assert(seen.category === 'accusation' && seen.targetId === target.id && seen.inferred === true, 'a typed "I think it\'s <name>" with no dropdown tag is filed as an accusation naming that player');

  const hostSeesAgree = once(host.ws, m => m.type === 'chatMsg' && m.text === 'I agree');
  send(p2.ws, { type: 'dayChat', text: 'I agree', replyTo: { name: 'Zed Quill', text: accusation } });
  const agree = await hostSeesAgree;
  assert(agree.category === 'accusation' && agree.targetId === target.id && agree.agreedWithId === host.playerId, 'replying "I agree" to that accusation files the replier as accusing the same player too');

  const room = require('./server.js').rooms[host.roomCode];
  const accusers = room.state.accusationLog.filter(a => a.targetId === target.id).map(a => a.accuserId).sort();
  assert(accusers.length === 2 && accusers.join() === [host.playerId, p2.playerId].sort().join(), 'both the original accuser and the agreeing player appear in accusationLog against that target');

  const hostSeesNoise = once(host.ws, m => m.type === 'chatMsg' && m.text === 'nice weather');
  send(p2.ws, { type: 'dayChat', text: 'nice weather' });
  const noise = await hostSeesNoise;
  assert(!noise.targetId && noise.category !== 'accusation', 'an ordinary line files nothing');

  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// Night: nothing about progress is revealed - a "N of M have decided" count
// let anyone work out how many players still had a night action to take
// (i.e. how many important roles were left).
// ============================================================
async function testNightProgressHidden() {
  const host = await createRoom('NP1');
  const p2 = await joinRoom(host.roomCode, 'NP2');
  const players = [host, p2];
  let leaked = null;
  players.forEach(p => p.ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'nightProgress') leaked = m; }));
  const started = once(host.ws, m => m.type === 'gameState');
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0, roles: { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false } });
  await started;
  send(host.ws, { type: 'nightAction', action: {} });
  await new Promise(r => setTimeout(r, 400));
  assert(leaked === null, 'no night progress/count message is ever sent to anyone, even right after one player has decided');
  const resolved = once(p2.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 5000);
  send(p2.ws, { type: 'nightAction', action: {} });
  await resolved;
  assert(leaked === null, 'the night still ends the moment everyone has decided, with no progress message along the way');
  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// Names: no pronoun/stand-in names, and "Host"/"Owner" can't be typed in to
// pose as the server's badges. Host/Owner flags come only from the server.
// ============================================================
async function testNamesAndBadges() {
  async function nameAs(raw, ownerKey) {
    const ws = await connect();
    send(ws, { type: 'create', name: raw, ownerKey });
    const roster = await once(ws, m => m.type === 'roster');
    const me = roster.players[0];
    ws.close();
    await new Promise(r => setTimeout(r, 30));
    return me;
  }
  assert(/^Player \d{3}$/.test((await nameAs('You')).name), 'the name "You" is replaced, not allowed');
  assert(/^Player \d{3}$/.test((await nameAs('he')).name), 'the name "he" is replaced');
  assert(/^Player \d{3}$/.test((await nameAs('No One')).name), 'the name "No One" is replaced');
  assert((await nameAs('You')).shame === 'Nameless', 'trying a banned pronoun name earns the "Nameless" Tag of Shame');
  assert((await nameAs('Bob Host')).shame === 'Poser', 'trying to fake a Host/Owner badge in a name earns the "Poser" tag');
  const ghost = await nameAs('Ghost');
  assert(ghost.name === 'Ghost' && ghost.shame === null, 'a name merely CONTAINING the letters "host" ("Ghost") is fine - no change, no shame');
  assert((await nameAs('Alice')).name === 'Alice' && (await nameAs('Alice')).shame === null, 'an ordinary name is untouched and earns no tag');
  assert((await nameAs('Bob Host')).name === 'Bob', 'typing "Host" after a name strips it so nobody can pose as the host');
  assert((await nameAs('[HOST] Zed')).name === 'Zed', 'a bracketed [HOST] tag in a name is stripped');
  const pierce = await nameAs('Pierce');
  assert(pierce.isOwner === true && pierce.isHost === true, 'the username Pierce is flagged Owner (and as host of the room they made)');
  const alice = await nameAs('Alice');
  assert(alice.isOwner === false && alice.isHost === true, 'a normal player who creates a room is Host but not Owner');
  process.env.OWNER_KEY = 'secret-key';
  const fake = await nameAs('Pierce');
  const real = await nameAs('Pierce', 'secret-key');
  delete process.env.OWNER_KEY;
  assert(fake.isOwner === false, 'with OWNER_KEY set on the server, typing the name Pierce alone does not earn the Owner badge');
  assert(real.isOwner === true && real.name === 'Pierce', 'with OWNER_KEY set, Pierce presenting the right key does, under the real name');
  assert(fake.shame === 'Impostor', 'with OWNER_KEY set, copying the owner\'s name earns the "Impostor" tag');
  assert(fake.name === 'Pierce 2', 'with OWNER_KEY set, the owner\'s name is reserved: a copy without the code is visibly different ("Pierce 2")');
}

// ============================================================
// Stage: the 30s turn clock applies to EVERYONE promoted from the queue while
// others are still waiting, not only the first speaker.
// ============================================================
async function testStageTimerOnPromotedSpeaker() {
  const host = await createRoom('Stg1');
  const p2 = await joinRoom(host.roomCode, 'Stg2');
  const p3 = await joinRoom(host.roomCode, 'Stg3');
  const players = [host, p2, p3];
  const roles = { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false };
  const started = once(host.ws, m => m.type === 'gameState');
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0, roles, voiceEnabled: true });
  await started;
  const day = Promise.all(players.map(p => once(p.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 8000)));
  players.forEach(p => send(p.ws, { type: 'nightAction', action: {} }));
  await day;

  send(host.ws, { type: 'joinQueue' });
  await once(p3.ws, m => m.type === 'stageState' && m.speakerId === host.playerId, 3000);
  send(p2.ws, { type: 'joinQueue' });
  const firstTimed = await once(p3.ws, m => m.type === 'stageState' && m.speakerId === host.playerId && m.turnDeadline, 3000);
  assert(!!firstTimed.turnDeadline, 'the first speaker is timed once someone is waiting behind them');
  send(p3.ws, { type: 'joinQueue' });
  await new Promise(r => setTimeout(r, 150));
  const secondSpeaker = once(p3.ws, m => m.type === 'stageState' && m.speakerId === p2.playerId, 3000);
  send(host.ws, { type: 'leaveStage' });
  const next = await secondSpeaker;
  assert(next.turnDeadline && next.queue.length === 1, 'the next speaker, promoted from the queue with someone still waiting, gets their own 30s clock');
  players.forEach(p => { try { p.ws.close(); } catch (e) {} });
}

// ============================================================
// The owner (verified by OWNER_KEY) can hang / lift the Tag of Shame on others.
// ============================================================
async function testOwnerCanShame() {
  process.env.OWNER_KEY = 'shame-key';
  try {
    const owner = await createRoomAs('Pierce', 'shame-key');
    const zed = await joinRoom(owner.roomCode, 'Zed');
    function rosterWith(ws, pred) { return once(ws, m => m.type === 'roster' && pred(m), 3000); }
    const shamed = rosterWith(zed.ws, m => m.players.some(p => p.name === 'Zed' && p.shame === 'Scoundrel'));
    send(owner.ws, { type: 'shame', targetId: zed.playerId });
    const r1 = await shamed;
    assert(r1.players.find(p => p.name === 'Zed').shame === 'Scoundrel', 'the verified owner can apply the Tag of Shame to another player in the lobby');
    assert(r1.ownerPowers === true, 'the roster tells clients owner powers are active (OWNER_KEY configured)');

    const errPromise = once(zed.ws, m => m.type === 'error', 2000);
    send(zed.ws, { type: 'shame', targetId: owner.playerId });
    const err = await errPromise;
    assert(/verified owner/i.test(err.message), 'an ordinary player cannot apply the tag - they are told only the owner can');

    const pardoned = rosterWith(owner.ws, m => m.players.some(p => p.name === 'Zed' && p.shame === null));
    send(owner.ws, { type: 'shame', targetId: zed.playerId, on: false });
    await pardoned;
    assert(true, 'the owner can lift the tag again');
    owner.ws.close(); zed.ws.close();
  } finally { delete process.env.OWNER_KEY; }

  // Without OWNER_KEY the name "Pierce" alone must NOT grant moderation power.
  const nameOnly = await createRoomAs('Pierce', '');
  const bob = await joinRoom(nameOnly.roomCode, 'Bob');
  const refused = once(nameOnly.ws, m => m.type === 'error', 2000);
  send(nameOnly.ws, { type: 'shame', targetId: bob.playerId });
  assert(/verified owner/i.test((await refused).message), 'with no OWNER_KEY configured, typing the name Pierce does not unlock owner powers');
  nameOnly.ws.close(); bob.ws.close();
}
async function createRoomAs(name, ownerKey) {
  const ws = await connect();
  send(ws, { type: 'create', name, ownerKey });
  const created = await once(ws, m => m.type === 'created');
  return { ws, roomCode: created.roomCode, playerId: created.playerId };
}

async function main() {
  await testUndercapacityStartRejected();
  await testCustomRolesEnabled();
  await testQuickMatchAndPrivateJoin();
  await testQuickMatchSkipsStartedRoom();
  await testHostKickDuringActiveGame();
  await testDisconnectFallback();
  await testCreateWithoutLeavingCleansUpOldRoom();
  await testRosterSyncsToExistingClients();
  await testMafiaChatScoping();
  await testNightProgressHidden();
  await testNamesAndBadges();
  await testOwnerCanShame();
  await testStageTimerOnPromotedSpeaker();
  await testDayChatAccusationTag();
  await testRoundScoreBreakdown();
  await testPlayAgainSameLobby();
  await testGhostChatScoping();
  await testSoloDisconnectSurvivesRoom();
  await testDayChatInferredAccusationAndAgreement();

  console.log('\n' + (failures === 0 ? 'All server.js integration checks passed.' : failures + ' CHECK(S) FAILED.'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
