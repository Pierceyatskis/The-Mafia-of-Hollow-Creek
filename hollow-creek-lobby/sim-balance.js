// Balance simulation by team size: plays whole games with the player-like bots from sim-bots.js and reports
// win rates for the default roles with different numbers of extra mafia.
// Usage: node sim-balance.js [gamesPerSetup=2000]
// The Cult Leader and Navy Seal are left out on purpose for now (too strong); neither is in the default roles.
const G = require('./game.js');
const { playGame } = require('./sim-bots.js');
const N = Number(process.argv[2]) || 2000;

function run(label, playerCount, roles, mafiaCount) {
  if (G.validateSeatCapacity({ playerCount, mafiaCount, roles }).ok === false) return;   // the default roles need 7 seats plus any extra mafia
  const tally = {}; let rounds = 0;
  for (let i = 0; i < N; i++) {
    const seats = Array.from({ length: playerCount }, (_, k) => ({ id: 'bot' + k, name: 'Bot ' + (k + 1) }));
    const r = playGame(G.createGame(seats, { playerCount, mafiaCount, roles }));
    tally[r.winner] = (tally[r.winner] || 0) + 1; rounds += r.rounds;
  }
  const pct = k => (100 * (tally[k] || 0) / N).toFixed(1).padStart(5) + '%';
  console.log(label.padEnd(34), 'town', pct('town'), ' mafia', pct('mafia'), ' bounty', pct('bounty'), ' avg rounds', (rounds / N).toFixed(1));
}

console.log('games per setup:', N);
[7, 8, 10, 12, 14, 16].forEach(n => {
  [0, 1, 2].forEach(extra => run(n + ' players, default roles + ' + extra + ' mafia', n, G.DEFAULT_ROLES_CONFIG, extra));
  console.log('');
});
