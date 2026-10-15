// Trap Run - the simulation for the lobby's troll-platformer mini game (physics, traps, levels).
// Pure and deterministic (fixed 60 Hz steps), shared by the browser and the tests, so every level can be
// verified completable by a solver. Nothing here touches the DOM or the network.
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrapSim = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';
  var TILE = 16, VIEW_W = 400, VIEW_H = 225, ROWS = 14;       // levels are 14 tiles (224px) tall; the camera only scrolls sideways
  var DT = 1 / 60;
  var P = { w: 10, h: 14, run: 82, accel: 760, fric: 980, airAccel: 520, grav: 800, jump: 244, maxFall: 330, coyote: 0.09, buffer: 0.10, cut: 0.42 };

  // tile codes in the compiled grid
  var T = { EMPTY: 0, SOLID: 1, SPIKE: 2, LAVA: 3, FAKE: 4 };

  // ------------------------------------------------------------------ level building
  function Builder(name, theme, w, intro){
    this.name = name; this.theme = theme; this.w = w; this.intro = intro || '';
    this.rows = []; for(var y = 0; y < ROWS; y++){ var r = []; for(var x = 0; x < w; x++) r.push('.'); this.rows.push(r); }
    this.traps = []; this.cps = []; this.start = { x: 2, y: 12 }; this.exit = null; this.hints = [];
  }
  Builder.prototype.set = function(x, y, ch){ if(x >= 0 && x < this.w && y >= 0 && y < ROWS) this.rows[y][x] = ch; return this; };
  Builder.prototype.fill = function(x0, y0, x1, y1, ch){ for(var y = y0; y <= y1; y++) for(var x = x0; x <= x1; x++) this.set(x, y, ch); return this; };
  Builder.prototype.ground = function(x0, x1){ return this.fill(x0, 12, x1, 13, '#'); };          // floor: rows 12-13, feet land at y = 192
  Builder.prototype.plat = function(x, y, n){ return this.fill(x, y, x + n - 1, y, '#'); };
  Builder.prototype.block = function(x, y, w, h){ return this.fill(x, y, x + w - 1, y + h - 1, '#'); };
  Builder.prototype.spikes = function(x0, x1, y){ return this.fill(x0, y === undefined ? 11 : y, x1, y === undefined ? 11 : y, '^'); };
  Builder.prototype.lava = function(x0, x1){ return this.fill(x0, 12, x1, 13, '~'); };
  Builder.prototype.fake = function(x, y, w, h){ return this.fill(x, y, x + (w || 1) - 1, y + (h || 1) - 1, 'g'); };
  Builder.prototype.checkpoint = function(x, y){ this.cps.push({ x: x, y: y === undefined ? 12 : y }); return this; };   // y = the row of the tile you stand on
  Builder.prototype.goal = function(x, y){ this.exit = { x: x, y: y === undefined ? 12 : y }; return this; };
  Builder.prototype.ceiling = function(){ return this.fill(0, 0, this.w - 1, 1, '#'); };
Builder.prototype.trap = function(t){ if(t.k === 'fall') this.fill(t.x, t.y, t.x + t.w - 1, t.y + t.h - 1, '.'); this.traps.push(t); return this; };
  Builder.prototype.build = function(){
    var grid = new Uint8Array(this.w * ROWS), rows = [];
    for(var y = 0; y < ROWS; y++){
      rows.push(this.rows[y].join(''));
      for(var x = 0; x < this.w; x++){
        var c = this.rows[y][x];
        grid[y * this.w + x] = c === '#' ? T.SOLID : c === '^' ? T.SPIKE : c === '~' ? T.LAVA : c === 'g' ? T.FAKE : T.EMPTY;
      }
    }
    return { name: this.name, theme: this.theme, intro: this.intro, w: this.w, h: ROWS, grid: grid, rows: rows, traps: this.traps, cps: this.cps, start: this.start, exit: this.exit };
  };

  // ------------------------------------------------------------------ the levels
  var DEATH_LINES = {
    spike: ['That floor was lying to you.', 'Spikes. Who could have seen that coming?', 'Those were not decorative.'],
    hidden: ['The ground grew teeth.', 'Surprise! The floor was hungry.', 'You were not expecting that, were you?'],
    fall: ['The ceiling had other plans.', 'Look up next time. Actually, never mind.', 'That block was just resting.'],
    pit: ['You fell. A long, long way.', 'Gravity wins again.', 'The ground is that way. It was.'],
    arrow: ['Pointy things are fast.', 'Something whistled. Then nothing did.', 'The wall had a quiver.'],
    boulder: ['You were rolled over.', 'It was a very round problem.', 'Run faster. Or higher.'],
    fakeExit: ['That door was a lie.', 'Not the exit. Not even close.', 'It said EXIT. It lied.'],
    walker: ['He was just walking. Rude of you.', 'Mind the walker.', 'Bonk. (That is you.)'],
    lava: ['The floor is lava. It was always lava.', 'Hot take.', 'Well done. Crispy.'],
    pad: ['The spring was not your friend.', 'Boing. Then, ouch.', 'Up, up, and into the spikes.'],
    crush: ['Squished by a sense of humour.', 'Flat. Yet funny.', 'The wall moved in.']
  };

  function buildLevels(){
    var L = [];

    // ---- 1. Welcome, Explorer (jungle): gentle lies
    (function(){
      var b = new Builder('Welcome, Explorer', 'jungle', 78, 'An easy one. What could go wrong?');
      b.ceiling(); b.ground(0, 77); b.start = { x: 2, y: 12 };
      b.spikes(12, 13);                                                                          // an honest spike, to build trust
      b.trap({ k: 'hidden', x: 22, y: 11, n: 2, trig: { x0: 19.6, x1: 22 }, msg: 'hidden' });     // spikes that grow right where you land
      b.checkpoint(29);
      b.fill(36, 12, 41, 13, '.');                                                              // a pit crossed by a bridge that does not last
      for(var i = 0; i < 6; i++) b.trap({ k: 'vanish', x: 36 + i, y: 12, delay: 0.28, msg: 'pit' });
      b.trap({ k: 'fall', x: 49, y: 1, w: 2, h: 1, trig: { x0: 46.6, x1: 50 }, floorY: 12, msg: 'fall' });   // a block drops across the path
      b.checkpoint(54);
      b.plat(56, 10, 5); b.trap({ k: 'fakeExit', x: 58, y: 10, msg: 'fakeExit' });
      b.spikes(62, 63);
      b.trap({ k: 'phantom', x: 66, y: 11, w: 1, h: 1, trig: { x0: 64.5, x1: 66 } });             // a wall that was not there a moment ago
      b.goal(73, 12);
      L.push(b.build());
    })();

    // ---- 2. Crumbling Ruins: arrows, a boulder, a spring
    (function(){
      var b = new Builder('Crumbling Ruins', 'ruins', 96, 'Old stones. Older tricks.');
      b.ceiling(); b.ground(0, 95); b.start = { x: 2, y: 12 };
      b.trap({ k: 'arrow', x: 20, y: 11, dir: -1, trig: { x0: 11, x1: 15 }, speed: 150, msg: 'arrow' });
      b.spikes(18, 19);
      b.trap({ k: 'hidden', x: 25, y: 11, n: 2, trig: { x0: 23.4, x1: 25 }, msg: 'hidden' });
      b.checkpoint(31);
      b.plat(36, 10, 4);                                                                         // an alcove ledge, two tiles up
      b.trap({ k: 'boulder', x: 30, y: 12, trig: { x0: 33.5, x1: 37 }, speed: 112, endX: 70, msg: 'boulder' });
      b.fill(44, 12, 46, 13, '.');                                                              // a pit with a stepping stone that does not stay
      b.trap({ k: 'vanish', x: 45, y: 11, delay: 0.3, msg: 'pit' });
      b.trap({ k: 'fall', x: 54, y: 1, w: 3, h: 1, trig: { x0: 51, x1: 56 }, floorY: 12, msg: 'fall' });
      b.checkpoint(60);
      b.trap({ k: 'pad', x: 64, y: 12, power: 330 });                                            // a helpful spring... under a spiked ceiling
      b.plat(62, 6, 5); b.spikes(63, 65, 7);
      b.spikes(70, 71);
      b.trap({ k: 'phantom', x: 76, y: 11, w: 1, h: 1, trig: { x0: 74.6, x1: 76 } });
      b.plat(79, 10, 5); b.trap({ k: 'fakeExit', x: 80, y: 10, msg: 'fakeExit' });
      b.trap({ k: 'hidden', x: 85, y: 11, n: 2, trig: { x0: 83.6, x1: 85 }, msg: 'hidden' });
      b.goal(91, 12);
      L.push(b.build());
    })();

    // ---- 3. Lava Cavern: stalactites, lava, walkers, vanishing stones
    (function(){
      var b = new Builder('Lava Cavern', 'cave', 104, 'The floor is hot. The ceiling is worse.');
      b.ceiling(); b.ground(0, 14); b.ground(20, 22); b.ground(28, 31); b.ground(40, 103); b.start = { x: 2, y: 12 };
      b.lava(15, 19); b.lava(23, 27); b.lava(32, 39);
      b.trap({ k: 'vanish', x: 16, y: 11, delay: 0.5, msg: 'lava' }); b.trap({ k: 'vanish', x: 17, y: 11, delay: 0.5, msg: 'lava' }); b.trap({ k: 'vanish', x: 18, y: 11, delay: 0.5, msg: 'lava' });
      b.plat(24, 11, 2); b.plat(33, 11, 2); b.plat(36, 11, 2);
      b.trap({ k: 'fall', x: 9, y: 1, w: 2, h: 1, trig: { x0: 7.5, x1: 10 }, floorY: 12, spiky: true, msg: 'fall' });
      b.checkpoint(21); b.checkpoint(41);
      b.trap({ k: 'walker', x: 46, y: 12, x0: 44, x1: 52, speed: 34, msg: 'walker' });
      b.trap({ k: 'fall', x: 56, y: 1, w: 1, h: 1, trig: { x0: 54, x1: 57 }, floorY: 12, spiky: true, msg: 'fall' });
      b.trap({ k: 'fall', x: 59, y: 1, w: 1, h: 1, trig: { x0: 57.4, x1: 60 }, floorY: 12, spiky: true, msg: 'fall' });
      b.checkpoint(62);
      b.lava(66, 70); b.plat(66, 11, 2); b.plat(69, 10, 2);
      b.trap({ k: 'hidden', x: 76, y: 11, n: 2, trig: { x0: 74.5, x1: 76 }, msg: 'hidden' });
      b.trap({ k: 'walker', x: 83, y: 12, x0: 80, x1: 90, speed: 44, msg: 'walker' });
      b.plat(93, 10, 5); b.trap({ k: 'fakeExit', x: 94, y: 10, msg: 'fakeExit' });
      b.goal(100, 12);
      L.push(b.build());
    })();

    // ---- 4. Sky Islands: floating stones, fake clouds, springs
    (function(){
      var b = new Builder('Sky Islands', 'sky', 112, 'Do not look down. Seriously.');
      b.ground(0, 9); b.start = { x: 2, y: 12 };
      b.plat(12, 12, 3); b.plat(17, 11, 2); b.plat(21, 10, 3); b.plat(26, 11, 3);
      b.fake(29, 11, 2, 1);                                                                      // looks like a bridge, is not
      b.plat(31, 11, 3); b.plat(36, 10, 3); b.plat(41, 11, 3); b.checkpoint(42, 11);
      b.plat(46, 12, 5); b.trap({ k: 'pad', x: 48, y: 12, power: 390 });
      b.plat(52, 7, 4); b.plat(58, 7, 3); b.checkpoint(59, 7);
      b.trap({ k: 'arrow', x: 69, y: 4, dir: -1, trig: { x0: 58, x1: 61 }, speed: 130, msg: 'arrow' });
      b.plat(63, 7, 3); b.plat(68, 7, 3);
      for(var i = 0; i < 3; i++) b.trap({ k: 'vanish', x: 73 + i, y: 8, delay: 0.3, msg: 'pit' });
      b.plat(78, 9, 2); b.plat(82, 10, 2); b.plat(86, 11, 2); b.plat(90, 12, 3); b.checkpoint(91, 12);
      b.ground(95, 111);
      b.trap({ k: 'hidden', x: 99, y: 11, n: 2, trig: { x0: 97.5, x1: 99 }, msg: 'hidden' });
      b.plat(102, 10, 5); b.trap({ k: 'fakeExit', x: 103, y: 10, msg: 'fakeExit' });
      b.goal(108, 12);
      L.push(b.build());
    })();

    // ---- 5. The Troll Castle: everything at once
    (function(){
      var b = new Builder('The Troll Castle', 'castle', 130, 'The final level. Probably.');
      b.ceiling(); b.ground(0, 129); b.start = { x: 2, y: 12 };
      b.trap({ k: 'fall', x: 12, y: 1, w: 2, h: 1, trig: { x0: 10.5, x1: 14 }, floorY: 12, spiky: true, msg: 'fall' });
      b.spikes(18, 19);
      b.trap({ k: 'arrow', x: 28, y: 11, dir: -1, trig: { x0: 20, x1: 24 }, speed: 160, msg: 'arrow' });
      b.trap({ k: 'hidden', x: 26, y: 11, n: 2, trig: { x0: 24.3, x1: 26 }, msg: 'hidden' });
      b.checkpoint(32);
      b.plat(40, 10, 4);
      b.trap({ k: 'boulder', x: 34, y: 12, trig: { x0: 37.3, x1: 41 }, speed: 115, endX: 70, msg: 'boulder' });
      b.lava(46, 50); b.plat(46, 11, 1); b.plat(49, 11, 2);
      b.trap({ k: 'vanish', x: 47, y: 11, delay: 0.3, msg: 'lava' });
      b.checkpoint(55);
      b.trap({ k: 'walker', x: 60, y: 12, x0: 58, x1: 68, speed: 40, msg: 'walker' });
      b.trap({ k: 'phantom', x: 71, y: 11, w: 1, h: 1, trig: { x0: 69.2, x1: 71 } });
      b.trap({ k: 'pad', x: 74, y: 12, power: 300 }); b.plat(72, 6, 4); b.spikes(73, 75, 7);
      b.checkpoint(80);
      b.fake(84, 12, 2, 2);
      b.trap({ k: 'fall', x: 91, y: 1, w: 1, h: 1, trig: { x0: 90.3, x1: 92 }, floorY: 12, spiky: true, msg: 'fall' });
      b.trap({ k: 'fall', x: 94, y: 1, w: 1, h: 1, trig: { x0: 93.3, x1: 95 }, floorY: 12, spiky: true, msg: 'fall' });
      b.trap({ k: 'hidden', x: 100, y: 11, n: 2, trig: { x0: 98.2, x1: 100 }, msg: 'hidden' });
      b.checkpoint(104);
      b.plat(107, 10, 7); b.trap({ k: 'fakeExit', x: 108, y: 10, msg: 'fakeExit' }); b.trap({ k: 'fakeExit', x: 112, y: 10, msg: 'fakeExit' });
      b.trap({ k: 'arrow', x: 127, y: 11, dir: -1, trig: { x0: 114, x1: 118 }, speed: 170, msg: 'arrow' });
      b.goal(124, 12);
      L.push(b.build());
    })();

    return L;
  }
  var LEVELS = buildLevels();

  // ------------------------------------------------------------------ runtime state
  function makeTraps(level){
    return level.traps.map(function(d, i){
      var t = { id: i, d: d, s: 0, t: 0, x: 0, y: 0, vx: 0, vy: 0 };
      if(d.k === 'fall'){ t.x = d.x * TILE; t.y = d.y * TILE; }
      else if(d.k === 'boulder'){ t.x = d.x * TILE; t.y = d.y * TILE; }
      else if(d.k === 'arrow'){ t.arrows = []; }
      else if(d.k === 'walker'){ t.x = d.x0 * TILE; t.vx = d.speed; t.y = d.y * TILE; }
      else if(d.k === 'hidden'){ t.h = 0; }
      else if(d.k === 'pad'){ t.sq = 0; }
      return t;
    });
  }
  function cloneTrap(t){
    var c = {}; for(var k in t) c[k] = t[k];
    if(t.arrows) c.arrows = t.arrows.map(function(a){ return { x: a.x, y: a.y, vx: a.vx }; });
    return c;
  }
  function createRun(levelIndex){
    var level = LEVELS[levelIndex];
    var cp = { x: level.start.x * TILE + TILE / 2, y: level.start.y * TILE };
    return {
      lvl: levelIndex, level: level, t: 0, frame: 0, px: cp.x, py: cp.y, vx: 0, vy: 0, onGround: false, coyote: 0, buf: 0, jumpHeld: false, face: 1,
      jumping: false, dead: false, deadT: 0, deadMsg: '', deadKind: '', cp: cp, cpIndex: -1, done: false, doneT: 0, traps: makeTraps(level), events: [], deaths: 0, anim: 0, gone: {}
    };
  }
  function clone(st){
    var c = {}; for(var k in st) c[k] = st[k];
    c.traps = st.traps.map(cloneTrap); c.cp = { x: st.cp.x, y: st.cp.y }; c.events = []; c.gone = st.gone;
    return c;
  }
  function respawn(st){
    st.px = st.cp.x; st.py = st.cp.y; st.vx = 0; st.vy = 0; st.dead = false; st.deadT = 0; st.deadMsg = ''; st.onGround = false; st.coyote = 0; st.buf = 0; st.t = 0;
    st.traps = makeTraps(st.level);
  }

  // ------------------------------------------------------------------ collision helpers
  function tileAt(level, tx, ty){
    if(tx < 0 || tx >= level.w) return T.SOLID;       // the world edges are walls
    if(ty < 0 || ty >= level.h) return T.EMPTY;
    return level.grid[ty * level.w + tx];
  }
  function dynSolids(st){
    var out = [], traps = st.traps;
    for(var i = 0; i < traps.length; i++){
      var t = traps[i], d = t.d;
      if(d.k === 'vanish'){ if(!t.gone && !d.skip) out.push([d.x * TILE, d.y * TILE, TILE, TILE]); }
      else if(d.k === 'fall'){ if(t.s === 2) out.push([t.x, t.y, d.w * TILE, d.h * TILE]); }
      else if(d.k === 'phantom'){ if(t.s >= 1) out.push([d.x * TILE, d.y * TILE, d.w * TILE, d.h * TILE]); }
    }
    return out;
  }
  function solidTile(level, tx, ty){ return tileAt(level, tx, ty) === T.SOLID; }
  function overlapSolid(st, dyn, x0, y0, x1, y1){
    var level = st.level, tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.001) / TILE), ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.001) / TILE);
    for(var ty = ty0; ty <= ty1; ty++) for(var tx = tx0; tx <= tx1; tx++) if(solidTile(level, tx, ty)) return [tx * TILE, ty * TILE, TILE, TILE];
    for(var i = 0; i < dyn.length; i++){ var r = dyn[i]; if(x1 > r[0] && x0 < r[0] + r[2] && y1 > r[1] && y0 < r[1] + r[3]) return r; }
    return null;
  }
  function pbox(st){ return [st.px - P.w / 2, st.py - P.h, st.px + P.w / 2, st.py]; }
  function hits(st, x0, y0, x1, y1, shrink){
    var s = shrink === undefined ? 1.5 : shrink, b = pbox(st);
    return b[2] - s > x0 && b[0] + s < x1 && b[3] - s > y0 && b[1] + s < y1;
  }
  function trig(t, st){
    var g = t.d.trig; if(!g) return false;
    var cx = st.px / TILE;
    if(cx < g.x0 || cx > g.x1) return false;
    if(g.y0 !== undefined && (st.py / TILE < g.y0 || st.py / TILE > g.y1)) return false;
    return true;
  }
  function die(st, kind, msgKey){
    if(st.dead || st.done) return;
    st.dead = true; st.deadT = 0; st.deadKind = kind;
    var lines = DEATH_LINES[msgKey || kind] || DEATH_LINES.spike;
    st.deadMsg = lines[(st.deaths + st.lvl * 7 + Math.floor(st.px)) % lines.length];
    st.deaths++; st.vy = -190; st.vx = 0;
    st.events.push({ e: 'die', kind: kind, msg: st.deadMsg });
  }

  // ------------------------------------------------------------------ the step
  function step(st, input){
    if(st.done){ st.doneT += DT; return; }
    if(st.dead){ st.deadT += DT; st.vy += P.grav * DT; st.py += st.vy * DT; return; }
    var level = st.level;
    st.t += DT; st.frame++;
    var mx = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    // --- traps (they react to where the player is)
    var traps = st.traps;
    for(var i = 0; i < traps.length; i++){
      var t = traps[i], d = t.d;
      switch(d.k){
        case 'hidden':
          if(t.s === 0 && trig(t, st)){ t.s = 1; st.events.push({ e: 'trap', k: 'hidden', x: d.x * TILE, y: d.y * TILE }); }
          if(t.s === 1){ t.h = Math.min(11, t.h + 140 * DT); if(t.h >= 11) t.s = 2; }
          break;
        case 'fall':
          if(t.s === 0 && trig(t, st)){ t.s = 1; t.vy = 0; st.events.push({ e: 'trap', k: 'fall', x: t.x, y: t.y }); }
          if(t.s === 1){
            t.vy += 1100 * DT; t.y += t.vy * DT;
            var floorTop = (d.floorY !== undefined ? d.floorY : 12) * TILE - d.h * TILE;
            if(t.y >= floorTop){ t.y = floorTop; t.s = 2; t.vy = 0; st.events.push({ e: 'thud', x: t.x, y: t.y }); }
          }
          break;
        case 'vanish':
          if(!d.skip && !t.gone){
            var onIt = st.onGround && Math.abs(st.py - d.y * TILE) < 0.6 && Math.abs(st.px - (d.x * TILE + TILE / 2)) < TILE / 2 + P.w / 2 - 1;
            if(onIt && t.s === 0){ t.s = 1; t.t = 0; }
            if(t.s === 1){ t.t += DT; if(t.t >= d.delay){ t.gone = true; st.events.push({ e: 'crumble', x: d.x * TILE, y: d.y * TILE }); } }
          }
          break;
        case 'phantom':
          if(t.s === 0 && trig(t, st)){ t.s = 1; st.events.push({ e: 'trap', k: 'phantom', x: d.x * TILE, y: d.y * TILE }); }
          break;
        case 'arrow':
          if(t.s === 0 && trig(t, st)){ t.s = 1; t.t = 0; st.events.push({ e: 'trap', k: 'arrow', x: d.x * TILE, y: d.y * TILE }); }
          if(t.s === 1){ t.t += DT; if(t.t >= 0.35){ t.s = 2; t.arrows.push({ x: d.x * TILE + TILE / 2, y: d.y * TILE + 6, vx: d.dir * d.speed }); st.events.push({ e: 'shoot', x: d.x * TILE, y: d.y * TILE }); } }
          for(var a = 0; a < t.arrows.length; a++){ t.arrows[a].x += t.arrows[a].vx * DT; }
          break;
        case 'boulder':
          if(t.s === 0 && trig(t, st)){ t.s = 1; st.events.push({ e: 'trap', k: 'boulder', x: t.x, y: t.y }); }
          if(t.s === 1){ t.x += d.speed * DT; t.rot = (t.rot || 0) + d.speed * DT / 10; if(t.x > (d.endX || level.w) * TILE) t.s = 2; }
          break;
        case 'walker':
          t.x += t.vx * DT;
          if(t.x > d.x1 * TILE){ t.x = d.x1 * TILE; t.vx = -Math.abs(t.vx); } else if(t.x < d.x0 * TILE){ t.x = d.x0 * TILE; t.vx = Math.abs(t.vx); }
          break;
        case 'pad': if(t.sq > 0) t.sq = Math.max(0, t.sq - DT * 4); break;
      }
    }
    var dyn = dynSolids(st);
    // --- horizontal movement
    var target = mx * P.run, acc = st.onGround ? P.accel : P.airAccel;
    if(mx !== 0){ st.face = mx; if(st.vx < target) st.vx = Math.min(target, st.vx + acc * DT); else if(st.vx > target) st.vx = Math.max(target, st.vx - acc * DT); }
    else { var f = P.fric * DT; if(st.vx > 0) st.vx = Math.max(0, st.vx - f); else st.vx = Math.min(0, st.vx + f); }
    st.px += st.vx * DT;
    var b = pbox(st), r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]), guard = 0;
    while(r && guard++ < 4){
      if(st.vx > 0 || (st.vx === 0 && st.px < r[0] + r[2] / 2)) st.px = r[0] - P.w / 2; else st.px = r[0] + r[2] + P.w / 2;
      st.vx = 0; b = pbox(st); r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]);
    }
    // --- jumping
    if(input.j && !st.jumpHeld) st.buf = P.buffer; else st.buf = Math.max(0, st.buf - DT);
    if(st.onGround) st.coyote = P.coyote; else st.coyote = Math.max(0, st.coyote - DT);
    if(st.buf > 0 && st.coyote > 0){ st.vy = -P.jump; st.buf = 0; st.coyote = 0; st.onGround = false; st.jumping = true; st.events.push({ e: 'jump' }); }
    if(!input.j && st.jumping && st.vy < -P.jump * P.cut && !st.onGround) st.vy = -P.jump * P.cut;      // release early = short hop
    st.jumpHeld = !!input.j;
    // --- vertical movement
    st.vy = Math.min(P.maxFall, st.vy + P.grav * DT);
    var wasGround = st.onGround; st.onGround = false;
    st.py += st.vy * DT;
    b = pbox(st); r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]); guard = 0;
    while(r && guard++ < 4){
      if(st.vy > 0){ st.py = r[1]; st.onGround = true; } else { st.py = r[1] + r[3] + P.h; }
      st.vy = 0; b = pbox(st); r = overlapSolid(st, dyn, b[0], b[1], b[2], b[3]);
    }
    if(!st.onGround && st.vy >= 0){                                                       // stay glued to the floor while walking down a step
      var below = overlapSolid(st, dyn, b[0], st.py, b[2], st.py + 0.5);
      if(below && Math.abs(st.py - below[1]) < 0.6){ st.onGround = true; }
    }
    if(st.onGround){ st.jumping = false; if(!wasGround) st.events.push({ e: 'land' }); }
    // --- springs
    for(i = 0; i < traps.length; i++){
      var tp = traps[i]; if(tp.d.k !== 'pad') continue;
      var pxl = tp.d.x * TILE, pyl = tp.d.y * TILE;
      if(st.onGround && Math.abs(st.py - pyl) < 0.8 && st.px > pxl - 2 && st.px < pxl + TILE + 2){ st.vy = -tp.d.power; st.onGround = false; st.jumping = false; tp.sq = 1; st.events.push({ e: 'spring' }); }
    }
    // --- hazards
    var hb = pbox(st);
    // static spikes / lava
    var tx0 = Math.floor(hb[0] / TILE), tx1 = Math.floor((hb[2] - 0.01) / TILE), ty0 = Math.floor(hb[1] / TILE), ty1 = Math.floor((hb[3] - 0.01) / TILE);
    for(var ty = ty0; ty <= ty1; ty++) for(var tx = tx0; tx <= tx1; tx++){
      var tc = tileAt(level, tx, ty);
      if(tc === T.SPIKE && hits(st, tx * TILE + 3, ty * TILE + 8, tx * TILE + 13, ty * TILE + 16, 1.5)) die(st, 'spike', 'spike');
      else if(tc === T.LAVA && hits(st, tx * TILE, ty * TILE + 4, tx * TILE + 16, ty * TILE + 16, 1)) die(st, 'lava', 'lava');
    }
    for(i = 0; i < traps.length; i++){
      var h = traps[i], hd = h.d;
      if(hd.k === 'hidden' && h.h > 3){ if(hits(st, hd.x * TILE + 2, (hd.y + 1) * TILE - h.h, (hd.x + hd.n) * TILE - 2, (hd.y + 1) * TILE, 1)) die(st, 'hidden', hd.msg || 'hidden'); }
      else if(hd.k === 'fall' && h.s === 1){ if(hits(st, h.x + 1, h.y, h.x + hd.w * TILE - 1, h.y + hd.h * TILE + (hd.spiky ? 6 : 0), 1)) die(st, 'fall', hd.msg || 'fall'); }
      else if(hd.k === 'fall' && h.s === 2 && hd.spiky){ if(hits(st, h.x, h.y + hd.h * TILE - 1, h.x + hd.w * TILE, h.y + hd.h * TILE + 7, 1)) die(st, 'fall', hd.msg || 'fall'); }
      else if(hd.k === 'arrow'){ for(var a2 = 0; a2 < h.arrows.length; a2++){ var ar = h.arrows[a2]; if(hits(st, ar.x - 7, ar.y - 2, ar.x + 7, ar.y + 2, 0.5)) die(st, 'arrow', hd.msg || 'arrow'); } }
      else if(hd.k === 'boulder' && h.s === 1){ if(hits(st, h.x - 10, h.y - 20, h.x + 10, h.y, 2)) die(st, 'boulder', hd.msg || 'boulder'); }
      else if(hd.k === 'walker'){ if(hits(st, h.x - 6, h.y - 12, h.x + 6, h.y, 1)) die(st, 'walker', hd.msg || 'walker'); }
      else if(hd.k === 'fakeExit'){ if(hits(st, hd.x * TILE - 4, (hd.y - 2) * TILE, hd.x * TILE + 22, hd.y * TILE, 1)) die(st, 'fakeExit', 'fakeExit'); }
    }
    if(st.py > level.h * TILE + 40) die(st, 'pit', 'pit');
    // --- checkpoints and the exit
    for(i = 0; i < level.cps.length; i++){
      var cp = level.cps[i];
      if(i > st.cpIndex && Math.abs(st.px - (cp.x * TILE + 8)) < 14 && Math.abs(st.py - cp.y * TILE) < 20){
        st.cpIndex = i; st.cp = { x: cp.x * TILE + 8, y: cp.y * TILE }; st.events.push({ e: 'checkpoint', i: i });
      }
    }
    var ex = level.exit;
    if(ex && Math.abs(st.px - (ex.x * TILE + 8)) < 12 && Math.abs(st.py - ex.y * TILE) < 20){ st.done = true; st.doneT = 0; st.events.push({ e: 'finish' }); }
    st.anim += Math.abs(st.vx) * DT * 0.12;
  }

  // ------------------------------------------------------------------ a solver (used by the tests to prove each level is completable)
  function solve(levelIndex, opts){
    opts = opts || {};
    var width = opts.width || 700, macro = opts.macro || 5, maxFrames = opts.maxFrames || 4200;
    var ACTIONS = [{}, { r: 1 }, { r: 1, j: 1 }, { l: 1 }, { j: 1 }, { l: 1, j: 1 }];
    var start = createRun(levelIndex), beam = [{ st: start, inputs: [] }], level = start.level, goalX = level.exit.x * TILE + 8;
    function key(st){
      var s = Math.round(st.px / 2) + ':' + Math.round(st.py / 2) + ':' + Math.round(st.vx / 30) + ':' + Math.round(st.vy / 60) + ':' + (st.onGround ? 1 : 0) + ':' + st.cpIndex;
      for(var i = 0; i < st.traps.length; i++){ var t = st.traps[i]; s += t.s + (t.gone ? 'g' : '') + (t.d.k === 'boulder' ? Math.round(t.x / 12) : t.d.k === 'walker' ? Math.round(t.x / 6) + (t.vx > 0 ? 'p' : 'n') : t.d.k === 'arrow' ? t.arrows.length + ':' + (t.arrows[0] ? Math.round(t.arrows[0].x / 10) : '') : t.d.k === 'fall' ? Math.round(t.y / 6) : ''); }
      return s;
    }
    var dbg = { maxX: 0, kinds: {} };
    for(var f = 0; f < maxFrames; f += macro){
      var next = [], seen = {};
      for(var bi = 0; bi < beam.length; bi++){
        for(var ai = 0; ai < ACTIONS.length; ai++){
          var c = clone(beam[bi].st), inp = ACTIONS[ai];
          for(var k = 0; k < macro && !c.dead && !c.done; k++){ step(c, inp); c.events.length = 0; }
          if(c.dead){ dbg.kinds[c.deadKind] = (dbg.kinds[c.deadKind] || 0) + 1; if(c.px > dbg.maxX) dbg.maxX = c.px; continue; }
          if(c.done) return { ok: true, frames: f + macro, inputs: beam[bi].inputs.concat([[ai, macro]]), actions: ACTIONS };
          var kk = key(c); if(seen[kk]) continue; seen[kk] = 1;
          next.push({ st: c, inputs: beam[bi].inputs.concat([[ai, macro]]), score: c.px + (c.onGround ? 0 : -2) });
        }
      }
      if(!next.length) return { ok: false, frames: f, reason: 'all states died', dbg: dbg };
      next.sort(function(a, b2){ return b2.score - a.score; });
      // keep the beam diverse: a few of the best states per horizontal bucket, so 'wait and see' plans are not crowded out by rushers
      var per = opts.perBucket || 14, bucket = {}, kept = [];
      for(var ni = 0; ni < next.length && kept.length < width; ni++){ var bk = Math.floor(next[ni].st.px / 10) + ':' + (next[ni].st.py < 150 ? 'u' : 'd'); bucket[bk] = (bucket[bk] || 0) + 1; if(bucket[bk] <= per) kept.push(next[ni]); }
      beam = kept;
    }
    return { ok: false, frames: maxFrames, reason: 'ran out of time', dbg: dbg, bestX: beam.length ? beam[0].st.px : 0 };
  }

  return { TILE: TILE, VIEW_W: VIEW_W, VIEW_H: VIEW_H, ROWS: ROWS, DT: DT, P: P, T: T, LEVELS: LEVELS, DEATH_LINES: DEATH_LINES,
    createRun: createRun, clone: clone, respawn: respawn, step: step, solve: solve, tileAt: tileAt };
});
