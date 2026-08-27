const G = require('./game.js');

function assert(cond, msg){ if(!cond){ console.error('FAIL: '+msg); process.exitCode = 1; } else { console.log('ok - '+msg); } }

// --- createGame: real players seated first, placeholders fill the rest ---
const seats = [{id:'p1', name:'Alice'}, {id:'p2', name:'Bob'}];
const state = G.createGame(seats, {playerCount: 8, mafiaCount: 1, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
assert(state.players.length === 8, 'createGame seats the configured player count (8)');
assert(state.players[0].id === 'p1' && state.players[0].isHuman, 'real player 1 seated first');
assert(state.players[1].id === 'p2' && state.players[1].isHuman, 'real player 2 seated second');
assert(state.players.slice(2).every(p => p.isPlaceholder), 'remaining seats are placeholders');
const roleSet = state.players.map(p => p.role);
assert(roleSet.includes('Godfather'), 'Godfather is always in the pool');
assert(roleSet.filter(r => r==='Mafia').length === 1, 'mafiaCount=1 adds exactly one regular Mafia');

// --- no player ever sees another player's hidden role ---
const aliceView = G.getPlayerView(state, 'p1');
const alicePlayer = aliceView.players.find(p => p.id === 'p1');
assert(alicePlayer.role === state.players[0].role, 'a player sees their OWN role');
const bobFromAliceView = aliceView.players.find(p => p.id === 'p2');
const aliceAndBobAreMafiaTeammates = state.players[0].align === 'mafia' && state.players[1].align === 'mafia';
if (aliceAndBobAreMafiaTeammates) {
  assert(bobFromAliceView.role === state.players[1].role, 'a living mafia player sees a living mafia teammate\'s role (they landed on the same team this shuffle)');
} else {
  assert(bobFromAliceView.role === undefined, 'a living player never sees another living non-teammate player\'s role');
}

// --- night resolution: force a kill and confirm the redaction updates after death ---
const godfather = state.players.find(p => p.role === 'Godfather');
const civilianTarget = state.players.find(p => p.role !== 'Godfather' && p.align !== 'mafia' && p.alive);
// Give every mafia-aligned voter the same explicit vote so the outcome is deterministic
// instead of leaving any of them to a random placeholder pick.
G.mafiaVoters(state).forEach(p => { state.pendingNightVotes[p.id] = {kill: civilianTarget.id}; });
// Also pin the Doctor's protect vote away from the target - otherwise a placeholder
// Doctor can randomly protect civilianTarget and flakily cancel the kill.
const doctorGuard = state.players.find(p => p.role === 'Doctor' && p.alive);
if(doctorGuard) state.pendingNightVotes[doctorGuard.id] = {protect: godfather.id};
const nightResult = G.resolveNight(state);
assert(nightResult.nightDeathOccurred === true, 'a kill with no doctor/navyseal in play actually kills someone');
assert(civilianTarget.alive === false, 'the killed player is marked dead');
const deadViewOfThemself = G.getPlayerView(state, civilianTarget.id);
// dead players get a full spectator view
assert(deadViewOfThemself.players.every(p => p.role !== undefined), 'a dead player gets a full spectator view (all roles visible)');
const stillAlivePlayer = state.players.find(p => p.alive && p.id !== godfather.id);
const aliveView = G.getPlayerView(state, stillAlivePlayer.id);
const deadPlayerInAliveView = aliveView.players.find(p => p.id === civilianTarget.id);
assert(deadPlayerInAliveView.role === civilianTarget.role, 'once someone dies, their role becomes visible to everyone else too');

// --- Doctor save cancels a kill ---
const state2 = G.createGame([{id:'h1', name:'Human'}], {playerCount:8, mafiaCount:1, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const gf2 = state2.players.find(p => p.role==='Godfather');
const doc2 = state2.players.find(p => p.role==='Doctor');
const victim2 = state2.players.find(p => p.role !== 'Godfather' && p.align !== 'mafia');
G.mafiaVoters(state2).forEach(p => { state2.pendingNightVotes[p.id] = {kill: victim2.id}; });
if(doc2) state2.pendingNightVotes[doc2.id] = {protect: victim2.id};
const nr2 = G.resolveNight(state2);
if(doc2){
  assert(victim2.alive === true, 'Doctor protecting the mafia\'s target saves them');
  assert(nr2.nightDeathOccurred === false, 'no death is reported when the doctor saves the target');
}

// --- Detective read logic: DoubleAgent flips guilty only on second investigation ---
const state3 = G.createGame([{id:'d1', name:'Det'}], {playerCount:8, mafiaCount:0, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG, {DoubleAgent:true, Detective:true})});
const da = state3.players.find(p => p.role==='DoubleAgent');
if(da){
  const read1 = G.investigateAndRead(da);
  assert(read1 === 'innocent', 'DoubleAgent reads innocent on first investigation');
  const read2 = G.investigateAndRead(da);
  assert(read2 === 'guilty', 'DoubleAgent reads guilty on second investigation');
}

// --- day vote: plurality wins, dead players excluded ---
const state4 = G.createGame([{id:'x1', name:'X'},{id:'x2', name:'X2'},{id:'x3', name:'X3'}], {playerCount:9, mafiaCount:1, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const targetPlayer = state4.players[5];
state4.players.forEach(p => { if(p.alive) state4.pendingDayVotes[p.id] = targetPlayer.id; });
const dayResult = G.resolveDayVote(state4);
assert(dayResult.lead.id === targetPlayer.id, 'unanimous votes correctly elect the target for elimination');
assert(targetPlayer.alive === false, 'the voted-out player is marked dead');

// --- win condition: mafia wiped out -> town wins ---
const state5 = G.createGame([{id:'w1', name:'W'}], {playerCount:7, mafiaCount:0, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG, {Godfather:true})});
state5.players.forEach(p => { if(p.align === 'mafia') p.alive = false; }); // kill every mafia-aligned player, not just the Godfather
const won = G.checkWin(state5);
assert(won === true && state5.winner === 'town', 'town wins once every mafia-aligned player is dead');

// --- win condition: mafia reaches parity with town -> mafia wins ---
const state6 = G.createGame([{id:'m1', name:'M'}], {playerCount:9, mafiaCount:2, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const townFolks = state6.players.filter(p => p.align !== 'mafia');
townFolks.slice(1).forEach(p => { p.alive = false; }); // kill all but one townsperson
const won2 = G.checkWin(state6);
assert(won2 === true && state6.winner === 'mafia', 'mafia wins once they equal or outnumber the remaining town');

// --- buildRolePool: insufficient seats for enabled roles rejects instead of silently dropping one ---
let seatCapacityThrew = false;
try {
  G.createGame([{id:'cap1', name:'Cap'}], {playerCount:6, mafiaCount:0, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
} catch (e) {
  seatCapacityThrew = true;
}
assert(seatCapacityThrew, 'createGame rejects playerCount:6 with the full default role set (7 roles) instead of silently dropping one');

// --- with exactly enough seats, every enabled special role actually appears ---
const state7 = G.createGame([{id:'cap2', name:'Cap2'}], {playerCount:7, mafiaCount:0, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const roles7 = state7.players.map(p => p.role);
['Godfather','DoubleAgent','Detective','Doctor','Miller','BountyHunter','CrazyGranny'].forEach(r => {
  assert(roles7.includes(r), 'with exactly enough seats, '+r+' actually appears in the pool (no silent drop)');
});

// --- a living mafia-aligned player sees their living teammates' roles, but not anyone else's ---
const stateTeam = G.createGame([{id:'m1', name:'M1'}, {id:'m2', name:'M2'}], {playerCount:9, mafiaCount:2, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const godfatherTeam = stateTeam.players.find(p => p.role === 'Godfather');
const mafiaTeammate = stateTeam.players.find(p => p.role === 'Mafia' || p.role === 'DoubleAgent');
const townPlayer = stateTeam.players.find(p => p.align !== 'mafia' && p.alive);
const gfView = G.getPlayerView(stateTeam, godfatherTeam.id);
if (mafiaTeammate) {
  const teammateInView = gfView.players.find(p => p.id === mafiaTeammate.id);
  assert(teammateInView.role === mafiaTeammate.role, 'a living Godfather sees a living mafia-aligned teammate\'s role');
}
const townInGfView = gfView.players.find(p => p.id === townPlayer.id);
assert(townInGfView.role === undefined, 'a living Godfather still cannot see a living non-mafia player\'s role');

// --- a NavySeal's own view reveals whether their counter-strike has been used ---
const stateSeal = G.createGame([{id:'s1', name:'Seal'}], {playerCount:7, mafiaCount:0, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG, {NavySeal:true, CrazyGranny:false})});
const seal = stateSeal.players.find(p => p.role === 'NavySeal');
if (seal) {
  const sealViewBefore = G.getPlayerView(stateSeal, seal.id);
  const sealInOwnView = sealViewBefore.players.find(p => p.id === seal.id);
  assert(sealInOwnView.usedNavySealCounter === false, 'a NavySeal sees their own counter-strike is unused at game start');
  seal.usedNavySealCounter = true;
  const sealViewAfter = G.getPlayerView(stateSeal, seal.id);
  assert(sealViewAfter.players.find(p => p.id === seal.id).usedNavySealCounter === true, 'a NavySeal sees their counter-strike flip to used after it fires');
}

// --- mafiaChatLog is scoped strictly by align==='mafia', never leaked to town ---
stateTeam.mafiaChatLog.push({playerId: godfatherTeam.id, name: godfatherTeam.name, text: 'kill the detective', ts: Date.now()});
const gfMafiaChatView = G.getPlayerView(stateTeam, godfatherTeam.id);
assert(Array.isArray(gfMafiaChatView.mafiaChatLog) && gfMafiaChatView.mafiaChatLog.length === 1, 'a mafia-aligned player\'s view includes mafiaChatLog');
const townMafiaChatView = G.getPlayerView(stateTeam, townPlayer.id);
assert(townMafiaChatView.mafiaChatLog === undefined, 'a town-aligned player\'s view never includes mafiaChatLog');

console.log('\nAll game.js checks completed.');
