// Bots that play like players, for the balance simulations (sim-balance.js, sim-lineups.js).
// They never see anything a real player couldn't: each bot knows its own role and what its role has
// learned, the mafia know each other, and everyone sees public events (deaths, lynch results with the
// victim's role, the near-miss "someone was saved" news, who voted for whom, and a Detective's announcements).
// No bot picks a target at random just because; choices come from suspicion built up from those facts,
// plus a little personal hunch so two bots don't always agree.
const G = require('./game.js');

const rnd = n => Math.floor(Math.random() * n);
const pickRandom = arr => arr[rnd(arr.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;   // roughly N(0, 0.6)
function weightedPick(items, scoreOf, temperature) {
  const scores = items.map(scoreOf), top = Math.max(...scores);
  const w = scores.map(s => Math.exp((s - top) / temperature));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

function newBrain(state) {
  const brain = {
    claims: [],            // public Detective-style announcements: {claimant, target, read, day}
    claimantTrust: {},     // claimantId -> how much the town believes them
    lynches: [],           // {id, align, role, votersFor:[ids]}
    nearMiss: new Set(),   // people the mafia tried to kill and failed (almost certainly town)
    hunch: {},             // bot -> target -> persistent personal feeling
    known: {},             // bot -> target -> {read} / {role}: private knowledge
    team: { detective: null, doctor: null },   // what the mafia's Consigliere has uncovered
    announced: {},         // detectiveId -> number of reads already announced
    day: 0
  };
  state.players.forEach(a => { brain.hunch[a.id] = {}; brain.known[a.id] = {}; state.players.forEach(b => { brain.hunch[a.id][b.id] = gauss(); }); });
  return brain;
}

const isMafia = p => p.align === 'mafia';
const alive = state => G.living(state);

// How suspicious `t` looks to `b`, from b's own point of view.
function suspicion(state, brain, b, t) {
  if (b.id === t.id) return -99;
  if (isMafia(b) && isMafia(t)) return -50;                 // mafia know each other
  let s = brain.hunch[b.id][t.id];
  const k = brain.known[b.id][t.id];
  if (k && k.read === 'guilty') s += 9;
  if (k && k.read === 'innocent') s -= 5;
  if (k && k.read === 'suspicious') s += 2.5;
  if (k && k.role) s += (isMafia({ align: G.alignOf(k.role) }) ? 9 : -4);
  brain.claims.forEach(c => {
    if (c.claimant === b.id) return;                        // my own result is already in `known`
    const trust = brain.claimantTrust[c.claimant] != null ? brain.claimantTrust[c.claimant] : 0.6;
    if (c.target === t.id) s += (c.read === 'guilty' ? 3.2 : c.read === 'suspicious' ? 1.0 : -1.8) * trust;
    if (c.claimant === t.id) s += (trust < 0.3 ? 2 : -0.8);   // a discredited claimant looks like a mafia plant
  });
  brain.lynches.forEach(l => {
    const voted = l.votersFor.includes(t.id);
    if (l.align === 'town' && voted) s += 1.1;              // pushed an innocent onto the gallows
    if (l.align === 'mafia' && voted) s -= 0.9;             // helped catch one
    if (l.align === 'mafia' && !voted) s += 0.25;
  });
  if (brain.nearMiss.has(t.id)) s -= 0.8;
  return s;
}

function chooseNightActions(state, brain) {
  const people = alive(state);
  const actions = {};
  const mafiaVotersNow = G.mafiaVoters(state);

  // ---- mafia: one shared kill target and silence target, as if agreed in their private chat
  let killTarget = null, silenceTarget = null;
  if (mafiaVotersNow.length) {
    const victims = people.filter(p => !isMafia(p));
    const threat = t => {
      let s = Math.random() * 0.8;
      brain.claims.forEach(c => { if (c.claimant === t.id && (brain.claimantTrust[t.id] == null || brain.claimantTrust[t.id] > 0.3)) s += 4; });
      if (brain.team.detective === t.id) s += 6;
      if (brain.team.doctor === t.id) s += 3;
      brain.lynches.forEach(l => { if (l.align === 'mafia' && l.votersFor.includes(t.id)) s += 1.2; });
      if (t.role === 'Vigilante') s += 0;                 // identity unknown to the mafia
      return s;
    };
    if (victims.length) {
      killTarget = victims.slice().sort((a, b) => threat(b) - threat(a))[0];
      const rest = victims.filter(v => v.id !== killTarget.id);
      silenceTarget = rest.length ? rest.slice().sort((a, b) => threat(b) - threat(a))[0] : null;
    }
    mafiaVotersNow.forEach(p => { actions[p.id] = { kill: killTarget && killTarget.id }; });
  }

  people.forEach(p => {
    const a = actions[p.id] || (actions[p.id] = {});
    const others = people.filter(q => q.id !== p.id);
    const mostSuspect = list => list.slice().sort((x, y) => suspicion(state, brain, p, y) - suspicion(state, brain, p, x))[0];
    const unchecked = list => list.filter(q => !brain.known[p.id][q.id]);
    if (p.role === 'Godfather' && silenceTarget) a.silence = silenceTarget.id;
    if (p.role === 'Detective') {
      const pool = unchecked(others); const t = mostSuspect(pool.length ? pool : others); if (t) a.investigate = t.id;
    }
    if (p.role === 'Consigliere') {
      const pool = unchecked(others.filter(q => !isMafia(q))); const t = mostSuspect(pool); if (t) a.consigliereInvestigate = t.id;
    }
    if (p.role === 'Doctor') {
      // shield whoever the town is relying on (a believed Detective), otherwise whoever the mafia would most want gone
      const claimant = others.find(q => brain.claims.some(c => c.claimant === q.id) && (brain.claimantTrust[q.id] == null || brain.claimantTrust[q.id] > 0.5));
      const t = claimant || others.slice().sort((x, y) => (suspicion(state, brain, p, x) + Math.random() * 1.5) - (suspicion(state, brain, p, y) + Math.random() * 1.5))[0];
      if (t) a.protect = t.id;
    }
    if (p.role === 'Coward') { const t = mostSuspect(others); if (t) a.hideBehind = t.id; }
    if (p.role === 'BountyHunter') { const t = mostSuspect(others); if (t) a.bounty = t.id; }
    if (p.role === 'Framer') {
      const team = people.filter(isMafia);
      const exposed = team.slice().sort((x, y) => brain.claims.filter(c => c.target === y.id).length - brain.claims.filter(c => c.target === x.id).length)[0];
      a.frameTarget = (exposed && brain.claims.some(c => c.target === exposed.id) ? exposed : pickRandom(others.filter(q => !isMafia(q)).concat(team))).id;
    }
    if (p.role === 'Vigilante' && !p.usedVigilanteShot && state.night >= 2) {
      const t = mostSuspect(others);
      if (t && suspicion(state, brain, p, t) >= 6) a.vigilanteKill = t.id;   // only fires when it is nearly sure
    }
    if (p.role === 'Mortician' && state.lastNightDeaths && state.lastNightDeaths.length) a.morticianInvestigate = state.lastNightDeaths[0].id;
  });
  return actions;
}

function learnFromNight(state, brain, res) {
  if (res.doctorSaved && res.killTargetId) brain.nearMiss.add(res.killTargetId);
  if (res.investigationResult) {
    const r = res.investigationResult;
    brain.known[r.detectiveId][r.targetId] = { read: r.read };
  }
  if (res.consigliereResult) {
    const r = res.consigliereResult;
    state.players.filter(isMafia).forEach(m => { brain.known[m.id][r.targetId] = { role: r.role }; });
    if (r.role === 'Detective') brain.team.detective = r.targetId;
    if (r.role === 'Doctor') brain.team.doctor = r.targetId;
  }
}

// A living Detective tells the town what they've found (most do); a mafia member sometimes lies about it.
function announce(state, brain) {
  const day = ++brain.day;
  const det = state.players.find(p => p.alive && p.role === 'Detective');
  const reads = state.detectiveLog;
  const already = det ? (brain.announced[det.id] || 0) : 0;
  if (det && reads.length > already && Math.random() < 0.8) {
    reads.slice(already).forEach(e => {
      const target = state.players.find(q => q.name === e.name);
      if (target && target.alive) brain.claims.push({ claimant: det.id, target: target.id, read: e.read, day });
    });
    brain.announced[det.id] = reads.length;
  }
  const liars = alive(state).filter(p => isMafia(p) && p.role !== 'Hitman');
  const realClaim = brain.claims.some(c => c.day === day);
  if (liars.length && day >= 2 && Math.random() < (realClaim ? 0.45 : 0.2)) {
    const liar = pickRandom(liars);
    const targets = alive(state).filter(q => !isMafia(q) && !brain.claims.some(c => c.claimant === q.id));
    if (targets.length) {
      // the fake claimant usually points at the real Detective (or whoever the real claim cleared)
      const real = brain.claims.find(c => c.day === day);
      const t = real && alive(state).find(q => q.id === real.claimant && !isMafia(q)) || pickRandom(targets);
      brain.claims.push({ claimant: liar.id, target: t.id, read: 'guilty', day, fake: true });
    }
  }
  // two competing claimants -> the town trusts each less until a lynch settles it
  const claimants = [...new Set(brain.claims.map(c => c.claimant))];
  claimants.forEach(id => { if (brain.claimantTrust[id] == null) brain.claimantTrust[id] = claimants.filter(x => alive(state).some(p => p.id === x)).length > 1 ? 0.4 : 0.75; });
}

function dayVotes(state, brain) {
  const living = alive(state);
  const tally = {};
  living.forEach(p => { tally[p.id] = 0; });
  const order = G.shuffle(living.slice());
  const cast = {};
  order.forEach(p => {
    const options = living.filter(q => q.id !== p.id);
    if (!options.length) return;
    // a Mayor who has a strong suspect uses their one double vote
    if (p.role === 'Mayor' && !p.usedMayorReveal && living.length >= 5) {
      const top = options.slice().sort((x, y) => suspicion(state, brain, p, y) - suspicion(state, brain, p, x))[0];
      if (!isMafia(p) && suspicion(state, brain, p, top) >= 3) G.recordMayorReveal(state, p.id);
    }
    let pool = options;
    let score;
    if (isMafia(p)) {
      // blend in: vote where the town is already heading, aimed at non-mafia; sacrifice a teammate only if the crowd is about to get them anyway
      const lead = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      const leader = living.find(q => q.id === lead);
      if (leader && isMafia(leader) && leader.id !== p.id && tally[lead] >= Math.ceil(living.length * 0.4) && Math.random() < 0.6) { cast[p.id] = lead; tally[lead]++; return; }
      pool = options.filter(q => !isMafia(q));
      if (!pool.length) pool = options;
      score = q => {
        let s = 0;
        brain.claims.forEach(c => { if (c.claimant === q.id) s += 2.5; });
        s += suspicionOfTownView(state, brain, q) * 0.6 + 0.6 * tally[q.id] + brain.hunch[p.id][q.id] * 0.5;
        return s;
      };
    } else if (p.role === 'BountyHunter') {
      const target = state.bountyTarget && living.find(q => q.id === state.bountyTarget);
      score = q => (target && q.id === target.id ? 4 : 0) + suspicion(state, brain, p, q) + 0.5 * tally[q.id];
    } else {
      score = q => suspicion(state, brain, p, q) + (suspicion(state, brain, p, q) > 0.5 ? 0.45 * tally[q.id] : 0);
    }
    const choice = weightedPick(pool, score, 1.0);
    cast[p.id] = choice.id; tally[choice.id]++;
  });
  return cast;
}

// what a typical townsperson would think of q (no personal hunches) - used by mafia to blend in
function suspicionOfTownView(state, brain, q) {
  let s = 0;
  brain.claims.forEach(c => {
    const trust = brain.claimantTrust[c.claimant] != null ? brain.claimantTrust[c.claimant] : 0.6;
    if (c.target === q.id) s += (c.read === 'guilty' ? 3.2 : c.read === 'suspicious' ? 1 : -1.8) * trust;
  });
  brain.lynches.forEach(l => { if (l.align === 'town' && l.votersFor.includes(q.id)) s += 1.1; if (l.align === 'mafia' && l.votersFor.includes(q.id)) s -= 0.9; });
  return s;
}

function learnFromLynch(state, brain, res, cast) {
  const lead = res.lead;
  if (!lead) return;
  const votersFor = Object.keys(cast).filter(id => cast[id] === lead.id);
  brain.lynches.push({ id: lead.id, align: lead.align, role: lead.role, votersFor });
  // settle claims: a verified claimant is believed, a claimant whose target was a lynched innocent is discredited
  brain.claims.forEach(c => {
    if (c.target === lead.id && c.read === 'guilty') brain.claimantTrust[c.claimant] = lead.align === 'mafia' ? 0.97 : Math.min(brain.claimantTrust[c.claimant] || 0.6, 0.15);
  });
}

// Plays one whole game for an already-created state. Returns {winner, rounds}.
function playGame(state) {
  state.players.forEach(p => { p.isHuman = true; p.isPlaceholder = false; p.connected = true; });   // bots act for themselves, not through the auto fallbacks
  const brain = newBrain(state);
  let rounds = 0;
  while (!state.gameOver && rounds < 60) {
    rounds++;
    state.pendingNightVotes = chooseNightActions(state, brain);
    const night = G.resolveNight(state);
    learnFromNight(state, brain, night);
    if (state.gameOver) break;
    announce(state, brain);
    const cast = dayVotes(state, brain);
    state.pendingDayVotes = Object.assign({}, cast);
    const res = G.resolveDayVote(state);
    learnFromLynch(state, brain, res, cast);
    if (res.farmerRevengePending) {
      const dead = G.byId(state, res.farmerRevengePending);
      const options = alive(state).filter(q => q.id !== dead.id);
      let target = null;
      if (options.length) {
        const claimant = options.find(q => brain.claims.some(c => c.claimant === q.id));
        target = dead.role === 'Hitman' ? (claimant || pickRandom(options)) : options.slice().sort((x, y) => suspicion(state, brain, dead, y) - suspicion(state, brain, dead, x))[0];
      }
      G.resolveFarmerRevenge(state, dead.id, target && target.id);
    }
    if (state.gameOver) break;
    G.startNextNight(state);
  }
  return { winner: state.winner || 'none', rounds };
}

module.exports = { playGame };
