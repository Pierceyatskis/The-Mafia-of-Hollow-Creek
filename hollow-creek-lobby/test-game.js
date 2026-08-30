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

// --- a disconnected human Farmer gets the same random-target fallback as a placeholder Farmer, not a hang ---
const stateFarmer = G.createGame([{id:'f1', name:'F1'}], {playerCount:6, mafiaCount:0, roles: {Godfather:false, DoubleAgent:false, Detective:false, Doctor:false, Miller:false, BountyHunter:false, CrazyGranny:false, Coward:false, Farmer:true, NavySeal:false}});
const farmer = stateFarmer.players.find(p => p.role === 'Farmer');
// Force the farmer to be a disconnected human regardless of which seat they landed in.
farmer.isHuman = true; farmer.isPlaceholder = false; farmer.connected = false;
stateFarmer.players.forEach(p => { if(p.alive) stateFarmer.pendingDayVotes[p.id] = farmer.id; }); // unanimous vote to lynch the farmer
const farmerVoteResult = G.resolveDayVote(stateFarmer);
assert(!farmerVoteResult.farmerRevengePending, 'a disconnected human Farmer does not leave the round waiting on a response that can never arrive');
assert(!!stateFarmer.farmerRevengeName, 'a disconnected human Farmer still gets a real random-target revenge kill, same as a placeholder Farmer would');

// --- Task 17: vote submission order and living-count snapshots are captured
// correctly across a multi-round simulated game - present AND populated AND
// correctly tagged with the round they happened in, not just non-empty ---
const seatsT17 = [1,2,3,4,5,6].map(n => ({id:'t17-p'+n, name:'P'+n}));
const stateT17 = G.createGame(seatsT17, {playerCount:6, mafiaCount:1, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG, {Godfather:false, DoubleAgent:false, Detective:false, Miller:false, BountyHunter:false, CrazyGranny:false, Doctor:true})});
const mafiaT17 = stateT17.players.find(p => p.role === 'Mafia');
const doctorT17 = stateT17.players.find(p => p.role === 'Doctor');
const [civA, civB, civC, civD] = stateT17.players.filter(p => p.role === 'Civilian');

// Round 1 night: mafia kills civA, doctor protects civB (doesn't block the
// kill - just proves the snapshot fires independent of the outcome). All 6
// players are still alive at the moment the doctor submits.
stateT17.pendingNightVotes[mafiaT17.id] = {kill: civA.id};
const livingBeforeR1Night = G.living(stateT17).length; // 6
G.recordLivingCountSnapshot(stateT17, doctorT17.id, 'Doctor', 'protect');
stateT17.pendingNightVotes[doctorT17.id] = {protect: civB.id};
G.resolveNight(stateT17);
assert(civA.alive === false, 'Task17 setup: round 1 night kill lands on the intended target');

// Round 1 day vote: the 5 living players submit in a deliberately
// non-sequential order so voteSubmissionOrder can be checked against real
// submission order rather than array/tally order.
const submitOrderR1 = [civC, doctorT17, civD, mafiaT17, civB];
submitOrderR1.forEach(p => G.recordDayVoteSubmission(stateT17, p.id, civC.id));
G.resolveDayVote(stateT17);
assert(civC.alive === false, 'Task17 setup: round 1 day vote lynches the intended target');

G.startNextNight(stateT17);
assert(stateT17.night === 2, 'Task17 setup: round advances to night 2');

// Round 2 night: mafia kills civD, doctor protects itself. Living at this
// point is 4 (mafia, doctor, civB, civD) - one fewer than round 1's snapshot.
stateT17.pendingNightVotes[mafiaT17.id] = {kill: civD.id};
const livingBeforeR2Night = G.living(stateT17).length; // 4
G.recordLivingCountSnapshot(stateT17, doctorT17.id, 'Doctor', 'protect');
stateT17.pendingNightVotes[doctorT17.id] = {protect: doctorT17.id};
G.resolveNight(stateT17);
assert(civD.alive === false, 'Task17 setup: round 2 night kill lands on the intended target');

// Round 2 day vote: the 3 remaining living players submit in another
// non-sequential order.
const submitOrderR2 = [civB, mafiaT17, doctorT17];
submitOrderR2.forEach(p => G.recordDayVoteSubmission(stateT17, p.id, mafiaT17.id));

// --- voteSubmissionOrder: every submission captured, tagged with the right
// round, in real submission order rather than array/tally order ---
const night1Votes = stateT17.voteSubmissionOrder.filter(v => v.night === 1);
const night2Votes = stateT17.voteSubmissionOrder.filter(v => v.night === 2);
assert(night1Votes.length === submitOrderR1.length, 'Task17: every round-1 day vote submission is captured in voteSubmissionOrder, tagged night 1');
assert(night2Votes.length === submitOrderR2.length, 'Task17: every round-2 day vote submission is captured in voteSubmissionOrder, tagged night 2');
assert(stateT17.voteSubmissionOrder.every(v => v.playerId && v.targetId && typeof v.submittedAt === 'number'), 'Task17: voteSubmissionOrder entries are fully populated, not empty/undefined');
assert(JSON.stringify(night1Votes.map(v => v.playerId)) === JSON.stringify(submitOrderR1.map(p => p.id)), 'Task17: voteSubmissionOrder preserves real round-1 submission order, not array/tally order');
assert(JSON.stringify(night2Votes.map(v => v.playerId)) === JSON.stringify(submitOrderR2.map(p => p.id)), 'Task17: voteSubmissionOrder preserves real round-2 submission order, not array/tally order');

// --- livingCountAtAction: snapshots the actual living count at the moment of
// submission, correctly tagged by round, and changes round over round ---
const doctorSnapshots = stateT17.livingCountAtAction.filter(e => e.role === 'Doctor' && e.actionType === 'protect');
assert(doctorSnapshots.length === 2, 'Task17: a living-count snapshot is captured for each round\'s Doctor protect submission');
const r1Snapshot = doctorSnapshots.find(e => e.night === 1);
const r2Snapshot = doctorSnapshots.find(e => e.night === 2);
assert(!!r1Snapshot && !!r2Snapshot, 'Task17: living-count snapshots are correctly tagged with their round number');
assert(r1Snapshot.livingCount === livingBeforeR1Night, 'Task17: round 1 living-count snapshot matches the actual living count at the moment of submission');
assert(r2Snapshot.livingCount === livingBeforeR2Night, 'Task17: round 2 living-count snapshot matches the actual living count at the moment of submission');
assert(r2Snapshot.livingCount < r1Snapshot.livingCount, 'Task17: living-count snapshot decreases round over round as players die, not a stale/frozen value');
assert(stateT17.livingCountAtAction.every(e => typeof e.livingCount === 'number' && e.playerId && e.role && e.actionType), 'Task17: livingCountAtAction entries are fully populated, not empty/undefined');

// --- Task 18: firstAccuserOf correctly identifies the TRUE first accuser of
// a target by timestamp, even when several other players later pile on the
// same accusation (and in an order that doesn't match seating/array order) ---
const stateT18 = G.createGame([1,2,3,4].map(n => ({id:'t18-p'+n, name:'A'+n})), {playerCount:6, mafiaCount:0, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG, {Godfather:false, DoubleAgent:false, Detective:false, Doctor:false, Miller:false, BountyHunter:false, CrazyGranny:false})});
const [accP1, accP2, accP3, accP4] = stateT18.players;
const targetT18 = stateT18.players[4];

assert(G.firstAccuserOf(stateT18, targetT18.id) === null, 'Task18: firstAccuserOf returns null for a target no one has accused yet');

// Real-time order of accusation would be accP3, accP1, accP2, accP4 - forced
// via explicit timestamps since recordAccusation's own Date.now() ts values
// can collide within a single synchronous test run.
G.recordAccusation(stateT18, accP3.id, targetT18.id); stateT18.accusationLog[stateT18.accusationLog.length-1].ts = 1000;
G.recordAccusation(stateT18, accP1.id, targetT18.id); stateT18.accusationLog[stateT18.accusationLog.length-1].ts = 3000;
G.recordAccusation(stateT18, accP2.id, targetT18.id); stateT18.accusationLog[stateT18.accusationLog.length-1].ts = 2000;
G.recordAccusation(stateT18, accP4.id, targetT18.id); stateT18.accusationLog[stateT18.accusationLog.length-1].ts = 4000;

const firstAccusation = G.firstAccuserOf(stateT18, targetT18.id);
assert(!!firstAccusation, 'Task18: firstAccuserOf returns a result once a target has been accused');
assert(firstAccusation.accuserId === accP3.id, 'Task18: firstAccuserOf identifies the true first accuser by timestamp, even when three other players later pile onto the same target');
assert(stateT18.accusationLog.filter(e => e.targetId === targetT18.id).length === 4, 'Task18: every pile-on accusation stays logged, none deduplicated away');

// --- firstAccuserOf's vote-timing relationship, which Task 19's persuasion/
// misdirection bonuses depend on ---
const beforeAnyVote = G.firstAccuserOf(stateT18, targetT18.id);
assert(beforeAnyVote.precededAnyVoteForTarget === true, 'Task18: an accusation with no votes yet cast for that target reads as having preceded every vote');
assert(beforeAnyVote.fractionVotesAlreadyInWhenAccused === 0, 'Task18: with zero votes in yet, fractionVotesAlreadyInWhenAccused is 0');

G.recordDayVoteSubmission(stateT18, accP1.id, targetT18.id);
stateT18.voteSubmissionOrder[stateT18.voteSubmissionOrder.length-1].submittedAt = 500; // before the ts=1000 first accusation
const afterEarlyVote = G.firstAccuserOf(stateT18, targetT18.id);
assert(afterEarlyVote.precededAnyVoteForTarget === false, 'Task18: an accusation made after a vote for that target already landed does not read as having preceded it');
assert(afterEarlyVote.fractionVotesAlreadyInWhenAccused === 1, 'Task18: fractionVotesAlreadyInWhenAccused reflects that the only vote for the target already landed before the first accusation');

// --- PREBETA Task 1: Godfather silence has no alignment restriction -
// server-side resolveNight already never filtered by alignment (the leak
// was purely in the client's silence-target picker), but this test locks
// in the backend behavior the fix depends on: a Godfather can silence a
// mafia-aligned teammate or themselves, same as any town player.
const stateSilence = G.createGame(seats, {playerCount: 8, mafiaCount: 1, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const gfSilence = stateSilence.players.find(p => p.role === 'Godfather');
const silenceMafiaTeammate = stateSilence.players.find(p => p.id !== gfSilence.id && p.align === 'mafia');
const townDecoyTarget = stateSilence.players.find(p => p.align !== 'mafia' && p.alive);
G.mafiaVoters(stateSilence).forEach(p => { stateSilence.pendingNightVotes[p.id] = {kill: townDecoyTarget.id}; });
stateSilence.pendingNightVotes[gfSilence.id] = Object.assign({}, stateSilence.pendingNightVotes[gfSilence.id], {silence: silenceMafiaTeammate.id});
const silenceResultTeammate = G.resolveNight(stateSilence);
assert(silenceResultTeammate.silencedPlayerId === silenceMafiaTeammate.id, 'PREBETA Task 1: Godfather can successfully silence a mafia-aligned teammate');
assert(silenceMafiaTeammate.silencedToday === true, 'PREBETA Task 1: the silenced mafia teammate is actually marked silencedToday');

const stateSelfSilence = G.createGame(seats, {playerCount: 8, mafiaCount: 1, roles: Object.assign({}, G.DEFAULT_ROLES_CONFIG)});
const gfSelfSilence = stateSelfSilence.players.find(p => p.role === 'Godfather');
const townDecoyTarget2 = stateSelfSilence.players.find(p => p.align !== 'mafia' && p.alive);
G.mafiaVoters(stateSelfSilence).forEach(p => { stateSelfSilence.pendingNightVotes[p.id] = {kill: townDecoyTarget2.id}; });
stateSelfSilence.pendingNightVotes[gfSelfSilence.id] = Object.assign({}, stateSelfSilence.pendingNightVotes[gfSelfSilence.id], {silence: gfSelfSilence.id});
const silenceResultSelf = G.resolveNight(stateSelfSilence);
assert(silenceResultSelf.silencedPlayerId === gfSelfSilence.id, 'PREBETA Task 1: Godfather can successfully silence himself');
assert(gfSelfSilence.silencedToday === true, 'PREBETA Task 1: the self-silenced Godfather is actually marked silencedToday');

// ============================================================
// PREBETA Task 3: Vigilante - once per game, independent night kill,
// isolated from the mafia's kill chain, guilt only on a town-aligned
// target (Crazy Granny always exempt regardless of her current alignment).
//
// Every test below builds from a fully-off role baseline and enables ONLY
// what that test needs - with the full DEFAULT_ROLES_CONFIG (Godfather +
// DoubleAgent, both mafia-aligned) layered on top, any placeholder holding
// one of those roles gets a random auto-filled kill vote (see
// placeholderNightAction) that can land on whichever player a test is
// making an unrelated assertion about, causing an occasional false
// failure unrelated to the Vigilante logic actually being tested. Keeping
// mafia voters absent (or explicitly pinned away) makes every one of
// these deterministic instead of flaky.
// ============================================================
const VIG_OFF = {Godfather:false, DoubleAgent:false, Detective:false, Doctor:false, Miller:false, BountyHunter:false, CrazyGranny:false, Coward:false, Farmer:false, NavySeal:false, Vigilante:false};

// (a) wrongful kill on a town-aligned target - Vigilante dies too
const stateVigGuilty = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true})});
const vigA = stateVigGuilty.players.find(p => p.role === 'Vigilante');
const townVictimA = stateVigGuilty.players.find(p => p.id !== vigA.id && p.align === 'town');
stateVigGuilty.pendingNightVotes[vigA.id] = {vigilanteKill: townVictimA.id};
const resA = G.resolveNight(stateVigGuilty);
assert(townVictimA.alive === false, 'Task 3: the Vigilante\'s shot kills the chosen target');
assert(!!resA.vigilanteKillVictim && resA.vigilanteKillVictim.id === townVictimA.id, 'Task 3: the kill victim is reported back in the resolution result');
assert(vigA.alive === false && resA.vigilanteDied === true, 'Task 3: a wrongful kill on a town-aligned target kills the Vigilante too');

// (b) Crazy Granny is exempt from guilt regardless of her CURRENT alignment
const stateVigGranny1 = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true, CrazyGranny:true})});
const vigB1 = stateVigGranny1.players.find(p => p.role === 'Vigilante');
const grannyB1 = stateVigGranny1.players.find(p => p.role === 'CrazyGranny');
assert(grannyB1.align === 'town', 'sanity: Crazy Granny starts town-aligned, before any flip');
stateVigGranny1.pendingNightVotes[vigB1.id] = {vigilanteKill: grannyB1.id};
const resB1 = G.resolveNight(stateVigGranny1);
assert(grannyB1.alive === false && vigB1.alive === true, 'Task 3: killing an unflipped (town-aligned) Crazy Granny never triggers guilt');

const stateVigGranny2 = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true, CrazyGranny:true})});
const vigB2 = stateVigGranny2.players.find(p => p.role === 'Vigilante');
const grannyB2 = stateVigGranny2.players.find(p => p.role === 'CrazyGranny');
grannyB2.flipped = true; grannyB2.align = 'mafia'; // simulate her post-flip state directly
// Flipping her makes mafiaVoters() return [grannyB2] alone (see game.js) -
// if she's a placeholder, resolveNight would auto-fill her a random kill
// vote unrelated to this test. Pin it away from everyone we assert on.
const safeFillerB2 = stateVigGranny2.players.find(p => p.id !== vigB2.id && p.id !== grannyB2.id);
stateVigGranny2.pendingNightVotes[grannyB2.id] = {kill: safeFillerB2.id};
stateVigGranny2.pendingNightVotes[vigB2.id] = {vigilanteKill: grannyB2.id};
const resB2 = G.resolveNight(stateVigGranny2);
assert(grannyB2.alive === false && vigB2.alive === true, 'Task 3: killing a FLIPPED (mafia-aligned) Crazy Granny still never triggers guilt - the exception is role-specific, not alignment-based');

// (c) mafia-aligned target - never triggers guilt
const stateVigMafia = G.createGame(seats, {playerCount: 8, mafiaCount: 1, roles: Object.assign({}, VIG_OFF, {Vigilante:true})});
const vigC = stateVigMafia.players.find(p => p.role === 'Vigilante');
const mafiaTargetC = stateVigMafia.players.find(p => p.id !== vigC.id && p.align === 'mafia');
const safeFillerC = stateVigMafia.players.find(p => p.id !== vigC.id && p.id !== mafiaTargetC.id);
G.mafiaVoters(stateVigMafia).forEach(p => { stateVigMafia.pendingNightVotes[p.id] = {kill: safeFillerC.id}; }); // this mafia voter IS the target, but pin its OWN vote away for determinism regardless
stateVigMafia.pendingNightVotes[vigC.id] = {vigilanteKill: mafiaTargetC.id};
G.resolveNight(stateVigMafia);
assert(mafiaTargetC.alive === false && vigC.alive === true, 'Task 3: killing a mafia-aligned target never triggers guilt');

// (d) neutral (Bounty Hunter) target - never triggers guilt, even one mark
// from their own win condition, since guilt is alignment-only, never a
// judgment of how dangerous the target currently is
const stateVigNeutral = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true, BountyHunter:true})});
const vigD = stateVigNeutral.players.find(p => p.role === 'Vigilante');
const bhD = stateVigNeutral.players.find(p => p.role === 'BountyHunter');
stateVigNeutral.bountyPoints = 2;
stateVigNeutral.pendingNightVotes[vigD.id] = {vigilanteKill: bhD.id};
G.resolveNight(stateVigNeutral);
assert(bhD.alive === false && vigD.alive === true, 'Task 3: killing a neutral Bounty Hunter never triggers guilt, even two marks into their own win condition');

// (e) bypasses Doctor's protect entirely
const stateVigDoc = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true, Doctor:true})});
const vigE1 = stateVigDoc.players.find(p => p.role === 'Vigilante');
const docE1 = stateVigDoc.players.find(p => p.role === 'Doctor');
const targetE1 = stateVigDoc.players.find(p => p.id !== vigE1.id && p.id !== docE1.id);
stateVigDoc.pendingNightVotes[docE1.id] = {protect: targetE1.id};
stateVigDoc.pendingNightVotes[vigE1.id] = {vigilanteKill: targetE1.id};
G.resolveNight(stateVigDoc);
assert(targetE1.alive === false, 'Task 3: Doctor protection does not block the Vigilante\'s independent kill');

// (e) bypasses Coward's hide-behind redirect entirely
const stateVigCow = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true, Coward:true})});
const vigE2 = stateVigCow.players.find(p => p.role === 'Vigilante');
const cowE2 = stateVigCow.players.find(p => p.role === 'Coward');
const decoyE2 = stateVigCow.players.find(p => p.id !== vigE2.id && p.id !== cowE2.id);
stateVigCow.pendingNightVotes[cowE2.id] = {hideBehind: decoyE2.id};
stateVigCow.pendingNightVotes[vigE2.id] = {vigilanteKill: cowE2.id};
G.resolveNight(stateVigCow);
assert(cowE2.alive === false, 'Task 3: hide-behind redirect does not apply to the Vigilante\'s kill - the Coward dies directly');
assert(decoyE2.alive === true, 'Task 3: the hide-behind decoy is untouched by a Vigilante kill aimed at the Coward');

// (e) bypasses Navy Seal's counter-kill entirely
const stateVigSeal = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true, NavySeal:true})});
const vigE3 = stateVigSeal.players.find(p => p.role === 'Vigilante');
const sealE3 = stateVigSeal.players.find(p => p.role === 'NavySeal');
stateVigSeal.pendingNightVotes[vigE3.id] = {vigilanteKill: sealE3.id};
G.resolveNight(stateVigSeal);
assert(sealE3.alive === false, 'Task 3: a Navy Seal killed by the Vigilante just dies - the counter-kill only ever applies to the mafia\'s own kill');
assert(sealE3.usedNavySealCounter === false, 'Task 3: the Navy Seal\'s counter is never consumed by a Vigilante kill');

// (f) a mafia kill and a Vigilante kill the same night correctly produce two deaths
const stateTwoDeaths = G.createGame(seats, {playerCount: 8, mafiaCount: 1, roles: Object.assign({}, VIG_OFF, {Vigilante:true})});
const vigF = stateTwoDeaths.players.find(p => p.role === 'Vigilante');
const mafiaKillTargetF = stateTwoDeaths.players.find(p => p.align !== 'mafia' && p.role !== 'Vigilante' && p.alive);
const vigTargetF = stateTwoDeaths.players.find(p => p.align === 'mafia'); // mafia-aligned, so the Vigilante's own death from guilt doesn't muddy this specific assertion
G.mafiaVoters(stateTwoDeaths).forEach(p => { stateTwoDeaths.pendingNightVotes[p.id] = {kill: mafiaKillTargetF.id}; });
stateTwoDeaths.pendingNightVotes[vigF.id] = {vigilanteKill: vigTargetF.id};
const resF = G.resolveNight(stateTwoDeaths);
assert(mafiaKillTargetF.alive === false && vigTargetF.alive === false, 'Task 3: both the mafia\'s kill and the Vigilante\'s kill land the same night');
assert(resF.nightDeaths.length === 2, 'Task 3/5: resolveNight reports both simultaneous deaths in nightDeaths, not just one');

// (g) once per game - a second shot attempt does nothing
const stateOnce = G.createGame(seats, {playerCount: 8, mafiaCount: 0, roles: Object.assign({}, VIG_OFF, {Vigilante:true})});
const vigG = stateOnce.players.find(p => p.role === 'Vigilante');
const firstTargetG = stateOnce.players.find(p => p.id !== vigG.id);
stateOnce.pendingNightVotes[vigG.id] = {vigilanteKill: firstTargetG.id};
G.resolveNight(stateOnce);
assert(vigG.usedVigilanteShot === true, 'Task 3: the shot is marked used the moment it\'s fired');
stateOnce.night = 2; stateOnce.phase = 'night';
const secondTargetG = stateOnce.players.find(p => p.align === 'town' && p.role !== 'CrazyGranny' && p.alive && p.id !== vigG.id);
stateOnce.pendingNightVotes[vigG.id] = {vigilanteKill: secondTargetG.id};
const resG2 = G.resolveNight(stateOnce);
assert(secondTargetG.alive === true, 'Task 3: once-per-game - a second shot attempt on a later night does nothing, the target survives');
assert(resG2.vigilanteKillVictim === null, 'Task 3: the resolution result confirms no second shot was fired');

console.log('\nAll game.js checks completed.');
