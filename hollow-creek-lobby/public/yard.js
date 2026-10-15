// Lobby Yard client: a chunky side-view pixel mini-game for the waiting lobby (see ../yard.js for the rules).
// Everything is drawn procedurally at 400x225 and scaled up with crisp pixels, in the spirit of a 16-bit prison-yard game.
(function(){
  'use strict';
  var W = 400, H = 225, GY = 198;                 // logical size; GY is the pixel row the characters' feet stand on
  var RING = { x: 236, w: 118 };
  var STATE = { idle: 0, ko: 1, held: 2, thrown: 3, out: 4 };
  var EMOTES = ['wave', 'heart', 'laugh', 'bang', 'zzz'];
  var MUSIC_KEY = 'hc-yard-music-v1';

  // ------------------------------------------------------------------ tiny 3x5 pixel font
  var GLYPHS = {
    A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',E:'111100110100111',F:'111100110100100',
    G:'011100101101011',H:'101101111101101',I:'111010010010111',J:'001001001101010',K:'101101110101101',L:'100100100100111',
    M:'101111111101101',N:'110101101101101',O:'010101101101010',P:'110101110100100',Q:'010101101110011',R:'110101110101101',
    S:'011100010001110',T:'111010010010010',U:'101101101101111',V:'101101101101010',W:'101101111111101',X:'101101010101101',
    Y:'101101010010010',Z:'111001010100111',
    '0':'111101101101111','1':'010110010010111','2':'110001010100111','3':'110001010001110','4':'101101111001001',
    '5':'111100110001110','6':'011100111101111','7':'111001010010010','8':'111101111101111','9':'111101111001110',
    '!':'010010010000010','-':'000000111000000','.':'000000000000010','x':'000101010101000','?':'110001010000010'
  };
  function textWidth(s, sc){ return Math.max(0, s.length * 4 - 1) * (sc || 1); }
  function drawText(ctx, s, x, y, color, sc, outline){
    sc = sc || 1; s = String(s).toUpperCase();
    function pass(ox, oy, col){
      ctx.fillStyle = col;
      for(var i = 0; i < s.length; i++){
        var g = GLYPHS[s.charAt(i)]; if(!g) continue;
        for(var k = 0; k < 15; k++) if(g.charAt(k) === '1') ctx.fillRect(x + ox + (i * 4 + (k % 3)) * sc, y + oy + Math.floor(k / 3) * sc, sc, sc);
      }
    }
    if(outline){ pass(-sc, 0, outline); pass(sc, 0, outline); pass(0, -sc, outline); pass(0, sc, outline); }
    pass(0, 0, color);
  }
  function drawTextCentered(ctx, s, cx, y, color, sc, outline){ drawText(ctx, s, Math.round(cx - textWidth(String(s), sc) / 2), y, color, sc, outline); }

  // ------------------------------------------------------------------ colour helpers
  function hexToRgb(h){ h = String(h || '#c8873a').replace('#', ''); if(h.length === 3) h = h.replace(/(.)/g, '$1$1'); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function clamp8(v){ return Math.max(0, Math.min(255, Math.round(v))); }
  function shade(hex, f){ var c = hexToRgb(hex); return 'rgb(' + clamp8(c[0] * f) + ',' + clamp8(c[1] * f) + ',' + clamp8(c[2] * f) + ')'; }
  function mixc(a, b, t){ var x = hexToRgb(a), y = hexToRgb(b); return 'rgb(' + clamp8(x[0] + (y[0] - x[0]) * t) + ',' + clamp8(x[1] + (y[1] - x[1]) * t) + ',' + clamp8(x[2] + (y[2] - x[2]) * t) + ')'; }
  function hashStr(s){ var h = 0; s = String(s); for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function rng(seed){ var s = seed >>> 0; return function(){ s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function rect(g, x, y, w, h, c){ g.fillStyle = c; g.fillRect(x, y, w, h); }
  var SKINS = ['#f4d0a8', '#e0aa7c', '#b9825a', '#8c5a3c', '#6a4028'];
  var HAIRS = ['#241812', '#4a2e1c', '#7a5a30', '#35353a', '#a8501f', '#c8b070'];

  // ------------------------------------------------------------------ the static scene (drawn once): layered, textured, lit
  var sceneCanvas = null;
  function vgrad(g, x, y, w, h, stops){
    for(var i = 0; i < h; i++){
      var yy = y + i, a = stops[0], b = stops[stops.length - 1];
      for(var k = 0; k < stops.length - 1; k++){ if(yy >= stops[k][0] && yy <= stops[k + 1][0]){ a = stops[k]; b = stops[k + 1]; break; } }
      var t = (b[0] === a[0]) ? 0 : (yy - a[0]) / (b[0] - a[0]);
      g.fillStyle = mixc(a[1], b[1], Math.max(0, Math.min(1, t))); g.fillRect(x, yy, w, 1);
    }
  }
  function lightPool(g, x, y, r, col, a){
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + col + ',' + a + ')'); gr.addColorStop(0.5, 'rgba(' + col + ',' + (a * 0.38) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function buildScene(){
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    var R = rng(7);
    // ---- sky: deep dusk gradient, dithered bands
    vgrad(g, 0, 0, W, 124, [[0, '#0e1535'], [34, '#1f2a63'], [66, '#4a3d7c'], [92, '#a95a72'], [110, '#e58c6a'], [124, '#f6b476']]);
    for(var by = 30; by < 124; by += 14){ for(var bx = (by / 14) % 2; bx < W; bx += 2){ if(R() < 0.5) rect(g, bx, by, 1, 1, 'rgba(255,255,255,0.045)'); } }
    for(var s = 0; s < 70; s++){ var sx = Math.floor(R() * W), sy = Math.floor(R() * 70); rect(g, sx, sy, 1, 1, R() < 0.2 ? '#fff6d8' : 'rgba(230,225,255,0.7)'); }
    // pixel clouds lit from below by the sunset
    function cloud(cx, cy, cw){
      for(var i = 0; i < cw; i += 3){
        var hh = 2 + Math.floor(R() * 3) + (i > cw * 0.3 && i < cw * 0.7 ? 2 : 0);
        rect(g, cx + i, cy - hh, 4, hh, '#5d4a86'); rect(g, cx + i, cy, 4, 1, '#e48a78'); rect(g, cx + i, cy - hh, 4, 1, '#8a6aa0');
      }
    }
    cloud(30, 58, 58); cloud(150, 44, 46); cloud(268, 64, 62); cloud(330, 36, 40); cloud(100, 84, 36);
    // moon
    g.fillStyle = 'rgba(255,240,200,0.10)'; g.beginPath(); g.arc(356, 24, 22, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(255,240,200,0.12)'; g.beginPath(); g.arc(356, 24, 15, 0, 6.3); g.fill();
    rect(g, 350, 18, 12, 12, '#f2e8c0'); rect(g, 349, 20, 14, 8, '#f2e8c0'); rect(g, 352, 16, 8, 16, '#f2e8c0');
    rect(g, 354, 22, 3, 3, '#d4c690'); rect(g, 358, 26, 2, 2, '#d4c690'); rect(g, 351, 25, 2, 2, '#dccf9c');
    // ---- distant skyline (two layers) with lit windows
    function skyline(baseY, col, minH, maxH, seed, winChance){
      var r2 = rng(seed);
      for(var x = -4; x < W; ){
        var w = 14 + Math.floor(r2() * 20), h = minH + Math.floor(r2() * (maxH - minH));
        rect(g, x, baseY - h, w, h + 2, col);
        if(r2() < 0.4) rect(g, x + 3, baseY - h - 4, 3, 4, col);
        for(var wy = baseY - h + 3; wy < baseY - 3; wy += 5) for(var wx = x + 2; wx < x + w - 3; wx += 5) if(r2() < winChance) rect(g, wx, wy, 2, 2, r2() < 0.7 ? '#f6c46e' : '#ffe9a8');
        x += w + Math.floor(r2() * 4);
      }
    }
    skyline(124, '#332a5c', 18, 56, 11, 0.16);
    skyline(124, '#1e1840', 10, 32, 23, 0.10);
    // ---- guard towers
    function tower(x, top, w, scale){
      rect(g, x + 2, top + 22, 3, 56, '#2b2540'); rect(g, x + w - 5, top + 22, 3, 56, '#2b2540');
      for(var k = 0; k < 4; k++){ g.fillStyle = '#2b2540'; for(var d = 0; d < w - 6; d++) g.fillRect(x + 3 + d, top + 30 + k * 12 + Math.floor((d * 10) / (w - 6)) * (k % 2 ? -1 : 1) + (k % 2 ? 10 : 0), 1, 1); }
      rect(g, x - 2, top + 18, w + 4, 5, '#4a4068'); rect(g, x - 2, top + 18, w + 4, 1, '#6a5f8e');
      rect(g, x, top, w, 18, '#4f4570'); rect(g, x, top, w, 1, '#7a6ea0'); rect(g, x, top + 17, w, 1, '#2f2848');
      rect(g, x + 4, top + 5, w - 8, 8, '#2a2140'); rect(g, x + 5, top + 6, w - 10, 6, '#ffd27a'); rect(g, x + 5, top + 6, w - 10, 2, '#fff0b0'); rect(g, x + Math.floor(w / 2), top + 5, 1, 8, '#2a2140');
      for(var rx = -3; rx < w + 3; rx++){ var hgt = Math.max(0, 7 - Math.abs(rx - w / 2) * 0.55); rect(g, x + rx, top - Math.floor(hgt), 1, Math.floor(hgt) + 1, '#2f2848'); }
      rect(g, x + w - 1, top + 8, 5, 4, '#1c1830'); rect(g, x + w + 3, top + 9, 2, 2, '#fff2c0');       // searchlight head
    }
    tower(16, 52, 46); tower(372, 66, 36);
    // ---- the prison wall: textured blocks, pilasters, weathering
    var WT = 118, WB = 198;
    rect(g, 0, WT, W, WB - WT, '#3d2b27');
    var palette = ['#8c6c5a', '#7e6050', '#966f5b', '#76594a', '#a07a64', '#84645a'];
    var rr = rng(99);
    for(var row = 0; row * 7 < WB - WT; row++){
      var yy = WT + row * 7;
      for(var bx = -((row % 2) * 8); bx < W; bx += 16){
        var col = palette[Math.floor(rr() * palette.length)];
        rect(g, bx + 1, yy + 1, 15, 6, col);
        rect(g, bx + 1, yy + 1, 15, 1, 'rgba(255,255,255,0.18)'); rect(g, bx + 1, yy + 1, 1, 6, 'rgba(255,255,255,0.10)');
        rect(g, bx + 1, yy + 6, 15, 1, 'rgba(0,0,0,0.28)'); rect(g, bx + 15, yy + 1, 1, 6, 'rgba(0,0,0,0.18)');
        for(var sp = 0; sp < 3; sp++) if(rr() < 0.7) rect(g, bx + 2 + Math.floor(rr() * 12), yy + 2 + Math.floor(rr() * 4), 1, 1, rr() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.2)');
      }
    }
    for(var st = 0; st < 46; st++){ var sx2 = Math.floor(rr() * W), sy2 = WT + 4 + Math.floor(rr() * 40), len = 8 + Math.floor(rr() * 26); rect(g, sx2, sy2, 2, len, 'rgba(25,15,18,0.20)'); rect(g, sx2, sy2, 1, len, 'rgba(25,15,18,0.12)'); }
    for(var cr = 0; cr < 7; cr++){ var cx2 = 20 + Math.floor(rr() * (W - 40)), cy2 = WT + 8 + Math.floor(rr() * 50); g.fillStyle = 'rgba(20,12,12,0.65)'; for(var q = 0; q < 12; q++){ cx2 += Math.floor(rr() * 3) - 1; cy2 += 1; g.fillRect(cx2, cy2, 1, 1); } }
    for(var mo = 0; mo < 60; mo++){ var mx = Math.floor(rr() * W), my = WB - 2 - Math.floor(rr() * 14); rect(g, mx, my, 2 + Math.floor(rr() * 3), 1 + Math.floor(rr() * 2), rr() < 0.6 ? 'rgba(70,104,58,0.55)' : 'rgba(96,130,70,0.45)'); }
    [0, 96, 192, 288, 392].forEach(function(px){ rect(g, px, WT, 8, WB - WT, '#a08874'); rect(g, px, WT, 1, WB - WT, '#c4aa94'); rect(g, px + 7, WT, 1, WB - WT, '#6a5444'); for(var k = WT + 6; k < WB; k += 10) rect(g, px + 1, k, 6, 1, 'rgba(0,0,0,0.18)'); });
    rect(g, 0, WT - 6, W, 6, '#b8a18e'); rect(g, 0, WT - 6, W, 1, '#dccab6'); rect(g, 0, WT - 1, W, 1, '#6a5a4e'); rect(g, 0, WT, W, 2, 'rgba(0,0,0,0.35)');
    // barbed wire with posts and coils
    for(var wp = 6; wp < W; wp += 30){ rect(g, wp, WT - 24, 2, 18, '#2a2a32'); rect(g, wp - 3, WT - 24, 8, 2, '#2a2a32'); rect(g, wp, WT - 24, 1, 18, '#4a4a56'); }
    [WT - 20, WT - 14, WT - 9].forEach(function(wy, i){
      rect(g, 0, wy, W, 1, '#3c3c46'); rect(g, 0, wy, W, 1, 'rgba(160,170,190,0.25)');
      for(var bx2 = 2 + i * 2; bx2 < W; bx2 += 6){ rect(g, bx2, wy - 1, 1, 3, '#555764'); rect(g, bx2 - 1, wy, 3, 1, '#555764'); }
    });
    // wall details: metal plate sign, vent, tally marks, poster
    rect(g, 100, 138, 76, 18, '#25201c'); rect(g, 101, 139, 74, 16, '#c9b88a'); rect(g, 102, 140, 72, 14, '#e8dba8'); rect(g, 102, 140, 72, 1, '#fff6d0');
    [[103, 141], [171, 141], [103, 151], [171, 151]].forEach(function(b){ rect(g, b[0], b[1], 2, 2, '#6a5a3a'); });
    drawTextCentered(g, 'LOBBY YARD', 138, 144, '#3a2a18', 1);
    rect(g, 24, 152, 20, 14, '#2a2622'); for(var vv = 0; vv < 5; vv++) rect(g, 26, 154 + vv * 2, 16, 1, '#5a544c'); rect(g, 24, 152, 20, 1, '#6a645a');
    for(var tm = 0; tm < 4; tm++) rect(g, 214 + tm * 3, 150, 1, 9, 'rgba(240,235,220,0.55)'); rect(g, 213, 153, 12, 1, 'rgba(240,235,220,0.55)');
    rect(g, 298, 140, 14, 18, '#d6c79a'); rect(g, 299, 141, 12, 16, '#9a2a2a'); drawText(g, 'WANTED', 299, 143, '#f2e6c0', 1); rect(g, 302, 148, 6, 7, '#2a1c14'); rect(g, 297, 139, 2, 2, '#444'); rect(g, 311, 139, 2, 2, '#444');
    // ---- chain-link fence over the wall
    for(var fy = 128; fy < WB; fy++){ for(var fx = 0; fx < W; fx++){ if(((fx + fy) % 6 === 0) || (((fx - fy) % 6 + 6) % 6 === 0)){ g.fillStyle = (fy % 12 < 6) ? 'rgba(205,215,230,0.26)' : 'rgba(150,165,185,0.22)'; g.fillRect(fx, fy, 1, 1); } } }
    [8, 88, 168, 248, 328, 396].forEach(function(px){ rect(g, px, 122, 4, WB - 122, '#4c5560'); rect(g, px, 122, 1, WB - 122, '#8a95a4'); rect(g, px + 3, 122, 1, WB - 122, '#2a3038'); rect(g, px - 1, 120, 6, 3, '#5a6470'); });
    rect(g, 0, 124, W, 3, '#58626e'); rect(g, 0, 124, W, 1, '#98a4b2'); rect(g, 0, 126, W, 1, '#2a3038');
    // ---- ground: concrete slab over a dirt cross-section (side view, Terraria style)
    var GT = GY;                                      // top of the slab = where feet land
    vgrad(g, 0, GT + 5, W, H - GT - 5, [[GT + 5, '#5e4836'], [GT + 14, '#46352a'], [H, '#2a1e16']]);
    var rg = rng(5);
    for(var d = 0; d < 260; d++){ var dx = Math.floor(rg() * W), dy = GT + 6 + Math.floor(rg() * (H - GT - 6)); rect(g, dx, dy, 1 + Math.floor(rg() * 3), 1 + Math.floor(rg() * 2), rg() < 0.5 ? 'rgba(255,225,190,0.16)' : 'rgba(0,0,0,0.25)'); }
    for(var pb = 0; pb < 26; pb++){ var px2 = Math.floor(rg() * W), py2 = GT + 8 + Math.floor(rg() * (H - GT - 12)); rect(g, px2, py2, 3, 2, '#7a6a5e'); rect(g, px2, py2, 3, 1, '#9a8a7c'); rect(g, px2 + 1, py2 + 2, 2, 1, '#3a2e26'); }
    for(var rt = 0; rt < 9; rt++){ var rx2 = Math.floor(rg() * W), ry2 = GT + 6; g.fillStyle = '#3a2a1e'; for(var q2 = 0; q2 < 8; q2++){ rx2 += Math.floor(rg() * 3) - 1; ry2 += 1; g.fillRect(rx2, ry2, 1, 1); } }
    rect(g, 0, GT, W, 5, '#a8a296'); rect(g, 0, GT, W, 1, '#d8d2c2'); rect(g, 0, GT + 1, W, 1, '#bdb7a8'); rect(g, 0, GT + 4, W, 1, '#6a655a'); rect(g, 0, GT + 5, W, 1, 'rgba(0,0,0,0.4)');
    for(var jx = 30; jx < W; jx += 44){ rect(g, jx, GT, 1, 5, '#5e594e'); rect(g, jx + 1, GT, 1, 5, 'rgba(255,255,255,0.12)'); }
    for(var pc = 0; pc < 50; pc++){ rect(g, Math.floor(rg() * W), GT + Math.floor(rg() * 4), 2, 1, rg() < 0.5 ? '#8a847a' : '#c4bdae'); }
    rect(g, 70, GT, 10, 1, 'rgba(130,160,210,0.55)'); rect(g, 300, GT, 16, 1, 'rgba(130,160,210,0.45)');   // puddles
    for(var gt = 0; gt < 38; gt++){ var tx = Math.floor(rg() * W); rect(g, tx, GT - 2, 1, 2, '#4e7a3a'); rect(g, tx + 1, GT - 1, 1, 1, '#6a9a4a'); }  // weeds along the slab
    // ---- props (behind the players)
    function crate(x, y, w){ rect(g, x, y, w, w, '#1c1410'); rect(g, x + 1, y + 1, w - 2, w - 2, '#9a6e3e'); for(var k = 3; k < w - 1; k += 4) rect(g, x + 1, y + k, w - 2, 1, '#6a4a2a'); rect(g, x + 1, y + 1, w - 2, 1, '#c8955a'); rect(g, x + 1, y + 1, 1, w - 2, '#b8864e'); rect(g, x + 1, y + 1, 3, w - 2, 'rgba(0,0,0,0.12)'); rect(g, x + 2, y + 2, 2, 2, '#3a2a18'); rect(g, x + w - 4, y + w - 4, 2, 2, '#3a2a18'); rect(g, x + 1, y + w - 2, w - 2, 1, 'rgba(0,0,0,0.3)'); }
    crate(108, GT - 18, 18); crate(128, GT - 14, 14); crate(112, GT - 34, 14);
    // basketball hoop
    rect(g, 52, 138, 3, GT - 138, '#4a4a52'); rect(g, 52, 138, 1, GT - 138, '#8a8a94'); rect(g, 49, GT - 3, 9, 3, '#2a2a30');
    rect(g, 55, 150, 12, 3, '#4a4a52'); rect(g, 66, 138, 4, 24, '#1c1410'); rect(g, 67, 139, 2, 22, '#f0ece0'); rect(g, 66, 148, 4, 6, '#c93a2a'); rect(g, 67, 149, 2, 4, '#f0ece0');
    rect(g, 58, 158, 9, 2, '#e8651f'); rect(g, 58, 158, 9, 1, '#ff9a4a');
    for(var nt = 0; nt < 6; nt++){ rect(g, 58 + nt * 2 - (nt > 3 ? 1 : 0), 160 + nt, 1, 1, 'rgba(240,240,240,0.7)'); rect(g, 59 + nt * 2 - (nt > 3 ? 1 : 0), 161 + nt % 4, 1, 1, 'rgba(240,240,240,0.6)'); }
    for(var nr = 0; nr < 5; nr++) rect(g, 59 + (nr % 2), 160 + nr, 7 - nr, 1, 'rgba(240,240,240,0.35)');
    // weight bench + barbell on a rack
    rect(g, 152, GT - 9, 40, 5, '#1c1410'); rect(g, 153, GT - 8, 38, 3, '#3a2a28'); rect(g, 153, GT - 8, 38, 1, '#7a5a52');
    rect(g, 156, GT - 4, 3, 4, '#555a64'); rect(g, 186, GT - 4, 3, 4, '#555a64'); rect(g, 156, GT - 4, 1, 4, '#9aa0aa'); rect(g, 186, GT - 4, 1, 4, '#9aa0aa');
    rect(g, 150, GT - 32, 3, 26, '#3a3d46'); rect(g, 190, GT - 32, 3, 26, '#3a3d46'); rect(g, 150, GT - 32, 1, 26, '#7a7f8a'); rect(g, 190, GT - 32, 1, 26, '#7a7f8a'); rect(g, 148, GT - 33, 7, 3, '#555a64'); rect(g, 188, GT - 33, 7, 3, '#555a64');
    rect(g, 134, GT - 30, 78, 2, '#2a2a30'); rect(g, 134, GT - 30, 78, 1, '#aab0ba');
    [[138, 5], [142, 3], [196, 3], [200, 5]].forEach(function(pl){ rect(g, pl[0], GT - 30 - pl[1] * 1 - 3, 3, pl[1] * 2 + 8, '#1c1410'); rect(g, pl[0] + 1, GT - 30 - pl[1] - 2, 1, pl[1] * 2 + 6, '#4a4f5c'); rect(g, pl[0], GT - 29 - pl[1] - 3, 1, pl[1] * 2 + 7, '#7a808c'); });
    // oil drums
    function drum(x, col){ rect(g, x, GT - 20, 14, 20, '#1c1410'); rect(g, x + 1, GT - 19, 12, 18, col); rect(g, x + 1, GT - 19, 3, 18, 'rgba(255,255,255,0.18)'); rect(g, x + 10, GT - 19, 3, 18, 'rgba(0,0,0,0.25)'); [GT - 16, GT - 10, GT - 4].forEach(function(by2){ rect(g, x + 1, by2, 12, 1, 'rgba(0,0,0,0.35)'); rect(g, x + 1, by2 + 1, 12, 1, 'rgba(255,255,255,0.12)'); }); rect(g, x + 2, GT - 20, 10, 2, shade('#7a7a82', 1)); }
    drum(214, '#3a5a7a'); drum(226, '#8a3a2a');
    // trash can + bench on the far left
    rect(g, 18, GT - 14, 10, 14, '#1c1410'); rect(g, 19, GT - 13, 8, 12, '#5a6068'); rect(g, 19, GT - 13, 2, 12, '#8a909a'); rect(g, 17, GT - 15, 12, 3, '#6a7078'); rect(g, 17, GT - 15, 12, 1, '#9aa0aa');
    // lamp post
    rect(g, 369, 124, 3, GT - 124, '#2a2a32'); rect(g, 369, 124, 1, GT - 124, '#6a6a76'); rect(g, 362, 120, 14, 4, '#2a2a32'); rect(g, 364, 124, 10, 3, '#ffe9a0'); rect(g, 366, 124, 6, 1, '#fffbe0');
    // ---- the ring: raised platform with an apron, posts and ropes (ropes/posts are drawn separately so players can stand in front)
    var RX = RING.x, RW = RING.w;
    rect(g, RX - 4, GT - 8, RW + 8, 12, '#1c1410');
    rect(g, RX - 3, GT - 7, RW + 6, 10, '#2c4a86'); rect(g, RX - 3, GT - 7, RW + 6, 2, '#e8eaf4'); rect(g, RX - 3, GT - 5, RW + 6, 1, '#7a98d8'); rect(g, RX - 3, GT + 1, RW + 6, 2, '#1a2a50');
    for(var ap = RX - 2; ap < RX + RW + 3; ap += 12){ rect(g, ap, GT - 4, 1, 6, 'rgba(0,0,0,0.25)'); rect(g, ap + 1, GT - 4, 1, 6, 'rgba(255,255,255,0.10)'); }
    drawTextCentered(g, 'KING', RX + RW / 2, GT - 3, '#e8eaf4', 1);
    rect(g, RX - 2, GT - 8, RW + 4, 2, '#cfd8f0'); rect(g, RX - 2, GT - 8, RW + 4, 1, '#ffffff');
    // banner over the ring on two chains
    [RX + 12, RX + RW - 14].forEach(function(cx){ rect(g, cx, 66, 1, 14, '#8a8a94'); rect(g, cx - 1, 65, 3, 2, '#aaaab4'); });
    rect(g, RX + 4, 78, RW - 8, 28, '#1c1410'); rect(g, RX + 5, 79, RW - 10, 26, '#7a1c1c'); rect(g, RX + 5, 79, RW - 10, 1, '#b83a3a'); rect(g, RX + 5, 104, RW - 10, 1, '#4a0c0c');
    rect(g, RX + 7, 81, RW - 14, 1, '#e0b84a'); rect(g, RX + 7, 102, RW - 14, 1, '#e0b84a');
    drawTextCentered(g, 'KING OF THE YARD', RX + RW / 2, 86, '#f8dc7a', 1, '#4a0c0c');
    drawTextCentered(g, 'THROW THEM OUT!', RX + RW / 2, 94, '#f0e6d0', 1);
    // ---- lighting: cool dusk grade over everything, then warm pools
    g.globalCompositeOperation = 'multiply';
    var grade = g.createLinearGradient(0, 100, 0, H); grade.addColorStop(0, '#9aa0c8'); grade.addColorStop(0.55, '#c2b4bc'); grade.addColorStop(1, '#a89a9a');
    g.fillStyle = grade; g.fillRect(0, 100, W, H - 100);
    g.globalCompositeOperation = 'lighter';
    lightPool(g, 40, 150, 70, '255,190,110', 0.10);
    lightPool(g, 370, 130, 86, '255,210,130', 0.42); lightPool(g, 370, 190, 60, '255,210,130', 0.16);
    lightPool(g, 222, 178, 52, '255,150,60', 0.25);
    lightPool(g, 56, 62, 40, '255,210,120', 0.28); lightPool(g, 390, 80, 34, '255,210,120', 0.22);
    // ring spotlights: two cones from above onto the mat
    [RX + 30, RX + RW - 30].forEach(function(lx){
      var cone = g.createLinearGradient(0, 70, 0, GT); cone.addColorStop(0, 'rgba(255,240,200,0.30)'); cone.addColorStop(1, 'rgba(255,240,200,0.07)');
      g.fillStyle = cone; g.beginPath(); g.moveTo(lx - 3, 70); g.lineTo(lx + 3, 70); g.lineTo(lx + 38, GT - 6); g.lineTo(lx - 38, GT - 6); g.closePath(); g.fill();
      lightPool(g, lx, GT - 6, 46, '255,236,190', 0.30);
    });
    g.globalCompositeOperation = 'source-over';
    // vignette
    var vg = g.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(6,4,14,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    sceneCanvas = c;
  }
  // ring posts + ropes (behind players)
  function drawRopes(g){
    var x0 = RING.x, x1 = RING.x + RING.w, base = GY - 8;
    [[base - 36, '#d83a2a'], [base - 25, '#f4efe2'], [base - 14, '#d83a2a']].forEach(function(r){
      for(var x = x0; x < x1; x++){ var u = (x - x0) / (x1 - x0), sag = Math.round(Math.sin(u * Math.PI) * 2); rect(g, x, r[0] + sag - 1, 1, 1, '#1c1410'); rect(g, x, r[0] + sag + 2, 1, 1, '#1c1410'); rect(g, x, r[0] + sag, 1, 2, r[1]); rect(g, x, r[0] + sag, 1, 1, 'rgba(255,255,255,0.35)'); }
    });
    [x0, x1].forEach(function(px){
      rect(g, px - 4, base - 52, 8, 52, '#1c1410'); rect(g, px - 3, base - 51, 6, 50, '#8a8d9a'); rect(g, px - 3, base - 51, 2, 50, '#c4c7d4'); rect(g, px + 1, base - 51, 2, 50, '#5a5d6a');
      [base - 36, base - 25, base - 14].forEach(function(py){ rect(g, px - 4, py - 3, 8, 7, '#1c1410'); rect(g, px - 3, py - 2, 6, 5, '#d83a2a'); rect(g, px - 3, py - 2, 6, 1, '#f0705a'); });
      rect(g, px - 5, base - 55, 10, 4, '#1c1410'); rect(g, px - 4, base - 54, 8, 2, '#b8bcc8');
    });
  }
  // ------------------------------------------------------------------ characters (chunky, big-headed, expressive)
  var OUT = '#1a120e';
  // a shaded part: dark outline, base colour, light top/left edge, shadow bottom/right edge
  function part(g, x, y, w, h, col, hi, lo){
    rect(g, x - 1, y - 1, w + 2, h + 2, OUT); rect(g, x, y, w, h, col);
    if(w > 2 && h > 2){ rect(g, x, y, w, 1, hi || shade(col, 1.25)); rect(g, x, y, 1, h, hi || shade(col, 1.15)); rect(g, x, y + h - 1, w, 1, lo || shade(col, 0.72)); rect(g, x + w - 1, y, 1, h, lo || shade(col, 0.8)); }
  }
  // draws a figure facing right with its feet at (0,0); the caller flips / rotates / places it
  function drawFigure(g, p, o){
    var hs = hashStr(p.id);
    var skin = SKINS[hs % SKINS.length], skinD = shade(skin, 0.82), skinL = shade(skin, 1.08);
    var hair = HAIRS[(hs >> 3) % HAIRS.length], hairStyle = (hs >> 5) % 4;
    var body = p.color || '#c8873a', bodyD = shade(body, 0.7), bodyL = shade(body, 1.22);
    var t = o.time || 0;
    var fr = o.walking ? (Math.floor(t * 10) % 4) : 0;       // walk cycle: 0 apart, 1 passing, 2 apart (swapped), 3 passing
    var bob = (fr === 1 || fr === 3) ? 1 : 0;
    var air = o.air;
    var lean = o.punch ? 1 : 0;
    // back leg, front leg (jumpsuit trousers) + boots
    var bl = -4, fl = 1;
    if(fr === 0){ bl = -5; fl = 2; } else if(fr === 2){ bl = -2; fl = -1; } else { bl = -3; fl = 0; }
    var legTop = -9 + bob;
    if(air){ part(g, -5, -8, 4, 6, bodyD); part(g, -6, -3, 5, 3, '#2a2118', '#4a3a2c'); part(g, 1, -10, 4, 8, bodyD); part(g, 1, -3, 6, 3, '#2a2118', '#4a3a2c'); }
    else {
      part(g, bl, legTop, 4, 9 - bob, bodyD); part(g, bl - 1, -3, 6, 3, '#2a2118', '#4a3a2c');
      part(g, fl, legTop, 4, 9 - bob, shade(body, 0.78)); part(g, fl, -3, 7, 3, '#2a2118', '#4a3a2c');
    }
    // back arm (swings opposite)
    var swing = o.walking ? (fr === 0 ? -1 : fr === 2 ? 1 : 0) : 0;
    if(o.armsUp){ part(g, -7, -36, 3, 15, shade(body, 0.85)); part(g, -7, -39, 3, 3, skinD); }
    else { part(g, -7 + swing, -21 + bob, 3, 10, shade(body, 0.82)); part(g, -7 + swing, -12 + bob, 3, 3, skinD); }
    // torso
    var ty = -22 + bob;
    part(g, -5 + lean, ty, 10, 13, body, bodyL, bodyD);
    rect(g, -2 + lean, ty, 5, 3, skin); rect(g, -2 + lean, ty, 5, 1, skinD); rect(g, -1 + lean, ty + 3, 3, 1, skin);     // open collar
    rect(g, -5 + lean, ty + 9, 10, 1, bodyD); rect(g, -1 + lean, ty + 9, 2, 1, '#d8b858');                        // belt + buckle
    rect(g, 1 + lean, ty + 4, 3, 3, bodyD); rect(g, 1 + lean, ty + 4, 3, 1, shade(body, 0.55));                    // breast pocket
    rect(g, -4 + lean, ty + 2, 1, 8, 'rgba(255,255,255,0.10)');
    // head
    var hy = -35 + bob;
    part(g, -5 + lean, hy, 11, 11, skin, skinL, skinD);
    part(g, -6 + lean, hy + 4, 2, 4, skin, skinL, skinD);                                                               // ear (back)
    rect(g, 6 + lean, hy + 6, 2, 2, skin); rect(g, 6 + lean, hy + 7, 2, 1, skinD); rect(g, 6 + lean, hy + 5, 1, 1, OUT);   // nose
    var ex = 1 + lean, ey = hy + 4;
    if(o.dead){ rect(g, ex, ey, 1, 1, OUT); rect(g, ex + 2, ey, 1, 1, OUT); rect(g, ex + 1, ey + 1, 1, 1, OUT); rect(g, ex, ey + 2, 1, 1, OUT); rect(g, ex + 2, ey + 2, 1, 1, OUT);
                 rect(g, ex + 3, ey - 1, 1, 1, OUT); }
    else if(o.dizzy){ rect(g, ex, ey, 3, 3, '#fff'); rect(g, ex + 1, ey + 1, 1, 1, OUT); rect(g, ex, ey - 2, 4, 1, OUT); }
    else if(o.blink){ rect(g, ex, ey + 1, 3, 1, OUT); }
    else { rect(g, ex, ey, 3, 3, '#fff'); rect(g, ex + 1, ey, 2, 3, OUT); rect(g, ex + 2, ey, 1, 1, '#fff'); rect(g, ex - 1, ey - 2, 5, 1, hair); if(o.angry){ rect(g, ex - 1, ey - 2, 2, 1, OUT); rect(g, ex, ey - 1, 2, 1, OUT); } }
    // cheeks + mouth
    rect(g, 4 + lean, hy + 7, 1, 1, 'rgba(220,90,90,0.5)');
    if(o.punch){ rect(g, 2 + lean, hy + 8, 4, 2, OUT); rect(g, 3 + lean, hy + 8, 2, 1, '#fff'); }
    else if(o.hurt || o.dead){ rect(g, 3 + lean, hy + 8, 3, 2, OUT); rect(g, 4 + lean, hy + 9, 1, 1, '#a83a3a'); }
    else if(o.happy){ rect(g, 2 + lean, hy + 8, 4, 1, OUT); rect(g, 3 + lean, hy + 9, 2, 1, OUT); }
    else rect(g, 3 + lean, hy + 8, 3, 1, shade(skin, 0.55));
    // hair / hats
    var f = p.g === 'f';
    if(f){ part(g, -7 + lean, hy + 3, 4, 14, hair, shade(hair, 1.3), shade(hair, 0.7)); part(g, -5 + lean, hy - 2, 11, 4, hair, shade(hair, 1.3), shade(hair, 0.7)); rect(g, 2 + lean, hy + 1, 4, 2, hair); }
    else if(hairStyle === 0){ part(g, -5 + lean, hy - 2, 11, 4, hair, shade(hair, 1.3), shade(hair, 0.7)); rect(g, -6 + lean, hy + 1, 2, 4, hair); }
    else if(hairStyle === 1){ part(g, -5 + lean, hy - 3, 12, 5, hair, shade(hair, 1.3), shade(hair, 0.7)); rect(g, 5 + lean, hy + 1, 2, 2, hair); rect(g, -6 + lean, hy, 2, 5, hair); }
    else if(hairStyle === 2){ rect(g, -5 + lean, hy - 1, 11, 2, hair); rect(g, -5 + lean, hy + 1, 1, 3, hair); }
    else { for(var sp = -5; sp < 6; sp += 2){ rect(g, sp + lean, hy - 4 - ((sp + 5) % 4 === 0 ? 1 : 0), 2, 4, hair); } rect(g, -5 + lean, hy - 1, 11, 2, hair); }
    switch(p.hat){
      case 1: part(g, -5 + lean, hy - 6, 12, 5, '#6a5a44', '#8a7a62', '#4a3c2c'); part(g, 4 + lean, hy - 2, 6, 2, '#3a2e22', '#5a4a38', '#2a2018'); break;                                         // flat cap
      case 2: part(g, -9 + lean, hy - 3, 20, 3, '#3a2c20', '#5a4838', '#241a12'); part(g, -4 + lean, hy - 11, 10, 9, '#4a3a2c', '#6a5848', '#2c2018'); rect(g, -4 + lean, hy - 5, 10, 2, '#8a1c14'); break;   // fedora
      case 3: if(f){ part(g, -6 + lean, hy - 6, 13, 6, '#8a4a5a', '#b06a7a', '#5a2a38'); part(g, -7 + lean, hy - 2, 15, 2, '#5a2a38'); rect(g, 3 + lean, hy - 7, 4, 3, '#e8b84a'); rect(g, 4 + lean, hy - 6, 2, 1, '#c93a2a'); }  // cloche with a flower
              else { part(g, -5 + lean, hy - 9, 11, 7, '#2f2f3a', '#4a4a58', '#1c1c26'); part(g, -7 + lean, hy - 3, 15, 2, '#1c1c26'); } break;                                                   // bowler
      default: break;
    }
    // front arm
    if(o.armsUp){ part(g, 5, -36, 3, 15, body); part(g, 5, -39, 3, 3, skin); }
    else if(o.punch){ part(g, 4, -19 + bob, 13, 4, body, bodyL, bodyD); part(g, 16, -21 + bob, 6, 6, skin, skinL, skinD); rect(g, 17, -19 + bob, 4, 1, skinD); }
    else if(o.waving){ var wv = Math.floor(t * 8) % 2; part(g, 5, -30 + bob, 3, 10, body); part(g, 5 + wv, -33 + bob, 4, 4, skin); }
    else { part(g, 5 - swing, -21 + bob, 3, 10, body); part(g, 5 - swing, -12 + bob, 3, 3, skin); }
  }
  function drawBubble(g, kind, cx, ty, t){
    var w = kind === 'zzz' ? 19 : 17, x = Math.round(cx - w / 2), y = ty - 15 - Math.round(Math.sin(t * 6) * 1);
    rect(g, x - 1, y - 1, w + 2, 13, OUT); rect(g, x, y, w, 11, '#fbf6ea'); rect(g, x, y + 10, w, 1, '#d9d0bc'); rect(g, cx - 2, y + 11, 5, 2, OUT); rect(g, cx - 1, y + 11, 3, 1, '#fbf6ea');
    if(kind === 'heart'){ rect(g, x + 4, y + 2, 3, 3, '#d93a4a'); rect(g, x + 10, y + 2, 3, 3, '#d93a4a'); rect(g, x + 3, y + 3, 11, 3, '#d93a4a'); rect(g, x + 4, y + 6, 9, 1, '#d93a4a'); rect(g, x + 5, y + 7, 7, 1, '#d93a4a'); rect(g, x + 7, y + 8, 3, 1, '#d93a4a'); rect(g, x + 5, y + 3, 2, 1, '#ff8a96'); }
    else if(kind === 'wave') drawTextCentered(g, 'HI!', cx, y + 3, '#3a2a18', 1);
    else if(kind === 'laugh') drawTextCentered(g, 'HA HA', cx, y + 3, '#3a2a18', 1);
    else if(kind === 'bang') drawTextCentered(g, '!', cx, y + 3, '#c93a2a', 1);
    else drawTextCentered(g, 'ZZZ', cx, y + 3, '#3a4a8a', 1);
  }
  function drawCrown(g, cx, y, n){
    rect(g, cx - 7, y - 1, 15, 9, OUT);
    rect(g, cx - 6, y + 3, 13, 4, '#f4c840'); rect(g, cx - 6, y, 3, 4, '#f4c840'); rect(g, cx - 1, y - 1, 3, 5, '#f4c840'); rect(g, cx + 4, y, 3, 4, '#f4c840');
    rect(g, cx - 6, y + 3, 13, 1, '#ffe888'); rect(g, cx - 6, y + 6, 13, 1, '#c8961c');
    rect(g, cx - 1, y + 4, 3, 2, '#d93a4a'); rect(g, cx - 5, y + 4, 2, 2, '#3a8ae8'); rect(g, cx + 4, y + 4, 2, 2, '#3ac878');
    if(n > 0) drawText(g, String(n), cx + 9, y + 1, '#ffe888', 1, OUT);
  }
  function drawStars(g, cx, cy, t){
    for(var i = 0; i < 3; i++){ var a = t * 5 + i * 2.1, sx = Math.round(cx + Math.cos(a) * 9), sy = Math.round(cy + Math.sin(a) * 2); rect(g, sx - 1, sy, 3, 1, '#f4d878'); rect(g, sx, sy - 1, 1, 3, '#f4d878'); }
  }

  // ------------------------------------------------------------------ audio: chiptune music + sound effects
  var audio = { ctx: null, master: null, musicGain: null, timer: null, nextTime: 0, step: 0, musicOn: true, started: false };
  try{ audio.musicOn = localStorage.getItem(MUSIC_KEY) !== '0'; }catch(e){}
  function soundMuted(){ try{ return !!(window.SoundFX && SoundFX.isMuted && SoundFX.isMuted()); }catch(e){ return false; } }
  function soundVol(){ try{ return (window.SoundFX && SoundFX.getVolume) ? SoundFX.getVolume() : 0.8; }catch(e){ return 0.8; } }
  function ac(){
    if(!audio.ctx){
      var AC = window.AudioContext || window.webkitAudioContext; if(!AC) return null;
      try{ audio.ctx = new AC(); }catch(e){ return null; }
      audio.master = audio.ctx.createGain(); audio.master.gain.value = 1; audio.master.connect(audio.ctx.destination);
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
      case 'punch': noise(t, 0.07, 0.22 * v, 600); tone(190, t, 0.07, 'square', 0.10 * v, 90); break;
      case 'hit': noise(t, 0.12, 0.34 * v, 300); tone(140, t, 0.12, 'square', 0.16 * v, 55); break;
      case 'ko': tone(330, t, 0.45, 'square', 0.15 * v, 70); noise(t, 0.3, 0.25 * v, 200); break;
      case 'grab': tone(300, t, 0.05, 'square', 0.12 * v); tone(450, t + 0.06, 0.07, 'square', 0.12 * v); break;
      case 'throw': noise(t, 0.35, 0.18 * v, 1200); tone(240, t, 0.35, 'triangle', 0.14 * v, 640); break;
      case 'land': noise(t, 0.12, 0.28 * v, 150); tone(110, t, 0.14, 'triangle', 0.2 * v, 50); break;
      case 'out': tone(520, t, 0.5, 'square', 0.13 * v, 80); noise(t + 0.05, 0.4, 0.2 * v, 250); break;
      case 'streak': [523, 659, 784, 1047].forEach(function(f, i){ tone(f, t + i * 0.07, 0.12, 'square', 0.12 * v); }); break;
      case 'crown': [784, 988, 1175, 1568].forEach(function(f, i){ tone(f, t + i * 0.09, 0.2, 'triangle', 0.16 * v); }); break;
      case 'kick': noise(t, 0.05, 0.2 * v, 900); tone(220, t, 0.08, 'triangle', 0.16 * v, 120); break;
      case 'jump': tone(260, t, 0.12, 'square', 0.07 * v, 520); break;
      case 'emote': tone(880, t, 0.07, 'square', 0.08 * v); tone(1175, t + 0.06, 0.08, 'square', 0.08 * v); break;
      case 'join': tone(392, t, 0.08, 'square', 0.1 * v); tone(587, t + 0.08, 0.12, 'square', 0.1 * v); break;
    }
  }
  // 4-bar funky loop in A minor, 16 steps a bar, ~124 bpm
  var BASS = [[0,null,0,null,0,null,3,null,5,null,5,null,7,null,5,3], [0,null,0,null,0,null,3,null,5,null,7,null,5,null,3,null], [-4,null,-4,null,-4,null,-1,null,0,null,0,null,-2,null,-4,-2], [-2,null,-2,null,-2,null,1,null,3,null,3,null,5,null,3,1]];
  var LEAD = [[12,null,null,15,null,12,null,10,null,null,12,null,15,null,17,null], [19,null,17,null,15,null,12,null,null,12,15,null,17,null,null,null], [8,null,null,12,null,8,null,7,null,null,8,null,12,null,14,null], [10,null,12,null,14,null,15,null,17,null,15,null,14,null,12,10]];
  function midiHz(semi, base){ return base * Math.pow(2, semi / 12); }
  function scheduleMusic(){
    var c = audio.ctx; if(!c || !audio.started) return;
    var stepDur = 60 / 124 / 4;
    var master = (audio.musicOn && !soundMuted()) ? 0.17 * soundVol() : 0;
    audio.musicGain.gain.setTargetAtTime(master, c.currentTime, 0.05);
    while(audio.nextTime < c.currentTime + 0.18){
      var bar = Math.floor(audio.step / 16) % 4, s = audio.step % 16, t = audio.nextTime;
      if(master > 0){
        var b = BASS[bar][s]; if(b !== null) tone(midiHz(b, 55), t, stepDur * 1.8, 'triangle', 0.55, null, audio.musicGain);
        var l = LEAD[bar][s]; if(l !== null) tone(midiHz(l, 220), t, stepDur * 1.5, 'square', 0.13, null, audio.musicGain);
        if(s === 0 || s === 8 || s === 10) tone(130, t, 0.12, 'sine', 0.7, 42, audio.musicGain);
        if(s === 4 || s === 12) noise(t, 0.1, 0.35, 1500, audio.musicGain);
        if(s % 2 === 0) noise(t, 0.03, 0.12, 6000, audio.musicGain);
      }
      audio.nextTime += stepDur; audio.step++;
    }
  }
  function startMusic(){
    var c = ac(); if(!c || audio.started) return;
    audio.started = true; audio.nextTime = c.currentTime + 0.1; audio.step = 0;
    audio.timer = setInterval(scheduleMusic, 40);
  }
  function stopMusic(){ if(audio.timer){ clearInterval(audio.timer); audio.timer = null; } audio.started = false; if(audio.musicGain && audio.ctx) audio.musicGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05); }

  // ------------------------------------------------------------------ game state
  var S = { joined: false, me: null, roster: {}, render: {}, ball: { x: 150, y: 3, rx: 150, ry: 3 }, crown: null, effects: [], flash: {}, shake: 0, shakeMag: 0, lastSnap: 0, time: 0, enabled: true };
  var el = {}, ctx2d = null, raf = 0, lastFrame = 0, sendTimer = null;
  var input = { left: false, right: false, act: 0, jump: 0, emote: null, lastSent: '', lastSentAt: 0, touchL: false, touchR: false };

  function sendWS2(o){ try{ if(window.sendWS) window.sendWS(o); }catch(e){} }
  function fxText(x, y, text, color, sc){ S.effects.push({ k: 'text', x: x, y: y, vy: -22, text: text, color: color || '#f4d878', life: 0.9, sc: sc || 1 }); }
  function fxSparks(x, y, n, color){ for(var i = 0; i < n; i++) S.effects.push({ k: 'spark', x: x, y: y, vx: (Math.random() - 0.5) * 90, vy: -20 - Math.random() * 60, life: 0.45, color: color || '#fff2b0' }); }
  function fxDust(x, y){ for(var i = 0; i < 5; i++) S.effects.push({ k: 'spark', x: x, y: y, vx: (Math.random() - 0.5) * 40, vy: -8 - Math.random() * 14, life: 0.4, color: '#b8b2a4' }); }
  function nameOf(id){ var r = S.roster[id]; return r ? r.name : 'SOMEONE'; }
  function pxOf(id){ var p = S.render[id]; return p ? p : null; }

  function handleEvents(events){
    if(!events) return;
    events.forEach(function(ev){
      var p = pxOf(ev.id);
      switch(ev.e){
        case 'punch': sfx('punch'); break;
        case 'hit': sfx('hit'); S.flash[ev.id] = S.time + 0.12; if(p){ fxSparks(p.x, GY - p.y - 22, 6); fxText(p.x, GY - p.y - 52, 'POW!', '#fff2b0', 2); } break;
        case 'ko': sfx('ko'); S.shake = S.time + 0.25; S.shakeMag = 2; if(p) fxText(p.x, GY - p.y - 56, 'K.O.!', '#ff6a5a', 2); break;
        case 'grab': sfx('grab'); break;
        case 'throw': sfx('throw'); break;
        case 'land': sfx('land'); if(p) fxDust(p.x, GY); break;
        case 'out':
          sfx('out'); S.shake = S.time + 0.3; S.shakeMag = 3;
          if(p) fxText(p.x, GY - p.y - 56, 'OUT!', '#ff6a5a', 2);
          break;
        case 'streak': sfx('streak'); if(S.render[ev.id]) fxText(S.render[ev.id].x, GY - 70, '+1  x' + ev.n, '#f4d878', 2); break;
        case 'crown': sfx('crown'); break;
        case 'kick': sfx('kick'); break;
        case 'jump': if(p){ fxDust(p.x, GY); } if(ev.id === S.me) sfx('jump'); break;
        case 'emote': sfx('emote'); break;
        case 'drop': break;
      }
    });
  }

  function applySnap(snap){
    S.lastSnap = S.time; S.crown = snap.crown || null;
    var seen = {};
    snap.players.forEach(function(p){
      seen[p.i] = true;
      var r = S.render[p.i];
      if(!r){ r = S.render[p.i] = { id: p.i, x: p.x, y: p.y, tx: p.x, ty: p.y, f: p.f || 1, s: 0, st: 0 }; }
      r.tx = p.x; r.ty = p.y; r.f = p.f; r.s = p.s; r.h = p.h; r.c = p.c || null; r.st = p.st || 0; r.e = p.e === undefined ? -1 : p.e; r.punch = !!p.p; r.moving = !!p.m;
    });
    Object.keys(S.render).forEach(function(id){ if(!seen[id]) delete S.render[id]; });
    if(snap.ball){ S.ball.tx = snap.ball.x; S.ball.ty = snap.ball.y; }
    handleEvents(snap.events);
  }

  // ------------------------------------------------------------------ drawing
  function ringElevation(x){ var l = Math.max(0, Math.min(1, (x - RING.x) / 6)), r = Math.max(0, Math.min(1, (RING.x + RING.w - x) / 6)); return 8 * Math.min(l, r); }
  var dust = []; (function(){ var r = rng(31); for(var i = 0; i < 26; i++) dust.push({ x: r() * W, y: 60 + r() * 130, s: 0.5 + r(), p: r() * 6 }); })();

  function drawPlayer(g, r, roster, isMe){
    var info = roster[r.id] || { id: r.id, name: '?', color: '#c8873a', g: 'm', hat: 0 };
    var p = { id: r.id, color: info.color, g: info.g, hat: info.hat };
    var x = Math.round(r.x), elev = ringElevation(r.x), fy = GY - Math.round(r.y) - Math.round(elev);
    if(r.s === STATE.held) return;                               // drawn with whoever is carrying them
    // soft shadow on the platform / ground
    var sh = Math.max(5, 14 - Math.round(r.y / 5));
    g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(x - sh / 2, GY - Math.round(elev), sh, 2); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - sh / 2 - 2, GY - Math.round(elev), sh + 4, 1);
    g.save(); g.translate(x, fy);
    var flip = r.f < 0 ? -1 : 1;
    var blink = (Math.floor(S.time * 1.3 + hashStr(r.id)) % 7 === 0) && ((S.time * 10) % 1 < 0.5);
    var o = { time: S.time, walking: r.moving && r.s === STATE.idle && r.y < 2, air: r.y >= 2, punch: r.punch, dead: false, dizzy: false, armsUp: !!r.c, waving: r.e === 0, blink: blink && r.s === STATE.idle, happy: r.e === 1 || r.e === 2, hurt: S.flash[r.id] > S.time, angry: r.punch };
    if(r.s === STATE.ko || r.s === STATE.out){
      o.dead = r.s === STATE.ko; o.dizzy = r.s === STATE.out; g.scale(flip, 1); g.translate(0, -3); g.rotate(-Math.PI / 2); g.translate(0, -2);
      drawFigure(g, p, o);
    } else if(r.s === STATE.thrown){
      o.hurt = true; g.translate(0, -14); g.rotate(S.time * 11 * flip); g.translate(0, 14); g.scale(flip, 1); drawFigure(g, p, o);
    } else {
      g.scale(flip, 1); drawFigure(g, p, o);
    }
    g.restore();
    // the player they are carrying, lying across the raised hands
    if(r.c && S.render[r.c]){
      var hi = roster[r.c] || { id: r.c, color: '#c8873a', g: 'm', hat: 0 };
      g.save(); g.translate(x, fy - 41); g.scale(flip, 1); g.rotate(-Math.PI / 2); g.translate(0, 3);
      drawFigure(g, { id: r.c, color: hi.color, g: hi.g, hat: hi.hat }, { time: S.time, dead: true });
      g.restore();
    }
    if(S.flash[r.id] && S.flash[r.id] > S.time){ g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x - 7, fy - 34, 14, 34); }
    if(r.s === STATE.out || r.s === STATE.ko) drawStars(g, x, fy - 14, S.time);
    // name tag, crown, emote
    var top = fy - (r.c ? 62 : 44);
    var label = String(info.name || '?').slice(0, 10);
    var tw = textWidth(label, 1);
    rect(g, x - Math.ceil(tw / 2) - 3, top - 10, tw + 5, 9, 'rgba(14,10,8,0.62)');
    drawTextCentered(g, label, x, top - 8, isMe ? '#ffe9a0' : '#f4f0e6', 1);
    if(S.crown === r.id) drawCrown(g, x - (r.st > 9 ? 3 : 0), top - 21, r.st);
    else if(r.st > 0) drawText(g, 'x' + r.st, x + Math.ceil(tw / 2) + 5, top - 8, '#ffe888', 1, OUT);
    if(r.e >= 0) drawBubble(g, EMOTES[r.e], x, top - (S.crown === r.id ? 24 : 10), S.time);
    if(isMe){ rect(g, x - 2, top + 0, 5, 1, '#ffe9a0'); rect(g, x - 1, top + 1, 3, 1, '#ffe9a0'); rect(g, x, top + 2, 1, 1, '#ffe9a0'); }
  }

  function drawAmbient(g){
    var t = S.time;
    // sweeping searchlight from the left tower
    var ang = 0.55 + Math.sin(t * 0.45) * 0.38, len = 230;
    g.save(); g.globalCompositeOperation = 'lighter';
    var sx = 66, sy = 64, ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
    var gr = g.createLinearGradient(sx, sy, ex, ey); gr.addColorStop(0, 'rgba(255,240,190,0.20)'); gr.addColorStop(1, 'rgba(255,240,190,0.02)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex + Math.sin(ang) * 22, ey - Math.cos(ang) * 22); g.lineTo(ex - Math.sin(ang) * 22, ey + Math.cos(ang) * 22); g.closePath(); g.fill();
    // burning barrel by the drums: flickering flame and glow
    var fl = 0.8 + Math.sin(t * 21) * 0.1 + Math.sin(t * 13.3) * 0.1;
    lightPool(g, 222, GY - 22, 44 * fl, '255,150,50', 0.20 * fl);
    g.restore();
    for(var i = 0; i < 6; i++){
      var h = 3 + Math.round(Math.abs(Math.sin(t * 9 + i * 1.7)) * 5), fx = 217 + i * 2;
      rect(g, fx, GY - 21 - h, 2, h, i % 2 ? '#ff9a2a' : '#ffd24a'); rect(g, fx, GY - 21 - h, 2, 2, '#ffee9a');
    }
    // dust motes drifting in the light
    dust.forEach(function(d){ var dx = (d.x + t * 5 * d.s) % W, dy = d.y + Math.sin(t * 0.8 + d.p) * 4; g.fillStyle = 'rgba(255,236,200,' + (0.12 + 0.12 * Math.sin(t + d.p)) + ')'; g.fillRect(Math.round(dx), Math.round(dy), 1, 1); });
  }

  function draw(g){
    var sh = 0; if(S.shake > S.time) sh = Math.round((Math.random() - 0.5) * 2 * S.shakeMag);
    g.save(); g.translate(sh, 0);
    g.drawImage(sceneCanvas, 0, 0);
    drawAmbient(g);
    drawRopes(g);
    // ball
    var b = S.ball; var bx = Math.round(b.x), by = GY - Math.round(b.y) - Math.round(ringElevation(b.x));
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(bx - 4, GY - Math.round(ringElevation(b.x)), 9, 1);
    rect(g, bx - 5, by - 9, 10, 10, OUT); rect(g, bx - 4, by - 8, 8, 8, '#f07a30'); rect(g, bx - 4, by - 5, 8, 1, '#8a3a12'); rect(g, bx, by - 8, 1, 8, '#8a3a12'); rect(g, bx - 3, by - 7, 2, 2, '#ffb078'); rect(g, bx + 2, by - 3, 2, 2, '#c85a1c');
    // players, back to front by height so airborne ones sit on top
    var ids = Object.keys(S.render).sort(function(a, c){ return S.render[a].y - S.render[c].y; });
    ids.forEach(function(id){ drawPlayer(g, S.render[id], S.roster, id === S.me); });
    // effects
    S.effects.forEach(function(e){
      if(e.k === 'text') drawTextCentered(g, e.text, Math.round(e.x), Math.round(e.y), e.color, e.sc || 1, OUT);
      else { g.fillStyle = e.color; g.fillRect(Math.round(e.x), Math.round(e.y), 2, 2); }
    });
    // header strip: who holds the ring
    g.fillStyle = 'rgba(16,11,8,0.80)'; g.fillRect(0, 0, W, 14); g.fillStyle = '#7a5a2c'; g.fillRect(0, 14, W, 1);
    if(S.crown && S.roster[S.crown]){
      drawCrown(g, 13, 3, 0);
      drawText(g, String(S.roster[S.crown].name).slice(0, 12), 26, 4, '#f4d878', 1);
      var kr = S.render[S.crown]; drawText(g, 'STREAK ' + (kr ? kr.st : 0), 26 + textWidth(String(S.roster[S.crown].name).slice(0, 12), 1) + 8, 4, '#e8e0d0', 1);
    } else drawText(g, 'THE RING IS OPEN - WALK IN TO FIGHT', 8, 4, '#e8e0d0', 1);
    var count = Object.keys(S.render).length; drawText(g, count + ' IN THE YARD', W - 6 - textWidth(count + ' IN THE YARD', 1), 4, '#9ad0a0', 1);
    // contextual hint for the local player
    var me = S.render[S.me];
    if(me){
      var hint = null;
      if(me.c) hint = 'THROW: ACTION - AIM AT THE ROPES';
      else if(me.x >= RING.x && me.x <= RING.x + RING.w){
        var downNear = Object.keys(S.render).some(function(id){ var o = S.render[id]; return id !== S.me && o.s === STATE.ko && Math.abs(o.x - me.x) < 20; });
        hint = downNear ? 'ACTION: PICK THEM UP' : 'IN THE RING: ACTION TO PUNCH';
      }
      if(me.s === STATE.ko) hint = 'KNOCKED OUT...';
      if(hint){ var hw = textWidth(hint, 1); rect(g, Math.round(W / 2 - hw / 2) - 4, H - 14, hw + 8, 10, 'rgba(14,10,8,0.7)'); drawTextCentered(g, hint, W / 2, H - 12, '#ffffff', 1); }
    }
    g.restore();
  }

  function frame(now){
    raf = requestAnimationFrame(frame);
    if(!S.joined || !ctx2d) return;
    var dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; S.time += dt;
    var k = 1 - Math.exp(-dt * 20);
    Object.keys(S.render).forEach(function(id){ var r = S.render[id]; r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; if(Math.abs(r.tx - r.x) > 60) r.x = r.tx; });
    if(S.ball.tx !== undefined){ S.ball.x += (S.ball.tx - S.ball.x) * k; S.ball.y += (S.ball.ty - S.ball.y) * k; }
    S.effects.forEach(function(e){ e.life -= dt; if(e.k === 'text'){ e.y += e.vy * dt; } else { e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 180 * dt; } });
    S.effects = S.effects.filter(function(e){ return e.life > 0; });
    draw(ctx2d);
  }

  // ------------------------------------------------------------------ input
  function typing(e){ var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  function keyState(e, down){
    if(!S.joined || typing(e)) return;
    var key = e.key, used = true;
    if(key === 'ArrowLeft' || key === 'a' || key === 'A') input.left = down;
    else if(key === 'ArrowRight' || key === 'd' || key === 'D') input.right = down;
    else if(key === 'ArrowUp' || key === 'w' || key === 'W' || key === ' '){ if(down && !e.repeat) input.jump++; }
    else if(key === 'j' || key === 'J' || key === 'z' || key === 'Z' || key === 'e' || key === 'E' || key === 'Enter'){ if(down && !e.repeat) input.act++; }
    else if(down && key >= '1' && key <= '5' && !e.repeat) input.emote = EMOTES[Number(key) - 1];
    else used = false;
    if(used){ e.preventDefault(); ensureAudio(); pushInput(); }
  }
  function pushInput(force){
    if(!S.joined) return;
    var mx = (input.right || input.touchR ? 1 : 0) - (input.left || input.touchL ? 1 : 0);
    var sig = mx + '|' + input.act + '|' + input.jump + '|' + (input.emote || '');
    var now = Date.now();
    if(!force && sig === input.lastSent && now - input.lastSentAt < 400) return;
    input.lastSent = sig; input.lastSentAt = now;
    var msg = { type: 'yardInput', mx: mx, act: input.act, jump: input.jump };
    if(input.emote){ msg.emote = input.emote; input.emote = null; input.lastSent = mx + '|' + input.act + '|' + input.jump + '|'; }
    sendWS2(msg);
  }
  function ensureAudio(){ try{ if(!audio.started) startMusic(); else ac(); }catch(e){} }

  function bindHold(btn, down, up){
    if(!btn) return;
    function on(e){ e.preventDefault(); down(); btn.classList.add('is-down'); ensureAudio(); pushInput(); }
    function off(e){ if(e) e.preventDefault(); up(); btn.classList.remove('is-down'); pushInput(); }
    btn.addEventListener('pointerdown', on); btn.addEventListener('pointerup', off); btn.addEventListener('pointerleave', off); btn.addEventListener('pointercancel', off);
    btn.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  }

  // ------------------------------------------------------------------ show / hide
  function fitCanvas(){
    if(!el.canvas || !el.stage) return;
    var avail = el.stage.clientWidth || 800;
    var scale = avail >= W * 2 ? Math.min(3, Math.floor(avail / W)) : avail / W;
    el.canvas.style.width = Math.round(W * scale) + 'px'; el.canvas.style.height = Math.round(H * scale) + 'px';
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

  var HCYard = {
    init: function(){
      el.card = document.getElementById('yard-card'); if(!el.card) return;
      el.joinBtn = document.getElementById('yard-join-btn'); el.leaveBtn = document.getElementById('yard-leave-btn'); el.stage = document.getElementById('yard-stage');
      el.canvas = document.getElementById('yard-canvas'); el.controls = document.getElementById('yard-controls'); el.musicBtn = document.getElementById('yard-music-btn');
      el.toggle = document.getElementById('yard-host-toggle'); el.toggleWrap = document.getElementById('yard-host-toggle-wrap');
      ctx2d = el.canvas.getContext('2d'); ctx2d.imageSmoothingEnabled = false;
      buildScene();
      el.joinBtn.addEventListener('click', function(){ ensureAudio(); sendWS2({ type: 'yardJoin' }); });
      el.leaveBtn.addEventListener('click', function(){ sendWS2({ type: 'yardLeave' }); });
      el.musicBtn.addEventListener('click', function(){ audio.musicOn = !audio.musicOn; try{ localStorage.setItem(MUSIC_KEY, audio.musicOn ? '1' : '0'); }catch(e){} setMusicLabel(); if(audio.musicOn) ensureAudio(); });
      if(el.toggle) el.toggle.addEventListener('change', function(){ sendWS2({ type: 'yardToggle', enabled: !!el.toggle.checked }); });
      bindHold(document.getElementById('yard-btn-left'), function(){ input.touchL = true; }, function(){ input.touchL = false; });
      bindHold(document.getElementById('yard-btn-right'), function(){ input.touchR = true; }, function(){ input.touchR = false; });
      bindHold(document.getElementById('yard-btn-jump'), function(){ input.jump++; }, function(){});
      bindHold(document.getElementById('yard-btn-act'), function(){ input.act++; }, function(){});
      document.querySelectorAll('.yard-emote-btn').forEach(function(b){ b.addEventListener('click', function(){ input.emote = b.getAttribute('data-emote'); ensureAudio(); pushInput(true); }); });
      window.addEventListener('keydown', function(e){ keyState(e, true); });
      window.addEventListener('keyup', function(e){ keyState(e, false); });
      window.addEventListener('blur', function(){ input.left = input.right = input.touchL = input.touchR = false; pushInput(true); });
      window.addEventListener('resize', fitCanvas);
      sendTimer = setInterval(function(){ pushInput(); }, 120);
      setMusicLabel(); setJoinedUI(false);
      lastFrame = performance.now(); raf = requestAnimationFrame(frame);
    },
    onMessage: function(msg){
      if(!el.card) return;
      if(msg.type === 'yardJoined'){ S.joined = true; S.me = msg.you; S.render = {}; S.effects = []; setJoinedUI(true); sfx('join'); startMusic(); input.lastSent = ''; pushInput(true); }
      else if(msg.type === 'yardRoster'){ S.roster = {}; msg.players.forEach(function(p){ S.roster[p.id] = p; }); }
      else if(msg.type === 'yardSnap'){ if(S.joined) applySnap(msg); }
      else if(msg.type === 'yardEnded'){ HCYard.stop(); }
    },
    setLobby: function(enabled, isHost){
      if(!el.card) return;
      S.enabled = enabled !== false;
      el.card.style.display = '';
      if(el.toggleWrap) el.toggleWrap.style.display = isHost ? '' : 'none';
      if(el.toggle) el.toggle.checked = S.enabled;
      var off = document.getElementById('yard-off-note'); if(off) off.style.display = S.enabled ? 'none' : '';
      if(el.joinBtn) el.joinBtn.disabled = !S.enabled;
      if(!S.enabled && S.joined) HCYard.stop();
    },
    stop: function(){
      if(!el.card) return;
      S.joined = false; S.render = {}; S.effects = []; S.crown = null;
      input.left = input.right = input.touchL = input.touchR = false;
      stopMusic(); setJoinedUI(false);
    },
    isJoined: function(){ return S.joined; }
  };
  window.HCYard = HCYard;
})();
