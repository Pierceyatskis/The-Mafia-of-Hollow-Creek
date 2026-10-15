// Trap Run - the simulation for the lobby's troll-platformer mini game (physics, traps, screens).
// Pure and deterministic (fixed 60 Hz steps), shared by the browser and the tests, so every screen can be
// proven completable by a solver. Nothing here touches the DOM or the network.
//
// The game is a chain of single screens (25 x 17 tiles). Reaching the exit of a screen is the checkpoint and starts the next one.
// Traps are deliberately silent and look like scenery until they go off: that is the joke.
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrapSim = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';
  var TILE = 16, COLS = 25, ROWS = 17, VIEW_W = COLS * TILE, VIEW_H = ROWS * TILE;   // 400 x 272
  var DT = 1 / 60, LIVES = 15;
  var P = { w: 8, h: 12, hDuck: 6, run: 82, duckRun: 30, accel: 760, fric: 980, airAccel: 520, grav: 800, jump: 272, maxFall: 330, coyote: 0.09, buffer: 0.10, cut: 0.42 };
  var T = { EMPTY: 0, SOLID: 1, SPIKE: 2, FSPIKE: 3 };      // FSPIKE: drawn exactly like a spike, but harmless

  // ------------------------------------------------------------------ screen building
  function Builder(name, intro){
    this.name = name; this.intro = intro || '';
    this.rows = []; for(var y = 0; y < ROWS; y++){ var r = []; for(var x = 0; x < COLS; x++) r.push('.'); this.rows.push(r); }
    this.traps = []; this.start = { x: 1.5, y: 15 }; this.exit = null;
  }
  Builder.prototype.set = function(x, y, ch){ if(x >= 0 && x < COLS && y >= 0 && y < ROWS) this.rows[y][x] = ch; return this; };
  Builder.prototype.fill = function(x0, y0, x1, y1, ch){ for(var y = y0; y <= y1; y++) for(var x = x0; x <= x1; x++) this.set(x, y, ch); return this; };
  Builder.prototype.ceiling = function(){ return this.fill(0, 0, COLS - 1, 1, '#'); };
  Builder.prototype.ground = function(x0, x1){ return this.fill(x0, 15, x1, 16, '#'); };      // floor: rows 15-16; feet land at y = 240
  Builder.prototype.plat = function(x, y, w, h){ return this.fill(x, y, x + w - 1, y + (h || 1) - 1, '#'); };
  Builder.prototype.spikes = function(x0, x1, y){ return this.fill(x0, y === undefined ? 14 : y, x1, y === undefined ? 14 : y, '^'); };
  Builder.prototype.fakeSpikes = function(x0, x1, y){ return this.fill(x0, y === undefined ? 14 : y, x1, y === undefined ? 14 : y, 'f'); };
  Builder.prototype.goal = function(x, y, opts){ this.exit = { x: x, y: y === undefined ? 15 : y, duck: !!(opts && opts.duck) }; return this; };
  Builder.prototype.trap = function(t){ this.traps.push(t); return this; };
  Builder.prototype.build = function(){
    var grid = new Uint8Array(COLS * ROWS), rows = [];
    for(var y = 0; y < ROWS; y++){
      rows.push(this.rows[y].join(''));
      for(var x = 0; x < COLS; x++){ var c = this.rows[y][x]; grid[y * COLS + x] = c === '#' ? T.SOLID : c === '^' ? T.SPIKE : c === 'f' ? T.FSPIKE : T.EMPTY; }
    }
    return { name: this.name, intro: this.intro, w: COLS, h: ROWS, grid: grid, rows: rows, traps: this.traps, start: this.start, exit: this.exit };
  };

  var DEATH_LINES = {
    ceil: ['You dodged one spike. Another was waiting.', 'Jumping was a bold choice.', 'The ceiling had a spike. Of course it did.'],
    fling: ['The spike had been practising.', 'It aimed where you were going. Rude.', 'Right between the eyes. Mostly.'],
    boulder: ['You were rolled over.', 'It was a very round problem.', 'Patience was the answer. It always is.'],
    pop: ['The floor grew a point.', 'Short hops are for short people.', 'You needed more air.'],
    rock: ['It was just a rock. A very heavy rock.', 'The ceiling had other plans.', 'Look up. Next time, look up.'],
    spike: ['Those were not decorative.', 'Sharp. Very sharp.', 'The floor was lying to you.'],
    pit: ['You fell. A long, long way.', 'Gravity wins again.', 'That bridge was a rumour.'],
    plate: ['It said DO NOT PRESS.', 'You pressed it. Of course you did.', 'A button is a promise. Of regret.'],
    doorSpike: ['You must bow to enter.', 'Stand tall, die small.', 'Manners cost nothing. Standing costs everything.']
  };

  // ------------------------------------------------------------------ the five screens
  function buildLevels(){
    var L = [];

    // ---- 1. Welcome, Adventurer. Hop up the ledges, clear the spike hanging in the gap, land, and it comes at the spot you were about to be at, at head height.
    //         Jump to dodge it and a spike drops from the ceiling. Duck. Then: an invisible wall, a drop onto a little block, and a ledge that gives way under a rising spike.
    (function(){
      var b = new Builder('Welcome, Adventurer', 'Nothing to see here. Please jump the spike.');
      b.ceiling(); b.start = { x: 1.5, y: 12 };
      b.plat(0, 12, 3, 2);                                  // start
      b.plat(4, 11, 2, 1);                                  // ledge
      b.plat(7, 10, 2, 1);                                  // ledge
      b.plat(10, 10, 1, 1);                                 // the little plate the spike sits on
      b.plat(12, 11, 5, 1);                                 // landing platform (right edge at x = 17)
      b.plat(17, 14, 2, 1);                                 // the small block, well below
      b.plat(22, 13, 3, 2);                                 // the far end, with the door (the tile before it is the sliver that gives way)
      b.trap({ k: 'fling', hx: 10.5, hy: 9.5, row: 11, trig: { x0: 12.0, x1: 17.0 }, wait: 0.3, T: 0.35, head: 12, drop: 0.12, minV: 170, ceil: true, cl: 0.3 });
      b.trap({ k: 'iwall', rect: [320, 32, 16, 128] });      // an invisible wall: a jump from the landing platform bonks your head on it
      b.trap({ k: 'collapse', x: 21, y: 13, w: 1, h: 2, delay: 1.25 });     // the sliver of ledge that gives way
      b.trap({ k: 'pop', x: 22, y: 12, n: 1, reach: 16, trig: { x0: 20.9, x1: 25 } });    // the tiny spike you jump over...
      b.trap({ k: 'pop', x: 23, y: 12, n: 1, reach: 16, trig: { x0: 22.3, x1: 25 } });    // ...and its friend on the other side
      b.goal(24, 13);
      L.push(b.build());
    })();

    // ---- 2. The Boulder. Stand still and it stops short, rolls back, and knocks a hole in the wall. Then the floor grows spikes: jump HIGH.
    (function(){
      var b = new Builder('The Boulder', 'A very large ball has noticed you.');
      b.ceiling(); b.ground(0, 24); b.start = { x: 2, y: 15 };
      b.fill(21, 2, 24, 12, '#');                          // the far wall, with a chunk left to be knocked out
      b.fill(23, 13, 24, 14, '.');
      b.fill(21, 13, 22, 14, '.');                         // (the chunk itself is dynamic, see the trap)
      b.trap({ k: 'boulder', x: 19.2, row: 15, delay: 1.0, speed: 52, rev: 150, R: 30, wallX: 21, chunk: { x0: 21, y0: 13, x1: 22, y1: 14 }, hold: 1.3 });
      b.trap({ k: 'pop', x: 13, y: 14, n: 1, reach: 30, trig: { x0: 10.8, x1: 12.4 }, after: 0 });
      b.trap({ k: 'rock', mode: 'still', when: 0, still: 0.5, delay: 0.5, row: 15 });      // you learned to stand still. The wall opens. Keep standing there.
      b.goal(23.4, 15);
      L.push(b.build());
    })();

    // ---- 3. The Void. Two honest jumps, then a gap that only holds you if you WALK. Jump and the far platform drops out and the floor is gone.
    (function(){
      var b = new Builder('The Void', 'Three jumps. The first two are normal.');
      b.ceiling(); b.start = { x: 1.5, y: 13 };
      b.plat(0, 13, 3, 1);                                  // A
      b.plat(5, 13, 4, 1);                                  // B  (gap of two tiles)
      b.trap({ k: 'collapse', x: 11, y: 13, w: 4, delay: 2.2 });                           // C  (gap of two tiles); too slow and it gives way
      b.trap({ k: 'void', bridge: { x0: 15, x1: 17, row: 13 }, far: { x0: 18, x1: 21, row: 13 }, zone: { x0: 13.2, x1: 15.6 } });   // the far platform and the floor you cannot see
      b.trap({ k: 'rock', mode: 'lead', trig: { x0: 19.2, x1: 21.6, row: 13 }, lead: 0.5, row: 13 });
      b.trap({ k: 'collapse', x: 22, y: 13, w: 3, delay: 0.3 });                           // you made it. The last three tiles disagree
      b.goal(23.5, 13);
      L.push(b.build());
    })();

    // ---- 4. Take Your Time. Pillars that slide away if you linger, and rocks that fall on the spot you were about to step to.
    (function(){
      var b = new Builder('Take Your Time', 'Rest if you must. Briefly.');
      b.ceiling(); b.start = { x: 1.5, y: 13 };
      b.plat(0, 13, 3, 1);
      b.trap({ k: 'slide', x: 5, y: 13, w: 3, delay: 1.5, dir: -1 });
      b.trap({ k: 'slide', x: 10, y: 13, w: 3, delay: 1.6, dir: 1 });
      b.trap({ k: 'slide', x: 15, y: 13, w: 3, delay: 0.35, dir: -1 });
      b.trap({ k: 'slide', x: 20, y: 13, w: 5, delay: 1.1, dir: 1 });                     // even the finish line does not want you to get comfortable
      b.trap({ k: 'rock', mode: 'lead', trig: { x0: 5.0, x1: 7.6, row: 13 }, lead: 0.5, row: 13 });
      b.trap({ k: 'rock', mode: 'lead', trig: { x0: 10.0, x1: 12.6, row: 13 }, lead: 0.5, row: 13 });
      b.trap({ k: 'rock', mode: 'after', when: 5, delay: 0.7, row: 13 });
      b.goal(23, 13);
      L.push(b.build());
    })();

    // ---- 5. The Home Stretch. A button that says DO NOT PRESS, spikes you can walk through, and a door that wants a bow.
    (function(){
      var b = new Builder('The Home Stretch', 'Almost there. Do not touch anything.');
      b.ceiling(); b.ground(0, 24); b.start = { x: 1.5, y: 15 };
      b.fill(16, 2, 17, 14, '#');                          // an iron gate (dynamic, see the button)
      b.fill(16, 2, 17, 14, '.');
      b.fakeSpikes(7, 9, 14);
      b.trap({ k: 'button', x: 4, row: 15, gate: { x0: 16, y0: 2, x1: 17, y1: 14 }, delay: 0.55 });
      b.trap({ k: 'pop', x: 10, y: 14, n: 2, reach: 16, trig: { x0: 9.2, x1: 12 } });
      b.trap({ k: 'doorSpike', zone: { x0: 19.6, x1: 23.4 }, row: 15, wait: 0.35 });
      b.goal(22, 15, { duck: true });
      L.push(b.build());
    })();

    return L;
  }
  var LEVELS = buildLevels();

  // ------------------------------------------------------------------ runtime state
  function makeTraps(level){
    return level.traps.map(function(d, i){
      var t = { id: i, d: d, s: 0, t: 0, x: 0, y: 0, vx: 0, vy: 0 };
      switch(d.k){
        case 'fling': t.x = d.hx * TILE; t.y = d.hy * TILE; t.cs = 0; t.arm = 0; t.ang = -Math.PI / 2; break;
        case 'boulder': t.x = d.x * TILE; t.rot = 0; break;
        case 'pop': t.h = 0; break;
        case 'collapse': case 'slide': t.gone = false; t.off = 0; break;
        case 'void': t.bridge = true; t.farGone = false; t.fy = 0; break;
        case 'rock': t.rx = 0; break;
        case 'button': t.pressed = false; break;
        case 'doorSpike': t.fy = 0; break;
      }
      return t;
    });
  }
  function cloneTrap(t){ var c = {}; for(var k in t) c[k] = t[k]; return c; }
  function createRun(levelIndex){
    var level = LEVELS[levelIndex], sx = level.start.x * TILE, sy = level.start.y * TILE;
    return {
      lvl: levelIndex, level: level, t: 0, frame: 0, px: sx, py: sy, vx: 0, vy: 0, onGround: false, duck: false, coyote: 0, buf: 0, jumpHeld: false, jumping: false, justJumped: false, face: 1,
      still: 0, dead: false, deadT: 0, deadMsg: '', deadKind: '', done: false, doneT: 0, exitT: 0, traps: makeTraps(level), events: [], deaths: 0, anim: 0
    };
  }
  function clone(st){ var c = {}; for(var k in st) c[k] = st[k]; c.traps = st.traps.map(cloneTrap); c.events = []; return c; }
  function respawn(st){
    var level = st.level;
    st.px = level.start.x * TILE; st.py = level.start.y * TILE; st.vx = 0; st.vy = 0; st.dead = false; st.deadT = 0; st.deadMsg = ''; st.onGround = false; st.duck = false;
    st.coyote = 0; st.buf = 0; st.t = 0; st.still = 0; st.exitT = 0; st.traps = makeTraps(level);
  }

  // ------------------------------------------------------------------ collision helpers
  function tileAt(level, tx, ty){
    if(tx < 0 || tx >= level.w) return T.SOLID;       // the screen edges are walls
    if(ty < 0 || ty >= level.h) return T.EMPTY;
    return level.grid[ty * level.w + tx];
  }
  function rectOf(x0, y0, x1, y1){ return [x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE]; }
  function dynSolids(st){
    var out = [], traps = st.traps;
    for(var i = 0; i < traps.length; i++){
      var t = traps[i], d = t.d;
      switch(d.k){
        case 'collapse': if(!t.gone) out.push([d.x * TILE, d.y * TILE, d.w * TILE, (d.h || 1) * TILE]); break;
        case 'iwall': out.push(d.rect); break;
        case 'slide': if(!t.gone) out.push([d.x * TILE, d.y * TILE, d.w * TILE, TILE]); break;
        case 'void':
          if(t.bridge) out.push(rectOf(d.bridge.x0, d.bridge.row, d.bridge.x1, d.bridge.row));
          if(!t.farGone) out.push(rectOf(d.far.x0, d.far.row, d.far.x1, d.far.row));
          break;
        case 'rock': if(t.s === 2) out.push([t.rx - 8, t.landY, 16, 16]); break;
        case 'boulder': if(!t.broke && d.chunk) out.push(rectOf(d.chunk.x0, d.chunk.y0, d.chunk.x1, d.chunk.y1)); break;
        case 'button': if(!t.pressed && d.gate) out.push(rectOf(d.gate.x0, d.gate.y0, d.gate.x1, d.gate.y1)); break;
      }
    }
    return out;
  }
  function overlapSolid(st, dyn, x0, y0, x1, y1){
    var level = st.level, tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.001) / TILE), ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.001) / TILE);
    for(var ty = ty0; ty <= ty1; ty++) for(var tx = tx0; tx <= tx1; tx++) if(tileAt(level, tx, ty) === T.SOLID) return [tx * TILE, ty * TILE, TILE, TILE];
    for(var i = 0; i < dyn.length; i++){ var r = dyn[i]; if(x1 > r[0] && x0 < r[0] + r[2] && y1 > r[1] && y0 < r[1] + r[3]) return r; }
    return null;
  }
  function ph(st){ return st.duck ? P.hDuck : P.h; }
  function pbox(st){ return [st.px - P.w / 2, st.py - ph(st), st.px + P.w / 2, st.py]; }
  function hits(st, x0, y0, x1, y1, shrink){
    var s = shrink === undefined ? 1 : shrink, b = pbox(st);
    return b[2] - s > x0 && b[0] + s < x1 && b[3] - s > y0 && b[1] + s < y1;
  }
  function die(st, kind){
    if(st.dead || st.done) return;
    st.dead = true; st.deadT = 0; st.deadKind = kind;
    var lines = DEATH_LINES[kind] || DEATH_LINES.spike;
    st.deadMsg = lines[(st.deaths + st.lvl * 7 + Math.floor(st.px)) % lines.length];
    st.deaths++; st.vy = -190; st.vx = 0;
    st.events.push({ e: 'die', kind: kind, msg: st.deadMsg });
  }
  function onSurface(st, row, x0, x1){ return st.onGround && Math.abs(st.py - row * TILE) < 1 && st.px / TILE >= x0 && st.px / TILE <= x1; }

  // ------------------------------------------------------------------ the step
  function step(st, input){
    if(st.done){ st.doneT += DT; return; }
    if(st.dead){ st.deadT += DT; st.vy += P.grav * DT; st.py += st.vy * DT; return; }
    var level = st.level, traps = st.traps;
    st.t += DT; st.frame++;
    var mx = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    var wasJumped = st.justJumped; st.justJumped = false;
    var predVx = mx !== 0 ? mx * (input.d && st.onGround ? P.duckRun : P.run) : st.vx;      // where the player is heading, used by traps that aim ahead
    st.duck = !!(input.d && st.onGround);
    if(st.onGround && Math.abs(st.vx) < 2 && mx === 0) st.still += DT; else st.still = 0;

    // --- traps react to where the player is (silently: no cues of any kind)
    for(var i = 0; i < traps.length; i++){
      var t = traps[i], d = t.d;
      switch(d.k){
        case 'fling':
          if(!t.armed && onSurface(st, d.row, d.trig.x0, d.trig.x1)) t.armed = true;
          if(t.armed && t.s === 0){
            t.arm += DT;
            var k0 = Math.min(1, t.arm / (d.wait * 0.6));
            t.ang = -Math.PI / 2 + (Math.PI / 3) * k0 * (2 - k0);                         // it turns toward you (about sixty degrees), as if it had noticed you
            if(t.arm >= d.wait){
              var tx = st.px + predVx * d.T * 0.9, dxs = tx - t.x, sgn = dxs < 0 ? -1 : 1;
              t.aim = tx; t.ty = d.row * TILE - d.head; t.y0 = t.y; t.ft = 0; t.ph = 1;
              t.vx = sgn * Math.max(d.minV, Math.abs(dxs) / d.T); t.vy = 0; t.s = 1; t.bn = 0;
            }
          }
          if(t.s === 1){
            var ox = t.x, oy = t.y; t.ft += DT;
            if(t.ph === 1){
              t.x += t.vx * DT; var kk = Math.max(0, 1 - t.ft / d.drop); t.y = t.ty + (t.y0 - t.ty) * kk * kk;
              if((t.vx > 0 ? t.x >= t.aim + 14 : t.x <= t.aim - 14)){ t.ph = 2; t.vy = 0; }
            } else {
              // it misses, and then gravity remembers it exists: it skips along the floor and off into the abyss
              t.vy += 1000 * DT; t.x += t.vx * DT; t.y += t.vy * DT;
              if(t.vy > 0 && t.bn < 4 && overlapSolid(st, dynSolids(st), t.x - 3, t.y + 3, t.x + 3, t.y + 5)){
                t.y = Math.floor((t.y + 4) / TILE) * TILE - 4; t.vy = -t.vy * 0.55 - 30; t.bn++;
              }
            }
            var want = Math.atan2(t.y - oy, t.x - ox); t.ang += (want - t.ang) * Math.min(1, DT * 22);
            if(t.x > VIEW_W + 30 || t.x < -30 || t.y > VIEW_H + 30) t.s = 2;
          }
          // jump to dodge it (before or while it flies) and the ceiling has something for you
          if(d.ceil && t.cs === 0 && t.armed && !st.onGround && st.py < d.row * TILE - 3 && (t.s === 0 || (t.s === 1 && (t.vx > 0 ? t.x < st.px + 28 : t.x > st.px - 28)))){ t.cs = 1; t.cx = Math.max(12, Math.min(VIEW_W - 12, st.px + predVx * d.cl)); t.cy = 2 * TILE; t.cvy = 0; }
          if(t.cs === 1){
            if(t.cy < 90) t.cx = Math.max(12, Math.min(VIEW_W - 12, st.px + st.vx * 0.12));       // it keeps its eye on you until it is nearly on you
            t.cvy += 2200 * DT; t.cy += t.cvy * DT;
            if(overlapSolid(st, dynSolids(st), t.cx - 2, t.cy + 14, t.cx + 2, t.cy + 15)){ t.cs = 2; st.events.push({ e: 'thud', x: t.cx - 8, y: t.cy }); }
            else if(t.cy > VIEW_H + 20) t.cs = 3;
          }
          break;
        case 'boulder': {
          var R = d.R, floorY = d.row * TILE;
          if(t.s === 0){ t.t += DT; if(t.t >= d.delay){ t.s = 1; } }
          else if(t.s === 1){
            var front = t.x - R, dist = front - (st.px + P.w / 2);
            if(dist <= 8 && st.still >= 1.0){ t.s = 2; t.t = 0; }
            else { t.x -= d.speed * DT; t.rot -= d.speed * DT / R; }
          }
          else if(t.s === 2){ t.t += DT; if(t.t >= d.hold){ t.s = 3; } }
          else if(t.s === 3){
            t.x += d.rev * DT; t.rot += d.rev * DT / R;
            if(t.x + R >= d.wallX * TILE){ t.s = 4; t.broke = true; st.events.push({ e: 'wallbreak', x: d.wallX * TILE, y: floorY }); }
          }
          break; }
        case 'pop': {
          var ready = d.after === undefined || traps[d.after].s === 4;
          var px = st.px / TILE;
          if(t.s === 0 && ready && px >= d.trig.x0 && px <= d.trig.x1){ t.s = 1; }
          if(t.s === 1){ t.h = Math.min(d.reach, t.h + 330 * DT); if(t.h >= d.reach) t.s = 2; }
          break; }
        case 'collapse':
          if(!t.gone){
            if(t.s === 0 && onSurface(st, d.y, d.x, d.x + d.w)) t.s = 1;
            if(t.s === 1){ t.t += DT; if(t.t >= d.delay){ t.gone = true; t.off = 0; } }
          } else t.off += DT;
          break;
        case 'slide':
          if(!t.gone){
            if(t.s === 0 && onSurface(st, d.y, d.x, d.x + d.w)) t.s = 1;
            if(t.s === 1){ t.t += DT; if(t.t >= d.delay){ t.gone = true; t.off = 0; } }
          } else t.off += DT;
          break;
        case 'void':
          if(t.bridge && wasJumped){
            var zx = st.px / TILE;
            if(zx >= d.zone.x0 && zx <= d.zone.x1){ t.bridge = false; t.farGone = true; t.fy = 0; }
          }
          if(t.farGone) t.fy += DT;
          break;
        case 'rock': {
          if(t.s === 0){
            var trigNow = false, atX = 0;
            if(d.mode === 'lead' && onSurface(st, d.trig.row, d.trig.x0, d.trig.x1)){ trigNow = true; atX = st.px + predVx * d.lead; }
            else if(d.mode === 'after' && traps[d.when].s >= 2){ t.t += DT; if(t.t >= d.delay){ trigNow = true; atX = st.px; } }
            else if(d.mode === 'still' && traps[d.when].s === 4){ if(st.onGround && st.still >= d.still) t.t += DT; else t.t = 0; if(t.t >= d.delay){ trigNow = true; atX = st.px; } }
            else if(d.mode === 'exact' && t.fire){ trigNow = true; atX = d.x * TILE; }
            if(trigNow){ t.s = 1; t.rx = Math.max(24, Math.min(VIEW_W - 24, atX)); t.y = 2 * TILE; t.vy = 0; t.landY = d.row * TILE - TILE; }
          }
          if(t.s === 1){
            t.vy += 1100 * DT; t.y += t.vy * DT;
            if(t.y >= t.landY){
              // it only lands if there is something to land on; over a gap it just keeps falling
              if(overlapSolid(st, dynSolids(st), t.rx - 6, t.landY + 16, t.rx + 6, t.landY + 17.5)){ t.y = t.landY; t.s = 2; st.events.push({ e: 'thud', x: t.rx, y: t.y }); }
              else if(t.y > VIEW_H + 20) t.s = 3;
            }
          }
          break; }
        case 'button': {
          var bx = d.x * TILE;
          if(!t.pressed && st.onGround && Math.abs(st.py - d.row * TILE) < 1 && Math.abs(st.px - (bx + 8)) < 8){ t.pressed = true; t.t = 0; }
          if(t.pressed && t.rock === undefined){ t.t += DT; if(t.t >= d.delay){ t.rock = true; t.rs = 1; t.ry = 2 * TILE; t.rvy = 0; t.rx = bx + 8; t.landY = d.row * TILE - TILE; } }
          if(t.rs === 1){ t.rvy += 1100 * DT; t.ry += t.rvy * DT; if(t.ry >= t.landY){ t.ry = t.landY; t.rs = 2; st.events.push({ e: 'thud', x: t.rx, y: t.ry }); } }
          break; }
        case 'doorSpike': {
          var inZone = onSurface(st, d.row, d.zone.x0, d.zone.x1);
          if(t.s === 0){ if(inZone && !st.duck) t.t += DT; else t.t = 0; if(t.t >= d.wait){ t.s = 1; t.sx = Math.max(d.zone.x0 * TILE + 8, Math.min(VIEW_W - 12, st.px + predVx * 0.5)); t.fy = 2 * TILE; t.vy = 0; } }
          if(t.s === 1){ t.vy += 1400 * DT; t.fy += t.vy * DT; var tip = d.row * TILE - 8; if(t.fy >= tip){ t.fy = tip; t.s = 2; } }
          break; }
      }
    }
    var dyn = dynSolids(st);
    // --- horizontal movement
    var runSp = st.duck ? P.duckRun : P.run, target = mx * runSp, acc = st.onGround ? P.accel : P.airAccel;
    if(mx !== 0){ st.face = mx; if(st.vx < target) st.vx = Math.min(target, st.vx + acc * DT); else if(st.vx > target) st.vx = Math.max(target, st.vx - acc * DT); }
    else { var f = P.fric * DT; if(st.vx > 0) st.vx = Math.max(0, st.vx - f); else st.vx = Math.min(0, st.vx + f); }
    if(st.duck && Math.abs(st.vx) > P.duckRun) st.vx = st.vx > 0 ? P.duckRun : -P.duckRun;
    st.px += st.vx * DT;
    var b = pbox(st), r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]), guard = 0;
    while(r && guard++ < 4){
      if(st.vx > 0 || (st.vx === 0 && st.px < r[0] + r[2] / 2)) st.px = r[0] - P.w / 2; else st.px = r[0] + r[2] + P.w / 2;
      st.vx = 0; b = pbox(st); r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]);
    }
    // --- jumping (not while ducking)
    if(input.j && !st.jumpHeld) st.buf = P.buffer; else st.buf = Math.max(0, st.buf - DT);
    if(st.onGround) st.coyote = P.coyote; else st.coyote = Math.max(0, st.coyote - DT);
    if(st.buf > 0 && st.coyote > 0 && !st.duck){ st.vy = -P.jump; st.buf = 0; st.coyote = 0; st.onGround = false; st.jumping = true; st.justJumped = true; st.events.push({ e: 'jump' }); }
    if(!input.j && st.jumping && st.vy < -P.jump * P.cut && !st.onGround) st.vy = -P.jump * P.cut;
    st.jumpHeld = !!input.j;
    // --- vertical movement
    st.vy = Math.min(P.maxFall, st.vy + P.grav * DT);
    var wasGround = st.onGround; st.onGround = false;
    st.py += st.vy * DT;
    b = pbox(st); r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]); guard = 0;
    while(r && guard++ < 4){
      if(st.vy > 0){ st.py = r[1]; st.onGround = true; } else { st.py = r[1] + r[3] + ph(st); }
      st.vy = 0; b = pbox(st); r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]);
    }
    if(!st.onGround && st.vy >= 0){
      var below = overlapSolid(st, dyn, b[0], st.py, b[2], st.py + 0.5);
      if(below && Math.abs(st.py - below[1]) < 0.6) st.onGround = true;
    }
    if(st.onGround){ st.jumping = false; if(!wasGround) st.events.push({ e: 'land' }); }
    // --- hazards
    var hb = pbox(st);
    var tx0 = Math.floor(hb[0] / TILE), tx1 = Math.floor((hb[2] - 0.01) / TILE), ty0 = Math.floor(hb[1] / TILE), ty1 = Math.floor((hb[3] - 0.01) / TILE);
    for(var ty = ty0; ty <= ty1; ty++) for(var tx = tx0; tx <= tx1; tx++){
      if(tileAt(level, tx, ty) === T.SPIKE && hits(st, tx * TILE + 2, ty * TILE + 6, tx * TILE + 14, ty * TILE + 16, 1)) die(st, 'spike');
    }
    for(i = 0; i < traps.length; i++){
      var h = traps[i], hd = h.d;
      switch(hd.k){
        case 'fling':
          if(h.s === 0 ? hits(st, h.x - 4, h.y - 8, h.x + 4, h.y + 8, 0.5) : h.s === 1 && hits(st, h.x - 7, h.y - 2.5, h.x + 7, h.y + 2.5, 0.5)) die(st, 'fling');
          if(h.cs === 1 && hits(st, h.cx - 4, 2 * TILE, h.cx + 4, h.cy + 14, 0.5)) die(st, 'ceil');
          break;
        case 'boulder': if((h.s === 1 || h.s === 2) && hits(st, h.x - hd.R + 2, hd.row * TILE - hd.R * 2, h.x + hd.R - 2, hd.row * TILE, 0.5)) die(st, 'boulder'); break;
        case 'pop': if(h.h > 3 && hits(st, hd.x * TILE + 2, (hd.y + 1) * TILE - h.h, (hd.x + hd.n) * TILE - 2, (hd.y + 1) * TILE, 0.5)) die(st, 'pop'); break;
        case 'rock': if(h.s === 1 && hits(st, h.rx - 7, h.y + 1, h.rx + 7, h.y + 16, 0.5)) die(st, 'rock'); break;
        case 'button': if(h.rs === 1 && hits(st, h.rx - 7, h.ry + 1, h.rx + 7, h.ry + 16, 0.5)) die(st, 'plate'); break;
        case 'doorSpike': if(h.s >= 1 && hits(st, h.sx - 3, 2 * TILE, h.sx + 3, h.fy + 14, 0.5)) die(st, 'doorSpike'); break;
      }
    }
    if(st.py > level.h * TILE + 40) die(st, 'pit');
    // --- the exit
    var ex = level.exit;
    if(ex && !st.dead){
      var near = Math.abs(st.px - (ex.x * TILE + 8)) < 12 && Math.abs(st.py - ex.y * TILE) < 20;
      if(ex.duck){ if(near && st.duck) st.exitT += DT; else st.exitT = 0; if(st.exitT >= 0.5){ st.done = true; st.doneT = 0; st.events.push({ e: 'finish' }); } }
      else if(near){ st.done = true; st.doneT = 0; st.events.push({ e: 'finish' }); }
    }
    st.anim += Math.abs(st.vx) * DT * 0.12;
  }

  // ------------------------------------------------------------------ a solver (used by the tests to prove each screen is completable)
  var ACTIONS = [{}, { r: 1 }, { r: 1, j: 1 }, { l: 1 }, { j: 1 }, { l: 1, j: 1 }, { d: 1 }, { r: 1, d: 1 }, { l: 1, d: 1 }];
  function solve(levelIndex, opts){
    opts = opts || {};
    var width = opts.width || 700, macro = opts.macro || 5, maxFrames = opts.maxFrames || 3600;
    var actions = opts.actions || ACTIONS;
    var start = createRun(levelIndex), beam = [{ st: start, inputs: [] }];
    function key(st){
      var s = Math.round(st.px / 2) + ':' + Math.round(st.py / 2) + ':' + Math.round(st.vx / 30) + ':' + Math.round(st.vy / 60) + ':' + (st.onGround ? 1 : 0) + (st.duck ? 'd' : '') + ':' + Math.min(3, Math.floor(st.still / 0.5));
      for(var i = 0; i < st.traps.length; i++){
        var t = st.traps[i];
        s += '|' + t.s + (t.gone ? 'g' : '') + (t.pressed ? 'p' : '') + (t.bridge === false ? 'b' : '') + (t.rs || '') + (t.d.k === 'boulder' ? Math.round(t.x / 10) : t.d.k === 'fling' ? (t.s === 1 ? Math.round(t.x / 10) + ':' + Math.round(t.y / 6) : '') + 'c' + t.cs + (t.cs === 1 ? Math.round(t.cy / 8) : '') : t.d.k === 'rock' && t.s === 1 ? Math.round(t.y / 8) : (t.d.k === 'collapse' || t.d.k === 'slide') && t.s === 1 ? Math.round(t.t * 4) : t.d.k === 'doorSpike' ? Math.round(t.t * 5) : t.d.k === 'button' && t.pressed ? Math.round(t.t * 6) : '');
      }
      return s;
    }
    var dbg = { maxX: 0, kinds: {} };
    for(var f = 0; f < maxFrames; f += macro){
      var next = [], seen = {};
      for(var bi = 0; bi < beam.length; bi++){
        for(var ai = 0; ai < actions.length; ai++){
          var c = clone(beam[bi].st), inp = actions[ai];
          for(var k = 0; k < macro && !c.dead && !c.done; k++){ step(c, inp); c.events.length = 0; }
          if(c.dead){ dbg.kinds[c.deadKind] = (dbg.kinds[c.deadKind] || 0) + 1; if(c.px > dbg.maxX) dbg.maxX = c.px; continue; }
          if(c.done) return { ok: true, frames: f + macro, inputs: beam[bi].inputs.concat([[ai, macro]]), actions: actions };
          var kk = key(c); if(seen[kk]) continue; seen[kk] = 1;
          next.push({ st: c, inputs: beam[bi].inputs.concat([[ai, macro]]), score: c.px + (c.onGround ? 0 : -2) });
        }
      }
      if(!next.length) return { ok: false, frames: f, reason: 'all states died', dbg: dbg };
      next.sort(function(a, b2){ return b2.score - a.score; });
      var per = opts.perBucket || 10, bucket = {}, kept = [];
      for(var ni = 0; ni < next.length && kept.length < width; ni++){ var bk = Math.floor(next[ni].st.px / 10) + ':' + (next[ni].st.py < 200 ? 'u' : 'd') + (next[ni].st.duck ? 'k' : '') + Math.min(2, Math.floor(next[ni].st.still)); bucket[bk] = (bucket[bk] || 0) + 1; if(bucket[bk] <= per) kept.push(next[ni]); }
      beam = kept;
    }
    return { ok: false, frames: maxFrames, reason: 'ran out of time', dbg: dbg, bestX: beam.length ? beam[0].st.px : 0 };
  }

  return { TILE: TILE, COLS: COLS, ROWS: ROWS, VIEW_W: VIEW_W, VIEW_H: VIEW_H, DT: DT, LIVES: LIVES, P: P, T: T, LEVELS: LEVELS, DEATH_LINES: DEATH_LINES, ACTIONS: ACTIONS,
    createRun: createRun, clone: clone, respawn: respawn, step: step, solve: solve, tileAt: tileAt };
});
