/* Hollow Creek background music - played live with Web Audio from recorded
 * instrument samples (FluidR3 GM, CC BY 3.0 - see assets/music/fluidr3/CREDITS.txt).
 *
 * Style: Southern Gothic folk noir. A small, foggy 1910s town with a dark
 * secret - restrained parlor piano, low strings, muted fiddle and upright
 * bass. Not a gangster movie: no swing, no brass, no jazz drums.
 *
 * Built to sit in the background of a thinking game:
 *   - Mostly texture. The full melody turns up about once per set (every
 *     2-3 minutes); the other passes are bass, strings and quiet piano, with
 *     the odd fragment of the tune.
 *   - Every pass is arranged differently (which layers play, which melody
 *     variant), so it never repeats as an obvious loop.
 *   - Sets run continuously: one plays for ~2-3 minutes, ends on a soft final
 *     chord, and the next begins as that chord fades.
 *
 * Every piece is built on one 5-note motif (D F E D A), sits in D minor and
 * plays into a soft "foggy" room reverb.
 *   menu  - main theme for menus and lobby: sparse piano broken chords over a
 *           bass sinking by half steps, the motif on echoing piano, celesta or
 *           distant fiddle, 60 bpm, 8-bar passes (~32 s).
 *   day   - a slow parlor waltz in 3/4, 84 bpm, 16-bar passes (~34 s).
 *   vote  - no tune: a cello pulse with a half-step "wrong" neighbour, timpani
 *           heartbeat, tremolo clusters and a high fiddle that build over passes.
 *   night - 72 bpm, 8-bar passes (~27 s): tiptoe upright bass, cello drone,
 *           and sometimes a celesta melody with echo, parlor-piano chords, a
 *           muted-fiddle counter-line, a timpani heartbeat or a tremolo swell.
 *   win-town / win-mafia / win-bounty - one-shot victory cues (~15-20 s),
 *           each opening with ~1.3 s of silence so the game's gavel/bong lands first.
 *
 * API:
 *   HollowMusic.load([name])           - Promise; fetches the samples a theme uses (play() does this itself)
 *   HollowMusic.play('day' | 'night')  - starts or crossfades to a theme
 *   HollowMusic.stop()                 - fades out
 *   HollowMusic.setVolume(0..1)
 *   HollowMusic.current()              - 'day' | 'night' | null
 *   HollowMusic.status()               - what is playing now / next, or how long the rest lasts
 *   HollowMusic.render(name[, seconds])- Promise<AudioBuffer>; default = one whole set
 *   HollowMusic.toWav(audioBuffer)     - Blob (audio/wav)
 */
(function(){
  'use strict';

  // ---------- notes ----------
  var SEMI = {C:0, D:2, E:4, F:5, G:7, A:9, B:11};
  var FLATS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  function midi(name){
    var m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if(!m) throw new Error('bad note ' + name);
    return SEMI[m[1]] + (m[2]==='#' ? 1 : m[2]==='b' ? -1 : 0) + (parseInt(m[3],10)+1)*12;
  }
  function freq(name){ return 440 * Math.pow(2, (midi(name) - 69) / 12); }
  function midiName(m){ return FLATS[m % 12] + (Math.floor(m/12) - 1); }
  // "F5:1 A5:1 r:2 ..." -> {events:[{at, dur, f}], length} in 16th steps. unit = 16ths per count.
  function seq(str, unit){
    var out = [], pos = 0;
    str.trim().split(/\s+/).forEach(function(tok){
      var p = tok.split(':'), len = parseFloat(p[1] || '1') * unit;
      if(p[0] !== 'r') out.push({at: pos, dur: len, f: freq(p[0])});
      pos += len;
    });
    return {events: out, length: pos};
  }
  function at(sq, s, fn){ sq.events.forEach(function(e){ if(e.at === s) fn(e); }); }
  function chance(p){ return Math.random() < p; }
  function pick(list){ return list[Math.floor(Math.random() * list.length)]; }

  // ---------- samples ----------
  var BASE = (document.currentScript && document.currentScript.src)
    ? new URL('assets/music/fluidr3/', document.currentScript.src).href
    : 'assets/music/fluidr3/';
  var BANK_SPEC = {
    piano:   ['acoustic_grand_piano', 'C2', 'C6'],
    violin:  ['violin',               'G3', 'D6'],
    cello:   ['cello',                'C2', 'A4'],
    bass:    ['acoustic_bass',        'E1', 'E3'],
    tremolo: ['tremolo_strings',      'A2', 'E4'],
    celesta: ['celesta',              'C4', 'C7'],
    timpani: ['timpani',              'A1', 'D3']
  };
  // Only the notes a theme can play are fetched (found by dry-running every
  // arrangement of the theme with a recorder in place of the sampler).
  var BANKS = {}, FILES = {}, RECORD = null, decoder = null;
  Object.keys(BANK_SPEC).forEach(function(k){ BANKS[k] = {notes: [], buf: {}}; });
  function notesFor(name){
    var theme = THEMES[name], stepDur = 60/theme.bpm/4, io = {out: null, echo: null};
    RECORD = {};
    try{
      theme.templates.forEach(function(plan){
        for(var s = 0; s < theme.steps; s++) theme.step(null, io, s, 0, stepDur, plan);
      });
      if(theme.ending) theme.ending(null, io, 0, stepDur);
    } finally {
      var rec = RECORD; RECORD = null;
    }
    return rec;
  }
  function fetchNote(key, m){
    var id = key + m;
    if(FILES[id]) return FILES[id];
    var spec = BANK_SPEC[key], lo = midi(spec[1]), hi = midi(spec[2]);
    m = Math.max(lo, Math.min(hi, m));
    decoder = decoder || new OfflineAudioContext(1, 1, 44100);
    FILES[id] = fetch(BASE + spec[0] + '/' + midiName(m) + '.mp3')
      .then(function(r){ if(!r.ok) throw new Error(r.status + ' ' + r.url); return r.arrayBuffer(); })
      .then(function(ab){ return decoder.decodeAudioData(ab); })
      .then(function(buf){
        var bank = BANKS[key];
        if(!bank.buf[m]){ bank.buf[m] = buf; bank.notes.push(m); bank.notes.sort(function(a,b){ return a-b; }); }
      })
      .catch(function(e){ console.warn('[HollowMusic] sample missing:', e.message || e); });
    return FILES[id];
  }
  function load(name){
    var names = name ? [name] : Object.keys(THEMES), jobs = [];
    names.forEach(function(n){
      var need = notesFor(n);
      Object.keys(need).forEach(function(key){
        Object.keys(need[key]).forEach(function(m){ jobs.push(fetchNote(key, +m)); });
      });
    });
    return Promise.all(jobs);
  }

  // Play one sampled note. o: {peak, len, a, r, cutoff}
  // If len is longer than the recording, it crossfades into a second copy
  // (started past the attack) so bowed notes can be held.
  function sampler(c, out, key, f, t, o){
    var m = 69 + 12 * Math.log2(f / 440);
    if(RECORD){ (RECORD[key] = RECORD[key] || {})[Math.round(m)] = true; return; }
    var bank = BANKS[key];
    if(!bank || !bank.notes.length) return;
    var best = bank.notes[0];
    bank.notes.forEach(function(n){ if(Math.abs(n - m) < Math.abs(best - m)) best = n; });
    var buf = bank.buf[best], rate = Math.pow(2, (m - best) / 12);
    var dest = out;
    if(o.cutoff){
      var flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = o.cutoff; flt.Q.value = 0.5;
      flt.connect(out); dest = flt;
    }
    var a = o.a || 0.003, r = o.r || 0.2, XF = 0.35, total = o.len || 99;
    var start = t, first = true;
    while(total > 0.02){
      var offset = first ? 0 : 0.6;
      var avail = (buf.duration - offset - 0.25) / rate;
      var segLen = Math.min(total, avail);
      var last = segLen >= total - 0.001;
      var fin = first ? a : XF, fout = last ? r : XF;
      var src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; src.playbackRate.value = rate;
      src.connect(g); g.connect(dest);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(o.peak, start + fin);
      if(segLen > fin) g.gain.setValueAtTime(o.peak, start + segLen);
      g.gain.linearRampToValueAtTime(0.0001, start + segLen + fout);
      src.start(start, offset);
      src.stop(start + segLen + fout + 0.02);
      if(last || !o.len) break;
      start += segLen;
      total -= segLen;
      first = false;
    }
  }
  // instrument shorthands
  function piano(c, out, f, t, len, peak){ sampler(c, out, 'piano', f, t, {peak: peak, len: len, r: 0.3}); }
  function uprightBass(c, out, f, t, len, peak){ sampler(c, out, 'bass', f, t, {peak: peak, len: len, r: 0.15}); }
  function fiddle(c, out, f, t, len, peak){ sampler(c, out, 'violin', f, t, {peak: peak, len: len, a: 0.06, r: 0.25, cutoff: 3200}); }
  function cello(c, out, f, t, len, peak, attack){ sampler(c, out, 'cello', f, t, {peak: peak, len: len, a: attack || 0.3, r: 0.6, cutoff: 2500}); }
  function celesta(c, out, f, t, peak){ sampler(c, out, 'celesta', f, t, {peak: peak, r: 0.3}); }
  function timpani(c, out, f, t, peak){ sampler(c, out, 'timpani', f, t, {peak: peak, len: 1.2, r: 0.3}); }

  // ---------- DAY: slow parlor waltz, 3/4 ----------
  var DAY = (function(){
    // Dm | Dm/C | Bbmaj7 | A | Dm | Gm/Bb | Em7b5 | A7 |
    // F | C/E | Dm | Bb | Gm | Dm/A | A7 | Dm
    var bassNotes = ['D2','C2','Bb1','A1','D2','Bb1','E2','A1','F2','E2','D2','Bb1','G1','A1','A1','D2'];
    var chords = [
      ['F3','A3','D4'], ['F3','A3','D4'], ['F3','A3','D4'], ['E3','A3','C#4'],
      ['F3','A3','D4'], ['G3','Bb3','D4'], ['G3','Bb3','D4'], ['G3','C#4','E4'],
      ['F3','A3','C4'], ['G3','C4','E4'], ['F3','A3','D4'], ['F3','Bb3','D4'],
      ['G3','Bb3','D4'], ['F3','A3','D4'], ['G3','C#4','E4'], ['F3','A3','D4']
    ];
    var inner = ['A3','A3','F3','E3','F3','G3','G3','G3','A3','G3','F3','F3','G3','F3','E3','F3'];
    // the tune - counts are eighth notes, 6 per bar
    var tune = seq(
      'r:2 D5:1 F5:1 E5:1 D5:1   A4:5 r:1   r:2 Bb4:1 D5:1 F5:2   E5:4 C#5:2 ' +
      'D5:1 F5:1 E5:1 D5:1 A4:2  Bb4:4 D5:2 G4:2 Bb4:2 D5:2      C#5:6 ' +
      'r:2 A5:1 G5:1 F5:1 E5:1   E5:4 G5:2  F5:2 E5:2 D5:2       D5:4 r:2 ' +
      'r:2 Bb4:1 D5:1 G5:2       F5:4 E5:2  E5:2 C#5:2 A4:2      D5:6', 2);
    // Arrangements. chords: 2 = beats 2 and 3, 1 = beat 2 only (sparser).
    var P = {
      sparse:    {name: 'sparse - bass and cello',            chords: 1, inner: false, melody: null},
      bed:       {name: 'bed - bass, cello, piano',            chords: 2, inner: false, melody: null},
      bedFull:   {name: 'bed - with second cello',             chords: 2, inner: true,  melody: null},
      hint:      {name: 'hint - low fiddle, first phrase',     chords: 2, inner: true,  melody: 'hint'},
      pianoTune: {name: 'tune on piano (first half)',          chords: 1, inner: false, melody: 'piano'},
      tune:      {name: 'tune on fiddle',                      chords: 2, inner: true,  melody: 'fiddle'},
      split:     {name: 'tune: piano, then low fiddle',        chords: 2, inner: true,  melody: 'split'}
    };
    return {
      bpm: 84, stepsPerBar: 12, swing: 0.5, steps: 192,
      tone: {hp: 40, lp: 9000, level: 2, reverb: 0.3},
      templates: Object.keys(P).map(function(k){ return P[k]; }),
      // One set = 4-5 passes (~2.3-2.9 min): quiet start, one full melody
      // near the end, maybe one hint earlier, never two melodic passes in a row.
      makeSet: function(){
        var n = chance(0.5) ? 5 : 4, set = [];
        for(var i=0;i<n;i++) set.push(pick([P.bed, P.bed, P.bedFull, P.sparse]));
        set[0] = pick([P.sparse, P.bed]);
        set[n-2] = pick([P.tune, P.split, P.pianoTune]);
        if(n === 5 && chance(0.6)) set[1] = P.hint;
        return set;
      },
      step: function(c, io, s, t, stepDur, plan){
        var out = io.out, bar = Math.floor(s/12), inBar = s % 12, beat = stepDur*4, barLen = stepDur*12;
        if(inBar === 0){
          uprightBass(c, out, freq(bassNotes[bar]), t, beat*1.8, 2.2);
          piano(c, out, freq(bassNotes[bar])*2, t, beat*1.4, 0.8);
          cello(c, out, freq(bassNotes[bar])*2, t, barLen, 0.55);
          if(plan.inner) cello(c, out, freq(inner[bar]), t + 0.04, barLen, 0.35);
        }
        if(bar === 15 && inBar === 8) uprightBass(c, out, freq('A1'), t, beat, 1.8);
        if(inBar === 4 || (inBar === 8 && plan.chords === 2)){
          var pk = plan.chords === 2 ? (inBar === 4 ? 0.45 : 0.36) : 0.32;
          chords[bar].forEach(function(n, i){ piano(c, out, freq(n), t + i*0.01, beat*0.9, pk); });
        }
        if(!plan.melody) return;
        at(tune, s, function(e){
          var len = e.dur*stepDur, firstHalf = e.at < 96;
          switch(plan.melody){
            case 'fiddle': fiddle(c, out, e.f, t, len*0.97, 0.95); break;
            case 'hint':   if(e.at < 48) fiddle(c, out, e.f/2, t, len*0.97, 0.8); break;
            case 'piano':  if(firstHalf) piano(c, out, e.f, t, Math.max(len, beat*1.2), 1.0); break;
            case 'split':
              if(firstHalf) piano(c, out, e.f, t, Math.max(len, beat*1.2), 1.1);
              else fiddle(c, out, e.f/2, t, len*0.97, 0.9);
          }
        });
      },
      // soft final D minor after the last pass of a set
      ending: function(c, io, t, stepDur){
        var out = io.out;
        uprightBass(c, out, freq('D2'), t, 2.5, 2.0);
        cello(c, out, freq('D3'), t, 3.5, 0.5, 0.2);
        piano(c, out, freq('D3'), t, 3, 0.7);
        ['F3','A3','D4'].forEach(function(n, i){ piano(c, out, freq(n), t + 0.06 + i*0.05, 3, 0.35); });
      }
    };
  })();

  // ---------- NIGHT: D minor, slow ----------
  var NIGHT = (function(){
    // Dm | Dm | Bb | A | Dm | Gm | Bb | A7
    var roots = ['D2','D2','Bb1','A1','D2','G1','Bb1','A1'];
    var fifths = ['A2','A2','F2','E2','A2','D2','F2','E2'];
    var pianoChords = [
      ['F3','A3','D4'], null, ['F3','Bb3','D4'], ['E3','A3','C#4'],
      ['F3','A3','D4'], ['G3','Bb3','D4'], ['F3','Bb3','D4'], ['G3','C#4','E4']
    ];
    var lead = seq(
      'D5:2 F5:2 E5:2 D5:2 ' +
      'A4:6 r:2 ' +
      'r:4 D5:1 F5:1 Bb5:2 ' +
      'A5:4 C#5:4 ' +
      'D5:2 F5:2 E5:2 D5:2 ' +
      'D5:2 Bb4:2 G4:4 ' +
      'r:2 F5:2 D5:2 Bb4:2 ' +
      'A4:6 r:2', 2);
    // distant muted fiddle, low on the string, filling the gaps the celesta leaves
    var counter = seq(
      'r:8 ' +
      'r:4 F4:2 E4:2 ' +
      'D4:6 r:2 ' +
      'r:2 E4:2 G4:2 C#4:2 ' +
      'D4:8 ' +
      'r:4 Bb3:2 D4:2 ' +
      'F4:6 r:2 ' +
      'E4:4 C#4:4', 2);
    var answers = { 28: 'A5', 92: 'G5', 124: 'E5' }; // high echoes after phrase ends
    function describe(p){
      var parts = [p.lead === 'full' ? 'celesta melody' : p.lead === 'fragment' ? 'melody fragment' : 'bass and drone'];
      if(p.piano) parts.push('piano');
      if(p.counter) parts.push('fiddle');
      if(p.heartbeat) parts.push('heartbeat');
      if(p.swell) parts.push('string swell');
      return parts.join(', ');
    }
    return {
      bpm: 72, stepsPerBar: 16, swing: 0.5, steps: 128, fx: 'echo',
      tone: {hp: 35, lp: 9000, level: 1, reverb: 0.22},
      templates: [{lead: 'full', piano: true, counter: true, heartbeat: true, swell: true}],
      // One set = 5-6 passes (~2.2-2.7 min). The full melody once (never
      // first), fragments now and then but not next to it, other layers by chance.
      makeSet: function(){
        var n = chance(0.5) ? 6 : 5, full = 2 + Math.floor(Math.random() * (n - 3)), set = [];
        for(var i=0;i<n;i++){
          var p = {
            lead: i === full ? 'full' : (i > 0 && Math.abs(i - full) > 1 && chance(0.5) ? 'fragment' : null),
            piano: chance(0.7),
            heartbeat: chance(0.35),
            swell: i > 0 && chance(0.25)
          };
          p.counter = i > 0 && p.lead !== 'full' && chance(0.3);
          p.name = describe(p);
          set.push(p);
        }
        return set;
      },
      step: function(c, io, s, t, stepDur, plan){
        var out = io.out, echo = io.echo, bar = Math.floor(s/16), inBar = s % 16, barLen = stepDur*16;
        // tiptoe bass: root, root, fifth - short
        if(inBar===0 || inBar===6) uprightBass(c, out, freq(roots[bar]), t, 0.3, 2.0);
        if(inBar===10) uprightBass(c, out, freq(fifths[bar]), t, 0.3, 1.5);
        // low cello drone per bar
        if(inBar===0){
          cello(c, out, freq(roots[bar])*2, t, barLen, 0.45, 0.9);
          cello(c, out, freq(fifths[bar])*2, t + 0.1, barLen, 0.25, 1.1);
        }
        // timpani heartbeat on bars 4 and 8 (lub-dub)
        if(plan.heartbeat && (bar===3 || bar===7) && inBar===0){
          timpani(c, out, freq('D2'), t, 1.6);
          timpani(c, out, freq('D2'), t + stepDur*1.2, 1.0);
        }
        // parlor piano: one soft rolled chord on the "and" of beat 1, into the echo
        if(plan.piano && inBar === 2 && pianoChords[bar]){
          pianoChords[bar].forEach(function(n, i){ piano(c, echo, freq(n), t + i*0.04, barLen*0.7, 0.45); });
        }
        // celesta lead -> dry + echo (fragment = just the opening motif)
        if(plan.lead && (plan.lead === 'full' || s < 32)){
          at(lead, s, function(e){
            celesta(c, out, e.f, t, 2.2);
            celesta(c, echo, e.f*2, t, 0.5);
            celesta(c, echo, e.f, t, 0.8);
          });
          if(plan.lead === 'full' && answers[s]) celesta(c, echo, freq(answers[s])*2, t, 0.8);
        }
        // distant muted-fiddle counter-line
        if(plan.counter) at(counter, s, function(e){ fiddle(c, echo, e.f, t, e.dur*stepDur*0.95, 0.5); });
        // tremolo strings creep in under the last two bars
        if(plan.swell && s === 96){
          ['A2','E3','G3','C#4'].forEach(function(n){
            sampler(c, out, 'tremolo', freq(n), t, {peak: 0.45, len: barLen*2 - 0.4, a: barLen*1.6, r: 0.6, cutoff: 2600});
          });
        }
      },
      // soft final D minor after the last pass of a set
      ending: function(c, io, t, stepDur){
        uprightBass(c, io.out, freq('D2'), t, 2.5, 1.8);
        cello(c, io.out, freq('D3'), t, 4, 0.45, 0.6);
        cello(c, io.out, freq('A3'), t + 0.1, 4, 0.25, 0.8);
        celesta(c, io.echo, freq('D5'), t + 0.2, 1.4);
      }
    };
  })();

  // ---------- MENU: the main theme (menus and lobby), 4/4, 60 bpm ----------
  var MENU = (function(){
    // Dm | Dm/C# | Dm7/C | Dm6/B | Bbmaj7 | Gm6 | Em7b5 | A7b9
    // the bass sinks a half step at a time under D minor - something is not right in this town
    var arps = [
      ['D2','A2','D3','F3'], ['C#2','A2','D3','F3'], ['C2','A2','D3','F3'], ['B1','A2','D3','F3'],
      ['Bb1','F2','A2','D3'], ['G1','D2','Bb2','E3'], ['E2','Bb2','D3','G3'], ['A1','G2','C#3','Bb3']
    ];
    // rising broken chord that stops short: 16th-step -> chord note, peak
    var hits = {0: [0, 0.7], 2: [1, 0.38], 4: [2, 0.38], 6: [3, 0.42], 10: [2, 0.26]};
    var tune = seq(
      'r:2 D5:1 F5:1 E5:4   A4:6 r:2   r:2 C5:1 D5:1 F5:2 A5:2   G#5:6 r:2 ' +
      'r:2 F5:1 E5:1 D5:4   Bb4:4 r:2 E5:2   D5:3 Bb4:1 G4:4   C#5:6 r:2', 2);
    var P = {
      title:   {name: 'theme on piano, echoing',   melody: 'piano',   cello: true,  swell: true,  knock: false},
      bells:   {name: 'theme on celesta',          melody: 'celesta', cello: true,  swell: false, knock: false},
      fiddle:  {name: 'theme on distant fiddle',   melody: 'fiddle',  cello: true,  swell: false, knock: true},
      bed:     {name: 'broken chords and cello',   melody: null,      cello: true,  swell: false, knock: true},
      sparse:  {name: 'broken chords, string swell', melody: null,    cello: false, swell: true,  knock: false}
    };
    return {
      bpm: 60, stepsPerBar: 16, swing: 0.5, steps: 128, fx: 'echo',
      tone: {hp: 40, lp: 9000, level: 3.3, reverb: 0.32},
      templates: Object.keys(P).map(function(k){ return P[k]; }),
      // A menu should announce itself, so a set opens with the theme; ~2 min, then a rest.
      makeSet: function(){
        return [P.title, pick([P.bed, P.sparse]), pick([P.bells, P.fiddle]), P.sparse];
      },
      step: function(c, io, s, t, stepDur, plan){
        var out = io.out, echo = io.echo, bar = Math.floor(s/16), inBar = s % 16, barLen = stepDur*16;
        var h = hits[inBar];
        if(h) piano(c, out, freq(arps[bar][h[0]]), t, stepDur*5, h[1]);
        // cello traces the sinking bass line, slow bow
        if(plan.cello && inBar === 0) cello(c, out, freq(arps[bar][0])*2, t, barLen, 0.42, 1.0);
        // distant timpani knock under the last bar
        if(plan.knock && s === 112) timpani(c, out, freq('A1'), t, 0.9);
        // trembling strings creep in over the last two bars
        if(plan.swell && s === 96){
          ['E3','Bb3','D4'].forEach(function(n){
            sampler(c, out, 'tremolo', freq(n), t, {peak: 0.4, len: barLen*2 - 0.4, a: barLen*1.6, r: 0.8, cutoff: 2400});
          });
        }
        if(plan.melody) at(tune, s, function(e){
          var len = e.dur*stepDur;
          if(plan.melody === 'piano'){ piano(c, echo, e.f, t, Math.max(len, stepDur*6), 0.9); }
          else if(plan.melody === 'celesta'){ celesta(c, out, e.f, t, 0.9); celesta(c, echo, e.f, t, 0.35); }
          else fiddle(c, echo, e.f, t, len*0.95, 0.33);
        });
      },
      // ends hanging: D minor with the 9th on top, never quite at rest
      ending: function(c, io, t){
        ['D2','A2','F3','E4'].forEach(function(n, i){ piano(c, io.out, freq(n), t + i*0.09, 3.5, i ? 0.4 : 0.65); });
        cello(c, io.out, freq('D3'), t, 3.5, 0.4, 0.6);
        celesta(c, io.echo, freq('A5'), t + 0.5, 0.7);
      }
    };
  })();

  // ---------- VOTE: tension bed while votes are cast, 4/4, 76 bpm ----------
  var VOTE = (function(){
    // a cello pulse circling one note with a half-step "wrong" neighbour,
    // sinking D -> Bb -> A; no tune at all
    var pulse = ['D3','D3','D3','D3','Bb2','Bb2','A2','A2'];
    var neighbour = ['Eb3','Eb3','Eb3','Eb3','B2','B2','Bb2','Bb2'];
    var high = {0: 'A5', 32: 'Bb5', 64: 'A5', 96: 'G#5'};
    function plan(i){
      return {name: i === 0 ? 'cello pulse and heartbeat' : i === 1 ? '+ strings' : '+ strings and high fiddle',
              strings: i >= 1, high: i >= 2};
    }
    return {
      bpm: 76, stepsPerBar: 16, swing: 0.5, steps: 128,
      tone: {hp: 40, lp: 9000, level: 1.7, reverb: 0.25},
      templates: [plan(2)],
      // Builds over the first passes, then holds; long enough to outlast any vote.
      makeSet: function(){ var set = []; for(var i=0;i<10;i++) set.push(plan(i)); return set; },
      step: function(c, io, s, t, stepDur, p){
        var out = io.out, bar = Math.floor(s/16), inBar = s % 16, barLen = stepDur*16;
        if(inBar % 2 === 0){
          var e8 = inBar / 2, note = (e8 === 2 || e8 === 6) ? neighbour[bar] : pulse[bar];
          cello(c, out, freq(note), t, stepDur*1.6, e8 % 4 === 0 ? 0.55 : 0.4, 0.01);
        }
        if(inBar === 0 || inBar === 8) uprightBass(c, out, freq(pulse[bar]) / 2, t, stepDur*6, 1.6);
        if(bar % 2 === 0 && inBar === 0){ timpani(c, out, freq('D2'), t, 1.0); timpani(c, out, freq('D2'), t + stepDur*1.2, 0.65); }
        if(p.strings && (s === 0 || s === 64)){
          var cluster = s === 0 ? ['D3','A3','Eb4'] : ['A2','E3','Bb3'];
          cluster.forEach(function(n){ sampler(c, out, 'tremolo', freq(n), t, {peak: 0.3, len: barLen*4 - 0.3, a: barLen*2, r: 0.8, cutoff: 2400}); });
        }
        if(p.high && high[s]) fiddle(c, out, freq(high[s]), t, barLen*2 - 0.2, 0.35);
      },
      ending: function(c, io, t){ uprightBass(c, io.out, freq('D2'), t, 2, 1.5); }
    };
  })();

  // ---------- Victory cues: play once (start ~1.2 s in, after the gavel/bong) ----------
  // Each lists events on an eighth-note grid: [eighth, fn(c, io, t)].
  function cue(bpm, length8, events){
    var byStep = {};
    events.forEach(function(ev){ (byStep[ev[0]*2] = byStep[ev[0]*2] || []).push(ev[1]); });
    var only = {name: 'cue'};
    return {
      bpm: bpm, stepsPerBar: 16, swing: 0.5, steps: length8*2, once: true,
      tone: {hp: 40, lp: 9000, level: 2.4, reverb: 0.34},
      templates: [only],
      makeSet: function(){ return [only]; },
      step: function(c, io, s, t, stepDur){ (byStep[s] || []).forEach(function(fn){ fn(c, io, t, stepDur); }); }
    };
  }
  function chordAt(at8, notes, peak, len){
    return [at8, function(c, io, t){ notes.forEach(function(n, i){ piano(c, io.out, freq(n), t + i*0.045, len, i ? peak : peak*1.4); }); }];
  }
  function line(start8, str, play){
    return seq(str, 1).events.map(function(e){
      return [start8 + e.at, function(c, io, t, stepDur){ play(c, io, e.f, t, e.dur*stepDur*2); }];
    });
  }
  // Town: the motif finally resolves into D major.
  var WIN_TOWN = cue(72, 40, [].concat(
    line(3, 'D5:2 F#5:2 E5:2 D5:2 A5:6 G5:2 F#5:4 E5:4 D5:12', function(c, io, f, t, len){ fiddle(c, io.out, f, t, len*0.97, 1.0); }),
    [chordAt(3,  ['D2','A2','D3','F#3','A3'], 0.45, 3.4),
     chordAt(11, ['G1','D2','G2','B2','D3'],  0.45, 3.4),
     chordAt(19, ['A1','E2','G2','C#3','E3'], 0.45, 3.4),
     chordAt(27, ['D2','A2','D3','F#3','A3','D4'], 0.5, 6),
     [3,  function(c, io, t){ cello(c, io.out, freq('D3'), t, 3.2, 0.5); }],
     [11, function(c, io, t){ cello(c, io.out, freq('G2'), t, 3.2, 0.5); }],
     [19, function(c, io, t){ cello(c, io.out, freq('A2'), t, 3.2, 0.5); }],
     [27, function(c, io, t){ cello(c, io.out, freq('D3'), t, 6, 0.5); }],
     [28, function(c, io, t){ ['F#5','A5','D6'].forEach(function(n, i){ celesta(c, io.out, freq(n), t + i*0.18, 1.3); }); }]]
  ));
  // Mafia: a timpani roll, the motif low on cello, a dark tolling end.
  var WIN_MAFIA = cue(56, 32, [].concat(
    [0,1,2,3,4,5].map(function(i){ return [2 + i * 0.5, function(c, io, t){ timpani(c, io.out, freq('D2'), t, 0.3 + i*0.18); }]; }),
    [[5, function(c, io, t){ timpani(c, io.out, freq('D2'), t, 1.8); }]],
    line(5, 'D3:2 F3:2 E3:2 D3:2 A2:8', function(c, io, f, t, len){ cello(c, io.out, f, t, len*0.97, 0.9, 0.15); }),
    [[5, function(c, io, t, stepDur){ ['A2','D3','F3'].forEach(function(n){ sampler(c, io.out, 'tremolo', freq(n), t, {peak: 0.35, len: stepDur*32, a: stepDur*24, r: 1.2, cutoff: 2000}); }); }],
     chordAt(13, ['D2','A2'], 0.6, 4),
     chordAt(21, ['D2','A2','D3','F3'], 0.55, 6),
     [21, function(c, io, t){ timpani(c, io.out, freq('D2'), t, 1.4); }],
     [23, function(c, io, t){ celesta(c, io.out, freq('D6'), t, 1.1); }]]
  ));
  // Bounty hunter: sly and unresolved.
  var WIN_BOUNTY = cue(66, 28, [].concat(
    line(3, 'D5:1 F5:1 E5:1 D5:1 A5:2 r:2 B5:2 A5:2 F5:2 D5:2', function(c, io, f, t){ celesta(c, io.out, f, t, 1.6); }),
    [[3,  function(c, io, t){ uprightBass(c, io.out, freq('D2'), t, 0.8, 1.8); }],
     [7,  function(c, io, t){ uprightBass(c, io.out, freq('A1'), t, 0.8, 1.6); }],
     [11, function(c, io, t){ uprightBass(c, io.out, freq('B1'), t, 0.8, 1.6); }],
     [15, function(c, io, t){ uprightBass(c, io.out, freq('A1'), t, 0.8, 1.6); }],
     chordAt(19, ['D2','A2','D3','F3','B3'], 0.5, 5),
     [19, function(c, io, t){ celesta(c, io.out, freq('D6'), t + 0.3, 1.0); }]]
  ));

  var THEMES = {day: DAY, night: NIGHT, menu: MENU, vote: VOTE,
                'win-town': WIN_TOWN, 'win-mafia': WIN_MAFIA, 'win-bounty': WIN_BOUNTY};
  // Sets run back to back: the closing chord rings out (ENDING_RING) and the next set begins, so a
  // theme keeps playing for as long as its phase lasts instead of dropping into a minute of silence.
  var REST_MIN = 0, REST_MAX = 2;      // seconds of silence between sets, on top of the ending's ring-out
  var ENDING_RING = 4;                 // seconds the final chord is allowed to ring

  // ---------- per-theme signal chain ----------
  //   instruments -> [echo] -> tone filter -> dry + foggy room reverb -> bus -> dest
  var irCache = new WeakMap();
  function roomImpulse(c){
    var b = irCache.get(c);
    if(b) return b;
    var len = Math.floor(c.sampleRate * 2.8);
    b = c.createBuffer(2, len, c.sampleRate);
    for(var ch=0; ch<2; ch++){
      var d = b.getChannelData(ch), lp = 0;
      for(var i=0;i<len;i++){
        // decaying noise, smoothed so the tail is dark (fog, not a tiled bathroom)
        lp += (Math.random()*2-1 - lp) * 0.35;
        d[i] = lp * Math.pow(1 - i/len, 3.2);
      }
    }
    irCache.set(c, b);
    return b;
  }
  function makeBus(c, dest, theme){
    var bus = c.createGain();
    bus.gain.value = 0;
    bus.connect(dest);
    var tp = theme.tone;
    var input = c.createGain(), hp = c.createBiquadFilter(), lp = c.createBiquadFilter(), post = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = tp.hp; hp.Q.value = 0.6;
    lp.type = 'lowpass'; lp.frequency.value = tp.lp; lp.Q.value = 0.6;
    post.gain.value = tp.level;
    input.connect(hp); hp.connect(lp); lp.connect(post); post.connect(bus);
    var verb = c.createConvolver(), wet = c.createGain();
    verb.buffer = roomImpulse(c); wet.gain.value = tp.reverb;
    post.connect(verb); verb.connect(wet); wet.connect(bus);
    var echoIn = input;
    if(theme.fx === 'echo'){
      echoIn = c.createGain();
      var d = c.createDelay(2), fb = c.createGain(), elp = c.createBiquadFilter();
      d.delayTime.value = 60/theme.bpm * 0.75; // dotted eighth
      fb.gain.value = 0.42; elp.type = 'lowpass'; elp.frequency.value = 2200;
      echoIn.connect(input); echoIn.connect(d); d.connect(elp); elp.connect(fb); fb.connect(d); elp.connect(input);
    }
    return {bus: bus, io: {out: input, echo: echoIn}};
  }
  function stepTime(theme, startTime, n){
    var stepDur = 60/theme.bpm/4;
    var t = startTime + n*stepDur;
    if(n % 4 === 2) t += (theme.swing - 0.5) * stepDur * 2; // swing the off-beat eighth (0.5 = straight)
    return t;
  }

  // ---------- live engine ----------
  // A player runs one theme: a set of passes, a soft ending, a rest, a new set...
  var ctx = null, master = null, duckNode = null, volume = 0.6, players = [], currentName = null, timer = null, lastFinished = null;
  var LOOKAHEAD = 0.15;
  var DUCK_LEVEL = 0.3, DUCK_HOLD = 1.2, ducked = false, unduckTimer = null;
  function ensureCtx(){
    if(ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    ctx = new AC();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = volume;
    duckNode = ctx.createGain(); duckNode.gain.value = ducked ? DUCK_LEVEL : 1;
    master.connect(duckNode); duckNode.connect(comp); comp.connect(ctx.destination);
    // Browsers keep audio suspended until the first click/key press.
    function wake(){ if(ctx.state === 'suspended') ctx.resume(); }
    document.addEventListener('pointerdown', wake, true);
    document.addEventListener('keydown', wake, true);
    return ctx;
  }
  function setDuckTarget(level, seconds){
    if(!duckNode) return;
    var now = ctx.currentTime;
    duckNode.gain.cancelScheduledValues(now);
    duckNode.gain.setValueAtTime(duckNode.gain.value, now);
    duckNode.gain.linearRampToValueAtTime(level, now + seconds);
  }
  function tick(){
    var now = ctx.currentTime;
    players.forEach(function(p){
      var theme = p.theme, stepDur = 60/theme.bpm/4;
      while(!p.stopped){
        if(p.restUntil != null){
          if(p.restUntil > now + LOOKAHEAD) break;
          p.origin = p.restUntil; p.n = 0; p.set = theme.makeSet(); p.restUntil = null;
        }
        var t = stepTime(theme, p.origin, p.n);
        if(t >= now + LOOKAHEAD) break;
        t = Math.max(now + 0.05, t);
        try{
          if(p.n >= p.set.length * theme.steps){
            if(theme.ending) theme.ending(ctx, p.io, t, stepDur);
            if(theme.once){
              // one-shot cue: let it ring out, then retire the player
              p.stopped = true; p.finished = true; lastFinished = p.name;
              setTimeout(function(){ p.dead = true; p.bus.disconnect(); }, 12000);
              break;
            }
            p.restUntil = t + ENDING_RING + REST_MIN + Math.random() * (REST_MAX - REST_MIN);
            continue;
          }
          theme.step(ctx, p.io, p.n % theme.steps, t, stepDur, p.set[Math.floor(p.n / theme.steps)]);
        }catch(e){ console.warn('[HollowMusic]', e); }
        p.n++;
      }
    });
    players = players.filter(function(p){ return !p.dead; });
    if(!players.length){ clearInterval(timer); timer = null; }
  }
  function fadeOut(p, secs){
    var now = ctx.currentTime;
    p.bus.gain.cancelScheduledValues(now);
    p.bus.gain.setValueAtTime(p.bus.gain.value, now);
    p.bus.gain.linearRampToValueAtTime(0, now + secs);
    setTimeout(function(){ p.stopped = true; }, secs*1000);
    setTimeout(function(){ p.dead = true; p.bus.disconnect(); }, secs*1000 + 3500);
  }
  function startTheme(name){
    var theme = THEMES[name], c = ctx;
    players.forEach(function(p){ if(!p.stopped) fadeOut(p, 2.5); });
    var b = makeBus(c, master, theme);
    var p = {name: name, theme: theme, bus: b.bus, io: b.io, origin: c.currentTime + 0.1, n: 0, set: theme.makeSet(), restUntil: null};
    b.bus.gain.setValueAtTime(0, c.currentTime);
    b.bus.gain.linearRampToValueAtTime(1, c.currentTime + (players.length ? 3 : 0.6));
    players.push(p);
    if(!timer) timer = setInterval(tick, 25);
    tick();
  }

  window.HollowMusic = {
    load: load,
    play: function(name){
      if(!THEMES[name] || name === currentName) return;
      var c = ensureCtx(); if(!c) return;
      if(c.state === 'suspended') c.resume();
      currentName = name;
      load(name).then(function(){ if(currentName === name) startTheme(name); });
    },
    stop: function(secs){
      currentName = null;
      if(!ctx) return;
      var t = typeof secs === 'number' ? secs : 1.5;
      players.forEach(function(p){ if(!p.stopped) fadeOut(p, t); });
    },
    setVolume: function(v){
      volume = Math.max(0, Math.min(1, v));
      if(master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    },
    current: function(){ return currentName; },
    // Duck under speech: down quickly while someone talks, back up gently
    // once they've been quiet for a moment (so pauses between words don't pump).
    duck: function(active){
      active = !!active;
      if(active){
        if(unduckTimer){ clearTimeout(unduckTimer); unduckTimer = null; }
        if(!ducked){ ducked = true; setDuckTarget(DUCK_LEVEL, 0.25); }
      } else if(ducked && !unduckTimer){
        unduckTimer = setTimeout(function(){
          unduckTimer = null; ducked = false; setDuckTarget(1, 1.5);
        }, DUCK_HOLD * 1000);
      }
    },
    isDucked: function(){ return ducked; },
    status: function(){
      var p = players.filter(function(x){ return !x.stopped; }).pop();
      if(!p){
        if(!currentName) return null;
        var done = lastFinished === currentName;
        return done ? {theme: currentName, finished: true} : {theme: currentName, loading: true};
      }
      var now = ctx.currentTime, stepDur = 60/p.theme.bpm/4;
      if(p.restUntil != null) return {theme: p.name, resting: Math.max(0, Math.round(p.restUntil - now))};
      var heard = Math.max(0, Math.floor((now - p.origin) / stepDur));
      var pass = Math.min(p.set.length - 1, Math.floor(heard / p.theme.steps));
      return {
        theme: p.name, pass: pass + 1, of: p.set.length,
        now: p.set[pass].name,
        next: pass + 1 < p.set.length ? p.set[pass + 1].name : 'ending, then a rest',
        secondsLeftInPass: Math.round((p.theme.steps - heard % p.theme.steps) * stepDur)
      };
    },

    // Offline render of one set and its ending, for a WAV or level checks.
    render: function(name, seconds){
      return load(name).then(function(){
        var theme = THEMES[name], rate = 44100, stepDur = 60/theme.bpm/4;
        var plans = theme.makeSet();
        if(!seconds) seconds = plans.length * theme.steps * stepDur + ENDING_RING + 1;
        var c = new OfflineAudioContext(2, Math.ceil(rate*seconds), rate);
        var comp = c.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 3;
        var m = c.createGain(); m.gain.value = volume; m.connect(comp); comp.connect(c.destination);
        var b = makeBus(c, m, theme);
        b.bus.gain.value = 1;
        // Schedule in 1-second chunks (suspend/resume) so only a few seconds of
        // notes exist at once - queuing a whole song up front gets very slow.
        // One set, then its ending; anything after that is silence (the rest).
        var n = 0, ended = false;
        function scheduleUntil(limit){
          for(;;){
            var t = stepTime(theme, 0.1, n);
            if(t >= limit || t >= seconds - 0.5) return;
            if(n >= plans.length * theme.steps){
              if(!ended){ if(theme.ending) theme.ending(c, b.io, t, stepDur); ended = true; }
              return;
            }
            theme.step(c, b.io, n % theme.steps, t, stepDur, plans[Math.floor(n / theme.steps)]);
            n++;
          }
        }
        scheduleUntil(1.5);
        for(var k=1; k < Math.floor(seconds); k++){
          (function(k){
            c.suspend(k).then(function(){ scheduleUntil(k + 1.5); c.resume(); });
          })(k);
        }
        return c.startRendering().then(function(buf){ buf.plans = plans.map(function(p){ return p.name; }); return buf; });
      });
    },
    loopSeconds: function(name){ var t = THEMES[name]; return t.steps * 60/t.bpm/4; },
    toWav: function(buf){
      var ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
      var ab = new ArrayBuffer(44 + len*ch*2), v = new DataView(ab), o = 0;
      function str(s){ for(var i=0;i<s.length;i++) v.setUint8(o++, s.charCodeAt(i)); }
      function u32(x){ v.setUint32(o, x, true); o += 4; }
      function u16(x){ v.setUint16(o, x, true); o += 2; }
      str('RIFF'); u32(36 + len*ch*2); str('WAVE'); str('fmt '); u32(16); u16(1); u16(ch);
      u32(rate); u32(rate*ch*2); u16(ch*2); u16(16); str('data'); u32(len*ch*2);
      var data = []; for(var k=0;k<ch;k++) data.push(buf.getChannelData(k));
      for(var i=0;i<len;i++) for(var j=0;j<ch;j++){
        var s = Math.max(-1, Math.min(1, data[j][i]));
        v.setInt16(o, s < 0 ? s*0x8000 : s*0x7FFF, true); o += 2;
      }
      return new Blob([ab], {type: 'audio/wav'});
    }
  };
})();
