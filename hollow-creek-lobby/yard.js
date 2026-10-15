// Lobby Yard - a tiny, self-contained SIDE-VIEW pixel mini-game that people can play while they wait for a game to fill.
// It has nothing to do with the Mafia rules: a shared yard to wander, a ball to kick, and a king-of-the-hill
// brawl ring. Pure logic (no sockets, no timers) so it is easy to test; server.js owns the clock and the wire.
//
// The world is a flat side view: x runs left to right along the ground, y is height ABOVE the ground (0 = standing).
//
// Brawl rules: inside the ring you can punch. Three punches knock someone out. A knocked-out player can be
// picked up by anyone in the ring, carried over their head, and thrown in an arc over the ropes. If the thrown
// player lands outside the ring they are out: the thrower's win streak goes up and the victim's streak is gone.
// The crown (and the streak number) belongs to whoever has the longest running streak.

const W = 400, H = 225;                        // world size in pixels (drawn at an integer scale, chunky on purpose)
const BOUNDS = { x0: 14, x1: 386 };
const RING = { x: 236, w: 118 };               // the ring covers x in [RING.x, RING.x + RING.w] on the ground
const SPAWN_X = 70;
const SPEED = 74, CARRY_SPEED = 48, JUMP_V = 150, GRAVITY = 430;
const PUNCH_REACH = 21, PUNCH_HEIGHT = 15, PUNCH_COOLDOWN = 0.38, HITS_TO_KO = 3, KNOCKBACK = 40;
const KO_SECONDS = 4.2, HOLD_SECONDS = 5, GRAB_REACH = 19;
const THROW_VX = 125, THROW_VY = 150;           // a lob: about 100px across, easily over the ropes
const OUT_SECONDS = 1.6, STREAK_LAPSE_SECONDS = 12;
const EMOTE_SECONDS = 1.8, EMOTE_COOLDOWN = 0.6;
const EMOTES = ['wave', 'heart', 'laugh', 'bang', 'zzz'];
const STATE = { idle: 0, ko: 1, held: 2, thrown: 3, out: 4 };
const MAX_YARD_PLAYERS = 16;
const BODY = 6;                                 // half-width used for crowding

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function inRing(x) { return x >= RING.x && x <= RING.x + RING.w; }
function hash(str) { let h = 0; const s = String(str); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

function createYard() {
  return { t: 0, players: new Map(), ball: { x: 150, y: 20, vx: 0, vy: 0 }, events: [], lastCrown: null };
}

function genderFor(info) {
  const n = Number(String(info.gameIconKey || '').replace('avatar', ''));
  if (n >= 16 && n <= 35) return ((n >= 16 && n <= 20) || (n >= 26 && n <= 30)) ? 'm' : 'f';
  return hash(info.id) % 2 ? 'm' : 'f';
}

function join(y, id, info) {
  if (y.players.has(id)) return y.players.get(id);
  if (y.players.size >= MAX_YARD_PLAYERS) return null;
  const k = y.players.size;
  const p = {
    id, name: info.name || 'Player', color: info.color || '#c8873a', g: genderFor({ id, gameIconKey: info.gameIconKey }), hat: hash(id) % 4,
    x: SPAWN_X + (k % 6) * 14, y: 0, vx: 0, vy: 0, kb: 0, face: 1,
    mx: 0, actSeq: 0, actPending: false, jumpSeq: 0, jumpPending: false,
    state: STATE.idle, until: 0, hits: 0,
    carrying: null, heldBy: null, punchUntil: 0, punchReady: 0, lastThrower: null,
    streak: 0, streakAt: 0, wins: 0, outsideSince: null,
    emote: -1, emoteUntil: 0, emoteReady: 0
  };
  y.players.set(id, p);
  return p;
}

function releaseCarried(y, carrier, why) {
  if (!carrier || !carrier.carrying) return;
  const held = y.players.get(carrier.carrying);
  carrier.carrying = null;
  if (held && held.state === STATE.held) {
    held.heldBy = null; held.state = STATE.ko; held.until = y.t + 1.4; held.vx = 0; held.vy = 0; held.kb = 0;
    held.x = clamp(carrier.x + carrier.face * 10, BOUNDS.x0, BOUNDS.x1); held.y = carrier.y;
    y.events.push({ e: 'drop', id: held.id, why: why || 'drop' });
  }
}

function leave(y, id) {
  const p = y.players.get(id);
  if (!p) return;
  if (p.carrying) releaseCarried(y, p, 'left');
  if (p.heldBy) { const c = y.players.get(p.heldBy); if (c) c.carrying = null; }
  y.players.delete(id);
}

function setInput(y, id, input) {
  const p = y.players.get(id);
  if (!p || !input) return;
  let mx = Number(input.mx);
  if (!Number.isFinite(mx)) mx = 0;
  p.mx = clamp(mx, -1, 1);
  const act = Number(input.act);
  if (Number.isFinite(act) && act > p.actSeq) { p.actSeq = act; p.actPending = true; }
  const jump = Number(input.jump);
  if (Number.isFinite(jump) && jump > p.jumpSeq) { p.jumpSeq = jump; p.jumpPending = true; }
  if (typeof input.emote === 'string') {
    const idx = EMOTES.indexOf(input.emote);
    if (idx >= 0 && y.t >= p.emoteReady) { p.emote = idx; p.emoteUntil = y.t + EMOTE_SECONDS; p.emoteReady = y.t + EMOTE_COOLDOWN; y.events.push({ e: 'emote', id, k: idx }); }
  }
}

// the closest player in front of (or on top of) p, within `reach` along the ground and a short way up or down
function nearestInFront(y, p, reach, filter) {
  let best = null, bd = Infinity;
  y.players.forEach(o => {
    if (o === p || !filter(o)) return;
    const dx = o.x - p.x, d = Math.abs(dx);
    if (d > reach || Math.abs(o.y - p.y) > PUNCH_HEIGHT || d >= bd) return;
    if (d > 4 && dx * p.face < 0) return;           // behind us
    best = o; bd = d;
  });
  return best;
}

function doAction(y, p) {
  if (p.state !== STATE.idle) return;
  // throw what we are carrying
  if (p.carrying) {
    const held = y.players.get(p.carrying);
    p.carrying = null;
    if (held && held.state === STATE.held) {
      held.heldBy = null; held.state = STATE.thrown; held.lastThrower = p.id;
      held.vx = p.face * THROW_VX; held.vy = THROW_VY; held.x = p.x + p.face * 6; held.y = p.y + 14;
      y.events.push({ e: 'throw', id: held.id, by: p.id });
    }
    return;
  }
  const meInRing = inRing(p.x);
  if (meInRing) {
    const down = nearestInFront(y, p, GRAB_REACH, o => o.state === STATE.ko && inRing(o.x));
    if (down) {
      down.state = STATE.held; down.heldBy = p.id; down.until = y.t + HOLD_SECONDS; p.carrying = down.id;
      y.events.push({ e: 'grab', id: down.id, by: p.id });
      return;
    }
  }
  // kick the ball if it is right there (unless there is someone to hit)
  const b = y.ball;
  const fighterInFront = meInRing && nearestInFront(y, p, PUNCH_REACH, o => o.state === STATE.idle && inRing(o.x));
  if (!fighterInFront && Math.abs(b.x - p.x) < 17 && Math.abs(b.y - p.y) < 18) {
    b.vx = p.face * 165 + p.mx * 20; b.vy = 95;
    y.events.push({ e: 'kick', id: p.id });
    return;
  }
  if (y.t < p.punchReady) return;
  p.punchReady = y.t + PUNCH_COOLDOWN; p.punchUntil = y.t + 0.2;
  y.events.push({ e: 'punch', id: p.id });
  if (!meInRing) return;                          // the yard is peaceful: punches only land inside the ring
  const target = nearestInFront(y, p, PUNCH_REACH, o => o.state === STATE.idle && inRing(o.x));
  if (!target) return;
  target.kb = p.face * KNOCKBACK; if (target.y === 0) target.vy = 55;
  if (target.carrying) releaseCarried(y, target, 'hit');
  target.hits++;
  y.events.push({ e: 'hit', id: target.id, by: p.id });
  if (target.hits >= HITS_TO_KO) {
    target.hits = 0; target.state = STATE.ko; target.until = y.t + KO_SECONDS;
    y.events.push({ e: 'ko', id: target.id, by: p.id });
  }
}

function land(y, p) {
  p.y = 0; p.vy = 0; p.vx = 0; p.kb = 0;
  p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1);
  const thrower = p.lastThrower ? y.players.get(p.lastThrower) : null;
  p.lastThrower = null;
  if (inRing(p.x)) {                               // landed back inside the ring: dazed but still in the fight
    p.state = STATE.ko; p.until = y.t + 1.6;
    y.events.push({ e: 'land', id: p.id });
    return;
  }
  p.state = STATE.out; p.until = y.t + OUT_SECONDS; p.hits = 0; p.streak = 0; p.outsideSince = null;
  y.events.push({ e: 'out', id: p.id, by: thrower ? thrower.id : null });
  if (thrower && thrower !== p) {
    thrower.streak++; thrower.wins++; if (thrower.streak === 1) thrower.streakAt = y.t;
    y.events.push({ e: 'streak', id: thrower.id, n: thrower.streak });
  }
}

function step(y, dt) {
  y.t += dt;
  const t = y.t;
  y.players.forEach(p => {
    if (p.actPending) { p.actPending = false; doAction(y, p); }
    if (p.jumpPending) {
      p.jumpPending = false;
      if (p.state === STATE.idle && p.y === 0) { p.vy = JUMP_V; y.events.push({ e: 'jump', id: p.id }); }
    }
    if (p.emote >= 0 && t > p.emoteUntil) p.emote = -1;
    switch (p.state) {
      case STATE.idle: {
        const sp = p.carrying ? CARRY_SPEED : SPEED;
        p.vx = p.mx * sp;
        if (p.mx) p.face = p.mx > 0 ? 1 : -1;
        p.x += (p.vx + p.kb) * dt;
        p.kb *= Math.pow(0.002, dt); if (Math.abs(p.kb) < 4) p.kb = 0;
        if (p.carrying && !inRing(p.x)) releaseCarried(y, p, 'left-ring');
        break;
      }
      case STATE.ko:
        p.x += p.kb * dt; p.kb *= Math.pow(0.002, dt);
        if (t >= p.until) { p.state = STATE.idle; p.hits = 0; p.kb = 0; }
        break;
      case STATE.held: {
        const c = p.heldBy ? y.players.get(p.heldBy) : null;
        if (!c || c.carrying !== p.id) { p.state = STATE.ko; p.until = t + 1.4; p.heldBy = null; break; }
        p.x = c.x; p.y = c.y;
        if (t >= p.until) { c.carrying = null; p.heldBy = null; p.state = STATE.ko; p.until = t + 1.4; p.y = c.y; y.events.push({ e: 'drop', id: p.id, why: 'wriggled' }); }
        break;
      }
      case STATE.thrown:
        p.x += p.vx * dt;
        if (p.x <= BOUNDS.x0 || p.x >= BOUNDS.x1) { p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1); p.vx = -p.vx * 0.3; }
        break;
      case STATE.out:
        if (t >= p.until) { p.state = STATE.idle; p.vx = 0; p.kb = 0; }
        break;
    }
    // gravity for everyone who is not being carried
    if (p.state !== STATE.held) {
      if (p.y > 0 || p.vy > 0) {
        p.y += p.vy * dt; p.vy -= GRAVITY * dt;
        if (p.y <= 0) { p.y = 0; if (p.state === STATE.thrown) land(y, p); else p.vy = 0; }
      }
    }
    p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1);
    // a streak only lasts while you keep defending the ring
    if (p.streak > 0) {
      if (inRing(p.x)) p.outsideSince = null;
      else { if (p.outsideSince === null) p.outsideSince = t; if (t - p.outsideSince > STREAK_LAPSE_SECONDS) { p.streak = 0; p.outsideSince = null; } }
    }
  });
  // gentle crowding on the ground so players do not stack on one pixel
  const list = [...y.players.values()].filter(p => (p.state === STATE.idle || p.state === STATE.out) && p.y < 4);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const dx = b.x - a.x, d = Math.abs(dx);
    if (d < BODY * 1.4) {
      const push = (BODY * 1.4 - d) / 2, dir = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx);
      a.x -= dir * push; b.x += dir * push;
    }
  }
  // the ball
  const b = y.ball;
  y.players.forEach(p => {
    if (p.state !== STATE.idle || !p.mx) return;
    const dx = b.x - p.x;
    if (Math.abs(dx) < BODY + 3 && Math.abs(b.y - p.y) < 12 && dx * p.mx > 0) b.vx += p.mx * 30;
  });
  b.x += b.vx * dt; b.y += b.vy * dt; b.vy -= GRAVITY * dt;
  if (b.y <= 3) { b.y = 3; if (Math.abs(b.vy) > 30) b.vy = -b.vy * 0.5; else b.vy = 0; b.vx *= Math.pow(0.25, dt); }
  if (Math.abs(b.vx) < 1) b.vx = 0;
  if (b.x < BOUNDS.x0) { b.x = BOUNDS.x0; b.vx = Math.abs(b.vx) * 0.7; }
  if (b.x > BOUNDS.x1) { b.x = BOUNDS.x1; b.vx = -Math.abs(b.vx) * 0.7; }
  // crown
  const king = crownId(y);
  if (king !== y.lastCrown) { y.lastCrown = king; if (king) y.events.push({ e: 'crown', id: king }); }
}

function crownId(y) {
  let best = null;
  y.players.forEach(p => {
    if (p.streak < 1) return;
    if (!best || p.streak > best.streak || (p.streak === best.streak && p.streakAt < best.streakAt)) best = p;
  });
  return best ? best.id : null;
}

function round1(v) { return Math.round(v * 10) / 10; }

function snapshot(y) {
  const players = [];
  y.players.forEach(p => players.push({
    i: p.id, x: round1(p.x), y: round1(p.y), f: p.face, s: p.state, h: p.hits,
    c: p.carrying || undefined, st: p.streak, e: p.emote >= 0 ? p.emote : undefined, p: y.t < p.punchUntil ? 1 : undefined, m: p.mx ? 1 : undefined
  }));
  return { type: 'yardSnap', t: round1(y.t), players, ball: { x: round1(y.ball.x), y: round1(y.ball.y) }, crown: crownId(y) };
}

function roster(y) {
  return [...y.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, g: p.g, hat: p.hat, wins: p.wins }));
}

function takeEvents(y) { const e = y.events; y.events = []; return e; }

module.exports = {
  W, H, BOUNDS, RING, STATE, EMOTES, MAX_YARD_PLAYERS, HITS_TO_KO, THROW_VX, THROW_VY, GRAVITY,
  createYard, join, leave, setInput, step, snapshot, roster, takeEvents, inRing, crownId
};
