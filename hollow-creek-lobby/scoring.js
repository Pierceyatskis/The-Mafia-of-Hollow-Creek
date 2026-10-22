// Hollow Creek - Skill-Based Scoring System.
// Pure logic, no I/O, no sockets - mirrors game.js so it can be unit tested
// the same way. Runs once per round resolution, fed the append-only Task
// 17/18 tracking arrays (voteSubmissionOrder, livingCountAtAction,
// accusationLog) plus the transient result objects game.js's own
// resolveNight/resolveDayVote/resolveFarmerRevenge already return for that
// round.
//
// Design philosophy: score the decision, not the outcome. A player who casts
// a vote that's consistent with the information they actually had (even if
// that information came from a misleading-but-mechanically-correct read, like
// investigating a Miller) is not making a worse decision than one who got a
// clean guilty read - role-distribution luck is never conflated with skill.

const G = require('./game.js');

const TOWN_BASELINE_MAX = 20;
const TOWN_BASELINE_FLOOR = 2;
const DETECTIVE_CONSISTENT_BONUS = 15;
const DETECTIVE_AGAINST_GUILTY_PENALTY = -10;
const BLIND_GUESS_MULTIPLIER = 2;
const BOUNTY_DAY_VOTE_BONUS = 25;
const BOUNTY_NIGHT_KILL_BONUS = 8;
const BOUNTY_NEAR_MISS_BONUS = 5;
const MAFIA_KILL_DETECTIVE_BONUS = 20;
const MAFIA_KILL_DOCTOR_BONUS = 20;
const GRANNY_POST_FLIP_BONUS = 10;
const SAVED_MILLER_BONUS = 5;

// Task 22: the round-indexed mafia bonuses (survival curve, kill-Detective,
// kill-Doctor) were built around round number alone, blind to how many
// players are actually in the game. Scale them against an 8-player reference
// game so a 16-seat game doesn't under-reward survival/kills relative to a
// 6-seat one. Doctor/Coward/Farmer blind-guess and the town baseline formula
// are already proportional (living count, fraction) by construction and must
// stay untouched by this scale.
const MAFIA_BONUS_REFERENCE_PLAYER_COUNT = 8;
function scaleMafiaBonus(baseValue, totalPlayers){
  return Math.round(baseValue * (totalPlayers / MAFIA_BONUS_REFERENCE_PLAYER_COUNT));
}

// Accelerating on purpose - round 4 survival matters a lot more than round 1.
function survivalCurvePoints(night){
  // 4, 10, 19, 31, 46 (was 3, 8, 17, 28, 43; originally 3n^2: 3, 12, 27, 48, 75), then only +4 a round: a long game no longer snowballs a surviving mafia player's total
  const n = Math.min(night, 5);
  return Math.round(1.5 * n * n + 1.5 * n + 1) + Math.max(0, night - 5) * 4;
}

// Decays with round number - an early, effective misdirection is worth far
// more than one thrown out once the town was going to figure it out anyway.
function misdirectionPoints(night){
  return Math.round(20 / night);
}

function addPoints(scores, playerId, points, rule, detail){
  if(!points) return;
  if(!scores[playerId]) scores[playerId] = { total: 0, breakdown: [] };
  scores[playerId].total += points;
  scores[playerId].breakdown.push({ rule, points, detail });
}

// round = {
//   night,
//   nightResult,   // return value of game.js's resolveNight for this round
//   dayResult,     // return value of game.js's resolveDayVote for this round
//   revengeResult, // return value of resolveFarmerRevenge, if it fired (optional)
//   grannyFlippedThisRound // true only on the exact round checkGrannyFlip flipped them (optional)
// }
// Returns { [playerId]: { total, breakdown: [{rule, points, detail}] } } - only
// for this round's points, so the caller accumulates across rounds itself.
function scoreRound(state, round){
  const night = round.night;
  const nightResult = round.nightResult || {};
  const dayResult = round.dayResult || {};
  const revengeResult = round.revengeResult || null;
  const grannyFlippedThisRound = !!round.grannyFlippedThisRound;

  const scores = {};
  const votesThisRound = state.voteSubmissionOrder.filter(v => v.night === night);
  const snapshotsThisRound = state.livingCountAtAction.filter(e => e.night === night);
  const lead = dayResult.lead || null;

  // votesThisRound is append-only (see game.js's recordDayVoteSubmission) -
  // every resubmission before the phase ended gets its own entry, on
  // purpose, since that's genuinely useful timing data. But every scoring
  // rule below cares about what a player actually *decided*, not how many
  // times they changed their mind - build each player's single latest
  // submission once and score against that, never the raw array directly.
  // Same principle already applied to livingCountAtAction above.
  const latestVoteByPlayer = new Map();
  votesThisRound.forEach(v => { latestVoteByPlayer.set(v.playerId, v); });
  const finalVotesThisRound = Array.from(latestVoteByPlayer.values());

  // --- Town baseline (all non-Detective town-aligned roles): correct vote only ---
  if(lead && lead.align === 'mafia'){
    const votesForLead = finalVotesThisRound.filter(v => v.targetId === lead.id);
    votesForLead.forEach(v => {
      const voter = G.byId(state, v.playerId);
      if(!voter || voter.align !== 'town' || voter.role === 'Detective') return;
      const others = votesForLead.filter(o => o.playerId !== v.playerId);
      const before = others.filter(o => o.submittedAt < v.submittedAt).length;
      const fraction = others.length ? before / others.length : 0;
      const points = Math.max(TOWN_BASELINE_FLOOR, Math.round(TOWN_BASELINE_MAX * (1 - fraction)));
      addPoints(scores, voter.id, points, 'town-baseline', 'Correctly voted out a mafia-aligned player');
    });
  }

  // --- Detective (replaces baseline) ---
  const detective = state.players.find(p => p.role === 'Detective');
  if(detective){
    const detectiveVote = latestVoteByPlayer.get(detective.id) || null;
    const detectiveTargetId = detectiveVote ? detectiveVote.targetId : null;
    const readsByTargetId = {};
    (state.detectiveLog || []).forEach(entry => {
      const p = state.players.find(pl => pl.name === entry.name);
      if(p) readsByTargetId[p.id] = entry.read;
    });
    const livingGuiltyIds = Object.keys(readsByTargetId).filter(id => readsByTargetId[id] === 'guilty' && G.byId(state, id) && G.byId(state, id).alive);
    const livingInnocentIds = Object.keys(readsByTargetId).filter(id => readsByTargetId[id] === 'innocent' && G.byId(state, id) && G.byId(state, id).alive);
    if(livingGuiltyIds.length){
      if(detectiveTargetId && livingGuiltyIds.indexOf(detectiveTargetId) !== -1){
        addPoints(scores, detective.id, DETECTIVE_CONSISTENT_BONUS, 'detective-consistent', 'Voted consistent with a confirmed guilty read');
      } else {
        addPoints(scores, detective.id, DETECTIVE_AGAINST_GUILTY_PENALTY, 'detective-against-guilty', 'Did not vote for a confirmed guilty suspect');
      }
    } else if(livingInnocentIds.length){
      if(!detectiveTargetId || livingInnocentIds.indexOf(detectiveTargetId) === -1){
        addPoints(scores, detective.id, DETECTIVE_CONSISTENT_BONUS, 'detective-consistent', 'Defended a confirmed innocent read instead of voting for them');
      }
    }
  }

  // --- Doctor / Coward (hideBehind) / Farmer (revenge) - successful blind guess ---
  // A player can resubmit their night action before the phase ends (Doctor
  // changing their protect target, etc.), and each submission records its
  // own snapshot - so snapshotsThisRound can hold more than one entry for
  // the same player/actionType this round. Only the latest one reflects
  // what they actually ended up doing; scoring every entry would pay out
  // once per resubmission instead of once per player. Array order is
  // submission order (see recordLivingCountSnapshot), so keeping the last
  // match per playerId+actionType keeps only their final choice.
  const latestSnapshotByPlayerAction = new Map();
  snapshotsThisRound.forEach(snap => {
    latestSnapshotByPlayerAction.set(snap.playerId + '|' + snap.actionType, snap);
  });
  latestSnapshotByPlayerAction.forEach(snap => {
    let success = false;
    if(snap.actionType === 'protect') success = !!nightResult.doctorSaved;
    else if(snap.actionType === 'hideBehind') success = !!nightResult.cowardRedirected;
    else if(snap.actionType === 'farmerRevenge') success = !!(revengeResult && revengeResult.revengeKillOccurred);
    if(success){
      const points = Math.round(BLIND_GUESS_MULTIPLIER * snap.livingCount);
      addPoints(scores, snap.playerId, points, 'blind-guess', snap.role + ' blind guess paid off');
    }
  });

  // --- Bounty Hunter ---
  const bountyHunter = state.players.find(p => p.role === 'BountyHunter');
  const bountyTargetId = state.bountyTarget;
  if(bountyHunter && bountyTargetId){
    const targetDiedByVote = !!(lead && lead.id === bountyTargetId && lead.alive === false);
    const targetDiedByNight = !!(nightResult.nightDeathOccurred && nightResult.revealVictim && nightResult.revealVictim.id === bountyTargetId);
    if(targetDiedByVote){
      addPoints(scores, bountyHunter.id, BOUNTY_DAY_VOTE_BONUS, 'bounty-day-vote', 'Bounty target eliminated by the town\'s vote');
    } else if(targetDiedByNight){
      addPoints(scores, bountyHunter.id, BOUNTY_NIGHT_KILL_BONUS, 'bounty-night-kill', 'Bounty target died in the night');
    } else {
      // Never expose *why* a near miss happened (e.g. a doctor save) - the
      // reason string stays generic even here, server-side.
      const receivedVotes = finalVotesThisRound.some(v => v.targetId === bountyTargetId);
      const nearMissLynch = receivedVotes && (!lead || lead.id !== bountyTargetId);
      const nearMissNightSave = nightResult.killTargetId === bountyTargetId && !!nightResult.doctorSaved;
      if(nearMissLynch || nearMissNightSave){
        addPoints(scores, bountyHunter.id, BOUNTY_NEAR_MISS_BONUS, 'bounty-near-miss', 'Bounty target narrowly survived this round');
      }
    }
  }

  // --- Mafia-aligned: survival curve, key-role kill bonuses, misdirection, granny ---
  const totalPlayers = state.players.length;
  const aliveMafia = state.players.filter(p => p.alive && p.align === 'mafia');
  aliveMafia.forEach(p => {
    addPoints(scores, p.id, scaleMafiaBonus(survivalCurvePoints(night), totalPlayers), 'mafia-survival', 'Survived round ' + night);
    if(p.role === 'CrazyGranny' && p.flipped && !grannyFlippedThisRound){
      addPoints(scores, p.id, GRANNY_POST_FLIP_BONUS, 'granny-post-flip', 'Survived a round undercover after flipping');
    }
  });
  if(nightResult.nightDeathOccurred && nightResult.revealVictim){
    const victimRole = nightResult.revealVictim.role;
    if(victimRole === 'Detective' || victimRole === 'Doctor'){
      const baseBonus = victimRole === 'Detective' ? MAFIA_KILL_DETECTIVE_BONUS : MAFIA_KILL_DOCTOR_BONUS;
      const bonus = scaleMafiaBonus(baseBonus, totalPlayers);
      aliveMafia.forEach(p => addPoints(scores, p.id, bonus, 'mafia-key-kill', 'Night elimination took out the ' + victimRole));
    }
  }
  if(lead && lead.align === 'town'){
    const firstAccusation = G.firstAccuserOf(state, lead.id, night);
    if(firstAccusation){
      const accuser = G.byId(state, firstAccusation.accuserId);
      if(accuser && accuser.align === 'mafia'){
        addPoints(scores, accuser.id, misdirectionPoints(night), 'mafia-misdirection', 'First accused the town-aligned player who was lynched');
      }
    }
  }

  // --- Saved the Miller (cross-cutting, any town-aligned player) ---
  const miller = state.players.find(p => p.role === 'Miller');
  if(miller){
    const accusedThisRound = state.accusationLog.some(e => e.night === night && e.targetId === miller.id);
    const votedThisRound = finalVotesThisRound.some(v => v.targetId === miller.id);
    const millerSurvived = miller.alive === true;
    if((accusedThisRound || votedThisRound) && millerSurvived){
      finalVotesThisRound.forEach(v => {
        if(v.targetId === miller.id) return;
        const voter = G.byId(state, v.playerId);
        if(voter && voter.align === 'town'){
          addPoints(scores, voter.id, SAVED_MILLER_BONUS, 'saved-the-miller', 'Voted elsewhere instead of piling onto the Miller');
        }
      });
    }
  }

  return scores;
}

// =====================================================================
// Continuous scoring: points for the many small things a player does well
// EVERY round, not only the one big payout. scoreRound() above pays big, rare
// amounts (a correct lynch, a lucky save, a late mafia survival); on its own it
// left most town players on 0 for most rounds and a few players on a lot. These
// streams sit alongside it (never replacing it) and are merged by the caller:
//   - taking part: voting, talking
//   - reading the table: voting for / accusing / first spotting a guilty player even when the
//     town didn't finish the job; the mafia applying pressure to a town player the town then piled on
//   - standing up for your own side when it is under pressure
//   - staying alive, and weathering a hot day (ties into the Heat thermometer)
//   - winning: a bonus for the winning side at game end (and for surviving to see it)
// Returns the same shape as scoreRound: { [playerId]: { total, breakdown } }.
// =====================================================================
const PARTICIPATION_VOTE = 1;
const PARTICIPATION_TALK = 1, PARTICIPATION_TALK_BUSY = 2, TALK_BUSY_LINES = 4;
const GOOD_READ_VOTE = 8;
const SHARP_ACCUSATION = 3, FIRST_TO_SPOT_BONUS = 2, MAFIA_PRESSURE = 3, ACCUSATION_CAP = 9;
const GOOD_DEFENSE = 2, DEFENSE_CAP = 6;
const HEAT_SURVIVAL = { 2: 2, 3: 4, 4: 7 };
const WIN_BONUS = 15, SURVIVED_TO_WIN_BONUS = 5;
function survivalPoints(night){ return Math.round(1 + 0.8 * night); }   // 2, 3, 3, 4, 5, 6

function scoreRoundExtras(state, round){
  const night = round.night;
  const lead = (round.dayResult && round.dayResult.lead) || null;
  const scores = {};
  const isEnemyOf = (p, t) => t && p && ((p.align === 'town' && (t.align === 'mafia' || t.align === 'cult')));
  // each player's single final vote this day
  const latestVote = new Map();
  state.voteSubmissionOrder.filter(v => v.night === night).forEach(v => { latestVote.set(v.playerId, v); });
  const finalVotes = Array.from(latestVote.values());
  const votesAgainst = {};
  finalVotes.forEach(v => { if(v.targetId) votesAgainst[v.targetId] = (votesAgainst[v.targetId] || 0) + 1; });
  // who talked
  const lines = {};
  (state.chatLog || []).forEach(e => { if(e && !e.kind && e.night === night && e.playerId) lines[e.playerId] = (lines[e.playerId] || 0) + 1; });
  // accusations this day, one per accuser per target (an "I agree" accusation is not an original read)
  const accusations = new Map();
  (state.accusationLog || []).forEach(e => {
    if(e.night !== night || e.agreedWithId || e.accuserId === e.targetId) return;
    accusations.set(e.accuserId + '>' + e.targetId, e);
  });
  const accusedThisDay = new Set(Array.from(accusations.values()).map(e => e.targetId));
  const accusedAny = new Set((state.accusationLog || []).filter(e => e.night === night).map(e => e.targetId));

  // taking part
  finalVotes.forEach(v => {
    if(v.targetId) addPoints(scores, v.playerId, PARTICIPATION_VOTE, 'vote-cast', 'Cast a vote');
  });
  Object.keys(lines).forEach(id => {
    const pts = lines[id] >= TALK_BUSY_LINES ? PARTICIPATION_TALK_BUSY : PARTICIPATION_TALK;
    addPoints(scores, id, pts, 'spoke-up', 'Took part in the discussion');
  });

  // reading the table: a vote for a guilty player that did not become the lynch
  finalVotes.forEach(v => {
    const voter = G.byId(state, v.playerId), target = v.targetId ? G.byId(state, v.targetId) : null;
    if(!voter || !isEnemyOf(voter, target)) return;
    if(lead && lead.id === target.id) return;            // a successful lynch is paid by the town baseline
    addPoints(scores, voter.id, GOOD_READ_VOTE, 'good-read', 'Voted for a guilty player (the town did not finish the job)');
  });
  // accusations
  const accPaid = {};
  accusations.forEach(e => {
    const accuser = G.byId(state, e.accuserId), target = G.byId(state, e.targetId);
    if(!accuser || !target) return;
    let pts = 0, rule = '', detail = '';
    if(isEnemyOf(accuser, target)){
      pts = SHARP_ACCUSATION; rule = 'sharp-accusation'; detail = 'Accused a guilty player';
      const first = G.firstAccuserOf(state, target.id, night);
      if(first && first.accuserId === accuser.id){ pts += FIRST_TO_SPOT_BONUS; detail = 'Was the first to accuse a guilty player'; }
    } else if(accuser.align === 'mafia' && target.align === 'town' && (votesAgainst[target.id] || 0) >= 2){
      pts = MAFIA_PRESSURE; rule = 'mafia-pressure'; detail = 'Pointed the town at a player it then piled onto';
    }
    if(!pts) return;
    const room = ACCUSATION_CAP - (accPaid[accuser.id] || 0);
    pts = Math.min(pts, room);
    if(pts > 0){ accPaid[accuser.id] = (accPaid[accuser.id] || 0) + pts; addPoints(scores, accuser.id, pts, rule, detail); }
  });
  // standing up for your own side when it was under pressure
  const defPaid = {}; const defSeen = new Set();
  (state.chatLog || []).forEach(e => {
    if(!e || e.kind || e.night !== night || !e.defendedId || e.defendedId === e.playerId) return;
    const key = e.playerId + '>' + e.defendedId;
    if(defSeen.has(key)) return; defSeen.add(key);
    const me = G.byId(state, e.playerId), friend = G.byId(state, e.defendedId);
    if(!me || !friend || me.align !== friend.align) return;
    if(!accusedAny.has(friend.id) && !(votesAgainst[friend.id] > 0)) return;
    const room = DEFENSE_CAP - (defPaid[me.id] || 0);
    const pts = Math.min(GOOD_DEFENSE, room);
    if(pts > 0){ defPaid[me.id] = (defPaid[me.id] || 0) + pts; addPoints(scores, me.id, pts, 'good-defense', 'Stood up for a player on your side who was under pressure'); }
  });
  // staying alive, and surviving a hot day
  state.players.forEach(p => {
    if(!p.alive) return;
    if(p.align !== 'mafia') addPoints(scores, p.id, survivalPoints(night), 'survival', 'Survived round ' + night);
    const h = G.computeHeat(state, p.id);
    if(HEAT_SURVIVAL[h.level]) addPoints(scores, p.id, HEAT_SURVIVAL[h.level], 'weathered-the-storm', 'Survived a ' + G.HEAT_LEVELS[h.level] + ' day (' + h.percent + '% of the table against you)');
  });
  // the game is over: the winning side is rewarded, and so is living to see it
  if(state.gameOver && !state.winBonusPaid){
    state.winBonusPaid = true;
    const w = state.winner;
    state.players.forEach(p => {
      const won = w === 'town' ? p.align === 'town' : w === 'mafia' ? p.align === 'mafia' : w === 'cult' ? p.align === 'cult' : w === 'bounty' ? p.role === 'BountyHunter' : false;
      if(!won) return;
      addPoints(scores, p.id, WIN_BONUS, 'win', 'Your side won the game');
      if(p.alive) addPoints(scores, p.id, SURVIVED_TO_WIN_BONUS, 'survived-to-win', 'Survived to the end');
    });
  }
  return scores;
}

// Adds b's points and breakdown lines into a (both in scoreRound's shape).
function mergeScores(a, b){
  const out = {};
  [a, b].forEach(m => Object.keys(m || {}).forEach(id => {
    if(!out[id]) out[id] = { total: 0, breakdown: [] };
    out[id].total += m[id].total;
    out[id].breakdown = out[id].breakdown.concat(m[id].breakdown);
  }));
  return out;
}

module.exports = { scoreRound, scoreRoundExtras, mergeScores, survivalCurvePoints, misdirectionPoints, scaleMafiaBonus, MAFIA_BONUS_REFERENCE_PLAYER_COUNT };
