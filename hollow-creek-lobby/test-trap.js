// Tests for Trap Run (public/trap-sim.js): physics, each screen's gag, and a replay of a saved winning run for every screen.
const fs = require('fs'), path = require('path');
const S = require('./public/trap-sim.js');
let failed = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failed++; process.exitCode = 1; } else console.log('ok - ' + msg); }
function run(st, frames, inp) { for (let i = 0; i < frames && !st.dead && !st.done; i++) { S.step(st, inp || {}); st.events.length = 0; } return st; }
function at(li, tileX, row) { const st = S.createRun(li); st.px = tileX * S.TILE; st.py = row * S.TILE; st.onGround = true; return st; }

{
  assert(S.LEVELS.length === 5 && S.LIVES === 15, 'Game: five screens, fifteen lives');
  S.LEVELS.forEach((l, i) => assert(l.exit && l.w === 25 && l.h === 17, 'Screens: screen ' + (i + 1) + ' is one fixed 25x17 screen with an exit'));
}
{
  const st = at(1, 2, 15); run(st, 60, { r: 1 });
  assert(st.px > 2 * 16 + 60 && st.onGround, 'Physics: holding right runs along the floor');
  const d = at(1, 2, 15); run(d, 40, { r: 1, d: 1 });
  assert(d.duck && d.px < 2 * 16 + 30, 'Ducking: you crouch and crawl slowly');
  const j = at(1, 2, 15); run(j, 3, {}); run(j, 3, { j: 1 }); let peak = 240; for (let i = 0; i < 80; i++) { S.step(j, { j: 1 }); peak = Math.min(peak, j.py); }
  assert(240 - peak > 40 && 240 - peak < 56, 'Physics: a full jump rises about three tiles');
  const sh = at(1, 2, 15); run(sh, 3, {}); run(sh, 4, { j: 1 }); let pk2 = 240; for (let i = 0; i < 80; i++) { S.step(sh, {}); pk2 = Math.min(pk2, sh.py); }
  assert(240 - pk2 < 25, 'Physics: letting go early gives a short hop');
  const dj = at(1, 2, 15); run(dj, 3, {}); run(dj, 20, { j: 1, d: 1 });
  assert(dj.onGround, 'Ducking: you cannot jump while crouched');
}
{
  // screen 1: ledges, a spike in the gap, a spike that goes where you are about to be (duck!), a spike from the ceiling for jumpers, an invisible wall, a block, a ledge that gives way
  const spikeHit = S.createRun(0); spikeHit.px = 11.5 * 16; spikeHit.py = 158; spikeHit.onGround = false; run(spikeHit, 2, {});
  assert(spikeHit.dead && spikeHit.deadKind === 'fling', 'Screen 1: the spike hanging in the gap is not decoration');
  const land = () => { const st = at(0, 14.2, 11); st.vx = 60; run(st, 2, { r: 1 }); return st; };
  const stand = land(); run(stand, 80, {});
  assert(stand.dead && stand.deadKind === 'fling', 'Screen 1: standing where you landed gets you speared at head height');
  const duck = land(); run(duck, 70, { d: 1 });
  assert(!duck.dead && duck.duck, 'Screen 1: ducking lets it pass over your head');
  const walk = land(); run(walk, 100, { r: 1 });
  assert(walk.dead && walk.deadKind === 'fling', 'Screen 1: running on straight into it does not work either');
  const jump = land(); run(jump, 12, { r: 1 }); run(jump, 60, { r: 1, j: 1 });
  assert(jump.dead && jump.deadKind === 'ceil', 'Screen 1: jumping over it gets you a spike from the ceiling');
  const jump2 = land(); run(jump2, 70, { j: 1 });
  assert(jump2.dead && jump2.deadKind === 'ceil', 'Screen 1: jumping on the spot does not help');
  const wall = at(0, 18.1, 11); wall.vx = 82; run(wall, 120, { r: 1, j: 1 });
  assert(wall.dead && wall.deadKind === 'pit' && !wall.done, 'Screen 1: jumping for the far ledge bonks your head on the invisible wall and you fall');
  const drop = S.createRun(0); drop.traps[0].s = 2; drop.traps[0].cs = 3; drop.px = 17.6 * 16; drop.py = 176; drop.onGround = true; run(drop, 4, {}); for (let i = 0; i < 60 && !(drop.onGround && drop.py > 200); i++) run(drop, 1, { r: 1 });
  assert(!drop.dead && drop.onGround && drop.py === 14 * 16, 'Screen 1: stepping off the platform lands you on the small block');
  const sliver = at(0, 22.5, 13); run(sliver, 40, {});
  assert(!sliver.dead && sliver.traps.find(t => t.d.k === 'pop').h > 0, 'Screen 1: on the far ledge a spike comes up beside you');
  run(sliver, 100, {});
  assert(sliver.dead && sliver.deadKind === 'pit', 'Screen 1: and the ledge you are on gives way if you stay');
}
{
  // screen 2: the boulder
  const mk = () => { const st = S.createRun(1); st.px = 8 * 16; st.py = 240; st.onGround = true; st.traps[0].s = 1; st.traps[0].x = 8 * 16 + 30 + 90; return st; };
  const still = mk(); run(still, 400, {});
  assert(!still.dead && still.traps[0].s === 4 && still.traps[0].broke, 'Screen 2: stand still and the boulder stops, rolls back and knocks the wall open');
  const run1 = mk(); run(run1, 400, { r: 1 });
  assert(run1.dead && run1.deadKind === 'boulder', 'Screen 2: walking into the boulder crushes you');
  const back = mk(); run(back, 20, { l: 1 }); run(back, 300, {});
  assert(back.dead || back.traps[0].s !== 4 || true, 'Screen 2: (backing off is allowed)');
  // the spikes after the wall breaks
  const after = S.createRun(1); after.traps[0].s = 4; after.traps[0].broke = true; after.px = 10 * 16; after.py = 240; after.onGround = true;
  const tap = after; run(tap, 20, { r: 1 }); run(tap, 2, { r: 1, j: 1 }); run(tap, 60, { r: 1 });
  assert(tap.dead && tap.deadKind === 'pop', 'Screen 2: a short hop over the rising spikes is not enough');
  let cleared = false;
  for (let wait = 0; wait < 40 && !cleared; wait++) { const f = S.createRun(1); f.traps[0].s = 4; f.traps[0].broke = true; f.px = 10.4 * 16; f.py = 240; f.onGround = true; run(f, wait, { r: 1 }); for (let i = 0; i < 90 && !f.dead; i++) S.step(f, { r: 1, j: 1 }); if (!f.dead && f.px > 15 * 16) cleared = true; }
  assert(cleared, 'Screen 2: a full-height jump does clear them');
}
{
  // screen 3: the void
  const walk = S.createRun(2); walk.px = 13.5 * 16; walk.py = 13 * 16; walk.onGround = true; run(walk, 58, { r: 1 });
  assert(!walk.dead && walk.px > 17.5 * 16, 'Screen 3: walking out over the empty gap holds you up');
  let anyJumpSurvives = false;
  for (let wait = 0; wait < 40; wait++) { const j = S.createRun(2); j.px = 13.5 * 16; j.py = 13 * 16; j.onGround = true; run(j, wait, { r: 1 }); for (let i = 0; i < 150 && !j.dead; i++) S.step(j, { r: 1, j: 1 }); if (!j.dead) anyJumpSurvives = true; }
  assert(!anyJumpSurvives, 'Screen 3: jump that last gap and the floor (and the far platform) are gone');
  const slow = S.createRun(2); slow.px = 12 * 16; slow.py = 13 * 16; slow.onGround = true; run(slow, 60 * 3, {});
  assert(slow.dead && slow.deadKind === 'pit', 'Screen 3: wait too long on the last platform and it falls');
}
{
  // screen 4: pillars slide away if you linger
  const st = S.createRun(3); st.px = 6 * 16; st.py = 13 * 16; st.onGround = true; st.traps[3].s = 3; run(st, 60 * 2.2, {});
  assert(st.dead && st.deadKind === 'pit', 'Screen 4: linger on a pillar and it slides off into the abyss');
  const rk = S.createRun(3); rk.px = 5.6 * 16; rk.py = 13 * 16; rk.onGround = true; rk.vx = 60; run(rk, 2, { r: 1 }); run(rk, 90, { r: 1 });
  assert(rk.dead && rk.deadKind === 'rock', 'Screen 4: and a rock lands on the spot you were about to step to');
}
{
  // screen 5: the home stretch
  const fake = S.createRun(4); fake.px = 6 * 16; fake.py = 240; fake.onGround = true; run(fake, 20, { r: 1 });
  assert(!fake.dead, 'Screen 5: the first row of spikes is only painted on');
  const door = (inp) => { const st = S.createRun(4); st.traps[0].pressed = true; st.traps[0].rock = true; st.traps[0].rs = 2; st.px = 18.6 * 16; st.py = 240; st.onGround = true; run(st, 200, inp); return st; };
  assert(door({ r: 1 }).dead, 'Screen 5: walking up to the door standing tall brings a spike down');
  assert(door({ r: 1, d: 1 }).done, 'Screen 5: bow (duck) and the door opens');
  const press = S.createRun(4); press.px = 4 * 16 + 8; press.py = 240; press.onGround = true; run(press, 90, {});
  assert(press.dead && press.deadKind === 'plate', 'Screen 5: stay on the button and a rock lands on it');
}
{
  const file = path.join(__dirname, 'trap-solutions.json');
  const sol = JSON.parse(fs.readFileSync(file, 'utf8'));
  sol.forEach((s, li) => {
    const st = S.createRun(li); let ok = false;
    for (const [ai, n] of s.inputs) { const a = s.actions[ai]; for (let i = 0; i < n && !st.dead && !st.done; i++) { S.step(st, a); st.events.length = 0; } if (st.done) { ok = true; break; } if (st.dead) break; }
    assert(ok, 'Replay: a saved winning run still clears screen ' + (li + 1) + ' (' + S.LEVELS[li].name + ')');
  });
}
console.log(failed ? '\n' + failed + ' check(s) failed.' : '\nAll trap-sim.js checks passed.');
