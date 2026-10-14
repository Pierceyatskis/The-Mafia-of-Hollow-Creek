// Lineup balance simulation: plays many bot games, giving every game a different random lineup
// (player count, mafia count, which special roles are in play), then reports which roles and role
// pairs push a team's win rate up or down compared with other games of the same size.
//   node sim-lineups.js [games=40000] [--include=Role,Role]
// The bots (sim-bots.js) play like players: suspicion built from public facts and their own role's
// knowledge, Detective announcements (some mafia lie), bandwagoning, mafia that blend in and hunt the
// town's key roles. Roles listed in LEFT_OUT are deliberately never put in a lineup for now (the Cult
// Leader and Navy Seal were too strong); pass e.g. --include=NavySeal to put one back.
// Read the numbers as "which roles help which side", not as exact real-world win rates.
const G = require('./game.js');
const { playGame } = require('./sim-bots.js');
const GAMES = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 40000;
const LEFT_OUT = ['CultLeader', 'NavySeal'];
const inc = (process.argv.find(a => a.startsWith('--include=')) || '').slice(10).split(',').filter(Boolean);
const ROLES = G.SPECIAL_ROLES.filter(r => !LEFT_OUT.includes(r) || inc.includes(r));   // everything in play, plain Mafia included
const TEAMS = ['town', 'mafia', 'cult', 'bounty'];
const rnd = n => Math.floor(Math.random() * n);

// A plausible lineup: the mafia are about a quarter of the table (give or take one, 1 to 4 of them), always led by
// the Godfather, with the other seats' mafia filled from the other mafia roles or plain Mafia; every town/neutral
// special role is in or out by coin flip as long as there is room.
const MAFIA_ROLES = ['DoubleAgent', 'Consigliere', 'Framer', 'Hitman', 'Mafia'];
const OTHER_ROLES = ROLES.filter(r => !MAFIA_ROLES.includes(r) && r !== 'Godfather');
function randomLineup() {
  for (;;) {
    const n = 8 + rnd(9);                                              // 8..16 players
    const mafia = Math.max(1, Math.min(4, Math.round(n / 4) + rnd(3) - 1));
    const roles = {}; G.SPECIAL_ROLES.forEach(r => { roles[r] = false; });
    roles.Godfather = true;
    let plain = 0;
    G.shuffle(MAFIA_ROLES.slice()).slice(0, mafia - 1).forEach(r => { if (r === 'Mafia') plain++; else roles[r] = true; });
    // allow plain Mafia to repeat if the mafia need more members than there are distinct roles
    while (1 + MAFIA_ROLES.filter(r => r !== 'Mafia' && roles[r]).length + plain < mafia) plain++;
    OTHER_ROLES.forEach(r => { roles[r] = Math.random() < 0.5; });
    const specials = G.SPECIAL_ROLES.filter(r => r !== 'Mafia' && roles[r]).length;
    if (specials + plain <= n) return { n, roles, mafiaCount: plain };
  }
}

function playOne(lineup) {
  const seats = Array.from({ length: lineup.n }, (_, i) => ({ id: 'bot' + i, name: 'Bot ' + (i + 1) }));
  const state = G.createGame(seats, { playerCount: lineup.n, mafiaCount: lineup.mafiaCount, roles: lineup.roles });
  const present = new Set(state.players.map(p => p.role));
  const mafiaTotal = state.players.filter(p => p.align === 'mafia').length;
  const out = playGame(state);
  return { n: lineup.n, winner: out.winner, rounds: out.rounds, present: [...present], mafiaTotal };
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

console.log(`${GAMES} games, random lineup every game, left out: ${LEFT_OUT.filter(r => !inc.includes(r)).join(', ') || 'nothing'}\n`);
console.log('OVERALL   town', pct(rate(results, 'town')), ' mafia', pct(rate(results, 'mafia')), ' bounty', pct(rate(results, 'bounty')), ' avg rounds', (results.reduce((s, r) => s + r.rounds, 0) / results.length).toFixed(1));
console.log('\nBY PLAYER COUNT');
Object.keys(byN).sort((a, b) => a - b).forEach(n => console.log(('  ' + n + ' players').padEnd(14), 'town', pct(base[n].town), ' mafia', pct(base[n].mafia), ' bounty', pct(base[n].bounty), '  games', byN[n].length));
console.log('\nBY TOTAL MAFIA-ALIGNED PLAYERS IN THE GAME');
for (let m = 1; m <= 8; m++) {
  const rows = results.filter(r => r.mafiaTotal === m);
  if (rows.length > 200) console.log(('  ' + m + ' mafia').padEnd(14), 'town', pct(rate(rows, 'town')), ' mafia', pct(rate(rows, 'mafia')), '  games', rows.length);
}

// "lift" = how much more often a team wins in games containing X than in same-size games on average.
console.log('\nROLE EFFECT ON EACH TEAM  (percentage points vs. same-size games; * = beyond random noise)');
console.log('role'.padEnd(16), 'games'.padStart(6), '  town win'.padEnd(11), 'mafia win'.padEnd(11), 'bounty win');
const TABLE_ROLES = ROLES.filter(r => r !== 'Godfather');
const roleRows = TABLE_ROLES.map(r => {
  const rows = results.filter(g => g.present.includes(r));
  const f = t => { const l = lift(rows, t); return signed(l) + (Math.abs(l) > noise(rows, t) ? '*' : ' '); };
  return { r, rows, town: lift(rows, 'town'), line: r.padEnd(16) + String(rows.length).padStart(6) + '  ' + f('town') + '  ' + f('mafia') + '  ' + f('bounty') };
}).sort((a, b) => b.town - a.town);
roleRows.forEach(x => console.log(x.line));

const single = {};
roleRows.forEach(x => { single[x.r] = { town: x.town, mafia: lift(x.rows, 'mafia') }; });
const pairs = [];
for (let i = 0; i < TABLE_ROLES.length; i++) for (let j = i + 1; j < TABLE_ROLES.length; j++) {
  const rows = results.filter(g => g.present.includes(TABLE_ROLES[i]) && g.present.includes(TABLE_ROLES[j]));
  if (rows.length >= 600) pairs.push({ name: TABLE_ROLES[i] + ' + ' + TABLE_ROLES[j], rows, l: lift(rows, 'town'), synergy: lift(rows, 'town') - single[TABLE_ROLES[i]].town - single[TABLE_ROLES[j]].town });
}
const show = p => console.log('  ' + p.name.padEnd(30), 'together', signed(p.l), ' extra beyond the two alone', signed(p.synergy), ' games', p.rows.length);
console.log('\nROLE PAIRS - town win-rate change when both are in play, and the "extra" the pair adds beyond each role alone');
pairs.sort((a, b) => b.l - a.l);
console.log(' best pairs for town:'); pairs.slice(0, 6).forEach(show);
console.log(' worst pairs for town:'); pairs.slice(-6).reverse().forEach(show);
pairs.sort((a, b) => b.synergy - a.synergy);
console.log(' pairs that work better together than apart (town):'); pairs.slice(0, 6).forEach(show);
console.log(' pairs that cancel each other out (town):'); pairs.slice(-6).reverse().forEach(show);

