// Tests for Trap Run (public/trap-sim.js): physics, the traps, and a replay of a saved winning run for every level.
const fs = require('fs'), path = require('path');
const S = require('./public/trap-sim.js');
let failed = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failed++; process.exitCode = 1; } else console.log('ok - ' + msg); }
function run(st, frames, inp) { for (let i = 0; i < frames && !st.dead && !st.done; i++) { S.step(st, inp || {}); st.events.length = 0; } }
function at(li, tileX, row) { const st = S.createRun(li); st.px = tileX * S.TILE + 8; st.py = (row === undefined ? 12 : row) * S.TILE; st.cp = { x: st.px, y: st.py }; return st; }

{
  assert(S.LEVELS.length === 5, 'Levels: there are five levels');
  S.LEVELS.forEach((l, i) => assert(l.exit && l.cps.length >= 2 && l.h === S.ROWS, 'Levels: level ' + (i + 1) + ' has an exit and checkpoints'));
}
{
  const st = at(0, 5); run(st, 60, { r: 1 });
  assert(st.px > 5 * 16 + 8 + 60 && st.onGround, 'Physics: holding right runs along the ground');
  const j = at(0, 5); run(j, 3, {}); run(j, 10, { j: 1 });
  assert(j.py < 192 - 8 && !j.onGround, 'Physics: jumping leaves the ground');
  let peak = 192; for (let i = 0; i < 80; i++) { S.step(j, { j: 1 }); peak = Math.min(peak, j.py); }
  assert(192 - peak > 30 && 192 - peak < 45, 'Physics: a full jump clears two tiles but not three');
  const s = at(0, 5); run(s, 3, {}); run(s, 4, { j: 1 }); let peak2 = 192; for (let i = 0; i < 80; i++) { S.step(s, {}); peak2 = Math.min(peak2, s.py); }
  assert(192 - peak2 < 25, 'Physics: letting go early gives a short hop');
}
{
  const st = at(0, 12); run(st, 40, { r: 1 });
  assert(st.dead && st.deadMsg.length > 5, 'Traps: touching honest spikes is fatal and comes with a joke');
  const h = at(0, 19.3); run(h, 40, { r: 1 });
  assert(h.dead, 'Traps: hidden spikes grow under you as you run past');
  let cleared = false;
  for (let wait = 0; wait < 60 && !cleared; wait++) { const hs = at(0, 18.5); run(hs, wait, { r: 1 }); for (let i = 0; i < 90 && !hs.dead; i++) S.step(hs, { r: 1, j: 1 }); if (!hs.dead && hs.px > 25 * 16) cleared = true; }
  assert(cleared, 'Traps: ...but a well timed jump clears them');
  const v = at(0, 35.5); run(v, 120, { r: 1 }); assert(!v.dead, 'Traps: the vanishing bridge holds if you keep moving');
  const v2 = at(0, 36.5); run(v2, 80, {}); assert(v2.dead && v2.deadKind === 'pit', 'Traps: ...and lets go of you if you stand still');
  const f = at(0, 46.7); run(f, 70, { r: 1 }); assert(f.dead && f.deadKind === 'fall', 'Traps: a ceiling block drops on anyone who rushes under it');
  const w = at(0, 53); run(w, 200, { r: 1 }); assert(w.dead || w.px < 58 * 16, 'Traps: the fake exit is not an exit');
}
{
  const st = at(0, 29, 12); run(st, 5, {}); assert(st.cpIndex === 0, 'Checkpoints: touching a flag saves your place');
  st.dead = false; run(st, 200, { r: 1 }); S.respawn(st);
  assert(st.px === 29 * 16 + 8 && st.vx === 0 && !st.dead, 'Checkpoints: respawning puts you back at the flag');
  assert(st.traps.every(t => t.s === 0 || t.d.k === 'walker' || t.d.k === 'pad'), 'Checkpoints: and every trap is reset');
}
{
  const st = at(1, 63.2); run(st, 5, {}); run(st, 20, { r: 1 });
  assert(st.vy < -250 || st.dead, 'Springs: a pad throws you skyward (or into the spiked ceiling)');
  const lv = S.LEVELS[0]; const e = S.createRun(0); e.px = lv.exit.x * 16 + 8; e.py = lv.exit.y * 16; run(e, 3, {});
  assert(e.done, 'Exit: reaching the real door finishes the level');
}
{
  const file = path.join(__dirname, 'trap-solutions.json');
  const sol = JSON.parse(fs.readFileSync(file, 'utf8'));
  sol.forEach((s, li) => {
    const st = S.createRun(li); let ok = false;
    for (const [ai, n] of s.inputs) { const a = s.actions[ai]; for (let i = 0; i < n && !st.dead && !st.done; i++) { S.step(st, a); st.events.length = 0; } if (st.done) { ok = true; break; } if (st.dead) break; }
    assert(ok, 'Replay: a saved winning run still clears level ' + (li + 1) + ' (' + S.LEVELS[li].name + ')');
  });
}
console.log(failed ? '\n' + failed + ' check(s) failed.' : '\nAll trap-sim.js checks passed.');
