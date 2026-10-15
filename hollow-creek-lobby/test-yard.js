// Tests for the lobby yard mini-game simulation (yard.js, side view).
const Y = require('./yard.js');
let failed = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failed++; process.exitCode = 1; } else console.log('ok - ' + msg); }
function run(y, seconds) { for (let i = 0; i < Math.round(seconds * 30); i++) Y.step(y, 1 / 30); }
function mk(n) { const y = Y.createYard(); for (let i = 1; i <= n; i++) Y.join(y, 'p' + i, { name: 'P' + i, color: '#aa5522' }); return y; }
function put(p, x, face) { p.x = x; p.y = 0; p.vx = 0; p.vy = 0; p.kb = 0; p.face = face; }
let seq = 0; const act = (y, id) => Y.setInput(y, id, { mx: 0, act: ++seq });
const ko = (y, p) => { p.state = Y.STATE.ko; p.until = y.t + 20; };

{
  const y = mk(1); const a = y.players.get('p1');
  put(a, 60, 1); Y.setInput(y, 'p1', { mx: 1 }); run(y, 1);
  assert(a.x > 120 && a.x < 140, 'Walking: a held direction moves a player at a steady speed');
  Y.setInput(y, 'p1', { mx: 9 }); assert(a.mx === 1, 'Walking: input is clamped');
  Y.setInput(y, 'p1', { mx: -1 }); run(y, 10);
  assert(a.x >= Y.BOUNDS.x0 && a.face === -1, 'Walking: the world edge stops you and you face the way you walk');
  put(a, 100, 1); Y.setInput(y, 'p1', { mx: 0, jump: 1 }); run(y, 0.2);
  assert(a.y > 5, 'Jumping: a jump lifts you off the ground');
  run(y, 1.2);
  assert(a.y === 0, 'Jumping: and gravity brings you back down');
  Y.setInput(y, 'p1', { jump: 1 }); run(y, 0.2);
  assert(a.y === 0, 'Jumping: an old jump counter is not replayed');
}
{
  const y = mk(2); const a = y.players.get('p1'), b = y.players.get('p2');
  put(a, 100, 1); put(b, 112, 1);
  for (let i = 0; i < 4; i++) { run(y, 0.5); act(y, 'p1'); }
  assert(b.hits === 0 && b.state === Y.STATE.idle, 'Peace: punches do nothing outside the ring');
  put(a, 250, 1); put(b, 262, 1);
  run(y, 0.5); act(y, 'p1'); run(y, 0.05);
  assert(b.hits === 1, 'Brawl: a punch inside the ring lands');
  for (let i = 0; i < 2; i++) { run(y, 0.6); put(a, 250, 1); put(b, 262, 1); act(y, 'p1'); run(y, 0.05); }
  assert(b.state === Y.STATE.ko, 'Brawl: three punches knock a fighter out');
  put(a, 250, 1); put(b, 262, 1); b.state = Y.STATE.idle; b.hits = 0; b.y = 40; run(y, 0.01); b.y = 40; b.vy = 0;
  run(y, 0.5); b.y = 40; act(y, 'p1'); run(y, 0.01);
  assert(b.hits === 0, 'Brawl: a punch swings under someone who is high in the air');
}
{
  // grab and throw out over the ropes: streak + crown
  const y = mk(3); const a = y.players.get('p1'), b = y.players.get('p2'), c = y.players.get('p3');
  put(a, 334, 1); put(b, 340, 1); ko(y, b); put(c, 80, 1);
  act(y, 'p1'); run(y, 0.1);
  assert(b.state === Y.STATE.held && a.carrying === 'p2', 'Grab: a fighter can pick up someone who is knocked out');
  act(y, 'p1'); run(y, 1.2);
  assert(b.state === Y.STATE.out && !Y.inRing(b.x), 'Throw: landing outside the ring means you are out');
  assert(a.streak === 1 && a.wins === 1 && Y.crownId(y) === 'p1', 'Throw: the thrower gets a streak of 1 and the crown');
  assert(y.events.some(e => e.e === 'out' && e.id === 'p2' && e.by === 'p1'), 'Throw: an out event names who threw whom');
  run(y, 3);
  put(c, 334, 1); put(a, 340, 1); ko(y, a);
  act(y, 'p3'); run(y, 0.1); act(y, 'p3'); run(y, 1.2);
  assert(a.streak === 0 && c.streak === 1 && Y.crownId(y) === 'p3', 'Crown: getting thrown out resets your streak and the crown moves on');
}
{
  const y = mk(2); const a = y.players.get('p1'), b = y.players.get('p2');
  put(a, 236, 1); put(b, 240, 1); ko(y, b);
  act(y, 'p1'); run(y, 0.1); act(y, 'p1'); run(y, 1.2);
  assert(Y.inRing(b.x) && b.state === Y.STATE.ko && a.streak === 0, 'Throw: landing inside the ring keeps the fight going (no streak)');
}
{
  const y = mk(2); const a = y.players.get('p1'), b = y.players.get('p2');
  put(a, 244, 1); put(b, 250, 1); ko(y, b);
  act(y, 'p1'); run(y, 0.1);
  Y.leave(y, 'p1');
  assert(b.state === Y.STATE.ko && !y.players.has('p1'), 'Leaving: someone who is carried is set down, not stuck in the air');
  const w = mk(2); const p = w.players.get('p1'), q = w.players.get('p2'); put(p, 244, 1); put(q, 250, 1); ko(w, q);
  act(w, 'p1'); run(w, 0.1); run(w, 5.4);
  assert(q.state !== Y.STATE.held && !p.carrying, 'Holding: a carried player wriggles free after a few seconds');
}
{
  const y = mk(1); const a = y.players.get('p1');
  put(a, 120, 1); y.ball.x = 128; y.ball.y = 3; act(y, 'p1'); run(y, 0.3);
  assert(y.ball.x > 140, 'Ball: pressing the action button next to the ball kicks it');
  Y.setInput(y, 'p1', { emote: 'heart' }); run(y, 0.1);
  assert(Y.snapshot(y).players[0].e === 1, 'Emotes: an emote shows in the snapshot');
  run(y, 2.5);
  assert(Y.snapshot(y).players[0].e === undefined, 'Emotes: it clears after a couple of seconds');
  Y.setInput(y, 'p1', { emote: 'bogus' });
  assert(Y.snapshot(y).players[0].e === undefined, 'Emotes: unknown emotes are ignored');
}
{
  const y = Y.createYard(); let joined = 0;
  for (let i = 0; i < 20; i++) if (Y.join(y, 'x' + i, { name: 'X' })) joined++;
  assert(joined === Y.MAX_YARD_PLAYERS, 'Capacity: the yard holds at most 16 players');
}
console.log(failed ? '\n' + failed + ' check(s) failed.' : '\nAll yard.js checks passed.');
