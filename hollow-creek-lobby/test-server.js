// Integration tests for server.js - drives the real server over real
// WebSocket connections (same pattern as game.js's own unit tests, but this
// one needs sockets since it's testing the protocol layer, not pure logic).
// Run with: node test-server.js

const path = require('path');
const WebSocket = require(path.join(__dirname, 'node_modules', 'ws'));

const PORT = 8098;
process.env.PORT = PORT;
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

async function main() {
  await testUndercapacityStartRejected();
  await testCustomRolesEnabled();
  await testQuickMatchAndPrivateJoin();
  await testQuickMatchSkipsStartedRoom();
  await testHostKickDuringActiveGame();
  await testDisconnectFallback();
  await testRosterSyncsToExistingClients();
  await testMafiaChatScoping();

  console.log('\n' + (failures === 0 ? 'All server.js integration checks passed.' : failures + ' CHECK(S) FAILED.'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
