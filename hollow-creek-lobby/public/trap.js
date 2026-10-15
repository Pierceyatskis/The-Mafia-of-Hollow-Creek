// Trap Run client: a troll platformer for the waiting lobby. The rules live in trap-sim.js; this file draws, plays sound,
// reads the keyboard / touch buttons, and shares positions with the rest of the lobby so you can watch each other die.
(function(){
  'use strict';
  var Sim = window.TrapSim;
  if(!Sim) return;
  var VW = Sim.VIEW_W, VH = Sim.VIEW_H, TILE = Sim.TILE;
  var MUSIC_KEY = 'hc-trap-music-v1';
  var OUT = '#1a120e';

  // ------------------------------------------------------------------ tiny 3x5 pixel font
  var GLYPHS = {
    A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',E:'111100110100111',F:'111100110100100',
    G:'011100101101011',H:'101101111101101',I:'111010010010111',J:'001001001101010',K:'101101110101101',L:'100100100100111',
    M:'101111111101101',N:'110101101101101',O:'010101101101010',P:'110101110100100',Q:'010101101110011',R:'110101110101101',
    S:'011100010001110',T:'111010010010010',U:'101101101101111',V:'101101101101010',W:'101101111111101',X:'101101010101101',
    Y:'101101010010010',Z:'111001010100111',
    '0':'111101101101111','1':'010110010010111','2':'110001010100111','3':'110001010001110','4':'101101111001001',
    '5':'111100110001110','6':'011100111101111','7':'111001010010010','8':'111101111101111','9':'111101111001110',
    '!':'010010010000010','-':'000000111000000','.':'000000000000010',':':'000010000010000','/':'001001010100100','?':'110001010000010',"'":'010010000000000',',':'000000000010100'
  };
  function textWidth(s, sc){ return Math.max(0, String(s).length * 4 - 1) * (sc || 1); }
  function drawText(g, s, x, y, color, sc, outline){
    sc = sc || 1; s = String(s).toUpperCase();
    function pass(ox, oy, col){
      g.fillStyle = col;
      for(var i = 0; i < s.length; i++){ var gl = GLYPHS[s.charAt(i)]; if(!gl) continue;
        for(var k = 0; k < 15; k++) if(gl.charAt(k) === '1') g.fillRect(x + ox + (i * 4 + (k % 3)) * sc, y + oy + Math.floor(k / 3) * sc, sc, sc); }
    }
    if(outline){ pass(-sc, 0, outline); pass(sc, 0, outline); pass(0, -sc, outline); pass(0, sc, outline); }
    pass(0, 0, color);
  }
  function drawTextC(g, s, cx, y, color, sc, outline){ drawText(g, s, Math.round(cx - textWidth(s, sc) / 2), y, color, sc, outline); }
  // wrap a sentence to a pixel width
  function wrap(s, maxChars){ var words = String(s).split(' '), lines = [], cur = ''; words.forEach(function(w){ if((cur + ' ' + w).trim().length > maxChars){ lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }); if(cur.trim()) lines.push(cur.trim()); return lines; }

  // ------------------------------------------------------------------ colour + noise helpers
  function hexToRgb(h){ h = String(h || '#c8873a').replace('#', ''); if(h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function c8(v){ return Math.max(0, Math.min(255, Math.round(v))); }
  function shade(hex, f){ var c = hexToRgb(hex); return 'rgb(' + c8(c[0] * f) + ',' + c8(c[1] * f) + ',' + c8(c[2] * f) + ')'; }
  function mixc(a, b, t){ var x = hexToRgb(a), y = hexToRgb(b); return 'rgb(' + c8(x[0] + (y[0] - x[0]) * t) + ',' + c8(x[1] + (y[1] - x[1]) * t) + ',' + c8(x[2] + (y[2] - x[2]) * t) + ')'; }
  function hashStr(s){ var h = 0; s = String(s); for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function rng(seed){ var s = seed >>> 0; return function(){ s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function rect(g, x, y, w, h, c){ g.fillStyle = c; g.fillRect(x, y, w, h); }
  function vgrad(g, x, y, w, h, stops){
    for(var i = 0; i < h; i++){
      var yy = y + i, a = stops[0], b = stops[stops.length - 1];
      for(var k = 0; k < stops.length - 1; k++){ if(yy >= stops[k][0] && yy <= stops[k + 1][0]){ a = stops[k]; b = stops[k + 1]; break; } }
      var t = (b[0] === a[0]) ? 0 : (yy - a[0]) / (b[0] - a[0]);
      g.fillStyle = mixc(a[1], b[1], Math.max(0, Math.min(1, t))); g.fillRect(x, yy, w, 1);
    }
  }

  // ------------------------------------------------------------------ themes: palettes, backgrounds, tile art
  var THEMES = {
    jungle: { sky: [[0, '#3c9ad8'], [120, '#9fe0e6'], [225, '#d8f4d0']], tile: '#6b4a2e', tileHi: '#8a6440', tileLo: '#4a3220', top: '#43a23c', topHi: '#74d05a', ceil: '#245c28', ceilHi: '#378a3a', fog: 'rgba(240,255,220,0.0)' },
    ruins:  { sky: [[0, '#e9a35c'], [110, '#f4d08a'], [225, '#f8e8b8']], tile: '#b8905a', tileHi: '#d8b074', tileLo: '#8a6a3e', top: '#c8a468', topHi: '#ead09a', ceil: '#8a6a3e', ceilHi: '#a88458', fog: 'rgba(255,230,170,0.0)' },
    cave:   { sky: [[0, '#0d0816'], [120, '#241028'], [225, '#4a1a1c']], tile: '#3c3042', tileHi: '#5a4a62', tileLo: '#241c2a', top: '#52425c', topHi: '#7a6a86', ceil: '#2a2030', ceilHi: '#46384e', fog: 'rgba(255,90,30,0.0)' },
    sky:    { sky: [[0, '#3a86f0'], [120, '#8ac8ff'], [225, '#dcf2ff']], tile: '#8a7a6a', tileHi: '#b0a090', tileLo: '#5e5044', top: '#58b848', topHi: '#88e068', ceil: '#6a6a7a', ceilHi: '#8a8a9a', fog: 'rgba(255,255,255,0.0)' },
    castle: { sky: [[0, '#150f2a'], [120, '#2c1c42'], [225, '#4a2442']], tile: '#4c4864', tileHi: '#6c6890', tileLo: '#2e2a42', top: '#5c5878', topHi: '#8480a8', ceil: '#34304c', ceilHi: '#524e70', fog: 'rgba(170,80,255,0.0)' }
  };

  function solidAt(level, tx, ty){ var t = Sim.tileAt(level, tx, ty); return t === 1 || t === 4; }
  function drawSolidTile(g, th, x, y, upOpen, leftOpen, rightOpen, downOpen, seed, ceiling){
    var base = ceiling ? th.ceil : th.tile, hi = ceiling ? th.ceilHi : th.tileHi, lo = ceiling ? shade(th.ceil, 0.7) : th.tileLo;
    rect(g, x, y, TILE, TILE, base);
    var r = rng(seed);
    for(var i = 0; i < 9; i++){ rect(g, x + Math.floor(r() * 14), y + Math.floor(r() * 14), 1 + Math.floor(r() * 2), 1, r() < 0.5 ? hi : lo); }
    if(th === THEMES.ruins || th === THEMES.castle){            // stone bricks
      rect(g, x, y + 7, TILE, 1, lo); rect(g, x + ((seed & 1) ? 5 : 10), y, 1, 7, lo); rect(g, x + ((seed & 2) ? 4 : 11), y + 8, 1, 8, lo);
      rect(g, x, y, TILE, 1, hi); rect(g, x, y + 8, TILE, 1, hi);
    }
    if(upOpen){ rect(g, x, y, TILE, 3, th.top); rect(g, x, y, TILE, 1, th.topHi); for(var k = 0; k < 6; k++) rect(g, x + Math.floor(r() * 15), y + 3, 1, 1 + Math.floor(r() * 3), th.top); if(th === THEMES.jungle || th === THEMES.sky){ rect(g, x, y + 2, TILE, 1, shade(th.top, 0.8)); } else { rect(g, x, y + 2, TILE, 1, lo); } }
    if(downOpen){ rect(g, x, y + TILE - 2, TILE, 2, lo); if(th === THEMES.jungle || th === THEMES.sky){ for(var v = 0; v < 3; v++){ var vx = x + 2 + v * 5, vl = 2 + Math.floor(r() * 5); rect(g, vx, y + TILE, 1, vl, th.top); } } }
    if(leftOpen) rect(g, x, y, 1, TILE, hi); if(rightOpen) rect(g, x + TILE - 1, y, 1, TILE, lo);
    if(!upOpen) rect(g, x, y, TILE, 1, 'rgba(255,255,255,0.05)');
  }
  function drawSpikeTile(g, x, y){
    for(var i = 0; i < 3; i++){
      var sx = x + 1 + i * 5;
      rect(g, sx, y + 12, 5, 4, '#5a5f6c'); rect(g, sx + 1, y + 8, 3, 4, '#aab0bf'); rect(g, sx + 2, y + 5, 1, 3, '#e8ecf4'); rect(g, sx + 1, y + 8, 1, 4, '#d6dbe8'); rect(g, sx + 3, y + 9, 1, 3, '#7a8090');
    }
  }

  var levelCache = {};
  function buildLevelArt(li){
    if(levelCache[li]) return levelCache[li];
    var level = Sim.LEVELS[li], th = THEMES[level.theme], W = level.w * TILE;
    // static tiles
    var tiles = document.createElement('canvas'); tiles.width = W; tiles.height = level.h * TILE; var g = tiles.getContext('2d'); g.imageSmoothingEnabled = false;
    for(var ty = 0; ty < level.h; ty++) for(var tx = 0; tx < level.w; tx++){
      var t = level.grid[ty * level.w + tx];
      if(t === 1 || t === 4){
        var ceiling = ty <= 1 && level.theme !== 'sky';
        drawSolidTile(g, th, tx * TILE, ty * TILE, !solidAt(level, tx, ty - 1), !solidAt(level, tx - 1, ty), !solidAt(level, tx + 1, ty), !solidAt(level, tx, ty + 1), tx * 73 + ty * 31, ceiling);
      } else if(t === 2) drawSpikeTile(g, tx * TILE, ty * TILE);
      else if(t === 3){ rect(g, tx * TILE, ty * TILE, TILE, TILE, '#5a1408'); }
    }
    // vanish / phantom / pad slots are dynamic; checkpoints and signs are drawn per frame
    // parallax layers
    var far = document.createElement('canvas'), near = document.createElement('canvas'), sky = document.createElement('canvas');
    sky.width = VW; sky.height = VH; var sg = sky.getContext('2d'); vgrad(sg, 0, 0, VW, VH, th.sky);
    var R = rng(level.theme.length * 977 + li);
    if(level.theme === 'cave'){ for(var s = 0; s < 60; s++){ rect(sg, Math.floor(R() * VW), Math.floor(R() * 120), 1, 1, 'rgba(255,200,160,0.5)'); } }
    else if(level.theme === 'castle'){ for(var s2 = 0; s2 < 50; s2++){ rect(sg, Math.floor(R() * VW), Math.floor(R() * 130), 1, 1, 'rgba(230,220,255,0.7)'); } rect(sg, 330, 24, 14, 14, '#efe8c8'); rect(sg, 332, 22, 10, 18, '#efe8c8'); }
    else { rect(sg, 330, 26, 16, 16, 'rgba(255,255,230,0.9)'); rect(sg, 327, 29, 22, 10, 'rgba(255,255,230,0.5)'); }
    var farW = Math.ceil(W * 0.25 + VW + 20), nearW = Math.ceil(W * 0.5 + VW + 20);
    far.width = farW; far.height = VH; near.width = nearW; near.height = VH;
    var fg = far.getContext('2d'), ng = near.getContext('2d');
    function hills(gc, w, base, col, hi, amp, step, seed){ var r2 = rng(seed), y = base; for(var x = 0; x < w; x += step){ y = base - amp * (0.5 + 0.5 * Math.sin(x * 0.021 + seed)) - r2() * 4; rect(gc, x, y, step + 1, VH - y, col); rect(gc, x, y, step + 1, 2, hi); } }
    if(level.theme === 'jungle'){ hills(fg, farW, 130, '#5ab05a', '#8ad47c', 34, 4, 3); hills(ng, nearW, 160, '#2f8a3c', '#58b852', 26, 4, 8);
      for(var tr = 0; tr < nearW; tr += 46 + Math.floor(R() * 30)){ rect(ng, tr, 120, 5, 80, '#5a3a22'); rect(ng, tr - 14, 96, 33, 30, '#2a7a34'); rect(ng, tr - 10, 88, 25, 14, '#3c9a44'); rect(ng, tr - 6, 82, 17, 8, '#58b852'); } }
    else if(level.theme === 'ruins'){ hills(fg, farW, 140, '#d8a860', '#f0cc88', 30, 4, 5); for(var p = 0; p < nearW; p += 70 + Math.floor(R() * 40)){ var ph = 40 + Math.floor(R() * 60); rect(ng, p, 192 - ph, 12, ph, '#b08850'); rect(ng, p - 3, 192 - ph - 4, 18, 5, '#c89a60'); rect(ng, p, 192 - ph, 3, ph, '#d4aa70'); for(var c = 0; c < 4; c++) rect(ng, p + 3, 192 - ph + 8 + c * 14, 6, 2, '#8a6a3e'); } }
    else if(level.theme === 'cave'){ for(var st = 0; st < nearW; st += 18 + Math.floor(R() * 20)){ var sh = 14 + Math.floor(R() * 40); for(var yy = 0; yy < sh; yy++){ rect(ng, st + Math.floor(yy / 4), yy, Math.max(1, 8 - Math.floor(yy / 5)), 1, '#2a1e32'); } }
      for(var cr = 0; cr < farW; cr += 30 + Math.floor(R() * 30)){ var cy = 100 + Math.floor(R() * 80); rect(fg, cr, cy, 3, 8, '#8a5aff'); rect(fg, cr, cy, 1, 8, '#c8a8ff'); rect(fg, cr + 2, cy + 3, 4, 5, '#5a3ab0'); } hills(ng, nearW, 190, '#1a1220', '#2a1e30', 20, 4, 9); }
    else if(level.theme === 'sky'){ function cloud(gc, x, y, w){ for(var i = 0; i < w; i += 5){ var hh = 6 + Math.floor(R() * 7); rect(gc, x + i, y - hh, 7, hh, '#ffffff'); rect(gc, x + i, y, 7, 3, '#dceaff'); } }
      for(var c1 = 0; c1 < farW; c1 += 80 + Math.floor(R() * 60)) cloud(fg, c1, 50 + Math.floor(R() * 70), 40 + Math.floor(R() * 30));
      for(var c2 = 0; c2 < nearW; c2 += 110 + Math.floor(R() * 80)) cloud(ng, c2, 110 + Math.floor(R() * 70), 50 + Math.floor(R() * 40)); }
    else { for(var tw = 0; tw < farW; tw += 60){ var th2 = 40 + Math.floor(R() * 70); rect(fg, tw, 150 - th2, 26, th2 + 80, '#201838'); rect(fg, tw, 150 - th2, 26, 2, '#342a52'); for(var k = 0; k < 4; k++) rect(fg, tw + 2 + k * 6, 146 - th2, 4, 4, '#201838'); rect(fg, tw + 10, 160 - th2, 4, 8, '#f6c46e'); }
      for(var wc = 0; wc < nearW; wc += 90){ rect(ng, wc, 0, 4, 40, '#6a2036'); rect(ng, wc - 8, 0, 20, 36, '#8a2a42'); rect(ng, wc - 8, 34, 20, 4, '#e0b84a'); rect(ng, wc - 2, 10, 8, 8, '#e0b84a'); } }
    return (levelCache[li] = { tiles: tiles, sky: sky, far: far, near: near, th: th });
  }

  // ------------------------------------------------------------------ sprites
  var SKINS = ['#f4d0a8', '#e0aa7c', '#b9825a', '#8c5a3c', '#6a4028'];
  var HAIRS = ['#241812', '#4a2e1c', '#7a5a30', '#35353a', '#a8501f', '#c8b070'];
  function explorer(g, x, y, o){
    // o: {id,color,face,anim,state:'idle'|'run'|'jump'|'dead'|'win',alpha,hat,t}
    var hs = hashStr(o.id || 'x'), skin = SKINS[hs % SKINS.length], hair = HAIRS[(hs >> 3) % HAIRS.length], hat = (hs >> 6) % 4;
    var col = o.color || '#c8873a', dk = shade(col, 0.68), lt = shade(col, 1.2);
    g.save(); g.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    g.translate(Math.round(x), Math.round(y)); if(o.face < 0) g.scale(-1, 1);
    var fr = o.state === 'run' ? (Math.floor(o.anim) % 4) : 0, bob = (o.state === 'run' && (fr === 1 || fr === 3)) ? 1 : 0;
    if(o.state === 'dead'){ g.rotate(o.spin || 0); g.translate(0, -7); g.translate(0, 7); }
    var air = o.state === 'jump';
    // legs
    if(air){ rect(g, -4, -5, 3, 4, OUT); rect(g, -3, -4, 2, 3, dk); rect(g, 1, -6, 3, 5, OUT); rect(g, 2, -5, 2, 4, dk); }
    else {
      var l1 = fr === 0 ? -3 : fr === 2 ? -1 : -2, l2 = fr === 0 ? 1 : fr === 2 ? -1 : 0;
      rect(g, l1 - 1, -6 + bob, 4, 7 - bob, OUT); rect(g, l1, -5 + bob, 2, 5 - bob, dk); rect(g, l1, -1, 3, 1, '#2a2118');
      rect(g, l2, -6 + bob, 4, 7 - bob, OUT); rect(g, l2 + 1, -5 + bob, 2, 5 - bob, shade(col, 0.8)); rect(g, l2 + 1, -1, 3, 1, '#2a2118');
    }
    // body
    var by = -13 + bob;
    rect(g, -5, by - 1, 10, 9, OUT); rect(g, -4, by, 8, 7, col); rect(g, -4, by, 8, 1, lt); rect(g, -4, by + 6, 8, 1, dk); rect(g, 2, by + 1, 2, 5, 'rgba(0,0,0,0.12)');
    rect(g, -4, by + 4, 8, 1, '#7a5a30');                                        // belt
    // arms
    if(o.state === 'jump' || o.state === 'win'){ rect(g, -7, by - 4, 3, 7, OUT); rect(g, -6, by - 3, 1, 5, col); rect(g, 4, by - 4, 3, 7, OUT); rect(g, 5, by - 3, 1, 5, col); rect(g, -6, by - 4, 1, 1, skin); rect(g, 5, by - 4, 1, 1, skin); }
    else { var sw = o.state === 'run' ? (fr === 0 ? 1 : fr === 2 ? -1 : 0) : 0; rect(g, -6 + sw, by, 3, 7, OUT); rect(g, -5 + sw, by + 1, 1, 5, shade(col, 0.85)); rect(g, 3 - sw, by, 3, 7, OUT); rect(g, 4 - sw, by + 1, 1, 5, col); rect(g, -5 + sw, by + 6, 1, 1, skin); rect(g, 4 - sw, by + 6, 1, 1, skin); }
    // head
    var hy = by - 10;
    rect(g, -5, hy - 1, 11, 11, OUT); rect(g, -4, hy, 9, 9, skin); rect(g, -4, hy, 9, 1, shade(skin, 1.1)); rect(g, -4, hy + 8, 9, 1, shade(skin, 0.8));
    var eyeY = hy + 4;
    if(o.state === 'dead'){ rect(g, 0, eyeY - 1, 1, 1, OUT); rect(g, 2, eyeY - 1, 1, 1, OUT); rect(g, 1, eyeY, 1, 1, OUT); rect(g, 0, eyeY + 1, 1, 1, OUT); rect(g, 2, eyeY + 1, 1, 1, OUT); rect(g, 1, hy + 7, 3, 1, OUT); }
    else if(o.blink){ rect(g, 0, eyeY, 3, 1, OUT); }
    else { rect(g, 0, eyeY - 1, 3, 3, '#fff'); rect(g, 1, eyeY - 1, 2, 3, OUT); rect(g, 2, eyeY - 1, 1, 1, '#fff'); rect(g, 0, eyeY - 3, 4, 1, hair); }
    rect(g, 5, hy + 5, 1, 2, shade(skin, 0.85));                                  // nose
    if(o.state === 'win') rect(g, 1, hy + 7, 4, 1, OUT); else if(o.state !== 'dead') rect(g, 2, hy + 7, 3, 1, shade(skin, 0.55));
    // hair + hats: 0 pith helmet, 1 fedora, 2 bandana, 3 flat cap
    rect(g, -5, hy - 2, 11, 3, hair); rect(g, -5, hy, 2, 5, hair);
    if(hat === 0){ rect(g, -6, hy - 4, 13, 3, OUT); rect(g, -5, hy - 3, 11, 2, '#e6d6a0'); rect(g, -4, hy - 7, 9, 4, OUT); rect(g, -3, hy - 6, 7, 3, '#e6d6a0'); rect(g, -3, hy - 6, 7, 1, '#fff6d0'); rect(g, -3, hy - 4, 7, 1, '#8a6a3e'); }
    else if(hat === 1){ rect(g, -7, hy - 3, 15, 2, OUT); rect(g, -6, hy - 2, 13, 1, '#5a3e26'); rect(g, -4, hy - 7, 9, 5, OUT); rect(g, -3, hy - 6, 7, 3, '#6a4a30'); rect(g, -3, hy - 4, 7, 1, '#c93a2a'); }
    else if(hat === 2){ rect(g, -5, hy - 2, 11, 3, OUT); rect(g, -4, hy - 1, 9, 2, '#d83a2a'); rect(g, -6, hy, 2, 2, '#d83a2a'); }
    else { rect(g, -5, hy - 4, 11, 3, OUT); rect(g, -4, hy - 3, 9, 2, '#6a7a8a'); rect(g, 3, hy - 2, 5, 2, OUT); rect(g, 3, hy - 2, 5, 1, '#4a5a6a'); }
    g.restore();
  }
  function drawExitDoor(g, x, y, t){
    // x,y = feet of the door; a wooden arch with a glowing EXIT sign
    rect(g, x - 12, y - 34, 24, 34, OUT); rect(g, x - 11, y - 33, 22, 33, '#7a5230'); rect(g, x - 11, y - 33, 22, 2, '#a07044'); rect(g, x - 9, y - 30, 18, 30, '#2a1810'); rect(g, x - 8, y - 29, 16, 29, '#4a2e1a');
    for(var i = 0; i < 4; i++) rect(g, x - 8 + i * 4, y - 29, 1, 29, '#3a2414');
    rect(g, x - 2, y - 18, 3, 3, '#e8c060'); rect(g, x - 2, y - 18, 1, 1, '#fff0b0');
    rect(g, x - 10, y - 40, 20, 8, OUT); rect(g, x - 9, y - 39, 18, 6, '#e8d8a0'); drawTextC(g, 'EXIT', x, y - 38, '#2a1810', 1);
    var glow = 0.5 + Math.sin(t * 4) * 0.2; g.fillStyle = 'rgba(255,240,170,' + (0.10 * glow) + ')'; g.fillRect(x - 16, y - 44, 32, 44);
  }
  function drawFlag(g, x, y, on, t){
    rect(g, x - 1, y - 28, 2, 28, '#5a4630'); rect(g, x - 2, y - 29, 4, 2, '#e0b84a');
    var wv = Math.round(Math.sin(t * 5) * 1);
    if(on){ rect(g, x + 1, y - 27, 11, 8, OUT); rect(g, x + 2, y - 26, 9 + wv, 6, '#3ac878'); rect(g, x + 2, y - 26, 9 + wv, 1, '#8affc0'); }
    else { rect(g, x + 1, y - 27, 9, 7, OUT); rect(g, x + 2, y - 26, 7, 5, '#8a8a94'); }
  }

  // ------------------------------------------------------------------ audio
  var audio = { ctx: null, master: null, musicGain: null, timer: null, nextTime: 0, step: 0, musicOn: true, started: false };
  try{ audio.musicOn = localStorage.getItem(MUSIC_KEY) !== '0'; }catch(e){}
  function soundMuted(){ try{ return !!(window.SoundFX && SoundFX.isMuted && SoundFX.isMuted()); }catch(e){ return false; } }
  function soundVol(){ try{ return (window.SoundFX && SoundFX.getVolume) ? SoundFX.getVolume() : 0.8; }catch(e){ return 0.8; } }
  function ac(){
    if(!audio.ctx){
      var AC = window.AudioContext || window.webkitAudioContext; if(!AC) return null;
      try{ audio.ctx = new AC(); }catch(e){ return null; }
      audio.master = audio.ctx.createGain(); audio.master.connect(audio.ctx.destination);
      audio.musicGain = audio.ctx.createGain(); audio.musicGain.connect(audio.master);
    }
    if(audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }
  function tone(freq, start, dur, type, peak, slideTo, dest){
    var c = audio.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, start);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + dur);
    g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(dest || audio.master); o.start(start); o.stop(start + dur + 0.03);
  }
  function noise(start, dur, peak, hp, dest){
    var c = audio.ctx, len = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for(var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = c.createBufferSource(); s.buffer = buf; var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
    var g = c.createGain(); g.gain.setValueAtTime(Math.max(peak, 0.0002), start); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f); f.connect(g); g.connect(dest || audio.master); s.start(start); s.stop(start + dur + 0.02);
  }
  function sfx(name){
    if(soundMuted()) return; var c = ac(); if(!c) return;
    var t = c.currentTime + 0.005, v = soundVol();
    switch(name){
      case 'jump': tone(300, t, 0.12, 'square', 0.07 * v, 620); break;
      case 'land': noise(t, 0.05, 0.10 * v, 400); break;
      case 'die': tone(520, t, 0.55, 'square', 0.14 * v, 70); tone(260, t + 0.05, 0.5, 'triangle', 0.12 * v, 55); noise(t, 0.12, 0.22 * v, 300); break;
      case 'sting': tone(880, t, 0.08, 'square', 0.10 * v); tone(1320, t + 0.07, 0.1, 'square', 0.10 * v); break;
      case 'thud': noise(t, 0.2, 0.34 * v, 120); tone(90, t, 0.2, 'triangle', 0.26 * v, 40); break;
      case 'crumble': noise(t, 0.16, 0.2 * v, 500); break;
      case 'shoot': noise(t, 0.2, 0.14 * v, 2000); tone(900, t, 0.2, 'sawtooth', 0.06 * v, 300); break;
      case 'spring': tone(200, t, 0.3, 'sine', 0.2 * v, 900); tone(400, t + 0.03, 0.25, 'triangle', 0.12 * v, 1200); break;
      case 'checkpoint': [660, 880, 1175].forEach(function(f, i){ tone(f, t + i * 0.07, 0.16, 'triangle', 0.14 * v); }); break;
      case 'finish': [523, 659, 784, 1047, 1319].forEach(function(f, i){ tone(f, t + i * 0.09, 0.22, 'square', 0.11 * v); tone(f / 2, t + i * 0.09, 0.22, 'triangle', 0.12 * v); }); break;
      case 'ghost': tone(300, t, 0.2, 'triangle', 0.05 * v, 90); break;
      case 'join': tone(392, t, 0.08, 'square', 0.1 * v); tone(587, t + 0.08, 0.12, 'square', 0.1 * v); break;
    }
  }
  // a bouncy adventure loop in C major: 4 bars of 16 steps
  var BASS = [[0,null,7,null,0,null,7,null,0,null,7,null,5,null,7,null],[5,null,12,null,5,null,12,null,5,null,12,null,3,null,5,null],[7,null,14,null,7,null,14,null,7,null,14,null,5,null,7,null],[0,null,7,null,0,null,7,null,3,null,5,null,7,null,2,null]];
  var LEAD = [[12,null,16,null,19,null,16,null,24,null,19,null,16,null,12,null],[17,null,21,null,24,null,21,null,29,null,24,null,21,null,17,null],[19,null,23,null,26,null,23,null,31,null,26,null,23,null,19,null],[24,null,19,null,16,null,19,null,24,null,26,null,28,null,null,null]];
  function noteHz(semi, base){ return base * Math.pow(2, semi / 12); }
  function scheduleMusic(){
    var c = audio.ctx; if(!c || !audio.started) return;
    var stepDur = 60 / 138 / 4;
    var master = (audio.musicOn && !soundMuted()) ? 0.15 * soundVol() : 0;
    audio.musicGain.gain.setTargetAtTime(master, c.currentTime, 0.05);
    while(audio.nextTime < c.currentTime + 0.18){
      var bar = Math.floor(audio.step / 16) % 4, s = audio.step % 16, t = audio.nextTime;
      if(master > 0){
        var b = BASS[bar][s]; if(b !== null) tone(noteHz(b, 65.4), t, stepDur * 1.7, 'triangle', 0.55, null, audio.musicGain);
        var l = LEAD[bar][s]; if(l !== null) tone(noteHz(l, 130.8), t, stepDur * 1.6, 'square', 0.11, null, audio.musicGain);
        if(s === 0 || s === 8) tone(120, t, 0.1, 'sine', 0.6, 42, audio.musicGain);
        if(s === 4 || s === 12) noise(t, 0.08, 0.28, 1800, audio.musicGain);
        if(s % 2 === 1) noise(t, 0.025, 0.09, 7000, audio.musicGain);
      }
      audio.nextTime += stepDur; audio.step++;
    }
  }
  function startMusic(){ var c = ac(); if(!c || audio.started) return; audio.started = true; audio.nextTime = c.currentTime + 0.1; audio.step = 0; audio.timer = setInterval(scheduleMusic, 40); }
  function stopMusic(){ if(audio.timer){ clearInterval(audio.timer); audio.timer = null; } audio.started = false; if(audio.musicGain && audio.ctx) audio.musicGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05); }

  // ------------------------------------------------------------------ game state
  var S = { joined: false, me: null, roster: {}, ghosts: {}, board: [], run: null, lvl: 0, totalDeaths: 0, cam: 0, time: 0, effects: [], toasts: [], shake: 0, introT: 0, bannerT: 0, banner: '', won: false, runT: 0, lastNet: 0, sentDeath: false, finishT: 0 };
  var el = {}, ctx2d = null, raf = 0, lastFrame = 0, acc = 0;
  var input = { left: false, right: false, jump: false, touchL: false, touchR: false, touchJ: false };

  function sendWS2(o){ try{ if(window.sendWS) window.sendWS(o); }catch(e){} }
  function toast(text, color){ S.toasts.push({ text: text, life: 4, color: color || '#f4efe0' }); if(S.toasts.length > 4) S.toasts.shift(); }
  function puff(x, y, n, color, spread){ for(var i = 0; i < n; i++) S.effects.push({ x: x, y: y, vx: (Math.random() - 0.5) * (spread || 90), vy: -20 - Math.random() * 80, life: 0.5 + Math.random() * 0.3, color: color || '#f4e8c0' }); }

  function startLevel(li){
    S.lvl = li; S.run = Sim.createRun(li); S.run.deaths = 0; S.introT = 2.6; S.sentDeath = false; S.runT = 0; S.finishT = 0; S.bannerT = 0;
    S.cam = Math.max(0, Math.min(S.run.level.w * TILE - VW, S.run.px - VW / 2));
    buildLevelArt(li);
  }

  function handleEvents(st){
    for(var i = 0; i < st.events.length; i++){
      var e = st.events[i];
      switch(e.e){
        case 'jump': sfx('jump'); puff(st.px, st.py, 3, '#cfc8b4', 40); break;
        case 'land': sfx('land'); puff(st.px, st.py, 3, '#cfc8b4', 40); break;
        case 'die':
          sfx('die'); S.shake = 0.3; S.totalDeaths++; puff(st.px, st.py - 8, 18, '#ffe9a0', 160);
          sendWS2({ type: 'trapDie', msg: e.msg, x: st.px, y: st.py }); S.sentDeath = true; break;
        case 'trap': sfx('sting'); S.shake = Math.max(S.shake, 0.12); break;
        case 'thud': sfx('thud'); S.shake = Math.max(S.shake, 0.2); break;
        case 'crumble': sfx('crumble'); puff(e.x + 8, e.y + 8, 6, '#a89880', 60); break;
        case 'shoot': sfx('shoot'); break;
        case 'spring': sfx('spring'); break;
        case 'checkpoint': sfx('checkpoint'); toast('CHECKPOINT!', '#8affc0'); break;
        case 'finish':
          sfx('finish'); S.finishT = 0.01;
          sendWS2({ type: 'trapFinish', lvl: st.lvl });
          if(st.lvl >= Sim.LEVELS.length - 1) { S.won = true; S.banner = 'YOU ESCAPED!'; } else S.banner = 'LEVEL CLEAR!';
          S.bannerT = 2.2; break;
      }
    }
    st.events.length = 0;
  }

  function updateGame(dt){
    var st = S.run; if(!st) return;
    S.runT += dt;
    var inp = { l: input.left || input.touchL, r: input.right || input.touchR, j: input.jump || input.touchJ };
    var steps = Math.round(dt / Sim.DT);
    for(var i = 0; i < steps; i++){
      Sim.step(st, inp); handleEvents(st);
      if(st.dead && st.deadT > 1.25){ Sim.respawn(st); S.sentDeath = false; S.introT = 0; }
      if(st.done && st.doneT > 2.3 && !S.won){ startLevel(st.lvl + 1); return; }
    }
    if(S.introT > 0) S.introT -= dt;
    if(S.bannerT > 0) S.bannerT -= dt;
    var tgt = Math.max(0, Math.min(st.level.w * TILE - VW, st.px - VW / 2 + st.face * 14));
    S.cam += (tgt - S.cam) * Math.min(1, dt * 7);
    // share where we are
    S.lastNet += dt;
    if(S.lastNet >= 0.1){ S.lastNet = 0; sendWS2({ type: 'trapPos', lvl: st.lvl, x: st.px, y: st.py, f: st.face, a: st.anim, d: st.dead }); }
  }

  // ------------------------------------------------------------------ drawing
  function drawWorld(g){
    var st = S.run; if(!st) return;
    var level = st.level, art = buildLevelArt(st.lvl), th = art.th, t = S.time;
    var cam = Math.round(S.cam);
    g.drawImage(art.sky, 0, 0);
    g.drawImage(art.far, -Math.round(cam * 0.25), 0);
    g.drawImage(art.near, -Math.round(cam * 0.5), 0);
    g.save(); g.translate(-cam, 0);
    var shk = S.shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0; if(shk) g.translate(0, shk);
    // decorations behind the action: start sign, checkpoints, exit
    rect(g, level.start.x * TILE - 6, level.start.y * TILE - 22, 2, 22, '#5a4630'); rect(g, level.start.x * TILE - 12, level.start.y * TILE - 26, 26, 10, OUT); rect(g, level.start.x * TILE - 11, level.start.y * TILE - 25, 24, 8, '#d8c890'); drawTextC(g, 'START', level.start.x * TILE + 1, level.start.y * TILE - 24, '#3a2a18', 1);
    level.cps.forEach(function(cp, i){ drawFlag(g, cp.x * TILE + 8, cp.y * TILE, i <= st.cpIndex, t); });
    if(level.exit) drawExitDoor(g, level.exit.x * TILE + 8, level.exit.y * TILE, t);
    g.drawImage(art.tiles, 0, 0);
    // lava (animated)
    var x0 = Math.max(0, Math.floor(cam / TILE) - 1), x1 = Math.min(level.w - 1, Math.floor((cam + VW) / TILE) + 1);
    for(var ty = 0; ty < level.h; ty++) for(var tx = x0; tx <= x1; tx++){
      if(level.grid[ty * level.w + tx] === 3){
        var lx = tx * TILE, ly = ty * TILE, up = level.grid[(ty - 1) * level.w + tx] !== 3;
        rect(g, lx, ly, TILE, TILE, '#c8300c'); rect(g, lx, ly + 4, TILE, TILE - 4, '#e8580c');
        for(var k = 0; k < 4; k++){ var wy = Math.round(Math.sin(t * 3 + (lx + k * 4) * 0.4) * 1.5); if(up) rect(g, lx + k * 4, ly + 1 + wy, 4, 3, '#ffb030'); }
        if(up){ rect(g, lx, ly, TILE, 2, '#ffd25a'); if(((lx / TILE + Math.floor(t * 2)) % 5) === 0) rect(g, lx + 6, ly - 2 - Math.round(Math.abs(Math.sin(t * 6)) * 3), 2, 2, '#ffe08a'); }
        rect(g, lx + 3, ly + 9 + Math.round(Math.sin(t * 2 + lx) * 1), 3, 2, '#ff8a20');
      }
    }
    // traps
    st.traps.forEach(function(tr){
      var d = tr.d;
      switch(d.k){
        case 'hidden':
          if(tr.h > 0){ for(var i = 0; i < d.n * 3; i++){ var sx = d.x * TILE + 1 + i * 5, hh = Math.round(tr.h), base = (d.y + 1) * TILE; rect(g, sx, base - hh, 5, hh, '#5a5f6c'); rect(g, sx + 1, base - hh, 3, hh - 4, '#aab0bf'); rect(g, sx + 2, base - hh - 2, 1, 3, '#e8ecf4'); rect(g, sx + 1, base - hh + 2, 1, hh - 6, '#d6dbe8'); } }
          break;
        case 'fall': {
          var th2 = th, ceil = true, bx = Math.round(tr.x), by = Math.round(tr.y);
          for(var ix = 0; ix < d.w; ix++) for(var iy = 0; iy < d.h; iy++) drawSolidTile(g, th2, bx + ix * TILE, by + iy * TILE, false, false, false, true, (d.x + ix) * 73 + (d.y + iy) * 31, ceil);
          if(d.spiky && tr.s >= 1){ for(var sp = 0; sp < d.w * 3; sp++){ var spx = bx + 1 + sp * 5, spy = by + d.h * TILE; rect(g, spx, spy, 5, 2, '#5a5f6c'); rect(g, spx + 1, spy + 2, 3, 3, '#aab0bf'); rect(g, spx + 2, spy + 5, 1, 3, '#e8ecf4'); } }
          if(tr.s === 1){ rect(g, bx + 2, by + d.h * TILE, 1, 3, 'rgba(255,255,255,0.4)'); }
          break; }
        case 'vanish':
          if(!d.skip && !tr.gone){
            var vx = d.x * TILE + (tr.s === 1 ? Math.round(Math.sin(S.time * 60) * 1) : 0), vy = d.y * TILE;
            drawSolidTile(g, th, vx, vy, true, true, true, true, d.x * 73 + d.y * 31, false);
            if(tr.s === 1){ rect(g, vx + 3, vy + 4, 1, 8, OUT); rect(g, vx + 4, vy + 6, 4, 1, OUT); rect(g, vx + 9, vy + 3, 1, 9, OUT); }
          }
          break;
        case 'phantom':
          if(tr.s >= 1){ for(var px2 = 0; px2 < d.w; px2++) for(var py2 = 0; py2 < d.h; py2++) drawSolidTile(g, th, (d.x + px2) * TILE, (d.y + py2) * TILE, py2 === 0, px2 === 0, px2 === d.w - 1, py2 === d.h - 1, (d.x + px2) * 73 + (d.y + py2) * 31 + 5, false); }
          break;
        case 'arrow': {
          var ax = d.x * TILE, ay = d.y * TILE;
          rect(g, ax - 2, ay, 20, 16, OUT); rect(g, ax - 1, ay + 1, 18, 14, '#8a8a96'); rect(g, ax - 1, ay + 1, 18, 2, '#b4b4c0'); rect(g, ax + (d.dir < 0 ? 0 : 8), ay + 7, 9, 3, '#1a1410');
          rect(g, ax + 4, ay + 4, 3, 2, '#d8d8e0'); rect(g, ax + 10, ay + 4, 3, 2, '#d8d8e0');
          tr.arrows.forEach(function(a){ rect(g, a.x - 7, a.y - 1, 14, 3, OUT); rect(g, a.x - 6, a.y, 12, 1, '#c8a46a'); rect(g, a.x + (d.dir < 0 ? -9 : 6), a.y - 2, 3, 5, '#cfd4e0'); rect(g, a.x + (d.dir < 0 ? 5 : -7), a.y - 2, 2, 5, '#d83a2a'); });
          break; }
        case 'boulder':
          if(tr.s === 1){ var bx2 = Math.round(tr.x), by2 = Math.round(tr.y) - 10; g.save(); g.translate(bx2, by2); g.rotate(tr.rot || 0);
            g.fillStyle = OUT; g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill(); g.fillStyle = '#8a7e72'; g.beginPath(); g.arc(0, 0, 10.5, 0, 7); g.fill();
            g.fillStyle = '#a89c8e'; g.beginPath(); g.arc(-3, -3, 5, 0, 7); g.fill(); rect(g, 2, -2, 5, 2, '#5a5046'); rect(g, -7, 3, 5, 2, '#5a5046'); rect(g, 0, 5, 3, 2, '#5a5046'); g.restore(); }
          break;
        case 'walker': {
          var wx = Math.round(tr.x), wy = Math.round(tr.y), step = Math.floor(S.time * 6) % 2;
          rect(g, wx - 7, wy - 13, 14, 13, OUT); rect(g, wx - 6, wy - 12, 12, 10, '#6a3a8a'); rect(g, wx - 6, wy - 12, 12, 2, '#9a5ac0'); rect(g, wx - 6, wy - 4, 12, 2, '#4a2a62');
          rect(g, wx - 4 + step, wy - 2, 3, 2, OUT); rect(g, wx + 2 - step, wy - 2, 3, 2, OUT);
          var fx = tr.vx > 0 ? 1 : -1; rect(g, wx + fx * 1 - 2, wy - 9, 3, 3, '#fff'); rect(g, wx + fx * 3 - 2, wy - 9, 2, 3, '#1a1410'); rect(g, wx - 3, wy - 11, 7, 1, '#2a1438'); break; }
        case 'fakeExit': drawExitDoor(g, d.x * TILE + 8, d.y * TILE, S.time); break;
        case 'pad': {
          var pxl = d.x * TILE, pyl = d.y * TILE, sq = tr.sq || 0, h2 = Math.round(8 - sq * 5);
          rect(g, pxl + 2, pyl - 2, 12, 2, OUT); rect(g, pxl + 3, pyl - 2, 10, 2, '#7a7a86');
          for(var cz = 0; cz < 3; cz++) rect(g, pxl + 4 + (cz % 2) * 2, pyl - 2 - Math.round(h2 * (cz + 1) / 3), 8, 1, '#c8c8d4');
          rect(g, pxl + 1, pyl - 3 - h2, 14, 3, OUT); rect(g, pxl + 2, pyl - 2 - h2, 12, 2, '#e8483a'); rect(g, pxl + 2, pyl - 2 - h2, 12, 1, '#ff8a7a'); break; }
      }
    });
    // ghosts (everyone else in the lobby on this level)
    Object.keys(S.ghosts).forEach(function(id){
      var gh = S.ghosts[id]; if(gh.lvl !== st.lvl || id === S.me) return;
      var info = S.roster[id] || { color: '#c8873a', name: '?', icon: null };
      explorer(g, gh.x, gh.y, { id: id, color: info.color, face: gh.f, anim: gh.a, state: gh.d ? 'dead' : (Math.abs(gh.vx) > 6 ? (gh.onAir ? 'jump' : 'run') : (gh.onAir ? 'jump' : 'idle')), alpha: 0.42, spin: gh.d ? 1.6 : 0 });
      var nm = String(info.name || '?').slice(0, 9); drawTextC(g, nm, Math.round(gh.x), Math.round(gh.y) - 36, 'rgba(255,255,255,0.8)', 1, 'rgba(0,0,0,0.55)');
    });
    // the player
    var state = st.dead ? 'dead' : st.done ? 'win' : (!st.onGround ? 'jump' : (Math.abs(st.vx) > 8 ? 'run' : 'idle'));
    var info2 = S.roster[S.me] || { color: '#d8573a', name: 'YOU' };
    var blink = (Math.floor(S.time * 1.4) % 6 === 0) && ((S.time * 8) % 1 < 0.4);
    var py = st.py; if(st.dead){ py = st.py; }
    explorer(g, st.px, py, { id: S.me || 'me', color: info2.color, face: st.face, anim: st.anim, state: state, blink: blink, spin: st.dead ? st.deadT * 9 * st.face : 0 });
    if(!st.dead){ var nm2 = String(info2.name || 'YOU').slice(0, 9); drawTextC(g, nm2, Math.round(st.px), Math.round(py) - 36, '#ffe9a0', 1, OUT); }
    // particles
    S.effects.forEach(function(e){ rect(g, Math.round(e.x), Math.round(e.y), 2, 2, e.color); });
    g.restore();
    // vignette
    var vg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.45, VW / 2, VH / 2, VW * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, level.theme === 'cave' || level.theme === 'castle' ? 'rgba(0,0,10,0.5)' : 'rgba(0,0,20,0.22)');
    g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
  }

  function drawHud(g){
    var st = S.run; if(!st) return;
    rect(g, 0, 0, VW, 14, 'rgba(14,10,8,0.78)'); rect(g, 0, 14, VW, 1, '#7a5a2c');
    drawText(g, 'LV ' + (st.lvl + 1) + '/' + Sim.LEVELS.length + '  ' + st.level.name, 6, 4, '#f4d878', 1);
    var dt = 'DEATHS ' + S.totalDeaths; drawText(g, dt, Math.round(VW / 2 - textWidth(dt, 1) / 2) + 40, 4, '#ff8a7a', 1);
    var sec = Math.floor(S.runT), tm = Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); drawText(g, tm, VW - 6 - textWidth(tm, 1), 4, '#e8e0d0', 1);
    // toasts from other players
    var y = 20; S.toasts.forEach(function(to){ var a = Math.min(1, to.life); g.globalAlpha = a; var lines = wrap(to.text, 46); lines.forEach(function(ln){ rect(g, 4, y - 1, textWidth(ln, 1) + 4, 8, 'rgba(14,10,8,0.6)'); drawText(g, ln, 6, y, to.color, 1); y += 8; }); g.globalAlpha = 1; });
    // death banner
    if(st.dead){
      var a2 = Math.min(1, st.deadT * 3);
      g.globalAlpha = a2; rect(g, 0, 84, VW, 54, 'rgba(10,6,6,0.8)'); rect(g, 0, 84, VW, 1, '#a83a2a'); rect(g, 0, 137, VW, 1, '#a83a2a');
      drawTextC(g, 'YOU DIED', VW / 2, 90, '#ff5a4a', 3, OUT);
      var lines2 = wrap(st.deadMsg, 44); lines2.forEach(function(ln, i){ drawTextC(g, ln, VW / 2, 116 + i * 9, '#f4efe0', 1); });
      g.globalAlpha = 1;
    }
    if(S.bannerT > 0 && S.banner){
      g.globalAlpha = Math.min(1, S.bannerT * 2); rect(g, 0, 78, VW, 50, 'rgba(10,30,14,0.8)'); rect(g, 0, 78, VW, 1, '#58d878'); rect(g, 0, 127, VW, 1, '#58d878');
      drawTextC(g, S.banner, VW / 2, 88, '#8affc0', 3, OUT);
      if(S.won){ drawTextC(g, 'DEATHS ' + S.totalDeaths + '   PRESS R OR ENTER TO RUN IT AGAIN', VW / 2, 114, '#f4efe0', 1); }
      g.globalAlpha = 1;
    } else if(S.won){ drawTextC(g, 'YOU ESCAPED! PRESS R TO RUN IT AGAIN', VW / 2, 200, '#8affc0', 1, OUT); }
    if(S.introT > 0 && !st.dead && !S.won){
      g.globalAlpha = Math.min(1, S.introT); rect(g, 0, 30, VW, 30, 'rgba(10,8,6,0.62)');
      drawTextC(g, st.level.name, VW / 2, 36, '#f4d878', 2, OUT); drawTextC(g, st.level.intro, VW / 2, 52, '#f4efe0', 1); g.globalAlpha = 1;
    }
  }

  function frame(now){
    raf = requestAnimationFrame(frame);
    if(!S.joined || !ctx2d || !S.run) return;
    var dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; S.time += dt; acc += dt;
    var stepDt = Sim.DT, n = 0;
    while(acc >= stepDt && n < 6){ updateGame(stepDt); acc -= stepDt; n++; }
    if(n === 6) acc = 0;
    // ghosts smooth toward their last position
    Object.keys(S.ghosts).forEach(function(id){ var gh = S.ghosts[id], k = 1 - Math.exp(-dt * 14); var ox = gh.x, oy = gh.y; gh.x += (gh.tx - gh.x) * k; gh.y += (gh.ty - gh.y) * k; gh.vx = (gh.x - ox) / Math.max(dt, 0.001); gh.onAir = Math.abs(gh.ty - gh.y) > 0.8 || Math.abs(gh.y - oy) > 0.4; });
    S.effects.forEach(function(e){ e.life -= dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 220 * dt; });
    S.effects = S.effects.filter(function(e){ return e.life > 0; });
    S.toasts.forEach(function(to){ to.life -= dt; }); S.toasts = S.toasts.filter(function(to){ return to.life > 0; });
    if(S.shake > 0) S.shake -= dt;
    drawWorld(ctx2d); drawHud(ctx2d);
  }

  // ------------------------------------------------------------------ input
  function typing(e){ var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  function keyState(e, down){
    if(!S.joined || typing(e)) return;
    var k = e.key, used = true;
    if(k === 'ArrowLeft' || k === 'a' || k === 'A') input.left = down;
    else if(k === 'ArrowRight' || k === 'd' || k === 'D') input.right = down;
    else if(k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ' || k === 'z' || k === 'Z') input.jump = down;
    else if((k === 'r' || k === 'R' || k === 'Enter') && down && !e.repeat) restartPressed();
    else used = false;
    if(used){ e.preventDefault(); ensureAudio(); }
  }
  function restartPressed(){
    if(!S.run) return;
    if(S.won){ S.won = false; S.totalDeaths = 0; startLevel(0); return; }
    if(!S.run.dead && !S.run.done){ S.run.deaths++; S.totalDeaths++; S.run.dead = true; S.run.deadT = 0.9; S.run.deadMsg = 'You gave up. The level noticed.'; S.run.vy = -150; sfx('die'); sendWS2({ type: 'trapDie', msg: S.run.deadMsg, x: S.run.px, y: S.run.py }); }
  }
  function ensureAudio(){ try{ if(!audio.started) startMusic(); else ac(); }catch(e){} }
  function bindHold(btn, down, up){
    if(!btn) return;
    function on(e){ e.preventDefault(); down(); btn.classList.add('is-down'); ensureAudio(); }
    function off(e){ if(e) e.preventDefault(); up(); btn.classList.remove('is-down'); }
    btn.addEventListener('pointerdown', on); btn.addEventListener('pointerup', off); btn.addEventListener('pointerleave', off); btn.addEventListener('pointercancel', off);
    btn.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  }

  // ------------------------------------------------------------------ board + show / hide
  function renderBoard(){
    if(!el.board) return;
    el.board.innerHTML = '';
    S.board.forEach(function(r, i){
      var row = document.createElement('div'); row.className = 'trap-board-row' + (r.id === S.me ? ' me' : '');
      row.innerHTML = '<span class="trap-b-rank">' + (i + 1) + '</span><span class="trap-b-dot" style="background:' + (r.color || '#c8873a') + '"></span><span class="trap-b-name"></span><span class="trap-b-lv">Level ' + Math.min(r.best, Sim.LEVELS.length) + (r.clears >= Sim.LEVELS.length ? ' (escaped)' : '') + '</span><span class="trap-b-d">' + r.deaths + ' deaths</span>';
      row.querySelector('.trap-b-name').textContent = r.name;
      el.board.appendChild(row);
    });
  }
  function fitCanvas(){
    if(!el.canvas || !el.stage) return;
    var avail = el.stage.clientWidth || 800;
    var scale = avail >= VW * 2 ? Math.min(3, Math.floor(avail / VW)) : avail / VW;
    el.canvas.style.width = Math.round(VW * scale) + 'px'; el.canvas.style.height = Math.round(VH * scale) + 'px';
  }
  function setJoinedUI(on){
    if(el.stage) el.stage.style.display = on ? 'block' : 'none';
    if(el.joinBtn) el.joinBtn.style.display = on ? 'none' : '';
    if(el.leaveBtn) el.leaveBtn.style.display = on ? '' : 'none';
    if(el.controls) el.controls.style.display = on ? '' : 'none';
    if(el.musicBtn) el.musicBtn.style.display = on ? '' : 'none';
    if(on) setTimeout(fitCanvas, 0);
  }
  function setMusicLabel(){ if(el.musicBtn) el.musicBtn.textContent = audio.musicOn ? 'Music: on' : 'Music: off'; }

  var HCTrap = {
    init: function(){
      el.card = document.getElementById('trap-card'); if(!el.card) return;
      el.joinBtn = document.getElementById('trap-join-btn'); el.leaveBtn = document.getElementById('trap-leave-btn'); el.stage = document.getElementById('trap-stage');
      el.canvas = document.getElementById('trap-canvas'); el.controls = document.getElementById('trap-controls'); el.musicBtn = document.getElementById('trap-music-btn'); el.board = document.getElementById('trap-board');
      el.toggle = document.getElementById('trap-host-toggle'); el.toggleWrap = document.getElementById('trap-host-toggle-wrap');
      ctx2d = el.canvas.getContext('2d'); ctx2d.imageSmoothingEnabled = false;
      el.joinBtn.addEventListener('click', function(){ ensureAudio(); sendWS2({ type: 'trapJoin' }); });
      el.leaveBtn.addEventListener('click', function(){ sendWS2({ type: 'trapLeave' }); });
      el.musicBtn.addEventListener('click', function(){ audio.musicOn = !audio.musicOn; try{ localStorage.setItem(MUSIC_KEY, audio.musicOn ? '1' : '0'); }catch(e){} setMusicLabel(); if(audio.musicOn) ensureAudio(); });
      if(el.toggle) el.toggle.addEventListener('change', function(){ sendWS2({ type: 'trapToggle', enabled: !!el.toggle.checked }); });
      bindHold(document.getElementById('trap-btn-left'), function(){ input.touchL = true; }, function(){ input.touchL = false; });
      bindHold(document.getElementById('trap-btn-right'), function(){ input.touchR = true; }, function(){ input.touchR = false; });
      bindHold(document.getElementById('trap-btn-jump'), function(){ input.touchJ = true; }, function(){ input.touchJ = false; });
      var rb = document.getElementById('trap-btn-retry'); if(rb) rb.addEventListener('click', function(){ restartPressed(); });
      window.addEventListener('keydown', function(e){ keyState(e, true); });
      window.addEventListener('keyup', function(e){ keyState(e, false); });
      window.addEventListener('blur', function(){ input.left = input.right = input.jump = input.touchL = input.touchR = input.touchJ = false; });
      window.addEventListener('resize', fitCanvas);
      setMusicLabel(); setJoinedUI(false);
      lastFrame = performance.now(); raf = requestAnimationFrame(frame);
    },
    onMessage: function(msg){
      if(!el.card) return;
      if(msg.type === 'trapJoined'){ S.joined = true; S.me = msg.you; S.ghosts = {}; S.effects = []; S.toasts = []; S.won = false; S.totalDeaths = 0; acc = 0; setJoinedUI(true); sfx('join'); startMusic(); startLevel(0); }
      else if(msg.type === 'trapRoster'){ S.roster = {}; msg.players.forEach(function(p){ S.roster[p.id] = p; }); }
      else if(msg.type === 'trapBoard'){ S.board = msg.rows || []; renderBoard(); }
      else if(msg.type === 'trapSnap'){ if(!S.joined) return; msg.players.forEach(function(p){ if(p.i === S.me) return; var gh = S.ghosts[p.i]; if(!gh){ gh = S.ghosts[p.i] = { x: p.x, y: p.y, vx: 0 }; } gh.lvl = p.l; gh.tx = p.x; gh.ty = p.y; gh.f = p.f; gh.a = p.a; gh.d = !!p.d; });}
      else if(msg.type === 'trapGone'){ delete S.ghosts[msg.id]; }
      else if(msg.type === 'trapEvent'){
        if(!S.joined || msg.id === S.me) return;
        var nm = (S.roster[msg.id] || {}).name || 'Someone';
        if(msg.e === 'die'){ toast(nm + ': ' + msg.msg, '#ffb0a0'); if(S.run && msg.lvl === S.run.lvl){ puff(msg.x, msg.y - 8, 10, '#ffffff', 120); sfx('ghost'); } }
        else if(msg.e === 'finish'){ toast(nm + (msg.final ? ' ESCAPED THE CASTLE!' : ' cleared level ' + (msg.lvl + 1) + '!'), '#8affc0'); }
      }
      else if(msg.type === 'trapEnded'){ HCTrap.stop(); }
    },
    setLobby: function(enabled, isHost){
      if(!el.card) return;
      el.card.style.display = '';
      if(el.toggleWrap) el.toggleWrap.style.display = isHost ? '' : 'none';
      if(el.toggle) el.toggle.checked = enabled !== false;
      var off = document.getElementById('trap-off-note'); if(off) off.style.display = enabled === false ? '' : 'none';
      if(el.joinBtn) el.joinBtn.disabled = enabled === false;
      if(enabled === false && S.joined) HCTrap.stop();
    },
    stop: function(){
      if(!el.card) return;
      S.joined = false; S.run = null; S.ghosts = {}; S.effects = []; S.board = [];
      input.left = input.right = input.jump = input.touchL = input.touchR = input.touchJ = false;
      stopMusic(); setJoinedUI(false);
    },
    isJoined: function(){ return S.joined; },
    _debug: { state: S, startLevel: startLevel }
  };
  window.HCTrap = HCTrap;
})();
