// Lineup balance simulation: plays many bot games, giving every game a different random lineup
// (player count, mafia count, which special roles are in play), then reports which roles and role
// pairs push a team's win rate up or down compared with other games of the same size.
//   node sim-lineups.js [games=40000] [townSkill=0.2] [detectiveTrust=0.7]
// Bot model (a baseline, not real humans): town votes at random, except a non-mafia voter picks a living
// mafia member with probability townSkill (how well the table reads the room), and a living Detective's
// "guilty" results are believed with probability detectiveTrust. Mafia never vote for teammates. The
// Vigilante never fires (the game's own AI never fires it either). Read the numbers as "which roles help
// which side", not as exact real-world win rates.
const G = require('./game.js');
const GAMES = Number(process.argv[2]) || 40000;
const SKILL = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.2;
const TRUST = process.argv[4] !== undefined ? Number(process.argv[4]) : 0.7;
const ROLES = G.SPECIAL_ROLES.filter(r => r !== 'Mafia');
const TEAMS = ['town', 'mafia', 'cult', 'bounty'];
const rnd = n => Math.floor(Math.random() * n);

function randomLineup() {
  for (;;) {
    const n = 7 + rnd(10);                       // 7..16 players
    const roles = {};
    ROLES.forEach(r => { roles[r] = Math.random() < 0.45; });
    const mafiaCount = rnd(4);                   // 0..3 extra plain mafia
    const specials = ROLES.filter(r => roles[r]).length;
    if (specials + mafiaCount <= n) return { n, roles, mafiaCount };
  }
}

function playOne(lineup) {
  const seats = Array.from({ length: lineup.n }, (_, i) => ({ id: 'bot' + i, name: 'Bot ' + (i + 1) }));
  const state = G.createGame(seats, { playerCount: lineup.n, mafiaCount: lineup.mafiaCount, roles: lineup.roles });
  state.players.forEach(p => { p.isHuman = false; p.isPlaceholder = true; });
  const present = new Set(state.players.map(p => p.role));
  let rounds = 0;
  while (!state.gameOver && rounds < 60) {
    rounds++;
    G.resolveNight(state);
    if (state.gameOver) break;
    const alive = G.living(state);
    // names the detective has read as guilty (a living detective only)
    const detective = alive.find(p => p.role === 'Detective');
    const guiltyNames = new Set(detective ? state.detectiveLog.filter(e => e.read === 'guilty').map(e => e.name) : []);
    alive.forEach(p => {
      const options = alive.filter(q => q.id !== p.id && !(p.align === 'mafia' && q.align === 'mafia'));
      const pool = options.length ? options : alive.filter(q => q.id !== p.id);
      let target = null;
      if (p.align !== 'mafia') {
        const tip = pool.filter(q => guiltyNames.has(q.name));
        const mafia = pool.filter(q => q.align === 'mafia');
        if (tip.length && Math.random() < TRUST) target = tip[rnd(tip.length)];
        else if (mafia.length && Math.random() < SKILL) target = mafia[rnd(mafia.length)];
      }
      state.pendingDayVotes[p.id] = (target || pool[rnd(pool.length)]).id;
    });
    G.resolveDayVote(state);
    if (state.gameOver) break;
    G.startNextNight(state);
  }
  const mafiaTotal = state.players.filter(p => p.align === 'mafia').length;
  return { n: lineup.n, winner: state.winner || 'none', rounds, present: [...present], mafiaTotal };
}

const results = [];
for (let i = 0; i < GAMES; i++) results.push(playOne(randomLineup()));

const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
const signed = x => ((x >= 0 ? '+' : '') + (100 * x).toFixed(1)).padStart(6) + 'pp';
const rate = (rows, team) => rows.length ? rows.filter(r => r.winner === team).length / rows.length : 0;

// expected win rate for each team at each player count - lift is measured against this
const byN = {};
results.forEach(r => { (byN[r.n] = byN[r.n] || []).push(r); });
const base = {};
Object.keys(byN).forEach(n => { base[n] = {}; TEAMS.forEach(t => { base[n][t] = rate(byN[n], t); }); });
const lift = (rows, team) => rows.length ? rows.reduce((s, r) => s + ((r.winner === team ? 1 : 0) - base[r.n][team]), 0) / rows.length : 0;
const noise = (rows, team) => { const p = rate(rows, team); return rows.length ? 1.96 * Math.sqrt(p * (1 - p) / rows.length) : 1; };

console.log(`${GAMES} games, townSkill ${SKILL}, detectiveTrust ${TRUST}, random lineup every game\n`);
console.log('OVERALL   town', pct(rate(results, 'town')), ' mafia', pct(rate(results, 'mafia')), ' cult', pct(rate(results, 'cult')), ' bounty', pct(rate(results, 'bounty')), ' avg rounds', (results.reduce((s, r) => s + r.rounds, 0) / results.length).toFixed(1));
console.log('\nBY PLAYER COUNT');
Object.keys(byN).sort((a, b) => a - b).forEach(n => console.log(('  ' + n + ' players').padEnd(14), 'town', pct(base[n].town), ' mafia', pct(base[n].mafia), ' cult', pct(base[n].cult), ' bounty', pct(base[n].bounty), '  games', byN[n].length));
console.log('\nBY TOTAL MAFIA-ALIGNED PLAYERS IN THE GAME');
for (let m = 1; m <= 8; m++) {
  const rows = results.filter(r => r.mafiaTotal === m);
  if (rows.length > 200) console.log(('  ' + m + ' mafia').padEnd(14), 'town', pct(rate(rows, 'town')), ' mafia', pct(rate(rows, 'mafia')), '  games', rows.length);
}

// "lift" = how much more often a team wins in games containing X than in same-size games on average.
console.log('\nROLE EFFECT ON EACH TEAM  (percentage points vs. same-size games; * = beyond random noise)');
console.log('role'.padEnd(16), 'games'.padStart(6), '  town win'.padEnd(11), 'mafia win'.padEnd(11), 'cult win'.padEnd(10), 'bounty win');
const roleRows = ROLES.map(r => {
  const rows = results.filter(g => g.present.includes(r));
  const f = t => { const l = lift(rows, t); return signed(l) + (Math.abs(l) > noise(rows, t) ? '*' : ' '); };
  return { r, rows, town: lift(rows, 'town'), line: r.padEnd(16) + String(rows.length).padStart(6) + '  ' + f('town') + '  ' + f('mafia') + '  ' + f('cult') + '  ' + f('bounty') };
}).sort((a, b) => b.town - a.town);
roleRows.forEach(x => console.log(x.line));

const single = {};
roleRows.forEach(x => { single[x.r] = { town: x.town, mafia: lift(x.rows, 'mafia') }; });
const pairs = [];
for (let i = 0; i < ROLES.length; i++) for (let j = i + 1; j < ROLES.length; j++) {
  const rows = results.filter(g => g.present.includes(ROLES[i]) && g.present.includes(ROLES[j]));
  if (rows.length >= 600) pairs.push({ name: ROLES[i] + ' + ' + ROLES[j], rows, l: lift(rows, 'town'), synergy: lift(rows, 'town') - single[ROLES[i]].town - single[ROLES[j]].town });
}
const show = p => console.log('  ' + p.name.padEnd(30), 'together', signed(p.l), ' extra beyond the two alone', signed(p.synergy), ' games', p.rows.length);
console.log('\nROLE PAIRS - town win-rate change when both are in play, and the "extra" the pair adds beyond each role alone');
pairs.sort((a, b) => b.l - a.l);
console.log(' best pairs for town:'); pairs.slice(0, 6).forEach(show);
console.log(' worst pairs for town:'); pairs.slice(-6).reverse().forEach(show);
pairs.sort((a, b) => b.synergy - a.synergy);
console.log(' pairs that work better together than apart (town):'); pairs.slice(0, 6).forEach(show);
console.log(' pairs that cancel each other out (town):'); pairs.slice(-6).reverse().forEach(show);

const withCult = results.filter(g => g.present.includes('CultLeader'));
console.log('\nWHEN A CULT LEADER IS IN PLAY (' + withCult.length + ' games): town', pct(rate(withCult, 'town')), ' mafia', pct(rate(withCult, 'mafia')), ' cult', pct(rate(withCult, 'cult')));
