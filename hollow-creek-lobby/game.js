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
  Farmer:'the farmer', NavySeal:'the war veteran', Vigilante:'the vigilante',
  Consigliere:'the consigliere', Mayor:'the mayor', Mortician:'the mortician', Framer:'the framer', Hitman:'the hitman',
  CultLeader:'the cult leader', Civilian:'a civilian'
};

const SPECIAL_ROLES = ['Godfather','Mafia','DoubleAgent','Detective','Doctor','Miller','BountyHunter','CrazyGranny','Coward','Farmer','NavySeal','Vigilante','Consigliere','Mayor','Mortician','Framer','Hitman','CultLeader'];

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 16;   // a lobby holds up to 16 (the day-page player grid pages through them 6 at a time)
const MAX_MAFIA_COUNT = 4;

const DEFAULT_ROLES_CONFIG = {Godfather:true, DoubleAgent:true, Detective:true, Doctor:true, Miller:true, BountyHunter:true, CrazyGranny:true, Coward:false, Farmer:false, NavySeal:false, Vigilante:false, Consigliere:false, Mayor:false, Mortician:false, Framer:false, Hitman:false, CultLeader:false};

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const t=a[i]; a[i]=a[j]; a[j]=t;
  }
  return a;
}

function alignOf(role){
  if(role==='Godfather'||role==='DoubleAgent'||role==='Mafia'||role==='Consigliere'||role==='Framer'||role==='Hitman') return 'mafia';
  if(role==='BountyHunter') return 'neutral';
  if(role==='CultLeader') return 'cult';
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
      // A player who never opened the avatar picker gets a distinct fallback
      // color (cycling the same palette the placeholder cast uses) instead
      // of undefined, which would render as an invisible/blank avatar swatch.
      avatarKey: seat.avatarKey || null, gameIconKey: seat.gameIconKey || null, color: seat.color || CHARACTERS[idx % CHARACTERS.length].color,
      alive: true, silencedToday: false, role: roles[idx], align: alignOf(roles[idx]),
      flipped: false, investigateCount: 0, usedNavySealCounter: false, usedVigilanteShot: false,
      usedMayorReveal: false
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
      flipped: false, investigateCount: 0, usedNavySealCounter: false, usedVigilanteShot: false,
      usedMayorReveal: false
    });
  });

  return {
    night: 1, phase: 'night', players, bountyTarget: null, bountyPoints: 0, history: [],
    chatLog: [], mafiaChatLog: [], cultChatLog: [], voteLog: [], voteHistory: [], winner: null, gameOver: false,
    pendingNightVotes: {}, // playerId -> {kill, silence, protect, investigate, bounty, hideBehind}
    pendingDayVotes: {}, // playerId -> targetId
    detectiveLog: [], consigliereLog: [], morticianLog: [], farmerRevengeName: null, farmerRevengePending: null,
    mayorRevealedId: null, lastDayVoteMayorTiebreak: false,
    // PREBETA Task 7 - who died in the immediately preceding NIGHT
    // specifically (never a day-vote elimination - those are already public
    // via the lynch reveal). Set to this round's own nightDeaths at the end
    // of every resolveNight call, so the Mortician's pool of choices for the
    // FOLLOWING night is always exactly "last night's dead," nothing older.
    lastNightDeaths: [],
    // Scoring infrastructure (Task 17/18) - append-only, never cleared between
    // rounds, each entry tagged with which round (`night`) it happened in so
    // scoring.js can look at either a single round or the whole game's history.
    voteSubmissionOrder: [], // [{night, playerId, targetId, submittedAt}] in real submission order, not tally order
    livingCountAtAction: [], // [{night, playerId, role, actionType, livingCount}] - Doctor/Coward/Farmer blind-guess snapshots
    accusationLog: [], // [{night, accuserId, targetId, ts}] - Task 18
    whisperLog: [], // [{fromId, toId, text, ts}] - private day-vote whispers, visible only to the two players involved (see getPlayerView)
    // PREBETA Task 9 - a private channel for eliminated players, visible only
    // to other eliminated players. Persists for the rest of the game once a
    // player is eliminated, unlike whisperLog which is scoped to day-vote only.
    ghostChatLog: [],
    // Live discussion-time attention marker: playerId -> targetId, one entry
    // per player who's currently put the spotlight on someone. Reset at the
    // start of every day-discuss phase (see beginDayDiscussPhase), same
    // lifetime as a day's votes/whispers - it's a signal about THIS round's
    // discussion, not a persistent record. Only ever exposed as an aggregate
    // count per target (see getPlayerView's mySpotlightTarget note) - nobody
    // gets told who specifically spotlighted whom, including the target.
    spotlights: {}
  };
}

// Records a day-vote the moment it's actually submitted (real player or
// placeholder fallback), preserving true chronological order - this is what
// lets scoring.js tell an early, independent vote from a late bandwagon one.
function recordDayVoteSubmission(state, playerId, targetId){
  state.pendingDayVotes[playerId] = targetId;
  state.voteSubmissionOrder.push({ night: state.night, playerId, targetId, submittedAt: Date.now() });
}

// Sets or clears (targetId===null) one player's live spotlight pick. A
// toggle, not a one-shot vote - can be changed or withdrawn as often as the
// discussion moves, unlike a day-vote.
function recordSpotlight(state, playerId, targetId){
  if(targetId) state.spotlights[playerId] = targetId;
  else delete state.spotlights[playerId];
}

// Aggregate-only tally for the town board's glow effect - counts, never
// identities, since nobody (not even the target) is meant to learn who
// specifically spotlighted whom.
function spotlightCounts(state){
  const counts = {};
  Object.keys(state.spotlights).forEach(spotlighterId => {
    const targetId = state.spotlights[spotlighterId];
    counts[targetId] = (counts[targetId]||0) + 1;
  });
  return counts;
}

// Mayor Ability 1: double this round's vote. Single-use for the whole game,
// spent the moment it's exercised regardless of how the vote itself
// ultimately resolves. Deliberately silent, same as Ability 2 below - using
// it must never itself out this player as the Mayor, so nothing gets
// logged to state.history (which every player can read via the case file).
// Returns whether the reveal actually took effect (false if this player
// isn't a not-yet-revealed Mayor).
function recordMayorReveal(state, playerId){
  const mayor = byId(state, playerId);
  if(!mayor || mayor.role !== 'Mayor' || mayor.usedMayorReveal) return false;
  mayor.usedMayorReveal = true;
  state.mayorRevealedId = playerId;
  return true;
}

// Snapshots how many players were alive at the moment a Doctor/Coward/Farmer
// made their blind guess - a guess made with 3 people left is a much bigger
// bet than one made with 10 left, and scoring rewards it accordingly.
function recordLivingCountSnapshot(state, playerId, role, actionType){
  state.livingCountAtAction.push({ night: state.night, playerId, role, actionType, livingCount: living(state).length });
}

function byId(state, id){ return state.players.find(p => p.id === id); }
function living(state){ return state.players.filter(p => p.alive); }
// PREBETA Phase 2 Task 5 - alignment-based, not role-based: a cult-converted
// player must fully stop counting toward their ORIGINAL faction's headcount
// (mafia or town), never left as a silent gap. Since every mafia-aligned
// role's `align` was already always 'mafia' from creation (alignOf sets it
// once, and the only thing that ever changes it afterward is a flip/
// conversion), this is exactly equivalent to the old role-enumeration for
// every pre-existing role, and is now also the only thing that correctly
// excludes a converted player.
function mafiaAlive(state){ return state.players.filter(p => p.alive && p.align==='mafia'); }
function cultAlive(state){ return state.players.filter(p => p.alive && p.align==='cult'); }
function mafiaVoters(state){
  // The mafia's shared kill-vote access is a FACTION-level privilege, not an
  // individual role's ability - a cult-converted Godfather/Mafia/DoubleAgent/
  // Framer keeps their role name but loses this specifically, since their
  // `align` is no longer 'mafia' post-conversion. Hitman is deliberately
  // absent from this role list regardless of alignment - he never had
  // kill-vote access to begin with (see Task 4), nothing to revoke. Framer
  // gets an equal vote same as Godfather/Mafia/DoubleAgent, on top of (and
  // fully independent from) his own separate frame-target ability below.
  // Consigliere likewise votes (alongside her own look-into ability) - she
  // used to be the one mafia role left out of the kill vote by mistake.
  const flippedGranny = state.players.find(p => p.alive && p.role==='CrazyGranny' && p.flipped && p.align==='mafia');
  if(flippedGranny) return [flippedGranny];
  return state.players.filter(p => p.alive && p.align==='mafia' && (p.role==='Godfather' || p.role==='Mafia' || p.role==='DoubleAgent' || p.role==='Framer' || p.role==='Consigliere'));
}
function log(state, line){ state.history.push('Night '+state.night+' / '+line); }

function checkWin(state){
  const totalLiving = living(state).length;
  const m = mafiaAlive(state).length;
  const c = cultAlive(state).length;
  const t = totalLiving - m; // unchanged meaning: everyone not currently mafia-aligned (town, neutral, and now cult too - mafia still has to outnumber every other living player combined)
  // PREBETA Phase 2 Task 5 - cult wins once they're a majority OR EQUAL
  // share of every living player, checked before the town/mafia checks
  // below since it's the most specific condition. Town's own win condition
  // now also requires the cult to be gone, not just the mafia - a cult
  // still short of majority shouldn't let a "town wins" moment fire out
  // from under it while cult members are still alive and viable.
  if(c > 0 && c >= (totalLiving - c)){ state.winner='cult'; state.gameOver=true; return true; }
  if(m===0 && c===0){ state.winner='town'; state.gameOver=true; return true; }
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

// PREBETA Phase 2 Task 1 - three-tier investigation read: innocent, guilty,
// suspicious. Based on the TARGET's current alignment, never on their
// underlying role, as the general rule - "suspicious" deliberately covers
// several genuinely different things (a harmless neutral, an unflipped
// Granny, a cult convert) with no way for the investigator to tell which
// apart, and that ambiguity is intentional, not a gap.
//
// framerTargetId (Phase 2 Task 3): if given and it matches this target,
// Framer's effect overrides the read this round based on the target's
// CURRENT alignment (mafia -> innocent, everyone else -> guilty) - checked
// before any role-based exception below, since Framer replaces "this
// round's" read outcome entirely, the same way it would for a plain
// town/mafia target with no special role gimmick of their own. Never
// reaches this override for a neutral/cult target - those are unconditional
// per the two checks above it.
function detectiveRead(target, framerTargetId){
  // Neutral and cult are always suspicious, unconditionally, checked first -
  // Framer's own ability explicitly never touches this ("never affects
  // neutral or cult members, who always read suspicious"), and this is also
  // the check that makes a cult-converted Miller/DoubleAgent correctly stop
  // getting their old role's guilty/innocent quirk once converted: "the read
  // is based on current alignment only, never on role - not a per-role
  // exception."
  if(target.align === 'neutral' || target.align === 'cult') return 'suspicious';
  if(framerTargetId && target.id === framerTargetId){
    return target.align === 'mafia' ? 'innocent' : 'guilty';
  }
  // Role-based exceptions that don't follow pure alignment - only reachable
  // while the player is still in their original (town/mafia) alignment,
  // since neutral/cult already returned above.
  if(target.role==='Miller') return 'guilty';
  if(target.role==='DoubleAgent') return (target.investigateCount||0) >= 1 ? 'guilty' : 'innocent';
  if(target.role==='CrazyGranny' && !target.flipped) return 'suspicious';
  // General alignment-based rule for everyone else - a flipped Crazy Granny
  // falls through to here too (align is already 'mafia' by then), so no
  // separate flipped-Granny case is needed above.
  if(target.align === 'mafia') return 'guilty';
  return 'innocent';
}
function investigateAndRead(target, framerTargetId){
  const read = detectiveRead(target, framerTargetId);
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
  if(player.role==='Consigliere'){
    // Cannot target teammates - already visible directly, so investigating
    // one would be a wasted, redundant action. Same UI-level restriction the
    // real client applies; a placeholder just picks from the same allowed pool.
    const nonTeammates = options.filter(p => p.align !== 'mafia');
    action.consigliereInvestigate = pick(nonTeammates.length ? nonTeammates : options);
  }
  // PREBETA Task 7 - low-stakes, no-risk choice (unlike Vigilante's
  // once-per-game shot), so a placeholder picks randomly among last night's
  // dead just like a placeholder Detective/Doctor/Coward/BountyHunter picks
  // randomly among the living. Naturally does nothing on Night 1 or any
  // night with zero deaths, since state.lastNightDeaths is simply empty then.
  if(player.role==='Mortician' && state.lastNightDeaths && state.lastNightDeaths.length){
    const deadPick = state.lastNightDeaths[Math.floor(Math.random()*state.lastNightDeaths.length)];
    action.morticianInvestigate = deadPick.id;
  }
  // PREBETA Phase 2 Task 3 - unlike Consigliere, targeting a teammate is
  // real, useful functionality here (shields them with an innocent read),
  // not a wasted action - so a placeholder is free to pick from every
  // living player, teammates included, with no exclusion.
  if(player.role==='Framer') action.frameTarget = pick(options);
  // PREBETA Phase 2 Task 5 - low-stakes, no-risk choice (a failed/blocked
  // conversion just does nothing, nobody's harmed), so a placeholder picks
  // randomly among every living non-cult player, same low-judgment approach
  // as Consigliere/Mortician's placeholder picks.
  if(player.role==='CultLeader'){
    const nonCult = options.filter(p => p.align !== 'cult');
    action.cultConvert = pick(nonCult.length ? nonCult : options);
  }
  // Deliberately no Vigilante case here (assumption, not spec'd): unlike
  // Doctor/Coward/BountyHunter, a shot is permanent, once-per-game, and can
  // kill the Vigilante themselves on a wrong guess - a placeholder has no
  // real judgment to decide whether that risk is worth taking, so a
  // placeholder Vigilante simply never fires rather than firing at random.
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
  const framer = state.players.find(p => p.alive && p.role==='Framer');

  const investigateTargetId = detective ? (state.pendingNightVotes[detective.id]||{}).investigate : null;
  const protectTargetId = doctor ? (state.pendingNightVotes[doctor.id]||{}).protect : null;
  const hideBehindId = coward ? (state.pendingNightVotes[coward.id]||{}).hideBehind : null;
  // Bounty Hunter re-aims every night, not just once ever - the role's own
  // description promises "place a bounty on someone each night."
  const bountyId = bountyHunter ? (state.pendingNightVotes[bountyHunter.id]||{}).bounty : null;
  const silenceId = godfather ? (state.pendingNightVotes[godfather.id]||{}).silence : null;
  // PREBETA Phase 2 Task 3 - purely local to this resolveNight call ("this
  // round" only, per the role's own description) - fed straight into
  // investigateAndRead below, never persisted on state since nothing else
  // needs to read it after this round resolves.
  const framerTargetId = framer ? (state.pendingNightVotes[framer.id]||{}).frameTarget : null;

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
      // No role named here - a night death never reveals role publicly
      // (only a day-vote lynch does, see resolveDayVote below), and naming
      // the counter-kill's victim's role would out them as the Navy Seal.
      log(state, 'The mafia moved on '+killTarget.name+', but they fought back and killed '+counterVictim.name+' instead.');
      deathSummary = counterVictim.name+' ('+counterVictim.role+') was killed in the night.';
      nightDeathOccurred = true; revealVictim = counterVictim;
      state.cachedNearMissId = null;
    } else {
      reportLines.push('A quiet night, for once. No one made a move.');
      deathSummary = 'No one died last night.';
      state.cachedNearMissId = null;
    }
  } else if(!killTarget){
    reportLines.push('A quiet night, for once. No one made a move.');
    deathSummary = 'No one died last night.';
    state.cachedNearMissId = null;
  } else if(doctorSaved){
    // Name the near-victim (this is public news the whole town reads the
    // next morning), but never name WHO saved them - that would out the
    // Doctor's role to everyone, not just tell the town someone survived.
    reportLines.push(killTarget.name+' was attacked in the dark last night, but someone reached them just in time and saved their life.');
    log(state, 'The mafia struck at '+killTarget.name+', but the doctor\'s hands got there first.');
    deathSummary = killTarget.name+' was nearly killed last night, the doctor\'s protection held.';
    state.cachedNearMissId = killTarget.id;
  } else {
    killTarget.alive = false;
    checkBountyHit(state, killTarget);
    reportLines.push(killTarget.name+' was found this morning. The town gathers, uneasy.');
    // No role named here - see the counter-kill case above for why.
    log(state, killTarget.name+' was killed in the night.');
    deathSummary = killTarget.name+' ('+killTarget.role+') was killed in the night.';
    nightDeathOccurred = true; revealVictim = killTarget;
    state.cachedNearMissId = null;
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

  // --- Vigilante: a clean, independent kill - deliberately isolated from
  // the mafia's kill chain above. Doctor's protect, Coward's hide-behind
  // redirect, and Navy Seal's counter-kill only ever apply to the mafia's
  // own kill resolution; the Vigilante's shot lands or doesn't land on its
  // own, with no cross-interaction whatsoever. ---
  const vigilante = state.players.find(p => p.alive && p.role==='Vigilante' && !p.usedVigilanteShot);
  const vigilanteTargetId = vigilante ? (state.pendingNightVotes[vigilante.id]||{}).vigilanteKill : null;
  let vigilanteKillVictim = null;
  let vigilanteDied = false;
  if(vigilante && vigilanteTargetId){
    // Once per game, period - spent the moment they commit to firing,
    // whether or not the target turns out to already be dead by the time
    // resolution reaches here (e.g. also the mafia's kill target this
    // same night).
    vigilante.usedVigilanteShot = true;
    const vigTarget = byId(state, vigilanteTargetId);
    if(vigTarget && vigTarget.alive){
      vigTarget.alive = false;
      checkBountyHit(state, vigTarget);
      vigilanteKillVictim = vigTarget;
      // Never the Vigilante's identity or the target's role here - the whole
      // town would learn who the Vigilante is (and what they killed) the
      // instant this printed, which is exactly the kind of thing this case
      // file must never leak.
      log(state, vigTarget.name+' was found dead as well, in the night.');
      reportLines.push(vigTarget.name+' was found dead this morning — not the family\'s doing this time.');
      // Guilt is purely the target's alignment category, never a judgment
      // of how dangerous they currently are: mafia-aligned or neutral
      // (Bounty Hunter) targets never trigger guilt, regardless of how
      // close a neutral target is to their own win condition. Crazy Granny
      // is a named, role-specific exception - never triggers guilt no
      // matter her alignment at the moment she's killed. This carve-out is
      // specific to her flip mechanic and intentionally not generalized to
      // any other "could become a future threat" role.
      const guilty = vigTarget.role !== 'CrazyGranny' && vigTarget.align === 'town';
      if(guilty){
        vigilante.alive = false;
        // Distinct from an ordinary night death (mafia kill, Navy Seal
        // counter-kill) - the Vigilante's own personal death screen needs
        // to say what actually happened, not generically blame "the mafia."
        // Private to this one player, same as the death screen itself.
        vigilante.deathCause = 'vigilanteGuilt';
        checkBountyHit(state, vigilante);
        vigilanteDied = true;
        // Same reasoning as above - naming the Vigilante and the fact their
        // target was town-aligned would leak both their identity and the
        // target's alignment to the entire town.
        log(state, vigilante.name+' was found dead as well, by their own hand.');
        reportLines.push(vigilante.name+' was found dead as well, by their own hand.');
      }
    }
  }

  // Every player who died this specific night, from any source - the
  // mafia/Navy-Seal-counter kill and the Vigilante's kill (and the
  // Vigilante's own guilt-death) can now all land the same night. Mortician
  // (a later role) needs the full set to choose between when there are two.
  const nightDeaths = [];
  if(revealVictim) nightDeaths.push({id: revealVictim.id, name: revealVictim.name, role: revealVictim.role});
  if(vigilanteKillVictim) nightDeaths.push({id: vigilanteKillVictim.id, name: vigilanteKillVictim.name, role: vigilanteKillVictim.role});
  if(vigilanteDied) nightDeaths.push({id: vigilante.id, name: vigilante.name, role: vigilante.role});

  let investigationResult = null;
  if(detective && investigateTargetId){
    const target = byId(state, investigateTargetId);
    if(target){
      const read = investigateAndRead(target, framerTargetId);
      // Private to the Detective alone (see detectiveLog below) - never
      // logged to state.history, which every player can read via the case
      // file. The case file only ever holds things the whole town would
      // actually know, like who was found dead.
      state.detectiveLog.push({name: target.name, read: read});
      investigationResult = {detectiveId: detective.id, targetId: target.id, targetName: target.name, read: read};
    }
  }

  // --- Consigliere: learns a target's exact role by name, not a
  // guilty/innocent read - this is why Miller and Double Agent's tricks
  // (both built specifically to manipulate the Detective's guilty/innocent
  // mechanic) never apply here: reading the literal role name never touches
  // that mechanic at all, so Miller plainly reads "Miller" and Double Agent
  // plainly reads "DoubleAgent" every time, with no special-casing needed. ---
  const consigliere = state.players.find(p => p.alive && p.role==='Consigliere');
  const consigliereTargetId = consigliere ? (state.pendingNightVotes[consigliere.id]||{}).consigliereInvestigate : null;
  let consigliereResult = null;
  if(consigliere && consigliereTargetId){
    const target = byId(state, consigliereTargetId);
    // "Cannot target teammates" is enforced at the UI/validation level only
    // (the client never offers a teammate as an option), the same way
    // self-targeting is typically blocked elsewhere in this game - not
    // re-checked here by alignment, so investigating a Double Agent (itself
    // mafia-aligned) still correctly resolves to "DoubleAgent" whenever it's
    // exercised directly, same as any other role.
    if(target){
      // Private to the Consigliere alone (see consigliereLog below) - same
      // reasoning as the Detective above, never logged to the public case file.
      state.consigliereLog.push({name: target.name, role: target.role});
      consigliereResult = {consigliereId: consigliere.id, targetId: target.id, targetName: target.name, role: target.role};
    }
  }

  // --- Mortician: learns the role of whoever died the PREVIOUS night
  // specifically - never a day-vote elimination (already public via the
  // lynch reveal), never this same night's own deaths (nothing has happened
  // yet to learn about until the FOLLOWING night). Reads state.lastNightDeaths
  // as it stood BEFORE this call, i.e. whatever the previous resolveNight
  // call set it to - it gets overwritten with this round's own deaths below,
  // for the round after this one to read in turn. Naturally does nothing on
  // Night 1 (nothing has died yet) or after a no-death night (empty pool),
  // with no special-casing needed for either case. ---
  const mortician = state.players.find(p => p.alive && p.role==='Mortician');
  const morticianTargetId = mortician ? (state.pendingNightVotes[mortician.id]||{}).morticianInvestigate : null;
  let morticianResult = null;
  if(mortician && morticianTargetId){
    const deadEntry = state.lastNightDeaths.find(d => d.id === morticianTargetId);
    if(deadEntry){
      // Private to the Mortician alone (see morticianLog below) - same
      // reasoning as the Detective/Consigliere above, never logged publicly.
      state.morticianLog.push({name: deadEntry.name, role: deadEntry.role});
      morticianResult = {morticianId: mortician.id, targetId: deadEntry.id, targetName: deadEntry.name, role: deadEntry.role};
    }
  }
  state.lastNightDeaths = nightDeaths;

  // --- Cult Leader: each night, targets one player to convert. Interacts
  // with Doctor's protection EXACTLY the way the mafia's kill does - reuses
  // the same protectTargetId computed above for the kill, not a second
  // parallel check - if the Doctor protects that night's conversion target,
  // the conversion fails. Can target anyone, including a mafia-aligned
  // player - confirmed intentional. If the Cult Leader is dead, `cultLeader`
  // below is simply undefined and this whole block is skipped: no new
  // conversions can happen without a living Cult Leader, while existing
  // converts are entirely unaffected either way (their align was already
  // set permanently on a past night, not re-derived here). ---
  const cultLeader = state.players.find(p => p.alive && p.role==='CultLeader');
  const cultTargetId = cultLeader ? (state.pendingNightVotes[cultLeader.id]||{}).cultConvert : null;
  let cultConvertedPlayer = null;
  let cultConversionBlocked = false;
  if(cultLeader && cultTargetId){
    const cultTarget = byId(state, cultTargetId);
    // Already-cult-aligned (including the Cult Leader's own align, 'cult'
    // from creation) is a silent no-op - nothing meaningful to convert.
    if(cultTarget && cultTarget.alive && cultTarget.align !== 'cult'){
      if(protectTargetId && protectTargetId === cultTarget.id){
        cultConversionBlocked = true;
        log(state, 'Someone tried to turn '+cultTarget.name+' last night, but the doctor\'s protection held.');
      } else {
        // Fully removed from their prior alignment (town or mafia), not left
        // as a silent gap in the old faction's count - mafiaAlive/cultAlive
        // are both purely align-based (see above) specifically so this one
        // line correctly updates every win-condition calculation at once.
        // The mafia's shared kill-vote access is the one individual privilege
        // this actually revokes (see mafiaVoters) - every other ability tied
        // to their role keeps working exactly as before.
        cultTarget.align = 'cult';
        cultConvertedPlayer = cultTarget;
        // Never logged publicly - this would out the target's new alignment
        // to the whole town, the same category of leak as the investigative
        // roles above. The convert and the cult team learn this through
        // cultChatLog/getPlayerView instead, which is already scoped to them.
      }
    }
  }

  checkGrannyFlip(state);
  state.cachedOvernightReport = reportLines.join(' ');
  const gameOver = checkWin(state);

  state.pendingNightVotes = {};
  state.phase = 'day-discuss';

  return {reportLines, deathSummary, nightDeathOccurred, revealVictim, silencedPlayerId, investigationResult, consigliereResult, morticianResult, cultConvertedPlayer, cultConversionBlocked, gameOver, killTargetId, doctorSaved: !!doctorSaved, cowardRedirected, vigilanteKillVictim, vigilanteDied, nightDeaths};
}

function resolveDayVote(state, timedOutFallbackId){
  const tally = {};
  living(state).forEach(p => { tally[p.id] = 0; });
  const livingAtStart = new Set(living(state).map(p => p.id)); // before the vote can eliminate anyone

  living(state).forEach(p => {
    // Silenced blocks speaking only - every living player still votes and
    // is counted in the tally, silenced or not.
    let target = state.pendingDayVotes[p.id];
    const alreadySubmitted = target !== undefined && target !== null;
    // Only the game's own AI seats get a generated ballot. A real player who
    // didn't vote - timed out, left it blank, or dropped - simply abstains;
    // they are never given a random vote they didn't choose.
    if(!target && p.isPlaceholder){
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
    if(target && tally[target] !== undefined){
      // Mayor Ability 1: a revealed Mayor's OWN vote this round counts
      // double - single-use for the whole game, already spent the moment
      // recordMayorReveal was called, regardless of how this vote resolves.
      const weight = (p.id === state.mayorRevealedId) ? 2 : 1;
      tally[target] += weight;
    }
    if(target) state.pendingDayVotes[p.id] = target;
  });

  const maxV = Math.max(...Object.values(tally));
  // Nobody cast a single vote for anyone (everyone abstained / no ballots):
  // nobody is voted out. Previously every living player tied at 0 and one was
  // picked at random - exactly the "random vote" this is meant to avoid.
  const noVotes = maxV <= 0;
  const leaders = noVotes ? [] : Object.keys(tally).filter(k => tally[k]===maxV);
  let leadId;
  // Mayor Ability 2: passive, always active, never requires revealing -
  // whenever the vote resolves in a tie, whichever candidate the Mayor
  // personally voted for silently wins the tiebreak (is eliminated). Falls
  // back to the normal random tiebreak whenever there's no living Mayor, the
  // Mayor didn't vote, or their vote target isn't among the tied candidates
  // (covers both the "Mayor is one of the tied candidates" and "3+-way tie"
  // cases the same way, with no separate branch needed for either).
  let mayorTiebreakResolved = false;
  if(leaders.length > 1){
    const mayor = state.players.find(p => p.alive && p.role==='Mayor');
    const mayorVoteTarget = mayor ? state.pendingDayVotes[mayor.id] : null;
    if(mayorVoteTarget && leaders.includes(mayorVoteTarget)){
      leadId = mayorVoteTarget;
      mayorTiebreakResolved = true;
    } else {
      leadId = leaders[Math.floor(Math.random()*leaders.length)];
    }
  } else {
    leadId = leaders[0];
  }
  const lead = noVotes ? null : byId(state, leadId);
  if(lead){
    lead.alive = false;
    log(state, lead.name+' ('+lead.role+') was voted out by the town.');
    checkBountyHit(state, lead);
  } else {
    log(state, 'Nobody was voted out by the town.');
  }

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
      voteBreakdown.push({name:p.name, target: targetP ? targetP.name : 'no one', targetId: targetP ? targetP.id : null, silenced: !!p.silencedToday, voterId:p.id});
    } else if(p.silencedToday){
      voteBreakdown.push({name:p.name, target:null, targetId:null, silenced:true, voterId:p.id});
    } else if(p.alive || livingAtStart.has(p.id)){
      // A living player who cast nothing: shown as abstaining on the vote
      // results instead of silently missing from them.
      voteBreakdown.push({name:p.name, target:'no one', targetId:null, silenced:false, voterId:p.id});
    }
  });
  state.voteLog = voteBreakdown;
  // Case-files Task 1 - state.voteLog is overwritten every round (current
  // round only); accumulate a full-game, FLAT copy (matching accusationLog's
  // shape) so a per-player case file can filter every past vote by
  // voterId/targetId across the whole game, not just the most recent round.
  voteBreakdown.forEach(v => state.voteHistory.push(Object.assign({night: state.night}, v)));
  state.farmerRevengeName = null;
  state.pendingDayVotes = {};
  state.mayorRevealedId = null;
  state.lastDayVoteMayorTiebreak = mayorTiebreakResolved;

  let farmerRevengePending = null;
  // PREBETA Phase 2 Task 4 - Hitman's revenge ability matches Farmer's shape
  // EXACTLY (reuses this same mechanism/state fields rather than a parallel
  // one): triggers only on a day-vote lynch, never any other cause of death,
  // and can target anyone including a mafia-aligned teammate - the lack of
  // restriction here is the actual cost of being cut out of the mafia's
  // coordination. resolveFarmerRevenge below already only excludes self, so
  // reusing it as-is already satisfies "no restriction enforced."
  if(lead && (lead.role==='Farmer' || lead.role==='Hitman')){
    // A disconnected human has no socket left to ever answer, so treat them
    // like a placeholder here too - same fallback pattern as resolveNight's
    // and resolveDayVote's own tally fill-in for a disconnected player.
    if(lead.isHuman && lead.connected !== false){
      farmerRevengePending = lead.id; // caller must collect a target then call resolveFarmerRevenge
      state.farmerRevengePending = lead.id;
    } else {
      const options = living(state).filter(p => p.id !== lead.id);
      // Hitman's placeholder fallback prefers a Doctor/Detective target when
      // one's alive - a preference, not a hard restriction (the real
      // resolution above accepts any target either way, human or fallback).
      const preferred = lead.role==='Hitman' ? options.filter(p => p.role==='Doctor' || p.role==='Detective') : [];
      const pool = preferred.length ? preferred : options;
      if(pool.length){
        const target = pool[Math.floor(Math.random()*pool.length)];
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

  return {lead, voteBreakdown, farmerRevengePending, gameOver, mayorTiebreakResolved};
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
function recordAccusation(state, accuserId, targetId, extra){
  state.accusationLog.push(Object.assign({ night: state.night, accuserId, targetId, ts: Date.now() }, extra || {}));
}

// Simple rule-based day-chat message classifier - deliberately NOT the
// mechanical accusation-tag system above (that's still untouched: purely
// "who tagged whom", no content judgment). This DOES read message
// content, but with no external AI/API call - just pattern templates,
// each cross-checked against the room's real player names so genre-
// idiomatic phrasing resolves without literal keyword triggering (e.g.
// "I think it's Corky" is recognized as an accusation naming Corky
// because "I think/believe/bet it's <name>" is *itself* the template -
// same as a human reading it instantly knows "it" means "the killer"
// from mafia-chat convention, without "it" ever being resolved as a
// literal pronoun). Comparably plain messages that don't line up with a
// real player name ("I think it's cold outside") correctly fall through
// instead of false-triggering.
//
// Two upgrades on top of the single-message pattern matching, both still
// zero-API/pure-function:
//  1. Name resolution is fuzzy, not just an exact substring of the full
//     "First Last" name - it also matches a bare first name, and an
//     unambiguous truncation of one ("cork" -> "Corky Wade", as long as
//     no OTHER player's first name also starts with "cork" - an
//     ambiguous prefix resolves to nobody rather than guessing wrong).
//     A bare pronoun ("he"/"she"/"they"/"him"/"her"/"them") resolves the
//     same way findName() would, but against whoever was last named in
//     the passed-in context instead of the message itself.
//  2. `context` (optional) carries the short-term thread this message is
//     part of - `replyToText` (the line this message was an explicit
//     Reply to, if any) and `recentTexts` (the last few lines in the
//     room's chat log before this one, oldest first). It's used for
//     exactly one thing: recognizing a bare self-ID ("I am", "that's
//     me") as a role claim when it's actually answering a "who's the
//     doctor?"-shaped question earlier in the thread - the same
//     inference a human reader makes without "I am" ever containing the
//     word "doctor" itself. Anywhere else, the two single-message
//     patterns above still do the same job context ever did before.
function chatRoleWordVariants(role){
  // SPECIAL_ROLES is camelCase code names (DoubleAgent, NavySeal,
  // CultLeader...) - nobody types those in chat. Add the space-separated
  // form a real player would actually type, alongside the plain one.
  const spaced = String(role).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const plain = String(role).toLowerCase();
  return spaced === plain ? [plain] : [spaced, plain];
}
const CHAT_CATEGORY_ROLE_WORDS = SPECIAL_ROLES.concat(['Mafia', 'Villager', 'Townsperson', 'Town', 'Cult', 'Civilian'])
  .reduce((acc, r) => acc.concat(chatRoleWordVariants(r)), []);
const CHAT_ROLE_WORDS_PATTERN = CHAT_CATEGORY_ROLE_WORDS.join('|');
const PRONOUN_RE = /\b(?:he|she|they|him|her|them)\b/;

// A handful of characters carry a title/descriptor ahead of their actual
// given name ("Sister Agatha Pruitt", "Big Tom Yarrow") - nobody refers to
// them in chat as "Sister" or "Big", so those words are dropped from the
// token set rather than treated as a real, matchable name fragment.
const NAME_TOKEN_STOPWORDS = new Set(['sister', 'brother', 'big', 'little', 'old', 'young', 'mr', 'mrs', 'ms', 'dr']);
function nameTokensFor(full){
  return String(full).trim().split(/\s+/).filter(w => w && !NAME_TOKEN_STOPWORDS.has(w.toLowerCase()));
}

function analyzeChatMessage(text, playerNames, context){
  // Every exit is {category, target}: target is the full name of whoever an
  // accusation names (null for anything else, or an accusation that names no
  // one the room can resolve). classifyChatMessage() below is the old
  // string-only view of the same result.
  const R = (category, target) => ({ category, target: target || null });
  const t = String(text || '').toLowerCase().trim();
  if (!t) return R('no_gameplay_meaning');
  const names = (playerNames || []).filter(Boolean);
  // Every real (non-title) word in each player's name is a candidate a
  // player might actually type - first name, last name, or (for the
  // three-word names) a middle given name - not just word[0].
  const nameEntries = names.map(full => ({ full, tokens: nameTokensFor(full) }));

  function findFullName(str){
    for (const n of names.slice().sort((a, b) => b.length - a.length)) {
      if (new RegExp('\\b' + String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(str)) return n;
    }
    return null;
  }
  function findTokenName(str){
    const flat = [];
    nameEntries.forEach(({ full, tokens }) => tokens.forEach(tok => flat.push({ full, tok })));
    flat.sort((a, b) => b.tok.length - a.tok.length);
    for (const { full, tok } of flat) {
      if (new RegExp('\\b' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(str)) return full;
    }
    return null;
  }
  function findPrefixName(str){
    const words = str.toLowerCase().match(/[a-z']+/g) || [];
    for (const w of words) {
      if (w.length < 3) continue;
      const matchedPlayers = [];
      nameEntries.forEach(({ full, tokens }) => {
        const hit = tokens.some(tok => { const tl = tok.toLowerCase(); return tl !== w && tl.startsWith(w); });
        if (hit) matchedPlayers.push(full);
      });
      // Only resolve a truncation when it's unambiguous - "cor" fitting
      // both "Corky" and "Cora" should name neither, "cork" fitting only
      // "Corky" safely resolves.
      if (matchedPlayers.length === 1) return matchedPlayers[0];
    }
    return null;
  }
  function findName(str){
    return findFullName(str) || findTokenName(str) || findPrefixName(str);
  }

  const ctx = context || {};
  const replyToText = String(ctx.replyToText || '').toLowerCase();
  const recentTexts = (Array.isArray(ctx.recentTexts) ? ctx.recentTexts : []).map(s => String(s || ''));
  // Who was last named, checking the explicit reply-to line first (a
  // deliberate signal the sender chose) and then working backwards
  // through the recent thread - same order a human catching up on the
  // conversation would read it in.
  function mostRecentlyMentioned(){
    if (replyToText) { const n = findName(replyToText); if (n) return n; }
    for (let i = recentTexts.length - 1; i >= 0; i--) {
      const n = findName(recentTexts[i]);
      if (n) return n;
    }
    return null;
  }
  function subjectPresent(str){
    if (findName(str)) return true;
    return PRONOUN_RE.test(str) && !!mostRecentlyMentioned();
  }

  // The (?:(?!\bnot\b)[^.!?])* stretch between "i'm/i am" and the role
  // word is "any run of characters, as long as the word 'not' never
  // starts partway through it" - so "I'm not the mafia" (a denial) is
  // correctly excluded from ever reaching the role word, while "I'm
  // definitely the mafia" still reaches it fine.
  const roleClaimRe = new RegExp('\\bi(?:\'m| am)\\b(?:(?!\\bnot\\b)[^.!?])*\\b(?:' + CHAT_ROLE_WORDS_PATTERN + ')\\b');
  if (roleClaimRe.test(t) || /\bmy role is\b/.test(t)) return R('role_claim');

  // Context upgrade: "I am"/"that's me" alone carries no role word of its
  // own, so it only reads as a role claim when it's actually answering a
  // "who's the X" question - checked against the reply-to line first,
  // then the last few lines before this one.
  if (/^(?:i'?m|i am|me|that'?s me|it'?s me)[.!]*$/.test(t)) {
    const roleQuestionRe = new RegExp('\\bwho\\b[^.!?]*\\b(?:' + CHAT_ROLE_WORDS_PATTERN + ')\\b');
    const askedAbout = roleQuestionRe.test(replyToText) || recentTexts.some(line => roleQuestionRe.test(line.toLowerCase()));
    if (askedAbout) return R('role_claim');
  }

  // Resolve whoever a stretch of text names: a real name first, otherwise a
  // bare pronoun answered from the surrounding thread.
  function targetIn(str){
    const n = findName(str);
    if (n) return n;
    if (PRONOUN_RE.test(str)) return mostRecentlyMentioned();
    return null;
  }
  // Negation sitting between a name and its accusation word ("Corky is not
  // the mafia", "he never killed anyone") flips the meaning - skip those.
  const NEG_RE = /\b(?:not|never|isn'?t|wasn'?t|didn'?t|doesn'?t|hasn'?t|no)\b|n't\b/;

  const qForM = t.match(/\bi have a question for\s+(.+)$/);
  if (qForM) return R('question', targetIn(qForM[1]));

  // Doubting someone's guilt is DEFENDING them, not accusing them: "I don't think it's Joe",
  // "no way Corky is the mafia", "I do not think Mabel did it". Checked before the accusation rules,
  // which would otherwise see the name next to a guilt word and file the opposite.
  const denyM = t.match(/\b(?:i (?:really |honestly |truly |just )?(?:do not|don'?t|dont) (?:think|believe|reckon|see)|i doubt|i highly doubt|no way|there'?s no way|i can'?t see|i cannot see)\b(.*)$/);
  if (denyM && /\b(?:mafia|maf|killer|guilty|liar|lying|murderer|traitor|culprit|did it|it'?s|it is|its|behind|responsible|vote|voting|lynch|hang|kill|killed|cultist|wolf)\b/.test(denyM[1])) {
    const who = targetIn(denyM[1]);
    if (who) return R('defense', who);
  }

  const accuseM = t.match(/\bi accuse\b(.*)$/);
  if (accuseM) return R('accusation', targetIn(accuseM[1]) || targetIn(t));

  const thinkItsMatch = t.match(/\b(?:i think|i believe|i bet|i'?m sure|pretty sure|i reckon|i know)\b[^.!?]*\b(?:it'?s|it is)\s+([^.!?]+)/);
  if (thinkItsMatch) {
    // First few words after "it's", not just the first one - a titled name
    // ("Sister Agatha Pruitt", "Big Tom Yarrow") starts with a stopword that
    // never matches on its own.
    const capWords = thinkItsMatch[1].trim().split(/\s*(?:[,;]|\band\b|\bbut\b)\s*/)[0].split(/\s+/);
    const cap = capWords.slice(0, 4).join(' ');
    const named = findName(cap) || (PRONOUN_RE.test(capWords[0]) ? mostRecentlyMentioned() : null);
    if (named) return R('accusation', named);
  }
  // "it was Corky", "it's Corky", "it has to be Corky" - the whole message
  // is basically the name, with no other verb to lean on.
  const bareItsM = t.match(/^(?:so |well |honestly |yeah |no,? )*(?:it'?s|its|it was|it is|it has to be|it must be|has to be|must be|gotta be|got to be)\s+(?:the |a )?([^.!?]+)/);
  if (bareItsM) {
    const named = findName(bareItsM[1].trim().split(/\s+/).slice(0, 4).join(' '));
    if (named) return R('accusation', named);
  }

  // "sus"/"suspicious" deliberately excluded here - those belong to the
  // dedicated suspicion category below, not accusation (a bug caught by
  // testing "Corky is acting really suspicious", which this pattern used
  // to swallow before suspicion ever got a turn).
  // "'s" covers the contraction ("he's the mafia") as well as the literal
  // word - just as common in real chat as spelling "is" out.
  const GUILT_WORDS = '(?:the |a |our |one of the )?(?:mafia|maf|killer|guilty|lying|liar|murderer|traitor|culprit|the one|behind (?:this|it|all this|the killings?)|responsible|a wolf|working with the mafia|cult(?:ist)?)';
  const isGuiltRe = new RegExp("\\b(?:is|was|'s|has been|must be|has to be|looks|seems)\\b([^.!?]*)\\b" + GUILT_WORDS + '\\b');
  if (subjectPresent(t)) {
    const gm = t.match(isGuiltRe);
    if (gm) {
      const before = t.slice(0, gm.index);
      const between = gm[1] || '';
      if (!NEG_RE.test(between) && !NEG_RE.test(t.slice(gm.index, gm.index + gm[0].length).replace(gm[1], ''))) {
        return R('accusation', targetIn(before) || targetIn(t));
      }
    }
    // "Corky did it", "Silas killed him", "Otis framed me", "Dot lied"
    const didM = t.match(/\b(?:did it|killed|murdered|is behind|framed|lied to|has been lying|was lying|lied)\b/);
    if (didM) {
      const before = t.slice(0, didM.index);
      const nameBefore = findName(before);
      if (nameBefore && !NEG_RE.test(before.slice(before.toLowerCase().indexOf(nameBefore.toLowerCase().split(' ')[0])))) {
        return R('accusation', nameBefore);
      }
    }
  }
  // Vouching for someone ("Corky is safe", "I think Joe is fine", "Mabel seems legit") - a defense of
  // that person whether or not anyone has accused them. Skipped when negated ("is not safe").
  const vouchM = t.match(/\b(?:is|seems|'s|looks|sounds|seem|are)\b[^.!?,;]*\b(?:innocent|clean|clear|safe|trustworthy|telling the truth|on our side|town|good|fine|legit|legitimate|okay|ok|cool|solid|honest|harmless|no threat|not (?:suspicious|sus)|not (?:the|a) (?:mafia|killer|traitor))\b/);
  if (vouchM && subjectPresent(t)) {
    const span = vouchM[0].replace(/not (?:suspicious|sus|the (?:mafia|killer|traitor)|a (?:mafia|killer|traitor))/g, '');
    if (!NEG_RE.test(span)) return R('trust_statement', targetIn(t.slice(0, vouchM.index)) || targetIn(t));
  }
  // Calling for a vote/execution of someone ("vote for Corky", "voting Tom",
  // "let's lynch Otis", "I'm going with Dot"). The old rule only matched the
  // literal "vote <word>" - "I'm voting Corky" or "lynch Corky" slipped past.
  const callM = t.match(/\b(?:vote(?: out| for)?|voting(?: for| out)?|voted(?: for| out)?|lynch|hang|execute|banish|eliminate|kill|ban|get rid of|going (?:with|for|after)|my (?:vote|money|bet) (?:is |goes )?(?:on|to|for)|my money'?s on)\b(.*)$/);
  if (callM) {
    const before = t.slice(0, callM.index);
    const named = targetIn(callM[1]) || (subjectPresent(t) ? targetIn(t) : null);
    if (named && !NEG_RE.test(before.slice(-30))) return R('accusation', named);
  }


  const defendM = t.match(/\bi defend\b(.*)$/);
  if (defendM) return R('defense', targetIn(defendM[1]));
  if (/\b(?:i'?m not|i am not|i didn'?t|i did not|that'?s not (?:true|fair)|i swear|you'?re wrong about me|i can prove)\b/.test(t)) return R('defense'); // defending themselves - no target
  // "Corky isn't the mafia", "he didn't do it" - defending someone ELSE.
  const notGuiltyM = t.match(/^(.*?)\b(?:is not|isn'?t|was not|wasn'?t|'s not|ain'?t|did not do it|didn'?t do it|has nothing to do with)\b[^.!?]*$/);
  if (notGuiltyM && /\b(?:mafia|killer|guilty|liar|lying|murderer|traitor|did it|it|this)\b/.test(t) && subjectPresent(notGuiltyM[1])) return R('defense', targetIn(notGuiltyM[1]));

  if (/\b(?:suspicious|sus|acting (?:weird|strange|off)|something'?s off|something is off|seems (?:off|weird|fishy)|why (?:did|would|were) you)\b/.test(t)) return R('suspicion');

  const trustM = t.match(/\b(?:i trust|i vouch for|i believe in|we can trust|you can trust|i'?d trust|i would trust|i'?m trusting)\b(.*)$/);
  if (trustM) return R('trust_statement', targetIn(trustM[1]));

  if (/\?\s*$/.test(t) || /^(?:who|what|why|where|when|how|did|do|does|are|is|can|could|would)\b/.test(t)) return R('question');

  return R('no_gameplay_meaning');
}

function classifyChatMessage(text, playerNames, context){
  return analyzeChatMessage(text, playerNames, context).category;
}

// "I agree" / "same" / "me too" - a short reply that adopts the accusation
// it's answering. Deliberately conservative: anything hedged, disagreeing, or
// phrased as a question isn't an endorsement.
const AGREE_RE = /(?:\b(?:i agree|agreed|i second|seconded|seconding|second that|same here|me too|i concur|ditto|likewise|exactly|totally|definitely|absolutely|for sure|facts|couldn'?t agree more|thinking the same|that'?s what i (?:think|thought)|i'?m with (?:you|him|her|them)|i'?m on board|you'?re right|u right|good point|so true)\b|^(?:yes|yep|yeah|yup|true|right|correct|same|this|agree|word)\b|^100%|\+1|^\^+$)/;
const DISAGREE_RE = /\b(?:disagree|don'?t agree|do not agree|not (?:sure|convinced|so sure)|doubt|nope|nah|no way|wrong|i don'?t think so|not really|can'?t agree|but|however|unless)\b|^no\b|\?\s*$/;
function isAgreement(text){
  const t = String(text || '').toLowerCase().trim();
  if (!t || t.length > 120) return false;
  return AGREE_RE.test(t) && !DISAGREE_RE.test(t);
}

// If this message is a bare agreement ("I agree", "same", "me too"), works out
// what it's agreeing WITH and returns { kind, agreedWithId, targetId? }:
//   kind 'accusation' - the message answered accused someone: the sender is filed as
//                       accusing that same player too (targetId)
//   kind 'defense'    - it defended someone: sender is defending them too (targetId)
//   kind 'support'    - anything else the other person said: the sender is just
//                       supporting THEM (agreedWithId)
// "What it answers" is the explicit Reply if there is one; otherwise ONLY the
// message immediately before it - an agreement doesn't reach back over other
// people's lines to find an older accusation (A accuses Joe, Joe says "slow
// down", Sarah says "I agree" is Sarah backing Joe, not A).
function detectAgreement(state, text, replyTo, senderId){
  if (!isAgreement(text)) return null;
  const log = (state.chatLog || []).filter(e => e && e.kind !== 'whisperAnnounce' && e.kind !== 'poll');
  let e = null;
  if (replyTo && replyTo.name) {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].name === replyTo.name && String(log[i].text || '').slice(0, 120) === String(replyTo.text || '')) { e = log[i]; break; }
    }
  } else if (log.length) {
    const last = log[log.length - 1];
    if (!(last.ts && Date.now() - last.ts > 90000)) e = last;
  }
  if (!e || e.playerId === senderId) return null;
  const alive = id => { const p = (state.players || []).find(q => q.id === id); return !!(p && p.alive); };
  if (e.targetId && e.targetId !== senderId && alive(e.targetId)) return { kind: 'accusation', targetId: e.targetId, agreedWithId: e.playerId };
  if (e.defendedId && alive(e.defendedId)) return { kind: 'defense', targetId: e.defendedId, agreedWithId: e.playerId };
  return { kind: 'support', agreedWithId: e.playerId };
}
// Old accusation-only view of the same thing (kept for callers/tests that only care about that case).
function detectAgreementTarget(state, text, replyTo, senderId){
  const r = detectAgreement(state, text, replyTo, senderId);
  return r && r.kind === 'accusation' ? { targetId: r.targetId, agreedWithId: r.agreedWithId } : null;
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
// ---------- Heat: how much bad attention a player is getting ----------
// Built only from things the whole table can already see (accusations in chat,
// the vote results after each day), so showing it leaks nothing. Live votes are
// secret until the reveal, so votes only count from earlier days.
//   accusation against you  +1   (a bare "I agree" accusation +0.5; once per accuser per day)
//   a vote against you      +2   (earlier days)
//   runner-up in last vote  +1   (2+ votes, you survived: the "that was close" bonus)
//   someone defends you     -0.5 each,  supports you -0.25 each (today)
// Everything halves for each day it is old, and heat never drops below zero.
const HEAT_LEVELS = ['Cold', 'Cool', 'Warm', 'Hot', 'Scalding'];
// Heat is measured against how many people are left to be against you: the same attention that is
// background noise at a full table is deadly when six are left. The score is the weighted pile of
// accusations/votes divided by the other living players (0.35 = about a third of the table).
const HEAT_THRESHOLDS = [0, 0.08, 0.2, 0.35, 0.55];
function heatLevelFor(score){
  let lv = 0;
  for(let i=0;i<HEAT_THRESHOLDS.length;i++) if(score >= HEAT_THRESHOLDS[i]) lv = i;
  return lv;
}
function computeHeat(state, playerId){
  const decay = night => Math.pow(0.5, Math.max(0, state.night - night));
  let score = 0, accusedEarlier = 0, votesLast = 0, votesEarlier = 0, nearMiss = false;
  const accusedToday = [];
  // accusations: one count per accuser per day (the strongest wins)
  const best = new Map();
  (state.accusationLog || []).forEach(e => {
    if(e.targetId !== playerId || e.accuserId === playerId) return;
    const key = e.accuserId + ':' + e.night;
    const w = e.agreedWithId ? 0.5 : 1;   // ("inferred" also covers ordinary typed accusations - only an agreement is the weaker kind)
    if(!best.has(key) || best.get(key).w < w) best.set(key, { w, night: e.night, accuserId: e.accuserId });
  });
  best.forEach(v => {
    score += v.w * decay(v.night);
    if(v.night === state.night){ const a = byId(state, v.accuserId); if(a) accusedToday.push(a.name); }
    else accusedEarlier++;
  });
  // votes against you from earlier days
  (state.voteHistory || []).forEach(v => {
    if(v.targetId !== playerId) return;
    score += 2 * decay(v.night);
    if(v.night === state.night - 1) votesLast++; else votesEarlier++;
  });
  // the close call in the last vote
  const lastNight = state.night - 1;
  if(lastNight >= 1){
    const tally = {};
    (state.voteHistory || []).forEach(v => { if(v.night === lastNight && v.targetId) tally[v.targetId] = (tally[v.targetId] || 0) + 1; });
    const counts = Object.keys(tally).map(id => tally[id]).sort((a, b) => b - a);
    const mine = tally[playerId] || 0;
    const secondBest = counts.length > 1 ? counts[1] : counts[0];
    const me = byId(state, playerId);
    if(me && me.alive && mine >= 2 && mine >= secondBest){ nearMiss = true; score += 1 * decay(lastNight); }
  }
  // people standing up for you today
  let defenders = 0, supporters = 0;
  const defSeen = new Set(), supSeen = new Set();
  (state.chatLog || []).forEach(e => {
    if(!e || e.night !== state.night || e.playerId === playerId) return;
    if(e.defendedId === playerId && !defSeen.has(e.playerId)){ defSeen.add(e.playerId); defenders++; score -= 0.5; }
    else if(e.supportedId === playerId && !supSeen.has(e.playerId)){ supSeen.add(e.playerId); supporters++; score -= 0.25; }
  });
  // ...as a share of everyone who could be against you (the other living players)
  const others = Math.max(1, state.players.filter(p => p.alive && p.id !== playerId).length);
  score = Math.max(0, Math.round((score / others) * 1000) / 1000);
  return { score, percent: Math.round(score * 100), others, level: heatLevelFor(score), accusedToday, accusedEarlier, votesLast, votesEarlier, nearMiss, defenders, supporters };
}
// What one viewer is shown: their own heat while alive; once dead, the hottest living player's.
function heatForView(state, viewerSeat){
  if(!viewerSeat) return null;
  if(viewerSeat.alive) return Object.assign({ self: true }, computeHeat(state, viewerSeat.id));
  let hot = null;
  state.players.forEach(p => {
    if(!p.alive) return;
    const h = computeHeat(state, p.id);
    if(!hot || h.score > hot.score) hot = { score: h.score, percent: h.percent, level: h.level, name: p.name };
  });
  return { self: false, hottest: hot };
}

// ---------- End-of-game summary: who won, who everyone was, points, awards ----------
// scoreRounds = [{night, cum:{playerId: cumulativePoints}}] kept by the server after every round.
function buildGameSummary(state, scoreRounds){
  scoreRounds = scoreRounds || [];
  const winner = state.winner;
  const won = p => winner === 'town' ? p.align === 'town' : winner === 'mafia' ? p.align === 'mafia' : winner === 'cult' ? p.align === 'cult' : winner === 'bounty' ? p.role === 'BountyHunter' : false;
  const totals = scoreRounds.length ? scoreRounds[scoreRounds.length - 1].cum : {};
  const players = state.players.map(p => ({
    id: p.id, name: p.name, role: p.role, align: p.align, alive: p.alive, isPlaceholder: !!p.isPlaceholder,
    avatarKey: p.avatarKey, gameIconKey: p.gameIconKey, color: p.color, won: won(p), total: totals[p.id] || 0
  }));
  const humans = players.filter(p => !p.isPlaceholder);
  const nameOf = id => { const p = players.find(q => q.id === id); return p ? p.name : '?'; };
  const topOf = (counts, min, humansOnly) => {
    let best = null;
    Object.keys(counts).forEach(id => {
      const p = players.find(q => q.id === id);
      if(!p || (humansOnly && p.isPlaceholder)) return;
      if(counts[id] >= min && (!best || counts[id] > best.value)) best = { id, value: counts[id] };
    });
    return best;
  };
  const bump = (m, k) => { if(k) m[k] = (m[k] || 0) + 1; };
  // accusations: once per accuser, target and day
  const acc = new Set(); const accusedBy = {}, accusersMade = {};
  (state.accusationLog || []).forEach(e => {
    const key = e.accuserId + '>' + e.targetId + ':' + e.night;
    if(acc.has(key)) return; acc.add(key);
    bump(accusedBy, e.targetId); bump(accusersMade, e.accuserId);
  });
  const votedAgainst = {};
  (state.voteHistory || []).forEach(v => { if(v.targetId) bump(votedAgainst, v.targetId); });
  const talk = {}, defended = {};
  (state.chatLog || []).forEach(e => {
    if(!e || e.kind) return;
    bump(talk, e.playerId);
    if(e.defendedId && e.defendedId !== e.playerId) bump(defended, e.playerId);
  });
  const awards = [];
  const addAward = (key, title, hit, blurb) => { if(hit) awards.push({ key, title, playerId: hit.id, name: nameOf(hit.id), value: hit.value, blurb: blurb(hit.value) }); };
  const scoreCounts = {}; humans.forEach(p => { scoreCounts[p.id] = p.total; });
  const mvp = humans.length ? humans.slice().sort((a, b) => b.total - a.total)[0] : null;
  if(mvp) addAward('mvp', 'MVP', { id: mvp.id, value: mvp.total }, v => v + ' points - the best player of the game');
  addAward('mostAccused', 'Most Wanted', topOf(accusedBy, 2, false), v => 'accused by ' + v + ' different players');
  addAward('mostVoted', 'Public Enemy No. 1', topOf(votedAgainst, 2, false), v => v + ' votes against them over the game');
  addAward('prosecutor', 'The Prosecutor', topOf(accusersMade, 2, true), v => 'pointed the finger ' + v + ' times');
  addAward('chatterbox', 'Chatterbox', topOf(talk, 3, true), v => v + ' lines of talk');
  addAward('defender', 'Defense Attorney', topOf(defended, 1, true), v => 'stood up for others ' + v + (v === 1 ? ' time' : ' times'));
  const chatLines = (state.chatLog || []).filter(e => e && !e.kind).length;
  return {
    winner,
    rounds: state.night,
    players,
    awards,
    scoreRounds: scoreRounds.map(r => ({ night: r.night, cum: r.cum })),
    stats: {
      rounds: state.night, messages: chatLines,
      accusations: acc.size,
      votesCast: (state.voteHistory || []).filter(v => v.targetId).length,
      polls: (state.chatLog || []).filter(e => e && e.kind === 'poll').length,
      whispers: (state.whisperLog || []).length
    },
    timeline: (state.history || []).slice()
  };
}

function getPlayerView(state, playerId){
  const me = byId(state, playerId);
  const seeAllRoles = !me || !me.alive || state.gameOver; // dead players get a full spectator view; everyone sees every role once the game is over
  // A living mafia-aligned player sees their living teammates too - the family
  // has to be able to coordinate a kill and avoid targeting its own.
  const iAmMafia = me && me.alive && me.align === 'mafia';
  // PREBETA Phase 2 Task 5 - a converted player immediately sees the Cult
  // Leader's identity and any other existing cult members, the same
  // teammate-visibility principle as mafia, just a different faction/roster.
  const iAmCult = me && me.alive && me.align === 'cult';
  const players = state.players.map(p => {
    const base = {id:p.id, name:p.name, alive:p.alive, silencedToday:p.silencedToday, isPlaceholder:p.isPlaceholder, occ:p.occ, color:p.color, avatarKey:p.avatarKey, gameIconKey:p.gameIconKey};
    // PREBETA Phase 2 Task 4 - Hitman's teammate awareness is asymmetric: he
    // never gets the system's passive teammate-visibility (excluded as the
    // VIEWER, `me`, so he never learns who his teammates are), but his own
    // teammates DO get it of him (he's not excluded as the TARGET, `p`) -
    // they know exactly who he is, he's just cut out of knowing them back.
    const seeAsTeammate = (iAmMafia && p.alive && p.align === 'mafia' && me.role !== 'Hitman')
      || (iAmCult && p.alive && p.align === 'cult');
    if(p.id === playerId || seeAllRoles || !p.alive || seeAsTeammate){
      base.role = p.role; base.align = p.align;
      if(p.role === 'NavySeal') base.usedNavySealCounter = p.usedNavySealCounter;
      if(p.role === 'Vigilante') base.usedVigilanteShot = p.usedVigilanteShot;
      if(p.role === 'Mayor') base.usedMayorReveal = p.usedMayorReveal;
    }
    // Why THIS player specifically died - purely personal (only matters for
    // their own death screen), so it's never exposed to anyone but them,
    // not even a dead spectator or teammate the block above already trusts
    // with role/align.
    if(p.id === playerId && p.deathCause) base.deathCause = p.deathCause;
    return base;
  });
  return {
    night: state.night, phase: state.phase, players, winner: state.winner, gameOver: state.gameOver,
    bountyPoints: (me && me.role==='BountyHunter') ? state.bountyPoints : (state.gameOver ? state.bountyPoints : undefined),
    bountyTarget: (me && me.role==='BountyHunter') ? state.bountyTarget : undefined,
    myRole: me ? me.role : null, myAlign: me ? me.align : null,
    // Purely personal - which player, if any, THIS viewer currently has the
    // spotlight on. Never who anyone else picked (see spotlightCounts for
    // the public, identity-free aggregate the town board's glow is built from).
    mySpotlightTarget: state.spotlights[playerId] || null,
    detectiveLog: (me && me.role==='Detective') ? state.detectiveLog : undefined,
    consigliereLog: (me && me.role==='Consigliere') ? state.consigliereLog : undefined,
    morticianLog: (me && me.role==='Mortician') ? state.morticianLog : undefined,
    // Who died last night, by name only (never role - that's the answer,
    // withheld until after they choose) - the Mortician's pool of choices
    // for tonight's investigation. Nobody else needs this: everyone already
    // learns WHO died via the night-kill reveal, just never their role.
    morticianCandidates: (me && me.role==='Mortician') ? state.lastNightDeaths.map(d => ({id: d.id, name: d.name})) : undefined,
    // Mafia chat is scoped strictly by align==='mafia' - never sent to a
    // town-aligned player, living or dead. Hitman is the one explicit
    // exception: mafia-aligned but deliberately excluded from this channel
    // entirely - never receives it, never participates in it.
    mafiaChatLog: (me && me.align==='mafia' && me.role !== 'Hitman') ? state.mafiaChatLog : undefined,
    // Cult chat is scoped strictly by CURRENT align==='cult' - same
    // double-sided pattern as mafiaChatLog above, just a different roster.
    cultChatLog: (me && me.align==='cult') ? state.cultChatLog : undefined,
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
    voteLog: state.voteLog, voteHistory: state.voteHistory, accusationLog: state.accusationLog, history: state.history,
    cachedOvernightReport: state.cachedOvernightReport, cachedNearMissId: state.cachedNearMissId || null, farmerRevengeName: state.farmerRevengeName,
    farmerRevengePending: state.farmerRevengePending,
    heat: heatForView(state, me),
    // A whisper is visible only to the two players in it, same scoping
    // principle as mafiaChatLog above - everyone else's whispers are
    // filtered out entirely, not just hidden client-side.
    whisperLog: me ? state.whisperLog.filter(w => w.fromId === playerId || w.toId === playerId) : undefined,
    // PREBETA Task 9 - scoped strictly by the VIEWER's own current alive
    // status, same double-sided principle as mafiaChatLog above (scoped by
    // align) - never sent to a living player under any circumstance.
    ghostChatLog: (me && !me.alive) ? state.ghostChatLog : undefined,
    // PREBETA Task 6 - Mayor Ability 2 resolves completely silently, with no
    // indication to anyone (including the Mayor's own identity) that it
    // happened. This flag is deliberately exposed to EVERY player equally,
    // never role-gated, so it never becomes a tell about who the Mayor is -
    // it only ever says a tie was broken this round, not by whom.
    mayorTiebreakResolved: state.lastDayVoteMayorTiebreak
  };
}

module.exports = {
  CHARACTERS, ROLE_LABEL, SPECIAL_ROLES, MIN_PLAYERS, MAX_PLAYERS, MAX_MAFIA_COUNT, DEFAULT_ROLES_CONFIG,
  HEAT_LEVELS, computeHeat, heatForView, buildGameSummary,
  shuffle, alignOf, createGame, byId, living, mafiaAlive, cultAlive, mafiaVoters, checkWin, checkBountyHit, checkGrannyFlip,
  detectiveRead, investigateAndRead, resolveNight, resolveDayVote, resolveFarmerRevenge, startNextNight,
  getPlayerView, log, specialRoleCount, validateSeatCapacity,
  recordDayVoteSubmission, recordMayorReveal, recordLivingCountSnapshot, recordAccusation, firstAccuserOf,
  recordSpotlight, spotlightCounts, classifyChatMessage, analyzeChatMessage, isAgreement, detectAgreementTarget, detectAgreement
};
