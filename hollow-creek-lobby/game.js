// Hollow Creek - server-authoritative game engine.
// Pure logic, no I/O, no sockets. Ported rule-for-rule from hollow_creek_game.html
// so the multiplayer game behaves exactly like the single-player one.
// Every function here takes/returns plain data so it's easy to test in isolation.

const CHARACTERS = [
  {id:'mabel', name:'Mabel Finch', occ:'bakery owner', color:'#B8502A'},
  {id:'otis', name:'Otis Redwood', occ:'mill hand', color:'#6B5B8A'},
  {id:'agatha', name:'Sister Agatha Pruitt', occ:'church organist & town healer', color:'#4C7C67'},
  {id:'nettie', name:'Nettie Calloway', occ:'town librarian', color:'#B08A3E'},
  {id:'corky', name:'Corky Wade', occ:'general store clerk, ex-deputy', color:'#7A6A54'},
  {id:'ida', name:'Ida Wexford', occ:'retiree, pie baker', color:'#9A7CA0'},
  {id:'silas', name:'Silas Crane', occ:'church groundskeeper', color:'#4E6E8E'},
  {id:'dot', name:'Dot Higgins', occ:'diner owner', color:'#C1544B'},
  {id:'walt', name:'Walt Pemberton', occ:'town mechanic', color:'#5C6B47'},
  {id:'roz', name:'Roz Okafor', occ:'schoolteacher', color:'#3E6E8E'},
  {id:'tom', name:'Big Tom Yarrow', occ:'feed store owner', color:'#8C6B3E'}
];

const ROLE_LABEL = {
  Detective:'the detective', Godfather:'the godfather', Mafia:'a mafia enforcer',
  DoubleAgent:'the double agent', Doctor:'the doctor', Miller:'the miller',
  BountyHunter:'the bounty hunter', CrazyGranny:'the crazy granny', Coward:'the coward',
  Farmer:'the farmer', NavySeal:'the war veteran', Civilian:'a civilian'
};

const SPECIAL_ROLES = ['Godfather','Mafia','DoubleAgent','Detective','Doctor','Miller','BountyHunter','CrazyGranny','Coward','Farmer','NavySeal'];

const MIN_PLAYERS = 6;
const MAX_PLAYERS = CHARACTERS.length + 1; // +1 for at least one real seat beyond the character pool isn't needed; kept for parity with single-player (12)
const MAX_MAFIA_COUNT = 4;

const DEFAULT_ROLES_CONFIG = {Godfather:true, DoubleAgent:true, Detective:true, Doctor:true, Miller:true, BountyHunter:true, CrazyGranny:true, Coward:false, Farmer:false, NavySeal:false};

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const t=a[i]; a[i]=a[j]; a[j]=t;
  }
  return a;
}

function alignOf(role){
  if(role==='Godfather'||role==='DoubleAgent'||role==='Mafia') return 'mafia';
  if(role==='BountyHunter') return 'neutral';
  return 'town';
}

function specialRoleCount(rolesConfig){
  return SPECIAL_ROLES.filter(r => r !== 'Mafia' && rolesConfig[r]).length;
}

// Enabled special roles + mafiaCount must fit within playerCount, or the pool
// would silently drop whichever role sits last in SPECIAL_ROLES when sliced.
function validateSeatCapacity(config){
  const specials = specialRoleCount(config.roles);
  const mafiaCount = config.mafiaCount || 0;
  const needed = specials + mafiaCount;
  if(config.playerCount < needed){
    return { ok:false, error: 'Not enough seats for the roles you\'ve enabled: needs '+needed+' seats ('+specials+' special role'+(specials===1?'':'s')+' + '+mafiaCount+' mafia), but only '+config.playerCount+' seat'+(config.playerCount===1?'':'s')+' configured.' };
  }
  return { ok:true };
}

function buildRolePool(config){
  const pool = SPECIAL_ROLES.filter(r => r !== 'Mafia' && config.roles[r]);
  for(let i=0;i<config.mafiaCount;i++) pool.push('Mafia');
  while(pool.length < config.playerCount) pool.push('Civilian');
  return pool.slice(0, config.playerCount);
}

// seats: array of {id, name, isHuman} for REAL connected players, in the order
// they should be seated first. Remaining slots up to config.playerCount are
// filled with placeholder characters from CHARACTERS (not yet used this game).
function createGame(seats, config){
  config = Object.assign({playerCount: Math.max(MIN_PLAYERS, seats.length), mafiaCount: 0, roles: DEFAULT_ROLES_CONFIG}, config);
  config.playerCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, config.playerCount, CHARACTERS.length + seats.length));
  const capacity = validateSeatCapacity(config);
  if(!capacity.ok) throw new Error(capacity.error);
  const pool = buildRolePool(config);
  const roles = shuffle(pool);

  const players = [];
  seats.forEach((seat, idx) => {
    players.push({
      id: seat.id, name: seat.name, isHuman: true, isPlaceholder: false,
      alive: true, silencedToday: false, role: roles[idx], align: alignOf(roles[idx]),
      flipped: false, investigateCount: 0, usedNavySealCounter: false
    });
  });
  const remaining = config.playerCount - seats.length;
  const usedIds = new Set(seats.map(s => s.id));
  const bench = CHARACTERS.filter(c => !usedIds.has(c.id));
  bench.slice(0, Math.max(0, remaining)).forEach((c, i) => {
    const roleIdx = seats.length + i;
    players.push({
      id: c.id, name: c.name, occ: c.occ, color: c.color, isHuman: false, isPlaceholder: true,
      alive: true, silencedToday: false, role: roles[roleIdx], align: alignOf(roles[roleIdx]),
      flipped: false, investigateCount: 0, usedNavySealCounter: false
    });
  });

  return {
    night: 1, phase: 'night', players, bountyTarget: null, bountyPoints: 0, history: [],
    chatLog: [], mafiaChatLog: [], voteLog: [], winner: null, gameOver: false,
    pendingNightVotes: {}, // playerId -> {kill, silence, protect, investigate, bounty, hideBehind}
    pendingDayVotes: {}, // playerId -> targetId
    detectiveLog: [], farmerRevengeName: null, farmerRevengePending: null,
    // Scoring infrastructure (Task 17/18) - append-only, never cleared between
    // rounds, each entry tagged with which round (`night`) it happened in so
    // scoring.js can look at either a single round or the whole game's history.
    voteSubmissionOrder: [], // [{night, playerId, targetId, submittedAt}] in real submission order, not tally order
    livingCountAtAction: [], // [{night, playerId, role, actionType, livingCount}] - Doctor/Coward/Farmer blind-guess snapshots
    accusationLog: [], // [{night, accuserId, targetId, ts}] - Task 18
    whisperLog: [] // [{fromId, toId, text, ts}] - private day-vote whispers, visible only to the two players involved (see getPlayerView)
  };
}

// Records a day-vote the moment it's actually submitted (real player or
// placeholder fallback), preserving true chronological order - this is what
// lets scoring.js tell an early, independent vote from a late bandwagon one.
function recordDayVoteSubmission(state, playerId, targetId){
  state.pendingDayVotes[playerId] = targetId;
  state.voteSubmissionOrder.push({ night: state.night, playerId, targetId, submittedAt: Date.now() });
}

// Snapshots how many players were alive at the moment a Doctor/Coward/Farmer
// made their blind guess - a guess made with 3 people left is a much bigger
// bet than one made with 10 left, and scoring rewards it accordingly.
function recordLivingCountSnapshot(state, playerId, role, actionType){
  state.livingCountAtAction.push({ night: state.night, playerId, role, actionType, livingCount: living(state).length });
}

function byId(state, id){ return state.players.find(p => p.id === id); }
function living(state){ return state.players.filter(p => p.alive); }
function mafiaAlive(state){ return state.players.filter(p => p.alive && (p.role==='Godfather' || p.role==='DoubleAgent' || p.role==='Mafia' || (p.role==='CrazyGranny' && p.flipped))); }
function mafiaVoters(state){
  const flippedGranny = state.players.find(p => p.alive && p.role==='CrazyGranny' && p.flipped);
  if(flippedGranny) return [flippedGranny];
  return state.players.filter(p => p.alive && (p.role==='Godfather' || p.role==='Mafia' || p.role==='DoubleAgent'));
}
function log(state, line){ state.history.push('Night '+state.night+' / '+line); }

function checkWin(state){
  const m = mafiaAlive(state).length;
  const t = living(state).length - m;
  if(m===0){ state.winner='town'; state.gameOver=true; return true; }
  if(m>=t){ state.winner='mafia'; state.gameOver=true; return true; }
  if(state.bountyPoints>=3){ state.winner='bounty'; state.gameOver=true; return true; }
  return false;
}

function checkBountyHit(state, deadPlayer){
  if(deadPlayer && state.bountyTarget === deadPlayer.id){
    state.bountyPoints++;
    log(state, "The bounty hunter's private ledger gains a point.");
  }
}

function checkGrannyFlip(state){
  const ida = state.players.find(p => p.role==='CrazyGranny');
  if(ida && ida.alive && !ida.flipped && mafiaAlive(state).length===0){
    ida.flipped = true; ida.align='mafia';
    log(state, ida.name+"'s eyes went red. The last of the mafia now wears an apron.");
    return true;
  }
  return false;
}

function detectiveRead(target){
  if(target.role==='Godfather') return 'guilty';
  if(target.role==='Mafia') return 'guilty';
  if(target.role==='Miller') return 'guilty';
  if(target.role==='CrazyGranny' && target.flipped) return 'guilty';
  if(target.role==='DoubleAgent') return (target.investigateCount||0) >= 1 ? 'guilty' : 'innocent';
  return 'innocent';
}
function investigateAndRead(target){
  const read = detectiveRead(target);
  target.investigateCount = (target.investigateCount||0) + 1;
  return read;
}

// A single placeholder's night decision, when nobody real submitted one for them.
// Deliberately simple/random for now (item 4 of the roadmap covers making this
// feel less like a bot and more varied - separate pass).
function placeholderNightAction(state, player){
  const options = living(state).filter(p => p.id !== player.id);
  const pick = (pool) => pool.length ? pool[Math.floor(Math.random()*pool.length)].id : null;
  const action = {};
  if(mafiaVoters(state).some(p => p.id === player.id)){
    // Never nominate a fellow mafia-aligned teammate as the kill target.
    const nonTeammates = options.filter(p => p.align !== 'mafia');
    action.kill = pick(nonTeammates.length ? nonTeammates : options);
  }
  if(player.role==='Detective') action.investigate = pick(options);
  if(player.role==='Doctor') action.protect = pick(options);
  if(player.role==='Coward') action.hideBehind = pick(options);
  if(player.role==='BountyHunter') action.bounty = pick(options);
  return action;
}

// Merges every submitted (or placeholder-defaulted) night action and resolves
// the night in full: mafia kill consensus, coward redirect, doctor save,
// navy seal counter, bounty, silence, granny flip, win check.
function resolveNight(state){
  // Fill in anything a placeholder never submitted.
  living(state).forEach(p => {
    if(!state.pendingNightVotes[p.id]) state.pendingNightVotes[p.id] = (p.isPlaceholder || p.connected === false) ? placeholderNightAction(state, p) : {};
  });

  // Mafia kill target resolution - deliberate rule, not incidental: plurality
  // vote among every alive mafia-aligned player's submitted kill vote. If two
  // or more targets are tied for the most votes (e.g. two human teammates
  // submit different targets with no prior coordination, and nothing else
  // breaks the tie), the target is picked at random among the tied targets.
  // This is the "if the family can't agree, it comes down to a coin flip"
  // rule the client's own UI text already promises the player - the mafia
  // chat channel exists precisely so real teammates can agree on one target
  // before submitting, rather than relying on this tiebreak.
  const killVotes = [];
  mafiaVoters(state).forEach(p => {
    const v = (state.pendingNightVotes[p.id] || {}).kill;
    if(v) killVotes.push(v);
  });
  let finalKillId = null;
  if(killVotes.length){
    const tally = {};
    killVotes.forEach(v => { tally[v] = (tally[v]||0)+1; });
    const maxCount = Math.max(...Object.values(tally));
    const top = Object.keys(tally).filter(k => tally[k]===maxCount);
    finalKillId = top.length===1 ? top[0] : top[Math.floor(Math.random()*top.length)];
  }

  // Single-actor role actions: whichever alive player holds that role, human or placeholder.
  const detective = state.players.find(p => p.alive && p.role==='Detective');
  const doctor = state.players.find(p => p.alive && p.role==='Doctor');
  const coward = state.players.find(p => p.alive && p.role==='Coward');
  const bountyHunter = state.players.find(p => p.alive && p.role==='BountyHunter');
  const godfather = state.players.find(p => p.alive && p.role==='Godfather');

  const investigateTargetId = detective ? (state.pendingNightVotes[detective.id]||{}).investigate : null;
  const protectTargetId = doctor ? (state.pendingNightVotes[doctor.id]||{}).protect : null;
  const hideBehindId = coward ? (state.pendingNightVotes[coward.id]||{}).hideBehind : null;
  // Bounty Hunter re-aims every night, not just once ever - the role's own
  // description promises "place a bounty on someone each night."
  const bountyId = bountyHunter ? (state.pendingNightVotes[bountyHunter.id]||{}).bounty : null;
  const silenceId = godfather ? (state.pendingNightVotes[godfather.id]||{}).silence : null;

  if(bountyId) state.bountyTarget = bountyId;

  let killTarget = finalKillId ? byId(state, finalKillId) : null;
  const reportLines = [];
  let deathSummary;
  let nightDeathOccurred = false;
  let revealVictim = null;
  let cowardRedirected = false;

  if(killTarget && killTarget.role==='Coward' && hideBehindId){
    const hideTarget = byId(state, hideBehindId);
    if(hideTarget && hideTarget.alive && hideTarget.id !== killTarget.id){
      log(state, 'The mafia came for '+killTarget.name+', but found '+hideTarget.name+' instead.');
      killTarget = hideTarget;
      cowardRedirected = true;
    }
  }

  const doctorSaved = protectTargetId && killTarget && protectTargetId === killTarget.id;
  // Who the kill mechanism was actually pointed at, post coward-swap, right
  // before the doctor-save check - this is what scoring.js needs to know
  // whether the Bounty Hunter's target was the night-kill target (even when
  // saved), without ever exposing *why* they survived to anyone.
  const killTargetId = killTarget ? killTarget.id : null;
  const navySealCounter = killTarget && killTarget.role==='NavySeal' && !killTarget.usedNavySealCounter && !doctorSaved;

  if(navySealCounter){
    killTarget.usedNavySealCounter = true;
    const mafiaOptions = state.players.filter(p => p.alive && p.align==='mafia');
    if(mafiaOptions.length){
      const counterVictim = mafiaOptions[Math.floor(Math.random()*mafiaOptions.length)];
      counterVictim.alive = false;
      checkBountyHit(state, counterVictim);
      reportLines.push(counterVictim.name+' was found dead this morning — word is the family\'s hit went badly wrong.');
      log(state, 'The mafia moved on '+killTarget.name+', but they fought back and killed '+counterVictim.name+' ('+counterVictim.role+') instead.');
      deathSummary = counterVictim.name+' ('+counterVictim.role+') was killed in the night.';
      nightDeathOccurred = true; revealVictim = counterVictim;
    } else {
      reportLines.push('A quiet night, for once. No one made a move.');
      deathSummary = 'No one died last night.';
    }
  } else if(!killTarget){
    reportLines.push('A quiet night, for once. No one made a move.');
    deathSummary = 'No one died last night.';
  } else if(doctorSaved){
    reportLines.push('An empty coffin. Someone tried, in the dark, and someone else stopped them just in time.');
    log(state, 'The mafia struck at '+killTarget.name+', but the doctor\'s hands got there first.');
    deathSummary = 'No one died last night, the doctor\'s protection held.';
  } else {
    killTarget.alive = false;
    checkBountyHit(state, killTarget);
    reportLines.push(killTarget.name+' was found this morning. The town gathers, uneasy.');
    log(state, killTarget.name+' ('+killTarget.role+') was killed in the night.');
    deathSummary = killTarget.name+' ('+killTarget.role+') was killed in the night.';
    nightDeathOccurred = true; revealVictim = killTarget;
  }

  state.players.forEach(p => { p.silencedToday = false; });
  let silencedPlayerId = null;
  if(silenceId){
    const s = byId(state, silenceId);
    if(s && s.alive){
      s.silencedToday = true;
      log(state, s.name+' was silenced for the coming day.');
      silencedPlayerId = s.id;
    }
  }

  let investigationResult = null;
  if(detective && investigateTargetId){
    const target = byId(state, investigateTargetId);
    if(target){
      const read = investigateAndRead(target);
      log(state, detective.name+' investigated '+target.name+' and it read '+read+'.');
      state.detectiveLog.push({name: target.name, read: read});
      investigationResult = {detectiveId: detective.id, targetId: target.id, targetName: target.name, read: read};
    }
  }

  checkGrannyFlip(state);
  state.cachedOvernightReport = reportLines.join(' ');
  const gameOver = checkWin(state);

  state.pendingNightVotes = {};
  state.phase = 'day-discuss';

  return {reportLines, deathSummary, nightDeathOccurred, revealVictim, silencedPlayerId, investigationResult, gameOver, killTargetId, doctorSaved: !!doctorSaved, cowardRedirected};
}

function resolveDayVote(state, timedOutFallbackId){
  const tally = {};
  living(state).forEach(p => { tally[p.id] = 0; });

  living(state).forEach(p => {
    // Silenced blocks speaking only - every living player still votes and
    // is counted in the tally, silenced or not.
    let target = state.pendingDayVotes[p.id];
    const alreadySubmitted = target !== undefined && target !== null;
    if(!target && (p.isPlaceholder || p.connected === false)){
      const options = living(state).filter(q => q.id !== p.id);
      target = options.length ? options[Math.floor(Math.random()*options.length)].id : null;
    }
    if(!target && timedOutFallbackId && p.id === timedOutFallbackId){
      const options = living(state).filter(q => q.id !== p.id);
      target = options.length ? options[Math.floor(Math.random()*options.length)].id : null;
    }
    if(!alreadySubmitted && target){
      // Generated as a fallback at resolution time rather than submitted in
      // real time - still recorded so voteSubmissionOrder reflects the whole
      // round, chronologically last since it only happens once everyone who
      // was going to vote for real already has.
      state.voteSubmissionOrder.push({ night: state.night, playerId: p.id, targetId: target, submittedAt: Date.now() });
    }
    if(target && tally[target] !== undefined) tally[target]++;
    if(target) state.pendingDayVotes[p.id] = target;
  });

  const maxV = Math.max(...Object.values(tally));
  const leaders = Object.keys(tally).filter(k => tally[k]===maxV);
  const leadId = leaders[Math.floor(Math.random()*leaders.length)];
  const lead = byId(state, leadId);
  lead.alive = false;
  log(state, lead.name+' ('+lead.role+') was voted out by the town.');
  checkBountyHit(state, lead);

  // Silenced players still vote and appear with their real target here too -
  // silenced only means they couldn't speak, not that they didn't vote.
  // Anyone with no recorded vote at all (silenced or not) shows as "did not
  // vote." Players already dead before this round never had a
  // pendingDayVotes entry, so they're naturally excluded.
  const voteBreakdown = [];
  state.players.forEach(p => {
    const t = state.pendingDayVotes[p.id];
    if(t !== undefined){
      const targetP = t ? byId(state, t) : null;
      voteBreakdown.push({name:p.name, target: targetP ? targetP.name : 'no one', silenced: !!p.silencedToday, voterId:p.id});
    } else if(p.silencedToday){
      voteBreakdown.push({name:p.name, target:null, silenced:true, voterId:p.id});
    }
  });
  state.voteLog = voteBreakdown;
  state.farmerRevengeName = null;
  state.pendingDayVotes = {};

  let farmerRevengePending = null;
  if(lead.role==='Farmer'){
    // A disconnected human has no socket left to ever answer, so treat them
    // like a placeholder here too - same fallback pattern as resolveNight's
    // and resolveDayVote's own tally fill-in for a disconnected player.
    if(lead.isHuman && lead.connected !== false){
      farmerRevengePending = lead.id; // caller must collect a target then call resolveFarmerRevenge
      state.farmerRevengePending = lead.id;
    } else {
      const options = living(state).filter(p => p.id !== lead.id);
      if(options.length){
        const target = options[Math.floor(Math.random()*options.length)];
        target.alive = false;
        checkBountyHit(state, target);
        log(state, lead.name+' took '+target.name+' down with them on the way out.');
        state.farmerRevengeName = target.name;
      }
    }
  }

  checkGrannyFlip(state);
  const gameOver = checkWin(state);
  state.phase = 'day-reveal';

  return {lead, voteBreakdown, farmerRevengePending, gameOver};
}

function resolveFarmerRevenge(state, farmerId, targetId){
  const farmer = byId(state, farmerId);
  const target = targetId ? byId(state, targetId) : null;
  let revengeKillOccurred = false;
  if(target && target.alive && target.id !== farmerId){
    target.alive = false;
    checkBountyHit(state, target);
    log(state, farmer.name+' took '+target.name+' down with them on the way out.');
    state.farmerRevengeName = target.name;
    revengeKillOccurred = true;
  }
  state.farmerRevengePending = null;
  const gameOver = checkWin(state);
  return { gameOver, revengeKillOccurred, revengeTargetId: revengeKillOccurred ? target.id : null };
}

function startNextNight(state){
  state.night++;
  state.phase = 'night';
}

// Task 18 - purely mechanical "who said it first" tracking. No LLM, no
// judgment of message content: a message either was tagged to a target
// player id when sent, or it wasn't.
function recordAccusation(state, accuserId, targetId){
  state.accusationLog.push({ night: state.night, accuserId, targetId, ts: Date.now() });
}

// Who first publicly accused targetId (optionally scoped to a single round),
// plus how that accusation's timing relates to the room's actual day-vote
// sequence for that same target: did it land before any vote for them came
// in, and what fraction of the eventual votes-for-them were already
// submitted at that moment (0 = accused before anyone voted for them at all,
// 1 = accused only after every vote for them was already in - i.e. just
// narrating what the room had already decided).
function firstAccuserOf(state, targetId, night){
  const entries = state.accusationLog.filter(e => e.targetId === targetId && (night === undefined || e.night === night));
  if(!entries.length) return null;
  const first = entries.reduce((a, b) => (a.ts <= b.ts ? a : b));
  const votesForTarget = state.voteSubmissionOrder.filter(v => v.targetId === targetId && v.night === first.night);
  const votesBeforeAccusation = votesForTarget.filter(v => v.submittedAt < first.ts).length;
  return {
    accuserId: first.accuserId, targetId, night: first.night, ts: first.ts,
    precededAnyVoteForTarget: votesBeforeAccusation === 0,
    fractionVotesAlreadyInWhenAccused: votesForTarget.length ? votesBeforeAccusation / votesForTarget.length : 0
  };
}

// What ONE specific player is allowed to see. Never leaks other players'
// hidden roles unless that player is dead/eliminated (spectator view) or the
// role has already been revealed by death/vote-out.
function getPlayerView(state, playerId){
  const me = byId(state, playerId);
  const seeAllRoles = !me || !me.alive; // dead players get a full spectator view
  // A living mafia-aligned player sees their living teammates too - the family
  // has to be able to coordinate a kill and avoid targeting its own.
  const iAmMafia = me && me.alive && me.align === 'mafia';
  const players = state.players.map(p => {
    const base = {id:p.id, name:p.name, alive:p.alive, silencedToday:p.silencedToday, isPlaceholder:p.isPlaceholder, occ:p.occ, color:p.color};
    const seeAsTeammate = iAmMafia && p.alive && p.align === 'mafia';
    if(p.id === playerId || seeAllRoles || !p.alive || seeAsTeammate){
      base.role = p.role; base.align = p.align;
      if(p.role === 'NavySeal') base.usedNavySealCounter = p.usedNavySealCounter;
    }
    return base;
  });
  return {
    night: state.night, phase: state.phase, players, winner: state.winner, gameOver: state.gameOver,
    bountyPoints: (me && me.role==='BountyHunter') ? state.bountyPoints : (state.gameOver ? state.bountyPoints : undefined),
    bountyTarget: (me && me.role==='BountyHunter') ? state.bountyTarget : undefined,
    myRole: me ? me.role : null, myAlign: me ? me.align : null,
    detectiveLog: (me && me.role==='Detective') ? state.detectiveLog : undefined,
    // Mafia chat is scoped strictly by align==='mafia' - never sent to a
    // town-aligned player, living or dead.
    mafiaChatLog: (me && me.align==='mafia') ? state.mafiaChatLog : undefined,
    // Regular chat lines pass through untouched; a whisper announcement's
    // `text` is stripped for anyone who isn't the sender or the target -
    // same scoping principle as whisperLog and mafiaChatLog above, just
    // applied per-entry instead of filtering whole entries out.
    chatLog: state.chatLog.map(entry => {
      if(entry.kind === 'whisperAnnounce' && playerId !== entry.fromId && playerId !== entry.toId){
        const redacted = Object.assign({}, entry);
        delete redacted.text;
        return redacted;
      }
      return entry;
    }),
    voteLog: state.voteLog, history: state.history,
    cachedOvernightReport: state.cachedOvernightReport, farmerRevengeName: state.farmerRevengeName,
    farmerRevengePending: state.farmerRevengePending,
    // A whisper is visible only to the two players in it, same scoping
    // principle as mafiaChatLog above - everyone else's whispers are
    // filtered out entirely, not just hidden client-side.
    whisperLog: me ? state.whisperLog.filter(w => w.fromId === playerId || w.toId === playerId) : undefined
  };
}

module.exports = {
  CHARACTERS, ROLE_LABEL, SPECIAL_ROLES, MIN_PLAYERS, MAX_PLAYERS, MAX_MAFIA_COUNT, DEFAULT_ROLES_CONFIG,
  shuffle, alignOf, createGame, byId, living, mafiaAlive, mafiaVoters, checkWin, checkBountyHit, checkGrannyFlip,
  detectiveRead, investigateAndRead, resolveNight, resolveDayVote, resolveFarmerRevenge, startNextNight,
  getPlayerView, log, specialRoleCount, validateSeatCapacity,
  recordDayVoteSubmission, recordLivingCountSnapshot, recordAccusation, firstAccuserOf
};
