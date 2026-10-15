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


  // ------------------------------------------------------------------ the dungeon: one theme, textured and lit
  var DG = { wall: '#2c2f3e', wallHi: '#3a3e52', wallLo: '#1c1e2a', mortar: '#15161f', brick: '#575b72', brickHi: '#7a7f9a', brickLo: '#383b4e', moss: '#4f7a46' };
  function drawBrick(g, x, y, upOpen, leftOpen, rightOpen, downOpen, seed, ceiling){
    var r = rng(seed), base = ceiling ? '#4a4d62' : DG.brick, hi = ceiling ? '#666a84' : DG.brickHi, lo = ceiling ? '#30323f' : DG.brickLo;
    rect(g, x, y, TILE, TILE, base);
    for(var i = 0; i < 8; i++) rect(g, x + Math.floor(r() * 14), y + Math.floor(r() * 14), 1 + Math.floor(r() * 2), 1, r() < 0.5 ? hi : lo);
    rect(g, x, y + 7, TILE, 1, lo); rect(g, x + ((seed & 1) ? 5 : 10), y, 1, 7, lo); rect(g, x + ((seed & 2) ? 4 : 11), y + 8, 1, 8, lo);
    rect(g, x, y, TILE, 1, hi); rect(g, x, y + 8, TILE, 1, hi);
    if(upOpen){ rect(g, x, y, TILE, 2, hi); rect(g, x, y + 2, TILE, 1, lo); if(r() < 0.5) rect(g, x + Math.floor(r() * 12), y - 1, 3, 1, DG.moss); }
    if(downOpen){ rect(g, x, y + TILE - 2, TILE, 2, lo); }
    if(leftOpen) rect(g, x, y, 1, TILE, hi); if(rightOpen) rect(g, x + TILE - 1, y, 1, TILE, lo);
  }
  function drawSpike(g, x, y){
    for(var i = 0; i < 3; i++){
      var sx = x + 1 + i * 5;
      rect(g, sx, y + 12, 5, 4, '#4a4e5c'); rect(g, sx + 1, y + 8, 3, 4, '#a8aebd'); rect(g, sx + 2, y + 5, 1, 3, '#e6eaf2'); rect(g, sx + 1, y + 8, 1, 4, '#d0d5e2'); rect(g, sx + 3, y + 9, 1, 3, '#7a8090');
    }
  }
  var spikeSpr = null;
  function flingSprite(){
    if(spikeSpr) return spikeSpr;
    var c = document.createElement('canvas'); c.width = 20; c.height = 12; var q = c.getContext('2d'); q.imageSmoothingEnabled = false;
    rect(q, 2, 2, 16, 8, OUT); rect(q, 3, 3, 5, 6, '#6a6f80');                                       // shaft
    rect(q, 8, 3, 4, 6, '#aab0c0'); rect(q, 12, 4, 4, 4, '#d4d9e6'); rect(q, 15, 5, 3, 2, '#f2f5fa'); rect(q, 3, 3, 14, 1, '#8a90a2');
    spikeSpr = c; return c;
  }
  var art = null;
  function buildArt(li){
    if(art && art.li === li) return art;
    var level = Sim.LEVELS[li], W = VW, H = VH;
    var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    // back wall: big irregular stone blocks
    rect(g, 0, 0, W, H, DG.mortar);
    var R = rng(li * 131 + 17);
    for(var row = 0; row * 14 < H; row++){
      var yy = row * 14, off = (row % 2) * 12;
      for(var bx = -off; bx < W; bx += 24){
        var w = 22 + Math.floor(R() * 3), shadeN = 0.9 + R() * 0.25;
        rect(g, bx + 1, yy + 1, w, 12, shade(DG.wall, shadeN)); rect(g, bx + 1, yy + 1, w, 1, 'rgba(255,255,255,0.05)'); rect(g, bx + 1, yy + 12, w, 1, 'rgba(0,0,0,0.25)');
        if(R() < 0.25) rect(g, bx + 3 + Math.floor(R() * (w - 6)), yy + 3 + Math.floor(R() * 7), 2 + Math.floor(R() * 3), 1, 'rgba(255,255,255,0.07)');
      }
    }
    // stains and moss on the back wall
    for(var st = 0; st < 22; st++){ var sx = Math.floor(R() * W), sy = 20 + Math.floor(R() * 120), ln = 10 + Math.floor(R() * 40); rect(g, sx, sy, 2, ln, 'rgba(10,12,20,0.30)'); }
    for(var m = 0; m < 40; m++){ var mx = Math.floor(R() * W), my = 150 + Math.floor(R() * 90); rect(g, mx, my, 2 + Math.floor(R() * 3), 1 + Math.floor(R() * 2), 'rgba(80,120,70,0.28)'); }
    // barred window slits with a little moonlight, and a skull shelf (purely decorative)
    [70, 330].forEach(function(wx){ rect(g, wx - 7, 70, 14, 24, '#0d0e16'); rect(g, wx - 6, 71, 12, 22, '#2a3a58'); rect(g, wx - 6, 71, 12, 4, '#4a6a98'); for(var b2 = 0; b2 < 3; b2++) rect(g, wx - 4 + b2 * 4, 70, 2, 24, '#15161f'); rect(g, wx - 7, 80, 14, 2, '#15161f'); });
    // static tiles
    for(var ty = 0; ty < level.h; ty++) for(var tx = 0; tx < level.w; tx++){
      var t = level.grid[ty * level.w + tx];
      if(t === 1){
        var solidAt = function(x, y){ return Sim.tileAt(level, x, y) === 1; };
        drawBrick(g, tx * TILE, ty * TILE, !solidAt(tx, ty - 1), !solidAt(tx - 1, ty), !solidAt(tx + 1, ty), !solidAt(tx, ty + 1), tx * 73 + ty * 31, ty <= 1);
      } else if(t === 2 || t === 3) drawSpike(g, tx * TILE, ty * TILE);
    }
    // slime drips under the ceiling, cobwebs in the corners
    for(var d = 0; d < 9; d++){ var dx = 20 + Math.floor(R() * (W - 40)); rect(g, dx, 32, 1, 3 + Math.floor(R() * 5), 'rgba(120,200,110,0.55)'); }
    for(var cw = 0; cw < 8; cw++){ rect(g, 16 + cw, 32 + cw, 1, 1, 'rgba(230,230,240,0.32)'); rect(g, W - 17 - cw, 32 + cw, 1, 1, 'rgba(230,230,240,0.32)'); rect(g, 16, 32 + cw, 3 - Math.floor(cw / 3), 1, 'rgba(230,230,240,0.22)'); }
    // bones by the wall
    rect(g, 6, 236, 6, 2, '#d8d2bc'); rect(g, 4, 235, 3, 3, '#d8d2bc'); rect(g, 9, 237, 5, 1, '#b8b29c');
    art = { li: li, canvas: c, torches: [[56, 150], [200, 130], [344, 150]] };
    return art;
  }
  function lightPool(g, x, y, r, col, a){
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + col + ',' + a + ')'); gr.addColorStop(0.5, 'rgba(' + col + ',' + (a * 0.35) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function drawTorch(g, x, y, t){
    rect(g, x - 1, y, 3, 10, '#2a1a10'); rect(g, x - 3, y - 2, 7, 3, '#5a5f70'); rect(g, x - 2, y - 3, 5, 1, '#7a7f90');
    var fl = 3 + Math.round(Math.abs(Math.sin(t * 9 + x)) * 3);
    rect(g, x - 2, y - 3 - fl, 5, fl, '#e8581a'); rect(g, x - 1, y - 3 - fl - 1, 3, fl, '#ffa02a'); rect(g, x, y - 3 - Math.floor(fl * 0.7), 1, Math.floor(fl * 0.7), '#fff0a0');
  }

  // ------------------------------------------------------------------ sprites
  var SKINS = ['#f4d0a8', '#e0aa7c', '#b9825a', '#8c5a3c', '#6a4028'];
  var HAIRS = ['#241812', '#4a2e1c', '#7a5a30', '#35353a', '#a8501f', '#c8b070'];
  var SPRITE_SCALE = 0.62, sprBuf = null, sprCtx = null;
  function explorer(g, x, y, o){
    if(!sprBuf){ sprBuf = document.createElement('canvas'); sprBuf.width = 64; sprBuf.height = 64; sprCtx = sprBuf.getContext('2d'); sprCtx.imageSmoothingEnabled = false; }
    sprCtx.clearRect(0, 0, 64, 64);
    var o2 = {}; for(var k in o) o2[k] = o[k]; o2.alpha = 1;
    explorerRaw(sprCtx, 32, 44, o2);
    g.save(); g.globalAlpha = o.alpha === undefined ? 1 : o.alpha; g.imageSmoothingEnabled = false;
    g.drawImage(sprBuf, Math.round(x - 32 * SPRITE_SCALE), Math.round(y - 44 * SPRITE_SCALE), Math.round(64 * SPRITE_SCALE), Math.round(64 * SPRITE_SCALE));
    g.restore();
  }
  function explorerRaw(g, x, y, o){
    var hs = hashStr(o.id || 'x'), skin = SKINS[hs % SKINS.length], hair = HAIRS[(hs >> 3) % HAIRS.length], hat = (hs >> 6) % 4;
    var col = o.color || '#c8873a', dk = shade(col, 0.68), lt = shade(col, 1.2);
    g.save(); g.translate(Math.round(x), Math.round(y)); if(o.face < 0) g.scale(-1, 1);
    var duck = o.state === 'duck';
    if(duck) g.scale(1, 0.58);
    var fr = o.state === 'run' ? (Math.floor(o.anim) % 4) : 0, bob = (o.state === 'run' && (fr === 1 || fr === 3)) ? 1 : 0;
    if(o.state === 'dead'){ g.rotate(o.spin || 0); }
    var air = o.state === 'jump';
    if(air){ rect(g, -4, -5, 3, 4, OUT); rect(g, -3, -4, 2, 3, dk); rect(g, 1, -6, 3, 5, OUT); rect(g, 2, -5, 2, 4, dk); }
    else {
      var l1 = fr === 0 ? -3 : fr === 2 ? -1 : -2, l2 = fr === 0 ? 1 : fr === 2 ? -1 : 0;
      rect(g, l1 - 1, -6 + bob, 4, 7 - bob, OUT); rect(g, l1, -5 + bob, 2, 5 - bob, dk); rect(g, l1, -1, 3, 1, '#2a2118');
      rect(g, l2, -6 + bob, 4, 7 - bob, OUT); rect(g, l2 + 1, -5 + bob, 2, 5 - bob, shade(col, 0.8)); rect(g, l2 + 1, -1, 3, 1, '#2a2118');
    }
    var by = -13 + bob;
    rect(g, -5, by - 1, 10, 9, OUT); rect(g, -4, by, 8, 7, col); rect(g, -4, by, 8, 1, lt); rect(g, -4, by + 6, 8, 1, dk); rect(g, 2, by + 1, 2, 5, 'rgba(0,0,0,0.12)'); rect(g, -4, by + 4, 8, 1, '#7a5a30');
    if(o.state === 'jump' || o.state === 'win'){ rect(g, -7, by - 4, 3, 7, OUT); rect(g, -6, by - 3, 1, 5, col); rect(g, 4, by - 4, 3, 7, OUT); rect(g, 5, by - 3, 1, 5, col); rect(g, -6, by - 4, 1, 1, skin); rect(g, 5, by - 4, 1, 1, skin); }
    else { var sw = o.state === 'run' ? (fr === 0 ? 1 : fr === 2 ? -1 : 0) : 0; rect(g, -6 + sw, by, 3, 7, OUT); rect(g, -5 + sw, by + 1, 1, 5, shade(col, 0.85)); rect(g, 3 - sw, by, 3, 7, OUT); rect(g, 4 - sw, by + 1, 1, 5, col); rect(g, -5 + sw, by + 6, 1, 1, skin); rect(g, 4 - sw, by + 6, 1, 1, skin); }
    var hy = by - 10;
    rect(g, -5, hy - 1, 11, 11, OUT); rect(g, -4, hy, 9, 9, skin); rect(g, -4, hy, 9, 1, shade(skin, 1.1)); rect(g, -4, hy + 8, 9, 1, shade(skin, 0.8));
    var eyeY = hy + 4;
    if(o.state === 'dead'){ rect(g, 0, eyeY - 1, 1, 1, OUT); rect(g, 2, eyeY - 1, 1, 1, OUT); rect(g, 1, eyeY, 1, 1, OUT); rect(g, 0, eyeY + 1, 1, 1, OUT); rect(g, 2, eyeY + 1, 1, 1, OUT); rect(g, 1, hy + 7, 3, 1, OUT); }
    else if(o.blink){ rect(g, 0, eyeY, 3, 1, OUT); }
    else { rect(g, 0, eyeY - 1, 3, 3, '#fff'); rect(g, 1, eyeY - 1, 2, 3, OUT); rect(g, 2, eyeY - 1, 1, 1, '#fff'); rect(g, 0, eyeY - 3, 4, 1, hair); }
    rect(g, 5, hy + 5, 1, 2, shade(skin, 0.85));
    if(o.state === 'win') rect(g, 1, hy + 7, 4, 1, OUT); else if(o.state !== 'dead') rect(g, 2, hy + 7, 3, 1, shade(skin, 0.55));
    rect(g, -5, hy - 2, 11, 3, hair); rect(g, -5, hy, 2, 5, hair);
    if(hat === 0){ rect(g, -6, hy - 4, 13, 3, OUT); rect(g, -5, hy - 3, 11, 2, '#e6d6a0'); rect(g, -4, hy - 7, 9, 4, OUT); rect(g, -3, hy - 6, 7, 3, '#e6d6a0'); rect(g, -3, hy - 6, 7, 1, '#fff6d0'); rect(g, -3, hy - 4, 7, 1, '#8a6a3e'); }
    else if(hat === 1){ rect(g, -7, hy - 3, 15, 2, OUT); rect(g, -6, hy - 2, 13, 1, '#5a3e26'); rect(g, -4, hy - 7, 9, 5, OUT); rect(g, -3, hy - 6, 7, 3, '#6a4a30'); rect(g, -3, hy - 4, 7, 1, '#c93a2a'); }
    else if(hat === 2){ rect(g, -5, hy - 2, 11, 3, OUT); rect(g, -4, hy - 1, 9, 2, '#d83a2a'); rect(g, -6, hy, 2, 2, '#d83a2a'); }
    else { rect(g, -5, hy - 4, 11, 3, OUT); rect(g, -4, hy - 3, 9, 2, '#6a7a8a'); rect(g, 3, hy - 2, 5, 2, OUT); rect(g, 3, hy - 2, 5, 1, '#4a5a6a'); }
    g.restore();
  }
  function drawExitDoor(g, x, y, t, open){
    rect(g, x - 13, y - 36, 26, 36, OUT); rect(g, x - 12, y - 35, 24, 35, '#5a3c24'); rect(g, x - 12, y - 35, 24, 2, '#80583a');
    rect(g, x - 10, y - 32, 20, 32, '#1c120a'); rect(g, x - 9, y - 31, 18, 31, '#3c2616');
    for(var i = 0; i < 4; i++) rect(g, x - 9 + i * 5, y - 31, 1, 31, '#2c1a0e');
    rect(g, x - 10, y - 24, 20, 2, '#6a6f80'); rect(g, x - 10, y - 10, 20, 2, '#6a6f80');
    rect(g, x + 4, y - 17, 3, 3, '#e8c060');
    rect(g, x - 11, y - 43, 22, 8, OUT); rect(g, x - 10, y - 42, 20, 6, '#cbbf94'); drawTextC(g, 'EXIT', x, y - 41, '#2a1810', 1);
    var glow = 0.5 + Math.sin(t * 4) * 0.2; g.fillStyle = 'rgba(255,220,140,' + (0.08 * glow) + ')'; g.fillRect(x - 16, y - 46, 32, 46);
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
      case 'thud': noise(t, 0.2, 0.34 * v, 120); tone(90, t, 0.2, 'triangle', 0.26 * v, 40); break;
      case 'smash': noise(t, 0.5, 0.45 * v, 90); tone(70, t, 0.45, 'triangle', 0.4 * v, 30); break;
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
  var S = { joined: false, me: null, roster: {}, ghosts: {}, board: [], run: null, lvl: 0, lives: Sim.LIVES, totalDeaths: 0, time: 0, effects: [], toasts: [], shake: 0, introT: 0, bannerT: 0, banner: '', bannerSub: '', won: false, over: false, overT: 0, runT: 0, lastNet: 0 };
  var el = {}, ctx2d = null, raf = 0, lastFrame = 0, acc = 0;
  var input = { left: false, right: false, jump: false, down: false, touchL: false, touchR: false, touchJ: false, touchD: false };

  function sendWS2(o){ if(S.solo) return; try{ if(window.sendWS) window.sendWS(o); }catch(e){} }
  function toast(text, color){ S.toasts.push({ text: text, life: 4, color: color || '#f4efe0' }); if(S.toasts.length > 4) S.toasts.shift(); }
  function puff(x, y, n, color, spread){ for(var i = 0; i < n; i++) S.effects.push({ x: x, y: y, vx: (Math.random() - 0.5) * (spread || 90), vy: -20 - Math.random() * 80, life: 0.5 + Math.random() * 0.3, color: color || '#f4e8c0' }); }

  function startLevel(li){
    S.lvl = li; S.run = Sim.createRun(li); S.introT = 2.4; S.bannerT = 0; buildArt(li);
  }
  function newGame(){ S.lives = Sim.LIVES; S.totalDeaths = 0; S.won = false; S.over = false; S.overT = 0; S.runT = 0; startLevel(0); }

  function handleEvents(st){
    for(var i = 0; i < st.events.length; i++){
      var e = st.events[i];
      switch(e.e){
        case 'jump': sfx('jump'); puff(st.px, st.py, 3, '#8a8da0', 40); break;
        case 'land': sfx('land'); puff(st.px, st.py, 2, '#8a8da0', 30); break;
        case 'die':
          sfx('die'); S.shake = 0.3; S.totalDeaths++; S.lives = Math.max(0, S.lives - 1); puff(st.px, st.py - 8, 18, '#ffe9a0', 160);
          sendWS2({ type: 'trapDie', msg: e.msg, x: st.px, y: st.py }); break;
        case 'thud': sfx('thud'); S.shake = Math.max(S.shake, 0.15); puff(e.x + 8, e.y + 14, 6, '#8a8da0', 70); break;
        case 'wallbreak': sfx('smash'); S.shake = 0.5; puff(e.x, e.y - 16, 30, '#8a8da0', 220); break;
        case 'finish':
          sfx('finish'); sendWS2({ type: 'trapFinish', lvl: st.lvl });
          if(st.lvl >= Sim.LEVELS.length - 1){ S.won = true; S.banner = 'YOU ESCAPED!'; S.bannerSub = 'DEATHS ' + S.totalDeaths + '   PRESS R OR ENTER TO RUN IT AGAIN'; }
          else { S.banner = 'CHECKPOINT!'; S.bannerSub = ''; }
          S.bannerT = 2.2; break;
      }
    }
    st.events.length = 0;
  }

  function updateGame(dt){
    var st = S.run; if(!st) return;
    if(S.over){ S.overT += dt; if(S.overT > 3.2) newGame(); return; }
    S.runT += dt;
    var inp = { l: input.left || input.touchL, r: input.right || input.touchR, j: input.jump || input.touchJ, d: input.down || input.touchD };
    var steps = Math.round(dt / Sim.DT);
    for(var i = 0; i < steps; i++){
      Sim.step(st, inp); handleEvents(st);
      if(st.dead && st.deadT > 1.15){
        if(S.lives <= 0){ S.over = true; S.overT = 0; return; }
        Sim.respawn(st); S.introT = 0;
      }
      if(st.done && st.doneT > 1.6 && !S.won){ startLevel(st.lvl + 1); return; }
    }
    if(S.introT > 0) S.introT -= dt;
    if(S.bannerT > 0) S.bannerT -= dt;
    S.lastNet += dt;
    if(S.lastNet >= 0.1){ S.lastNet = 0; sendWS2({ type: 'trapPos', lvl: st.lvl, x: st.px, y: st.py, f: st.face, a: st.anim, d: st.dead, u: st.duck }); }
  }

  // ------------------------------------------------------------------ drawing
  function brickAt(g, x, y, ceil){ drawBrick(g, Math.round(x), Math.round(y), true, true, true, true, Math.round(x) * 7 + Math.round(y) * 13, !!ceil); }
  function drawRect2(g, r, ceil){ for(var ix = 0; ix < r[2] / TILE; ix++) for(var iy = 0; iy < r[3] / TILE; iy++) brickAt(g, r[0] + ix * TILE, r[1] + iy * TILE, ceil); }

  function drawWorld(g){
    var st = S.run; if(!st) return;
    var level = st.level, a = buildArt(st.lvl), t = S.time;
    g.save();
    var shk = S.shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0; if(shk) g.translate(0, shk);
    g.drawImage(a.canvas, 0, 0);
    // the exit
    if(level.exit) drawExitDoor(g, Math.min(VW - 14, level.exit.x * TILE + 8), level.exit.y * TILE, t);
    st.traps.forEach(function(tr){
      var d = tr.d;
      switch(d.k){
        case 'fling': {
          if(tr.cs === 1){ var cx = Math.round(tr.cx), cy = Math.round(tr.cy);          // the ceiling spike: same brick as the ceiling, tip showing only as it falls
            rect(g, cx - 3, 2 * TILE, 6, cy - 2 * TILE, '#4a4d62'); rect(g, cx - 3, 2 * TILE, 1, cy - 2 * TILE, '#30323f'); rect(g, cx - 3, cy - 2, 6, 3, '#4a4e5c'); rect(g, cx - 2, cy + 1, 4, 8, '#a8aebd'); rect(g, cx - 1, cy + 8, 2, 6, '#e6eaf2'); }
          if(tr.s >= 2) break;
          // one spike sprite. Standing still it is axis-aligned and as crisp as everything else; the moment it turns it is drawn smoothly at a real angle,
          // which breaks the pixel-art illusion (on purpose: that is the joke)
          var crisp = tr.s === 0 && !(tr.arm > 0), spr = flingSprite();
          g.save(); g.imageSmoothingEnabled = !crisp;
          if(crisp) g.translate(Math.round(tr.x), Math.round(tr.y)); else g.translate(tr.x + (tr.s === 0 ? (Math.random() - 0.5) * 0.6 : 0), tr.y);
          g.rotate(tr.ang === undefined ? 0 : tr.ang); g.drawImage(spr, -10, -6);
          g.restore(); break; }
        case 'boulder': {
          if(tr.s === 4) break;
          var R = d.R, bx = Math.round(tr.x), by = Math.round(d.row * TILE - R);
          g.save(); g.translate(bx, by); g.rotate(tr.rot || 0);
          g.fillStyle = OUT; g.beginPath(); g.arc(0, 0, R + 2, 0, 7); g.fill(); g.fillStyle = '#7f8293'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
          g.fillStyle = '#9a9db0'; g.beginPath(); g.arc(-R * 0.25, -R * 0.3, R * 0.55, 0, 7); g.fill();
          g.strokeStyle = '#505366'; g.lineWidth = 2; for(var k2 = 0; k2 < 4; k2++){ g.beginPath(); g.arc(0, 0, R * (0.3 + k2 * 0.18), k2, k2 + 1.1); g.stroke(); }
          rect(g, 6, -4, 8, 3, '#4a4d5e'); rect(g, -14, 6, 9, 3, '#4a4d5e'); rect(g, -2, -18, 6, 3, '#4a4d5e'); rect(g, 12, 10, 7, 3, '#aeb1c4');
          g.restore(); break; }
        case 'pop':
          if(tr.h > 0){ for(var i = 0; i < d.n * 3; i++){ var sx = d.x * TILE + 1 + i * 5, hh = Math.round(tr.h), base = (d.y + 1) * TILE; rect(g, sx, base - hh, 5, hh, '#4a4e5c'); rect(g, sx + 1, base - hh, 3, Math.max(1, hh - 4), '#a8aebd'); rect(g, sx + 2, base - hh - 2, 1, 3, '#e6eaf2'); } }
          break;
        case 'collapse': case 'slide': {
          if(!tr.gone){ var wob = (tr.s === 1 && tr.t > d.delay - 0.3 && d.k === 'slide') ? Math.round(Math.sin(t * 50)) : 0; for(var ix = 0; ix < d.w; ix++) for(var iy2 = 0; iy2 < (d.h || 1); iy2++) brickAt(g, d.x * TILE + ix * TILE + wob, d.y * TILE + iy2 * TILE, false); }
          else if(tr.off < 1.2){ var dx = d.k === 'slide' ? (d.dir || 1) * tr.off * tr.off * 360 : 0, dy = d.k === 'collapse' ? tr.off * tr.off * 420 : 0; g.globalAlpha = Math.max(0, 1 - tr.off); for(var jx = 0; jx < d.w; jx++) for(var jy = 0; jy < (d.h || 1); jy++) brickAt(g, d.x * TILE + jx * TILE + dx, d.y * TILE + jy * TILE + dy, false); g.globalAlpha = 1; }
          break; }
        case 'void': {
          // the far platform (it falls out of the picture if you jump); the bridge is deliberately invisible
          var fy = tr.farGone ? tr.fy * tr.fy * 520 : 0;
          if(!tr.farGone || fy < 300){ g.globalAlpha = tr.farGone ? Math.max(0, 1 - tr.fy) : 1; for(var fx = d.far.x0; fx <= d.far.x1; fx++) brickAt(g, fx * TILE, d.far.row * TILE + fy, false); g.globalAlpha = 1; }
          break; }
        case 'rock':
          if(tr.s === 1 || tr.s === 2){ brickAt(g, tr.rx - 8, tr.s === 2 ? tr.landY : tr.y, true); }
          break;
        case 'button': {
          var bx2 = d.x * TILE, by2 = d.row * TILE;
          if(!tr.pressed) drawGate(g, d.gate, 1); else if(tr.t < 0.5 && tr.rs === undefined) drawGate(g, d.gate, 1 - Math.min(1, tr.t * 3));
          rect(g, bx2 + 1, by2 - 1, 14, 1, '#6a6f80'); rect(g, bx2 + 1, by2 - 1, 14, 1, tr.pressed ? '#3a3d4c' : '#8a90a2'); rect(g, bx2 + 4, by2, 8, 1, '#2a2c38');
          // a hand-painted sign above the plate
          rect(g, bx2 - 14, by2 - 36, 44, 16, OUT); rect(g, bx2 - 13, by2 - 35, 42, 14, '#c9bd90'); drawTextC(g, 'DO NOT', bx2 + 8, by2 - 33, '#6a1a14', 1); drawTextC(g, 'PRESS', bx2 + 8, by2 - 27, '#6a1a14', 1);
          rect(g, bx2 + 7, by2 - 20, 2, 19, '#4a3220');
          if(tr.rs === 1 || tr.rs === 2) brickAt(g, tr.rx - 8, tr.rs === 2 ? tr.landY : tr.ry, true);
          break; }
        case 'doorSpike':
          if(tr.s >= 1){ var sx2 = Math.round(tr.sx); rect(g, sx2 - 2, 2 * TILE, 5, Math.round(tr.fy - 2 * TILE), '#4a4e5c'); rect(g, sx2 - 1, 2 * TILE, 2, Math.round(tr.fy - 2 * TILE), '#a8aebd'); rect(g, sx2 - 3, Math.round(tr.fy) - 2, 7, 4, '#4a4e5c'); rect(g, sx2 - 1, Math.round(tr.fy) + 2, 3, 6, '#d4d9e6'); }
          break;
      }
    });
    // the wall chunk (part of the wall until the boulder knocks it out)
    st.traps.forEach(function(tr){ if(tr.d.k === 'boulder' && tr.d.chunk){ var c = tr.d.chunk, r = rectOf(c); if(!tr.broke) drawRect2(g, r, false); else { for(var rb = 0; rb < 9; rb++){ rect(g, c.x0 * TILE + (rb * 29) % 30, 15 * TILE - 3 - (rb % 3) * 2, 5, 3 + (rb % 2), '#6a6e82'); } } } });
    // ghosts
    Object.keys(S.ghosts).forEach(function(id){
      var gh = S.ghosts[id]; if(gh.lvl !== st.lvl || id === S.me) return;
      var info = S.roster[id] || { color: '#c8873a', name: '?' };
      explorer(g, gh.x, gh.y, { id: id, color: info.color, face: gh.f, anim: gh.a, state: gh.d ? 'dead' : (gh.u ? 'duck' : (Math.abs(gh.vx) > 6 ? (gh.onAir ? 'jump' : 'run') : (gh.onAir ? 'jump' : 'idle'))), alpha: 0.42, spin: gh.d ? 1.6 : 0 });
      drawTextC(g, String(info.name || '?').slice(0, 9), Math.round(gh.x), Math.round(gh.y) - 25, 'rgba(255,255,255,0.8)', 1, 'rgba(0,0,0,0.55)');
    });
    // the player
    var state = st.dead ? 'dead' : st.done ? 'win' : (st.duck ? 'duck' : (!st.onGround ? 'jump' : (Math.abs(st.vx) > 8 ? 'run' : 'idle')));
    var me = S.roster[S.me] || { color: '#d8573a', name: 'YOU' };
    var blink = (Math.floor(S.time * 1.4) % 6 === 0) && ((S.time * 8) % 1 < 0.4);
    explorer(g, st.px, st.py, { id: S.me || 'me', color: me.color, face: st.face, anim: st.anim, state: state, blink: blink, spin: st.dead ? st.deadT * 9 * st.face : 0 });
    if(!st.dead) drawTextC(g, String(me.name || 'YOU').slice(0, 9), Math.round(st.px), Math.round(st.py) - (st.duck ? 14 : 25), '#ffe9a0', 1, OUT);
    S.effects.forEach(function(e){ rect(g, Math.round(e.x), Math.round(e.y), 2, 2, e.color); });
    // one lighting pass over everything, so moving parts and scenery are shaded identically (no tells): cold dungeon grade, vignette, then torch light
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(138,146,196,1)'; g.fillRect(0, 15, VW, VH - 15); g.globalCompositeOperation = 'source-over';
    var vg = g.createRadialGradient(VW / 2, VH * 0.55, VH * 0.3, VW / 2, VH * 0.55, VW * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(4,4,12,0.55)'); g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
    a.torches.forEach(function(tc){ drawTorch(g, tc[0], tc[1], t); });
    g.save(); g.globalCompositeOperation = 'lighter';
    a.torches.forEach(function(tc, i){ lightPool(g, tc[0], tc[1] - 6, 72 + Math.sin(t * 7 + i) * 4, '255,150,60', 0.24 + Math.sin(t * 9 + i * 2) * 0.03); });
    g.restore();
    g.restore();
  }
  function rectOf(c){ return [c.x0 * TILE, c.y0 * TILE, (c.x1 - c.x0 + 1) * TILE, (c.y1 - c.y0 + 1) * TILE]; }
  function drawGate(g, gt, k){
    var x0 = gt.x0 * TILE, x1 = (gt.x1 + 1) * TILE, y0 = gt.y0 * TILE, y1 = (gt.y1 + 1) * TILE, h = Math.round((y1 - y0) * k);
    var top = y1 - h;
    for(var x = x0 + 2; x < x1; x += 6){ rect(g, x, top, 3, h, OUT); rect(g, x + 1, top, 1, h, '#8a90a2'); }
    for(var y = top + 6; y < y1; y += 28){ rect(g, x0, y, x1 - x0, 3, OUT); rect(g, x0, y, x1 - x0, 1, '#6a6f80'); }
  }

  function drawHud(g){
    var st = S.run; if(!st) return;
    rect(g, 0, 0, VW, 14, 'rgba(14,10,8,0.82)'); rect(g, 0, 14, VW, 1, '#7a5a2c');
    drawText(g, 'SCREEN ' + (st.lvl + 1) + '/' + Sim.LEVELS.length + '  ' + st.level.name, 6, 4, '#f4d878', 1);
    // lives: a heart and a number
    var hx = VW - 70, hy = 3;
    rect(g, hx, hy + 1, 3, 3, '#ff4a5a'); rect(g, hx + 5, hy + 1, 3, 3, '#ff4a5a'); rect(g, hx - 1, hy + 2, 11, 3, '#ff4a5a'); rect(g, hx, hy + 5, 9, 2, '#ff4a5a'); rect(g, hx + 2, hy + 7, 5, 1, '#ff4a5a'); rect(g, hx + 4, hy + 8, 1, 1, '#ff4a5a'); rect(g, hx + 1, hy + 2, 2, 1, '#ffb0b8');
    drawText(g, 'x ' + S.lives, hx + 14, 4, S.lives <= 3 ? '#ff7a6a' : '#f4efe0', 1);
    var sec = Math.floor(S.runT), tm = Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); drawText(g, tm, VW / 2 + 60, 4, '#e8e0d0', 1);
    var y = 20; S.toasts.forEach(function(to){ g.globalAlpha = Math.min(1, to.life); wrap(to.text, 46).forEach(function(ln){ rect(g, 4, y - 1, textWidth(ln, 1) + 4, 8, 'rgba(14,10,8,0.6)'); drawText(g, ln, 6, y, to.color, 1); y += 8; }); g.globalAlpha = 1; });
    if(S.over){
      rect(g, 0, 90, VW, 70, 'rgba(10,4,4,0.9)'); rect(g, 0, 90, VW, 1, '#a83a2a'); rect(g, 0, 159, VW, 1, '#a83a2a');
      drawTextC(g, 'GAME OVER', VW / 2, 100, '#ff5a4a', 3, OUT); drawTextC(g, 'OUT OF LIVES. THE DUNGEON WINS.', VW / 2, 126, '#f4efe0', 1); drawTextC(g, 'BACK TO SCREEN 1 WITH ' + Sim.LIVES + ' LIVES', VW / 2, 138, '#f4d878', 1);
      return;
    }
    if(st.dead){
      g.globalAlpha = Math.min(1, st.deadT * 3); rect(g, 0, 100, VW, 54, 'rgba(10,6,6,0.8)'); rect(g, 0, 100, VW, 1, '#a83a2a'); rect(g, 0, 153, VW, 1, '#a83a2a');
      drawTextC(g, 'YOU DIED', VW / 2, 106, '#ff5a4a', 3, OUT);
      wrap(st.deadMsg, 44).forEach(function(ln, i){ drawTextC(g, ln, VW / 2, 132 + i * 9, '#f4efe0', 1); });
      g.globalAlpha = 1;
    }
    if(S.bannerT > 0 && S.banner){
      g.globalAlpha = Math.min(1, S.bannerT * 2); rect(g, 0, 96, VW, 50, 'rgba(10,30,14,0.82)'); rect(g, 0, 96, VW, 1, '#58d878'); rect(g, 0, 145, VW, 1, '#58d878');
      drawTextC(g, S.banner, VW / 2, 106, '#8affc0', 3, OUT); if(S.bannerSub) drawTextC(g, S.bannerSub, VW / 2, 132, '#f4efe0', 1); g.globalAlpha = 1;
    } else if(S.won){ drawTextC(g, 'YOU ESCAPED! PRESS R TO RUN IT AGAIN', VW / 2, 252, '#8affc0', 1, OUT); }
    if(S.introT > 0 && !st.dead && !S.won){
      g.globalAlpha = Math.min(1, S.introT); rect(g, 0, 36, VW, 30, 'rgba(10,8,6,0.62)');
      drawTextC(g, st.level.name, VW / 2, 42, '#f4d878', 2, OUT); drawTextC(g, st.level.intro, VW / 2, 58, '#f4efe0', 1); g.globalAlpha = 1;
    }
  }

  function frame(now){
    raf = requestAnimationFrame(frame);
    if(!S.joined || !ctx2d || !S.run) return;
    var dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; S.time += dt; acc += dt;
    var stepDt = Sim.DT, n = 0;
    while(acc >= stepDt && n < 6){ updateGame(stepDt); acc -= stepDt; n++; }
    if(n === 6) acc = 0;
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
    else if(k === 'ArrowDown' || k === 's' || k === 'S') input.down = down;
    else if((k === 'r' || k === 'R' || k === 'Enter') && down && !e.repeat) restartPressed();
    else used = false;
    if(used){ e.preventDefault(); ensureAudio(); }
  }
  function restartPressed(){
    if(!S.run) return;
    if(S.won){ newGame(); return; }
    if(S.over || S.run.dead || S.run.done) return;
    // giving up costs a life, like everything else here
    S.run.deaths++; S.totalDeaths++; S.lives = Math.max(0, S.lives - 1); S.run.dead = true; S.run.deadT = 0.9; S.run.deadMsg = 'You gave up. The dungeon noticed.'; S.run.vy = -150;
    sfx('die'); sendWS2({ type: 'trapDie', msg: S.run.deadMsg, x: S.run.px, y: S.run.py });
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
      bindHold(document.getElementById('trap-btn-down'), function(){ input.touchD = true; }, function(){ input.touchD = false; });
      var rb = document.getElementById('trap-btn-retry'); if(rb) rb.addEventListener('click', function(){ restartPressed(); });
      window.addEventListener('keydown', function(e){ keyState(e, true); });
      window.addEventListener('keyup', function(e){ keyState(e, false); });
      window.addEventListener('blur', function(){ input.left = input.right = input.jump = input.down = input.touchL = input.touchR = input.touchJ = input.touchD = false; });
      window.addEventListener('resize', fitCanvas);
      setMusicLabel(); setJoinedUI(false);
      lastFrame = performance.now(); raf = requestAnimationFrame(frame);
    },
    onMessage: function(msg){
      if(!el.card || S.solo) return;
      if(msg.type === 'trapJoined'){ S.joined = true; S.me = msg.you; S.ghosts = {}; S.effects = []; S.toasts = []; acc = 0; setJoinedUI(true); sfx('join'); startMusic(); newGame(); }
      else if(msg.type === 'trapRoster'){ S.roster = {}; msg.players.forEach(function(p){ S.roster[p.id] = p; }); }
      else if(msg.type === 'trapBoard'){ S.board = msg.rows || []; renderBoard(); }
      else if(msg.type === 'trapSnap'){ if(!S.joined) return; msg.players.forEach(function(p){ if(p.i === S.me) return; var gh = S.ghosts[p.i]; if(!gh){ gh = S.ghosts[p.i] = { x: p.x, y: p.y, vx: 0 }; } gh.lvl = p.l; gh.tx = p.x; gh.ty = p.y; gh.f = p.f; gh.a = p.a; gh.d = !!p.d; gh.u = !!p.u; });}
      else if(msg.type === 'trapGone'){ delete S.ghosts[msg.id]; }
      else if(msg.type === 'trapEvent'){
        if(!S.joined || msg.id === S.me) return;
        var nm = (S.roster[msg.id] || {}).name || 'Someone';
        if(msg.e === 'die'){ toast(nm + ': ' + msg.msg, '#ffb0a0'); if(S.run && msg.lvl === S.run.lvl){ puff(msg.x, msg.y - 8, 10, '#ffffff', 120); sfx('ghost'); } }
        else if(msg.e === 'finish'){ toast(nm + (msg.final ? ' ESCAPED THE CASTLE!' : ' cleared level ' + (msg.lvl + 1) + '!'), '#8affc0'); }
      }
      else if(msg.type === 'trapEnded'){ HCTrap.stop(); }
    },
    setLobby: function(){},       // Trap Run is not shown in lobbies for now: it lives in Settings, single player
    openSolo: function(){
      if(!el.card) return;
      var m = document.getElementById('trap-modal'); if(m) m.style.display = 'flex';
      S.solo = true; S.joined = true; S.me = 'me'; S.roster = { me: { id: 'me', name: 'YOU', color: '#d8573a' } }; S.ghosts = {}; S.effects = []; S.toasts = []; S.board = []; acc = 0;
      setJoinedUI(true); ensureAudio(); newGame();
    },
    stop: function(){
      if(!el.card) return;
      S.joined = false; S.solo = false; S.run = null; S.ghosts = {}; S.effects = []; S.board = [];
      var m = document.getElementById('trap-modal'); if(m) m.style.display = 'none';
      input.left = input.right = input.jump = input.down = input.touchL = input.touchR = input.touchJ = input.touchD = false;
      stopMusic(); setJoinedUI(false);
    },
    isJoined: function(){ return S.joined; },
    _debug: { state: S, startLevel: startLevel }
  };
  window.HCTrap = HCTrap;
})();
