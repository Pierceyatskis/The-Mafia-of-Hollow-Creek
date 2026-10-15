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
  function shade(hex, f){ var c = hexToRgb(hex); return 'rgb(' + Math.max(0, Math.min(255, Math.round(c[0] * f))) + ',' + Math.max(0, Math.min(255, Math.round(c[1] * f))) + ',' + Math.max(0, Math.min(255, Math.round(c[2] * f))) + ')'; }
  var SKINS = ['#f1c9a0', '#d9a577', '#b57d54', '#8a5a3a'];
  var HAIRS = ['#2a1d14', '#5a3a22', '#8a6a3a', '#3a3a3a', '#a85a2a'];
  function hashStr(s){ var h = 0; s = String(s); for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  // ------------------------------------------------------------------ the static scene (drawn once)
  var sceneCanvas = null;
  function buildScene(){
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    // dusk sky in chunky bands
    var bands = ['#1f2a45', '#26335a', '#2f3d6a', '#4a4a78', '#7a5a7a', '#b8737a', '#d99a6c'];
    for(var i = 0; i < bands.length; i++){ g.fillStyle = bands[i]; g.fillRect(0, i * 16, W, 17); }
    // dither between bands
    for(var b = 1; b < bands.length; b++){ g.fillStyle = bands[b]; for(var x = 0; x < W; x += 2) g.fillRect(x + (b % 2), b * 16 - 1, 1, 1); }
    // stars
    g.fillStyle = '#f2e8c8'; [[20,10],[64,22],[130,8],[188,26],[250,12],[300,30],[360,14],[392,36],[100,40],[330,6]].forEach(function(s){ g.fillRect(s[0], s[1], 1, 1); });
    // moon
    g.fillStyle = '#efe3b8'; g.fillRect(352, 18, 12, 12); g.fillStyle = '#d6c892'; g.fillRect(358, 22, 3, 3); g.fillRect(355, 26, 2, 2);
    // distant skyline / hills
    g.fillStyle = '#2a2640'; [[0,84,40,30],[34,76,28,38],[70,90,50,24],[330,80,44,34],[372,88,28,26]].forEach(function(r){ g.fillRect(r[0], r[1], r[2], r[3]); });
    // watchtower
    g.fillStyle = '#3b3550'; g.fillRect(24, 70, 6, 60); g.fillRect(52, 70, 6, 60);
    g.fillStyle = '#4d4666'; g.fillRect(16, 54, 50, 18); g.fillStyle = '#e8c070'; g.fillRect(24, 60, 10, 7); g.fillRect(48, 60, 10, 7);
    g.fillStyle = '#2d2842'; g.fillRect(12, 50, 58, 6);
    g.fillStyle = 'rgba(240,210,120,0.16)'; g.beginPath(); g.moveTo(40, 66); g.lineTo(150, 188); g.lineTo(80, 188); g.closePath(); g.fill();   // searchlight
    // prison wall (bricks)
    var wallTop = 112, wallBottom = 190;
    g.fillStyle = '#7a5646'; g.fillRect(0, wallTop, W, wallBottom - wallTop);
    for(var row = 0; row < (wallBottom - wallTop) / 7; row++){
      var yy = wallTop + row * 7;
      g.fillStyle = '#5c3e32'; g.fillRect(0, yy, W, 1);
      for(var bx = (row % 2) * 8; bx < W; bx += 16){ g.fillRect(bx, yy, 1, 7); }
    }
    for(var n = 0; n < 90; n++){ g.fillStyle = (n % 3) ? '#8a6454' : '#6a4a3c'; g.fillRect((n * 53) % W, wallTop + ((n * 29) % (wallBottom - wallTop - 2)), 3, 2); }
    g.fillStyle = '#9a7a66'; g.fillRect(0, wallTop, W, 3); g.fillStyle = '#4a3228'; g.fillRect(0, wallTop + 3, W, 1);
    // barbed wire
    g.fillStyle = '#2a2a30'; g.fillRect(0, wallTop - 10, W, 1);
    for(var wx = 2; wx < W; wx += 8){ g.fillRect(wx, wallTop - 12, 1, 5); g.fillRect(wx - 1, wallTop - 10, 3, 1); }
    // chain-link fence in front of the wall
    g.fillStyle = 'rgba(190,200,210,0.20)';
    for(var fx = 0; fx < W; fx += 6){ g.fillRect(fx, 126, 1, 64); }
    for(var fy = 126; fy < 190; fy += 6){ g.fillRect(0, fy, W, 1); }
    g.fillStyle = '#58606a'; [0, 100, 200, 300, 399].forEach(function(px){ g.fillRect(px, 120, 3, 70); });
    g.fillRect(0, 120, W, 2);
    // signs on the wall
    g.fillStyle = '#e8d8a8'; g.fillRect(96, 136, 62, 15); g.fillStyle = '#3a2a18'; g.fillRect(97, 137, 60, 13); g.fillStyle = '#e8d8a8'; g.fillRect(98, 138, 58, 11);
    drawTextCentered(g, 'LOBBY YARD', 127, 141, '#3a2a18', 1);
    // ground: curb + concrete floor
    g.fillStyle = '#5a554c'; g.fillRect(0, 190, W, 4);
    g.fillStyle = '#8a8478'; g.fillRect(0, 194, W, H - 194);
    for(var gx = 0; gx < W; gx += 26){ g.fillStyle = '#7a7468'; g.fillRect(gx, 194, 1, H - 194); }
    for(var gy = 194; gy < H; gy += 10){ g.fillStyle = '#7e786c'; g.fillRect(0, gy, W, 1); }
    for(var k = 0; k < 50; k++){ g.fillStyle = (k % 2) ? '#9a9488' : '#6c675c'; g.fillRect((k * 71) % W, 196 + ((k * 13) % 28), 2, 1); }
    g.fillStyle = '#d9b840'; for(var dx = 8; dx < RING.x - 14; dx += 20) g.fillRect(dx, 212, 10, 2);        // faded road paint
    // props: bench, weights, hoop
    g.fillStyle = '#4a3020'; g.fillRect(150, 184, 36, 4); g.fillRect(152, 188, 3, 6); g.fillRect(181, 188, 3, 6); g.fillRect(150, 176, 36, 3);
    g.fillStyle = '#6b4a30'; g.fillRect(150, 184, 36, 1);
    g.fillStyle = '#3a3a42'; g.fillRect(196, 178, 2, 16); g.fillRect(212, 178, 2, 16); g.fillRect(190, 176, 30, 2);       // weight rack
    g.fillStyle = '#2a2a30'; g.fillRect(190, 172, 6, 8); g.fillRect(214, 172, 6, 8);
    g.fillStyle = '#5a5a64'; g.fillRect(88, 150, 2, 44); g.fillStyle = '#e8e0d0'; g.fillRect(80, 150, 18, 12); g.fillStyle = '#8a1c14'; g.fillRect(84, 154, 10, 5); // hoop
    g.fillStyle = '#d96a2a'; g.fillRect(84, 161, 10, 1);
    // ring mat
    g.fillStyle = '#35506e'; g.fillRect(RING.x, 190, RING.w, H - 190);
    g.fillStyle = '#44628a'; for(var m = 0; m < RING.w; m += 8) g.fillRect(RING.x + m, 194, 4, H - 194);
    g.fillStyle = '#e8e8f0'; g.fillRect(RING.x, 190, RING.w, 1); g.fillRect(RING.x, 190, 2, H - 190); g.fillRect(RING.x + RING.w - 2, 190, 2, H - 190);
    g.fillStyle = '#c93a2a'; g.fillRect(RING.x + RING.w / 2 - 2, 206, 4, 4); g.fillRect(RING.x + RING.w / 2 - 8, 207, 16, 2);
    // banner above the ring
    g.fillStyle = '#3a1a1a'; g.fillRect(RING.x + 2, 84, RING.w - 4, 24); g.fillStyle = '#d9b840'; g.fillRect(RING.x + 3, 87, RING.w - 6, 1); g.fillRect(RING.x + 3, 106, RING.w - 6, 1);
    drawTextCentered(g, 'KING OF THE YARD', RING.x + RING.w / 2, 89, '#f4d878', 1);
    drawTextCentered(g, 'THROW THEM OUT!', RING.x + RING.w / 2, 98, '#e8e0d0', 1);
    sceneCanvas = c;
  }
  // ring posts + ropes (behind players) and the front post (in front)
  function drawRopes(g){
    var x0 = RING.x, x1 = RING.x + RING.w;
    [[162, '#c93a2a'], [174, '#f0ece0'], [186, '#c93a2a']].forEach(function(r){ g.fillStyle = '#1a1410'; g.fillRect(x0, r[0] - 1, RING.w, 3); g.fillStyle = r[1]; g.fillRect(x0, r[0], RING.w, 1); g.fillRect(x0, r[0] + 1, RING.w, 1); });
    [x0, x1].forEach(function(px){
      g.fillStyle = '#1a1410'; g.fillRect(px - 3, 150, 6, 44); g.fillStyle = '#9a9aa6'; g.fillRect(px - 2, 151, 4, 42); g.fillStyle = '#c4c4d0'; g.fillRect(px - 2, 151, 1, 42);
      g.fillStyle = '#c93a2a'; g.fillRect(px - 3, 160, 6, 4); g.fillRect(px - 3, 172, 6, 4); g.fillRect(px - 3, 184, 6, 4);
      g.fillStyle = '#1a1410'; g.fillRect(px - 4, 148, 8, 3);
    });
  }

  // ------------------------------------------------------------------ characters
  function box(g, x, y, w, h, col, line){ g.fillStyle = line || '#1a1410'; g.fillRect(x - 1, y - 1, w + 2, h + 2); g.fillStyle = col; g.fillRect(x, y, w, h); }
  // draws a figure facing right with its feet at (0,0); the caller flips / rotates
  function drawFigure(g, p, o){
    var skin = SKINS[hashStr(p.id) % 4], hair = HAIRS[hashStr(p.id + 'h') % 5];
    var body = p.color || '#c8873a', dark = shade(body, 0.62);
    var walkFrame = o.walking ? (Math.floor(o.time * 9) % 2) : 0;
    var airborne = o.air;
    var lyingEyes = o.lying;
    // legs
    var lx = walkFrame ? -3 : -2, rx = walkFrame ? 1 : 0;
    if(airborne){ box(g, -3, -6, 3, 5, dark); box(g, 1, -7, 3, 5, dark); }
    else { box(g, lx, -7, 3, 7, dark); box(g, rx + 1, -7, 3, 7, dark); }
    // back arm
    if(o.armsUp){ box(g, -5, -24, 2, 9, body); }
    else box(g, -5, -14, 2, 7, shade(body, 0.8));
    // torso
    box(g, -4, -15, 8, 8, body);
    g.fillStyle = shade(body, 1.18); g.fillRect(-3, -14, 6, 1);
    g.fillStyle = dark; g.fillRect(-4, -9, 8, 1);                               // belt
    // head
    box(g, -3, -22, 7, 7, skin);
    g.fillStyle = '#1a1410';
    if(lyingEyes){ g.fillRect(0, -19, 1, 1); g.fillRect(2, -19, 1, 1); g.fillRect(1, -18, 1, 1); }
    else if(o.dizzy){ g.fillRect(0, -20, 2, 1); g.fillRect(2, -20, 2, 1); }
    else { g.fillRect(2, -20, 1, 2); g.fillRect(0, -19, 1, 1); }
    // mouth for punches
    if(o.punch){ g.fillStyle = '#7a2a2a'; g.fillRect(1, -17, 2, 1); }
    // hair / hat
    g.fillStyle = hair; g.fillRect(-3, -23, 7, 2); g.fillRect(-4, -22, 1, 3);
    if(p.g === 'f'){ g.fillRect(-4, -22, 2, 8); g.fillRect(-5, -20, 1, 5); }
    switch(p.hat){
      case 1: g.fillStyle = '#1a1410'; g.fillRect(-4, -25, 9, 4); g.fillStyle = '#6a5a44'; g.fillRect(-3, -25, 7, 3); g.fillStyle = '#1a1410'; g.fillRect(3, -22, 4, 1); break;      // flat cap
      case 2: g.fillStyle = '#1a1410'; g.fillRect(-6, -23, 13, 2); g.fillRect(-3, -28, 7, 6); g.fillStyle = '#4a3a2a'; g.fillRect(-2, -27, 5, 4); g.fillStyle = '#8a1c14'; g.fillRect(-2, -24, 5, 1); break;   // fedora
      case 3: g.fillStyle = '#1a1410'; g.fillRect(-4, -27, 9, 5); g.fillRect(-5, -23, 11, 1); g.fillStyle = '#2f2f38'; g.fillRect(-3, -26, 7, 3); break;                                              // bowler
      default: break;
    }
    // front arm
    if(o.armsUp){ box(g, 3, -24, 2, 9, body); box(g, 3, -26, 2, 2, skin); box(g, -5, -26, 2, 2, skin); }
    else if(o.punch){ box(g, 4, -13, 8, 3, body); box(g, 11, -14, 4, 5, skin); }
    else if(o.waving){ box(g, 4, -20, 2, 7, body); box(g, 4, -22, 2, 2, skin); }
    else { box(g, 3, -14, 2, 7, body); }
  }
  function drawBubble(g, kind, cx, ty, t){
    var w = kind === 'zzz' ? 15 : 13, x = Math.round(cx - w / 2), y = ty - 12 - Math.round(Math.sin(t * 6) * 1);
    g.fillStyle = '#1a1410'; g.fillRect(x - 1, y - 1, w + 2, 11); g.fillStyle = '#f8f4e8'; g.fillRect(x, y, w, 9); g.fillRect(cx - 1, y + 9, 3, 2);
    if(kind === 'heart'){ g.fillStyle = '#d93a4a'; g.fillRect(x + 3, y + 2, 2, 2); g.fillRect(x + 7, y + 2, 2, 2); g.fillRect(x + 2, y + 3, 8, 2); g.fillRect(x + 3, y + 5, 6, 1); g.fillRect(x + 4, y + 6, 4, 1); g.fillRect(x + 5, y + 7, 2, 1); }
    else if(kind === 'wave') drawTextCentered(g, 'HI!', cx, y + 2, '#3a2a18', 1);
    else if(kind === 'laugh') drawTextCentered(g, 'HA', cx, y + 2, '#3a2a18', 1);
    else if(kind === 'bang') drawTextCentered(g, '!', cx, y + 2, '#c93a2a', 1);
    else drawTextCentered(g, 'ZZZ', cx, y + 2, '#3a4a8a', 1);
  }
  function drawCrown(g, cx, y, n){
    g.fillStyle = '#1a1410'; g.fillRect(cx - 5, y - 1, 11, 7);
    g.fillStyle = '#f4c840'; g.fillRect(cx - 4, y + 2, 9, 3); g.fillRect(cx - 4, y, 2, 3); g.fillRect(cx - 1, y - 1, 2, 4); g.fillRect(cx + 3, y, 2, 3);
    g.fillStyle = '#d93a4a'; g.fillRect(cx - 1, y + 3, 2, 1);
    if(n > 0) drawText(g, String(n), cx + 7, y, '#f4d878', 1, '#1a1410');
  }
  function drawStars(g, cx, cy, t){
    for(var i = 0; i < 3; i++){ var a = t * 5 + i * 2.1; g.fillStyle = '#f4d878'; g.fillRect(Math.round(cx + Math.cos(a) * 7), Math.round(cy + Math.sin(a) * 2), 2, 2); }
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
  function fxText(x, y, text, color){ S.effects.push({ k: 'text', x: x, y: y, vy: -22, text: text, color: color || '#f4d878', life: 0.9 }); }
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
        case 'hit': sfx('hit'); S.flash[ev.id] = S.time + 0.12; if(p){ fxSparks(p.x, GY - p.y - 14, 5); fxText(p.x, GY - p.y - 26, 'POW!', '#fff2b0'); } break;
        case 'ko': sfx('ko'); S.shake = S.time + 0.25; S.shakeMag = 2; if(p) fxText(p.x, GY - p.y - 30, 'K.O.!', '#ff6a5a'); break;
        case 'grab': sfx('grab'); break;
        case 'throw': sfx('throw'); break;
        case 'land': sfx('land'); if(p) fxDust(p.x, GY); break;
        case 'out':
          sfx('out'); S.shake = S.time + 0.3; S.shakeMag = 3;
          if(p) fxText(p.x, GY - p.y - 34, 'OUT!', '#ff6a5a');
          break;
        case 'streak': sfx('streak'); if(S.render[ev.id]) fxText(S.render[ev.id].x, GY - 44, '+1  x' + ev.n, '#f4d878'); break;
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
  function drawPlayer(g, r, roster, isMe){
    var info = roster[r.id] || { id: r.id, name: '?', color: '#c8873a', g: 'm', hat: 0 };
    var p = { id: r.id, color: info.color, g: info.g, hat: info.hat };
    var x = Math.round(r.x), fy = GY - Math.round(r.y);
    if(r.s === STATE.held) return;                               // drawn with whoever is carrying them
    g.save(); g.translate(x, fy);
    // shadow on the ground
    g.restore(); g.save();
    g.fillStyle = 'rgba(0,0,0,0.28)'; var sw = Math.max(4, 10 - Math.round(r.y / 6)); g.fillRect(x - sw / 2, GY, sw, 2);
    g.translate(x, fy);
    var flip = r.f < 0 ? -1 : 1;
    var o = { time: S.time, walking: r.moving && r.s === STATE.idle && r.y < 2, air: r.y >= 2, punch: r.punch, lying: false, dizzy: false, armsUp: !!r.c, waving: r.e === 0 };
    if(r.s === STATE.ko || r.s === STATE.out){
      o.lying = true; o.dizzy = r.s === STATE.out; g.scale(flip, 1); g.translate(0, -2); g.rotate(-Math.PI / 2); g.translate(0, -2);
      drawFigure(g, p, o);
    } else if(r.s === STATE.thrown){
      o.lying = true; g.translate(0, -10); g.rotate(S.time * 11 * flip); g.translate(0, 10); g.scale(flip, 1); drawFigure(g, p, o);
    } else {
      g.scale(flip, 1); drawFigure(g, p, o);
    }
    g.restore();
    // the player they are carrying (drawn lying across the raised hands)
    if(r.c && S.render[r.c]){
      var h = S.render[r.c], hi = roster[r.c] || { id: r.c, color: '#c8873a', g: 'm', hat: 0 };
      g.save(); g.translate(x, fy - 31); g.scale(flip, 1); g.rotate(-Math.PI / 2); g.translate(0, 2);
      drawFigure(g, { id: r.c, color: hi.color, g: hi.g, hat: hi.hat }, { time: S.time, lying: true, dizzy: false });
      g.restore();
    }
    if(S.flash[r.id] && S.flash[r.id] > S.time){ g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x - 6, fy - 24, 12, 24); }
    if(r.s === STATE.out || r.s === STATE.ko) drawStars(g, x, fy - 12, S.time);
    // name tag, crown, emote
    var top = fy - (r.c ? 52 : 30);
    var label = String(info.name || '?').slice(0, 10);
    drawTextCentered(g, label, x, top - 8, isMe ? '#ffe9a0' : '#f2f2f2', 1, '#1a1410');
    if(S.crown === r.id) drawCrown(g, x - (r.st > 9 ? 3 : 0), top - 17, r.st);
    else if(r.st > 0) drawText(g, 'x' + r.st, x + textWidth(label, 1) / 2 + 2, top - 8, '#f4d878', 1, '#1a1410');
    if(r.e >= 0) drawBubble(g, EMOTES[r.e], x, top - (S.crown === r.id ? 20 : 8), S.time);
    if(isMe){ g.fillStyle = '#ffe9a0'; g.fillRect(x - 1, top - 1, 3, 1); g.fillRect(x, top, 1, 1); }
  }

  function draw(g){
    var sh = 0; if(S.shake > S.time) sh = Math.round((Math.random() - 0.5) * 2 * S.shakeMag);
    g.save(); g.translate(sh, 0);
    g.drawImage(sceneCanvas, 0, 0);
    drawRopes(g);
    // ball
    var b = S.ball; var bx = Math.round(b.x), by = GY - Math.round(b.y);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(bx - 3, GY, 7, 1);
    g.fillStyle = '#1a1410'; g.fillRect(bx - 4, by - 7, 8, 8); g.fillStyle = '#e86a2a'; g.fillRect(bx - 3, by - 6, 6, 6); g.fillStyle = '#a8431a'; g.fillRect(bx - 3, by - 4, 6, 1); g.fillRect(bx, by - 6, 1, 6); g.fillStyle = '#f8a070'; g.fillRect(bx - 2, by - 5, 2, 1);
    // players, back to front by height so airborne ones sit on top
    var ids = Object.keys(S.render).sort(function(a, c){ return S.render[a].y - S.render[c].y; });
    ids.forEach(function(id){ drawPlayer(g, S.render[id], S.roster, id === S.me); });
    // effects
    S.effects.forEach(function(e){
      if(e.k === 'text') drawTextCentered(g, e.text, Math.round(e.x), Math.round(e.y), e.color, 1, '#1a1410');
      else { g.fillStyle = e.color; g.fillRect(Math.round(e.x), Math.round(e.y), 2, 2); }
    });
    // header strip: who holds the ring
    g.fillStyle = 'rgba(20,14,10,0.72)'; g.fillRect(0, 0, W, 13);
    if(S.crown && S.roster[S.crown]){
      drawCrown(g, 12, 3, 0);
      drawText(g, String(S.roster[S.crown].name).slice(0, 12), 22, 4, '#f4d878', 1);
      var kr = S.render[S.crown]; drawText(g, 'STREAK ' + (kr ? kr.st : 0), 22 + textWidth(String(S.roster[S.crown].name).slice(0, 12), 1) + 8, 4, '#e8e0d0', 1);
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
      if(hint) drawTextCentered(g, hint, W / 2, H - 9, '#ffffff', 1, '#1a1410');
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
