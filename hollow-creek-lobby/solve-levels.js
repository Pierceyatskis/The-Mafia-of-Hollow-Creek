// Finds (and saves) a winning input sequence for every Trap Run level, so the tests can replay them quickly.
// Run this again after editing a level: node solve-levels.js
const fs = require('fs'), path = require('path');
const S = require('./public/trap-sim.js');
const out = [];
for (let i = 0; i < S.LEVELS.length; i++) {
  const r = S.solve(i, { width: 500, perBucket: 8, macro: 6, maxFrames: 6000 });
  console.log((i + 1) + ' ' + S.LEVELS[i].name + ': ' + (r.ok ? 'solved in ' + r.frames + ' frames' : 'NOT SOLVED (' + r.reason + ')'));
  if (!r.ok) process.exitCode = 1;
  out.push(r.ok ? { actions: r.actions, inputs: r.inputs } : null);
}
fs.writeFileSync(path.join(__dirname, 'trap-solutions.json'), JSON.stringify(out));
