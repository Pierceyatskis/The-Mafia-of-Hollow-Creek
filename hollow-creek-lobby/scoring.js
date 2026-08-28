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
const MAFIA_KILL_DETECTIVE_BONUS = 15;
const MAFIA_KILL_DOCTOR_BONUS = 15;
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
  return Math.round(3 * night * night);
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
      addPoints(scores, bountyHunter.id, BOUNTY_NIGHT_KILL_BONUS, 'bounty-night-kill', 'Bounty target killed in the night');
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
      aliveMafia.forEach(p => addPoints(scores, p.id, bonus, 'mafia-key-kill', 'Night kill eliminated the ' + victimRole));
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

module.exports = { scoreRound, survivalCurvePoints, misdirectionPoints, scaleMafiaBonus, MAFIA_BONUS_REFERENCE_PLAYER_COUNT };
