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
  send(host.ws, { type: 'kick', targetId: victim.playerId });
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

    const investigated = (resolved.view.history || []).some(line => /investigated .+ and it read/i.test(line));
    assert(investigated, 'the disconnected Detective still got a real fallback investigate action recorded in history, not an empty {} action');

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
  const host = await createRoom('PH-Host');
  const other = await joinRoom(host.roomCode, 'PH-Other');

  const rosterAfterLeave = once(other.ws, m => m.type === 'roster' && m.players.length === 1, 3000);
  send(host.ws, { type: 'create', name: 'PH-Host2', isPublic: false });
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
  const host = await createRoom('RS-Host');
  const rosterOnJoin = once(host.ws, m => m.type === 'roster' && m.players.length === 2, 3000);
  const p2 = await joinRoom(host.roomCode, 'RS-P2');
  const hostSawJoin = await rosterOnJoin;
  assert(hostSawJoin.players.some(p => p.name === 'RS-P2'), 'the HOST\'s existing connection (not just the joining client) receives an updated roster when a second real player joins');

  const rosterOnLeave = once(host.ws, m => m.type === 'roster' && m.players.length === 1, 3000);
  send(p2.ws, { type: 'leave' });
  const hostSawLeave = await rosterOnLeave;
  assert(hostSawLeave.players.length === 1 && hostSawLeave.players[0].name === 'RS-Host', 'the HOST\'s existing connection also receives an updated roster when another real player leaves');

  host.ws.close(); p2.ws.close();
}

// ============================================================
// Task 11: live "still deciding" night-progress counter - updates the
// moment either of two real players submits, and never leaks identity
// or choice, only counts.
// ============================================================
async function testNightProgressCounter() {
  const host = await createRoom('NP1');
  const p2 = await joinRoom(host.roomCode, 'NP2');
  const players = [host, p2];

  const initialProgress = Promise.all(players.map(p => once(p.ws, m => m.type === 'nightProgress')));
  send(host.ws, { type: 'start', playerCount: 6, mafiaCount: 0, roles: { Godfather: false, DoubleAgent: false, Detective: false, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false } });
  const [initA, initB] = await initialProgress;
  assert(initA.submitted === 0 && initA.total === 2, 'night begins with a 0-of-2 progress broadcast (only the 2 real players count, not placeholders)');
  assert(Object.keys(initA).sort().join(',') === 'submitted,total,type', 'the nightProgress payload contains only counts and a type - no player id, name, or choice ever appears in it');

  const progressAfterOneSubmits = once(p2.ws, m => m.type === 'nightProgress' && m.submitted === 1);
  send(host.ws, { type: 'nightAction', action: {} });
  const afterOne = await progressAfterOneSubmits;
  assert(afterOne.submitted === 1 && afterOne.total === 2, 'the count updates the moment the FIRST of two real players submits, visible to the OTHER player');

  const resolved = once(p2.ws, m => m.type === 'gameState' && m.view.phase === 'day-discuss', 5000);
  send(p2.ws, { type: 'nightAction', action: {} });
  await resolved;

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

  const initialProgress = Promise.all(players.map(p => once(p.ws, m => m.type === 'nightProgress')));
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
  await testNightProgressCounter();
  await testDayChatAccusationTag();
  await testRoundScoreBreakdown();
  await testPlayAgainSameLobby();

  console.log('\n' + (failures === 0 ? 'All server.js integration checks passed.' : failures + ' CHECK(S) FAILED.'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
