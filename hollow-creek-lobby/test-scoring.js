const G = require('./game.js');
const Scoring = require('./scoring.js');

function assert(cond, msg){ if(!cond){ console.error('FAIL: '+msg); process.exitCode = 1; } else { console.log('ok - '+msg); } }

function seats(prefix, n){
  const out = [];
  for(let i=1;i<=n;i++) out.push({id: prefix+'-p'+i, name: prefix.toUpperCase()+i});
  return out;
}

const ALL_OFF = {Godfather:false, DoubleAgent:false, Detective:false, Doctor:false, Miller:false, BountyHunter:false, CrazyGranny:false, Coward:false, Farmer:false, NavySeal:false};

// ============================================================
// Rule: Town baseline (all non-Detective town roles) - correct vote only,
// points = round(20 * (1 - fractionAlreadyCommittedWhenVoted)), floor 2.
// ============================================================
(function testTownBaseline(){
  const state = G.createGame(seats('tb', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF)});
  const mafia = state.players.find(p => p.role === 'Mafia');
  mafia.alive = false; // simulates having just been the lynch target
  const civs = state.players.filter(p => p.role === 'Civilian'); // 5 civilians

  civs.forEach((p, i) => {
    G.recordDayVoteSubmission(state, p.id, mafia.id);
    state.voteSubmissionOrder[state.voteSubmissionOrder.length-1].submittedAt = (i+1)*1000;
  });

  const scores = Scoring.scoreRound(state, {night:1, nightResult:{}, dayResult:{lead: mafia}});
  const expected = [20, 15, 10, 5, 2]; // earliest independent vote -> latest bandwagon vote
  civs.forEach((p, i) => {
    assert(scores[p.id] && scores[p.id].total === expected[i], 'Task19 town-baseline: voter #'+(i+1)+' (fraction already committed '+(i/4)+') earns '+expected[i]+' points for the correct vote');
  });
  assert(!scores[mafia.id], 'Task19 town-baseline: the mafia-aligned lynch target never earns town-baseline points for itself');
})();

// ============================================================
// Rule: Detective (replaces baseline) - +15 consistent with own investigation
// result, -10 voted against own confirmed guilty read.
// ============================================================
(function testDetective(){
  // (a) guilty read + voted for them -> +15
  const s1 = G.createGame(seats('d1', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Detective:true})});
  const det1 = s1.players.find(p => p.role === 'Detective');
  const suspect1 = s1.players.find(p => p.role === 'Mafia');
  s1.detectiveLog.push({name: suspect1.name, read: 'guilty'});
  G.recordDayVoteSubmission(s1, det1.id, suspect1.id);
  const scores1 = Scoring.scoreRound(s1, {night:1, nightResult:{}, dayResult:{}});
  assert(scores1[det1.id].total === 15, 'Task19 detective: +15 for voting consistent with a confirmed guilty read');

  // (b) guilty read + voted for someone else instead -> -10
  const s2 = G.createGame(seats('d2', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Detective:true})});
  const det2 = s2.players.find(p => p.role === 'Detective');
  const suspect2 = s2.players.find(p => p.role === 'Mafia');
  const civ2 = s2.players.find(p => p.role === 'Civilian');
  s2.detectiveLog.push({name: suspect2.name, read: 'guilty'});
  G.recordDayVoteSubmission(s2, det2.id, civ2.id);
  const scores2 = Scoring.scoreRound(s2, {night:1, nightResult:{}, dayResult:{}});
  assert(scores2[det2.id].total === -10, 'Task19 detective: -10 for not voting a confirmed-alive guilty suspect');

  // (c) innocent read + defended them by voting elsewhere -> +15
  const s3 = G.createGame(seats('d3', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Detective:true})});
  const det3 = s3.players.find(p => p.role === 'Detective');
  const civs3 = s3.players.filter(p => p.role === 'Civilian');
  s3.detectiveLog.push({name: civs3[0].name, read: 'innocent'});
  G.recordDayVoteSubmission(s3, det3.id, civs3[1].id);
  const scores3 = Scoring.scoreRound(s3, {night:1, nightResult:{}, dayResult:{}});
  assert(scores3[det3.id].total === 15, 'Task19 detective: +15 for defending a confirmed-innocent read instead of voting for them');
})();

// ============================================================
// Rule: Doctor / Coward (hideBehind) / Farmer (revenge) - successful blind
// guess, points = round(2 * livingCountAtAction). Same formula, all three.
// ============================================================
(function testBlindGuess(){
  const s1 = G.createGame(seats('bg1', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Doctor:true})});
  const doc = s1.players.find(p => p.role === 'Doctor');
  G.recordLivingCountSnapshot(s1, doc.id, 'Doctor', 'protect');
  const scoresDoc = Scoring.scoreRound(s1, {night:1, nightResult:{doctorSaved:true}, dayResult:{}});
  assert(scoresDoc[doc.id].total === Math.round(2*6), 'Task19 blind-guess: a successful Doctor protect earns round(2 * livingCount)');

  const scoresDocFail = Scoring.scoreRound(s1, {night:1, nightResult:{doctorSaved:false}, dayResult:{}});
  assert(!scoresDocFail[doc.id], 'Task19 blind-guess: an unsuccessful Doctor protect earns nothing');

  const s2 = G.createGame(seats('bg2', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Coward:true})});
  const cow = s2.players.find(p => p.role === 'Coward');
  G.recordLivingCountSnapshot(s2, cow.id, 'Coward', 'hideBehind');
  const scoresCow = Scoring.scoreRound(s2, {night:1, nightResult:{cowardRedirected:true}, dayResult:{}});
  assert(scoresCow[cow.id].total === Math.round(2*6), 'Task19 blind-guess: a successful Coward hideBehind redirect earns round(2 * livingCount)');

  const s3 = G.createGame(seats('bg3', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Farmer:true})});
  const farmer = s3.players.find(p => p.role === 'Farmer');
  G.recordLivingCountSnapshot(s3, farmer.id, 'Farmer', 'farmerRevenge');
  const scoresFarmer = Scoring.scoreRound(s3, {night:1, nightResult:{}, dayResult:{}, revengeResult:{revengeKillOccurred:true}});
  assert(scoresFarmer[farmer.id].total === Math.round(2*6), 'Task19 blind-guess: a successful Farmer revenge kill earns round(2 * livingCount)');
})();

// ============================================================
// Rule: Bounty Hunter - +25 day-vote elimination, +8 night-kill elimination,
// +5 near miss (votes but not lynched, OR night-targeted-but-doctor-saved
// without ever exposing the doctor as the reason).
// ============================================================
(function testBountyHunter(){
  const s1 = G.createGame(seats('bh1', 7), {playerCount:7, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {BountyHunter:true})});
  const bh1 = s1.players.find(p => p.role === 'BountyHunter');
  const target1 = s1.players.find(p => p.role === 'Civilian');
  s1.bountyTarget = target1.id;
  target1.alive = false;
  const scores1 = Scoring.scoreRound(s1, {night:1, nightResult:{}, dayResult:{lead: target1}});
  assert(scores1[bh1.id].total === 25, 'Task19 bounty hunter: +25 when the bounty target is eliminated by the town\'s day vote');

  const s2 = G.createGame(seats('bh2', 7), {playerCount:7, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {BountyHunter:true})});
  const bh2 = s2.players.find(p => p.role === 'BountyHunter');
  const target2 = s2.players.find(p => p.role === 'Civilian');
  s2.bountyTarget = target2.id;
  const scores2 = Scoring.scoreRound(s2, {night:1, nightResult:{nightDeathOccurred:true, revealVictim: target2, killTargetId: target2.id, doctorSaved:false}, dayResult:{}});
  assert(scores2[bh2.id].total === 8, 'Task19 bounty hunter: +8 when the bounty target is eliminated by the night kill');

  const s3 = G.createGame(seats('bh3', 7), {playerCount:7, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {BountyHunter:true})});
  const bh3 = s3.players.find(p => p.role === 'BountyHunter');
  const target3 = s3.players.find(p => p.role === 'Civilian');
  s3.bountyTarget = target3.id;
  const scores3 = Scoring.scoreRound(s3, {night:1, nightResult:{nightDeathOccurred:false, killTargetId: target3.id, doctorSaved:true}, dayResult:{}});
  assert(scores3[bh3.id].total === 5, 'Task19 bounty hunter: +5 near miss when the bounty target was the night-kill target but was saved');
  const nearMissDetail = scores3[bh3.id].breakdown[0].detail;
  assert(!/doctor/i.test(nearMissDetail), 'Task19 bounty hunter: the near-miss reason never exposes that a Doctor save was the actual cause');

  const s4 = G.createGame(seats('bh4', 7), {playerCount:7, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {BountyHunter:true})});
  const bh4 = s4.players.find(p => p.role === 'BountyHunter');
  const civs4 = s4.players.filter(p => p.role === 'Civilian');
  const target4 = civs4[0], lynched4 = civs4[1];
  s4.bountyTarget = target4.id;
  G.recordDayVoteSubmission(s4, lynched4.id, target4.id); // target4 received a vote, but wasn't the lynch leader
  const scores4 = Scoring.scoreRound(s4, {night:1, nightResult:{}, dayResult:{lead: lynched4}});
  assert(scores4[bh4.id].total === 5, 'Task19 bounty hunter: +5 near miss when the bounty target received votes but wasn\'t the lynch leader');
})();

// ============================================================
// Rule: Mafia-aligned - accelerating survival curve, +15 night-kill target
// was the Detective/Doctor, misdirection bonus (scaled earlier = bigger),
// small flipped-Granny post-flip bonus.
// ============================================================
(function testMafiaAligned(){
  assert(Scoring.survivalCurvePoints(4) > Scoring.survivalCurvePoints(1) * 2, 'Task19 mafia survival: the curve accelerates - round 4 is worth much more than double round 1, not a flat rate');

  // playerCount:8 = Task 22's reference game size, so the mafia-bonus scale
  // factor is exactly 1 and these stay pure tests of the base formula.
  const s1 = G.createGame(seats('m1', 8), {playerCount:8, mafiaCount:1, roles: Object.assign({}, ALL_OFF)});
  const mafia1 = s1.players.find(p => p.role === 'Mafia');
  const r1n1 = Scoring.scoreRound(s1, {night:1, nightResult:{}, dayResult:{}});
  const r1n4 = Scoring.scoreRound(s1, {night:4, nightResult:{}, dayResult:{}});
  assert(r1n1[mafia1.id].total === Scoring.survivalCurvePoints(1), 'Task19 mafia survival: a surviving mafia-aligned player earns the round-1 survival value');
  assert(r1n4[mafia1.id].total === Scoring.survivalCurvePoints(4), 'Task19 mafia survival: the same player surviving round 4 earns the much larger round-4 survival value');

  const s2 = G.createGame(seats('m2', 8), {playerCount:8, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Detective:true})});
  const mafia2 = s2.players.find(p => p.role === 'Mafia');
  const det2 = s2.players.find(p => p.role === 'Detective');
  const scores2 = Scoring.scoreRound(s2, {night:1, nightResult:{nightDeathOccurred:true, revealVictim: det2}, dayResult:{}});
  const keyKillEntry = scores2[mafia2.id].breakdown.find(b => b.rule === 'mafia-key-kill');
  assert(!!keyKillEntry && keyKillEntry.points === 15, 'Task19 mafia: +15 when the night kill lands on the Detective');

  function misdirectionSetup(nightNum){
    const st = G.createGame(seats('m3n'+nightNum, 7), {playerCount:7, mafiaCount:1, roles: Object.assign({}, ALL_OFF)});
    st.night = nightNum;
    const mafiaP = st.players.find(p => p.role === 'Mafia');
    const lynchedP = st.players.find(p => p.role === 'Civilian');
    G.recordAccusation(st, mafiaP.id, lynchedP.id); // tagged with st.night === nightNum
    lynchedP.alive = false;
    const scores = Scoring.scoreRound(st, {night: nightNum, nightResult:{}, dayResult:{lead: lynchedP}});
    return { mafiaP, scores };
  }
  const early = misdirectionSetup(1);
  const late = misdirectionSetup(4);
  const misdirEarly = early.scores[early.mafiaP.id].breakdown.find(b => b.rule === 'mafia-misdirection');
  const misdirLate = late.scores[late.mafiaP.id].breakdown.find(b => b.rule === 'mafia-misdirection');
  assert(!!misdirEarly && misdirEarly.points === Scoring.misdirectionPoints(1), 'Task19 mafia misdirection: awarded when mafia was first to accuse the town-aligned player who got lynched');
  assert(!!misdirLate && misdirLate.points === Scoring.misdirectionPoints(4), 'Task19 mafia misdirection: the same rule applied to a later round uses that round\'s scaling');
  assert(misdirEarly.points > misdirLate.points, 'Task19 mafia misdirection: the same misdirection scores higher the earlier in the game it happened');

  const s4 = G.createGame(seats('m4', 6), {playerCount:6, mafiaCount:0, roles: Object.assign({}, ALL_OFF, {CrazyGranny:true})});
  const granny = s4.players.find(p => p.role === 'CrazyGranny');
  granny.flipped = true; granny.align = 'mafia';
  const scoresFlippedSurvived = Scoring.scoreRound(s4, {night:2, nightResult:{}, dayResult:{}, grannyFlippedThisRound:false});
  const grannyBonus = scoresFlippedSurvived[granny.id].breakdown.find(b => b.rule === 'granny-post-flip');
  assert(!!grannyBonus, 'Task19 mafia: a flipped Granny surviving a round post-flip earns the small separate bonus');
  const scoresFlipRound = Scoring.scoreRound(s4, {night:1, nightResult:{}, dayResult:{}, grannyFlippedThisRound:true});
  assert(!scoresFlipRound[granny.id].breakdown.some(b => b.rule === 'granny-post-flip'), 'Task19 mafia: the exact round the Granny flips does not itself count as a round survived post-flip');
})();

// ============================================================
// Cross-cutting rule: "Saved the Miller" - any town-aligned player who voted
// for someone other than a Miller who received real votes/accusation that
// round and survived.
// ============================================================
(function testSavedTheMiller(){
  const s = G.createGame(seats('sm', 7), {playerCount:7, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Miller:true})});
  const miller = s.players.find(p => p.role === 'Miller');
  const mafia = s.players.find(p => p.role === 'Mafia');
  const civs = s.players.filter(p => p.role === 'Civilian');

  G.recordAccusation(s, civs[0].id, miller.id); // the town square points at the Miller this round
  G.recordDayVoteSubmission(s, civs[0].id, civs[1].id); // but civs[0] actually votes elsewhere
  G.recordDayVoteSubmission(s, civs[2].id, miller.id);  // civs[2] piles onto the Miller instead
  G.recordDayVoteSubmission(s, mafia.id, civs[1].id);    // mafia-aligned, should never earn this town-only bonus

  const scores = Scoring.scoreRound(s, {night:1, nightResult:{}, dayResult:{}});
  assert(scores[civs[0].id].total === 5, 'Task19 saved-the-miller: a town player who voted for someone other than an accused-but-surviving Miller earns the bonus');
  assert(!scores[civs[2].id], 'Task19 saved-the-miller: a town player who voted FOR the Miller does not earn the bonus');
  assert(!(scores[mafia.id] && scores[mafia.id].breakdown.some(b => b.rule === 'saved-the-miller')), 'Task19 saved-the-miller: a mafia-aligned player never earns this town-only bonus');
})();

// ============================================================
// Task 22: the round-indexed mafia bonuses (survival curve, kill-Detective,
// kill-Doctor) scale by totalPlayers/8 against an 8-player reference game.
// Doctor/Coward/Farmer blind-guess and the town baseline formula must stay
// byte-for-byte untouched by this - they already scale by construction.
// ============================================================
(function testMafiaBonusPlayerCountScaling(){
  // Pure formula check first, unconstrained by game.js's own MAX_PLAYERS seat
  // cap (12) - scaleMafiaBonus is just arithmetic, so this can exercise the
  // exact 6/8/16 comparison the spec calls for.
  const base3 = Scoring.survivalCurvePoints(3);
  assert(Scoring.scaleMafiaBonus(base3, 8) === base3, 'Task22: scaleMafiaBonus at the 8-player reference size returns the base value unchanged');
  assert(Scoring.scaleMafiaBonus(base3, 6) === Math.round(base3 * 0.75), 'Task22: scaleMafiaBonus at 6 players scales down by exactly 6/8');
  assert(Scoring.scaleMafiaBonus(base3, 16) === Math.round(base3 * 2), 'Task22: scaleMafiaBonus at 16 players scales up by exactly 16/8 (double the reference)');
  assert(Scoring.scaleMafiaBonus(15, 16) === Scoring.scaleMafiaBonus(15, 8) * 2, 'Task22: doubling the reference player count exactly doubles a round-indexed mafia bonus');

  // End-to-end through scoreRound itself, at every game size game.js's own
  // seat cap actually supports (6 to 12) - proves the scaling is really wired
  // into the survival-curve and key-kill code paths, not just the helper.
  function survivalAt(totalPlayers, night){
    const st = G.createGame(seats('sc'+totalPlayers, totalPlayers), {playerCount: totalPlayers, mafiaCount:1, roles: Object.assign({}, ALL_OFF)});
    const mafiaP = st.players.find(p => p.role === 'Mafia');
    const scores = Scoring.scoreRound(st, {night, nightResult:{}, dayResult:{}});
    return scores[mafiaP.id].total;
  }
  assert(survivalAt(8, 3) === base3, 'Task22: at the 8-player reference size, round-3 survival through scoreRound is unchanged from the raw base formula');
  assert(survivalAt(6, 3) === Scoring.scaleMafiaBonus(base3, 6), 'Task22: at 6 players, round-3 survival through scoreRound scales down by exactly 6/8');
  assert(survivalAt(12, 3) === Scoring.scaleMafiaBonus(base3, 12), 'Task22: at 12 players (game.js\'s own seat cap), round-3 survival through scoreRound scales up by exactly 12/8');

  function keyKillAt(totalPlayers, victimRole){
    const st = G.createGame(seats('kk'+totalPlayers+victimRole, totalPlayers), {playerCount: totalPlayers, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Detective:true, Doctor:true})});
    const mafiaP = st.players.find(p => p.role === 'Mafia');
    const victim = st.players.find(p => p.role === victimRole);
    const scores = Scoring.scoreRound(st, {night:1, nightResult:{nightDeathOccurred:true, revealVictim: victim}, dayResult:{}});
    return scores[mafiaP.id].breakdown.find(b => b.rule === 'mafia-key-kill').points;
  }
  assert(keyKillAt(8, 'Detective') === 15, 'Task22: at the 8-player reference size, the kill-Detective bonus through scoreRound is unchanged at 15');
  assert(keyKillAt(6, 'Detective') === Scoring.scaleMafiaBonus(15, 6), 'Task22: at 6 players, the kill-Detective bonus through scoreRound scales down by exactly 6/8');
  assert(keyKillAt(12, 'Doctor') === Scoring.scaleMafiaBonus(15, 12), 'Task22: at 12 players, the kill-Doctor bonus through scoreRound scales up by exactly 12/8');

  // Regression: Doctor/Coward/Farmer blind-guess and town-baseline formulas
  // must be completely untouched by player-count scaling.
  function blindGuessAt(totalPlayers){
    const st = G.createGame(seats('bg'+totalPlayers, totalPlayers), {playerCount: totalPlayers, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Doctor:true})});
    const doc = st.players.find(p => p.role === 'Doctor');
    G.recordLivingCountSnapshot(st, doc.id, 'Doctor', 'protect');
    const scores = Scoring.scoreRound(st, {night:1, nightResult:{doctorSaved:true}, dayResult:{}});
    return scores[doc.id].total;
  }
  assert(blindGuessAt(6) === Math.round(2 * 6), 'Task22 regression: Doctor blind-guess at 6 players is still exactly round(2 * livingCount), untouched by the player-count scale');
  assert(blindGuessAt(12) === Math.round(2 * 12), 'Task22 regression: Doctor blind-guess at 12 players is still exactly round(2 * livingCount), untouched by the player-count scale');

  function townBaselineAt(totalPlayers){
    const st = G.createGame(seats('tbx'+totalPlayers, totalPlayers), {playerCount: totalPlayers, mafiaCount:1, roles: Object.assign({}, ALL_OFF)});
    const mafiaP = st.players.find(p => p.role === 'Mafia');
    mafiaP.alive = false;
    const civP = st.players.find(p => p.role === 'Civilian');
    G.recordDayVoteSubmission(st, civP.id, mafiaP.id);
    const scores = Scoring.scoreRound(st, {night:1, nightResult:{}, dayResult:{lead: mafiaP}});
    return scores[civP.id].total;
  }
  assert(townBaselineAt(6) === 20, 'Task22 regression: town-baseline at 6 players is still exactly the unscaled formula value (sole/earliest correct vote = 20)');
  assert(townBaselineAt(12) === 20, 'Task22 regression: town-baseline at 12 players is still exactly the unscaled formula value, untouched by the player-count scale');
})();

// ============================================================
// Full multi-round integration test: point totals accumulate correctly
// across rounds, using the real game.js resolution functions (not stubs).
// ============================================================
(function testMultiRoundAccumulation(){
  const state = G.createGame(seats('mr', 6), {playerCount:6, mafiaCount:1, roles: Object.assign({}, ALL_OFF, {Doctor:true})});
  const mafia = state.players.find(p => p.role === 'Mafia');
  const doctor = state.players.find(p => p.role === 'Doctor');
  const civs = state.players.filter(p => p.role === 'Civilian'); // 4 civilians

  const totals = {};
  function accumulate(scores){
    Object.keys(scores).forEach(id => {
      totals[id] = (totals[id] || 0) + scores[id].total;
    });
  }

  // Round 1 night: mafia kills civA, doctor protects civB (kill still lands).
  state.pendingNightVotes[mafia.id] = {kill: civs[0].id};
  G.recordLivingCountSnapshot(state, doctor.id, 'Doctor', 'protect');
  state.pendingNightVotes[doctor.id] = {protect: civs[1].id};
  const night1 = G.resolveNight(state);

  // Round 1 day: everyone still alive votes out the mafia player.
  const living1 = G.living(state);
  living1.forEach(p => G.recordDayVoteSubmission(state, p.id, mafia.id));
  const day1 = G.resolveDayVote(state);
  assert(day1.lead.id === mafia.id, 'Task19 integration setup: round 1 town correctly lynches the mafia player');

  accumulate(Scoring.scoreRound(state, {night: 1, nightResult: night1, dayResult: day1}));

  // Every surviving town-aligned voter should have earned town-baseline
  // points for correctly voting out the mafia player.
  const correctVoters = living1.filter(p => p.id !== mafia.id);
  correctVoters.forEach(p => {
    assert(totals[p.id] > 0, 'Task19 integration: '+p.name+' accumulated positive points for round 1\'s correct lynch vote');
  });
  assert(!totals[mafia.id], 'Task19 integration: the eliminated mafia player earns no round-1 survival points once dead');

  G.startNextNight(state);
  assert(state.night === 2, 'Task19 integration setup: round advances to night 2');

  // Round 2: quiet night (mafia is dead, nothing to resolve), then a day vote
  // among the remaining living players.
  const night2 = G.resolveNight(state);
  const living2 = G.living(state);
  const singleTargetForRound2 = living2[0];
  living2.forEach(p => { if(p.id !== singleTargetForRound2.id) G.recordDayVoteSubmission(state, p.id, singleTargetForRound2.id); });
  const day2 = G.resolveDayVote(state);

  const round2Scores = Scoring.scoreRound(state, {night: 2, nightResult: night2, dayResult: day2});
  accumulate(round2Scores);

  // No mafia left alive, so no more mafia-survival points should ever accrue,
  // and totals from round 1 must persist rather than being overwritten.
  assert(Object.keys(round2Scores).every(id => !state.players.find(p => p.id===id && p.align==='mafia')), 'Task19 integration: with the mafia already eliminated, no further mafia-aligned points are ever awarded in round 2');
  correctVoters.forEach(p => {
    assert(totals[p.id] > 0, 'Task19 integration: round 1 points for '+p.name+' are still present in the running total after round 2 resolves, not overwritten');
  });
})();

console.log('\nAll scoring.js checks completed.');
