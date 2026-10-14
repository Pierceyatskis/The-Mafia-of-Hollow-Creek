// Balance simulation: plays whole games with bot players straight through game.js and reports win rates.
// Usage: node sim-balance.js [gamesPerSetup=2000]
// Town bots vote at random, except that with probability `skill` a non-mafia voter picks a living mafia member
// (that models how well the table reads the room); mafia bots never vote for a teammate. skill=0 is a pure
// no-information baseline. Real tables sit somewhere in between, so compare setups with each other and look for
// the skill level where the game is 50/50 - don't read any single number as the true win rate.
const G = require('./game.js');
const N = Number(process.argv[2]) || 2000;

function playOne(playerCount, roles, mafiaCount, skill) {
  // Seat everyone as a (fake) human so lobbies bigger than the 11 built-in AI characters can be simulated,
  // then flip them to placeholders so the game's own fallback logic plays their night actions.
  const seats = Array.from({ length: playerCount }, (_, i) => ({ id: 'bot' + i, name: 'Bot ' + (i + 1) }));
  const state = G.createGame(seats, { playerCount, mafiaCount, roles });
  state.players.forEach(p => { p.isHuman = false; p.isPlaceholder = true; });
  let rounds = 0;
  while (!state.gameOver && rounds < 60) {
    rounds++;
    G.resolveNight(state);
    if (state.gameOver) break;
    const alive = G.living(state);
    alive.forEach(p => {
      const pool = alive.filter(q => q.id !== p.id && !(p.align === 'mafia' && q.align === 'mafia'));
      const choices = pool.length ? pool : alive.filter(q => q.id !== p.id);
      const mafiaTargets = choices.filter(q => q.align === 'mafia');
      if (p.align !== 'mafia' && mafiaTargets.length && Math.random() < skill) {
        state.pendingDayVotes[p.id] = mafiaTargets[Math.floor(Math.random() * mafiaTargets.length)].id;
        return;
      }
      state.pendingDayVotes[p.id] = choices[Math.floor(Math.random() * choices.length)].id;
    });
    G.resolveDayVote(state);
    if (state.gameOver) break;
    G.startNextNight(state);
  }
  return { winner: state.winner || 'none', rounds };
}

function run(label, playerCount, roles, mafiaCount, skill) {
  const tally = {}; let rounds = 0;
  for (let i = 0; i < N; i++) {
    const r = playOne(playerCount, roles, mafiaCount, skill);
    tally[r.winner] = (tally[r.winner] || 0) + 1; rounds += r.rounds;
  }
  const pct = k => (100 * (tally[k] || 0) / N).toFixed(1).padStart(5) + '%';
  console.log((label + ' skill ' + skill).padEnd(40), 'town', pct('town'), ' mafia', pct('mafia'), ' cult', pct('cult'), ' bounty', pct('bounty'), ' none', pct('none'), ' avg rounds', (rounds / N).toFixed(1));
}

function richRoles(n) {
  const cfg = {};
  G.SPECIAL_ROLES.forEach((r, idx) => { cfg[r] = idx < Math.max(1, n - 4); });
  return cfg;
}
console.log('games per setup:', N);
[0, 0.25, 0.4].forEach(skill => {
  [7, 8, 10, 12, 16].forEach(n => run(n + 'p default roles', n, G.DEFAULT_ROLES_CONFIG, 0, skill));
  [8, 12, 16].forEach(n => run(n + 'p default+' + Math.round(n / 4 - 2) + ' extra mafia', n, G.DEFAULT_ROLES_CONFIG, Math.max(0, Math.round(n / 4 - 2)), skill));
  [10, 12, 16].forEach(n => { try { run(n + 'p many roles', n, richRoles(n), 0, skill); } catch (e) { console.log(n, 'many roles:', e.message); } });
  console.log('');
});
