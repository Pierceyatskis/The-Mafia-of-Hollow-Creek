// Hollow Creek - language filter for everything players can type (chat, whispers, polls, names).
//
// check(text) -> { ok: true } or { ok: false, reason: '<category>', word: '<what matched>' }
//
// Goals: block swearing, slurs, sexual language and hate speech, INCLUDING the usual ways of dodging a filter
// (@ss, sh1t, f*ck, f u c k, fuuuuck, accented letters, look-alike letters from other alphabets, zero-width characters,
// words glued together), without blocking innocent words that merely contain a bad one ("class", "assassin",
// "Scunthorpe", "cocktail", "therapist", "this hit"). The trick is to match whole words (after cleaning them up) almost
// everywhere, and to look INSIDE a word only for terms that never appear in an innocent word.
//
// A mafia game is full of killing, so violence words (kill, murder, stab, hang, shoot, die) are deliberately NOT banned;
// only telling a real person to harm themselves is. Mild words ("damn", "hell", "crap") are allowed - add them to
// WORDS.mild below if you want them blocked too.
//
// To add or remove words, edit the lists below. Write the plain spelling; the cleaning step handles the disguises.
'use strict';

// ---------------------------------------------------------------- the word lists
const WORDS = {
  // strong swearing and crude language
  profanity: [
    'fuck', 'fucker', 'fuckers', 'fucking', 'fucked', 'fucks', 'fuk', 'fuks', 'fuking', 'fuker', 'fck', 'fcking', 'fuq', 'fucc', 'fvck', 'phuck', 'effing',
    'motherfucker', 'motherfuckers', 'mofo', 'mfer', 'mf', 'wtf', 'stfu', 'gtfo', 'omfg', 'lmfao', 'fml',
    'shit', 'shits', 'shitty', 'shite', 'shyt', 'sht', 'shitting', 'shitter', 'bullshit', 'horseshit', 'dipshit', 'shithead', 'shitface', 'bs',
    'bitch', 'bitches', 'bitchy', 'biatch', 'btch', 'bytch', 'bich', 'bitching', 'sonofabitch',
    'bastard', 'bastards', 'asshole', 'assholes', 'arsehole', 'arseholes', 'ass', 'asses', 'arse', 'asshat', 'asswipe', 'jackass', 'dumbass', 'smartass', 'badass', 'fatass', 'dumass', 'azz',
    'piss', 'pissed', 'pissing', 'pisser',
    'dick', 'dicks', 'dickhead', 'dickheads', 'dik', 'cock', 'cocks', 'cocksucker', 'cocksuckers',
    'pussy', 'pussies', 'cunt', 'cunts', 'twat', 'twats', 'slut', 'sluts', 'slutty', 'whore', 'whores', 'skank', 'skanks', 'hoebag',
    'wank', 'wanker', 'wankers', 'wanking', 'bollocks', 'bellend', 'knobhead', 'tosser', 'douche', 'douchebag', 'douchebags', 'douchey', 'prick'
  ],
  // sexual words
  sexual: [
    'sex', 'sexy', 'sexting', 'penis', 'penises', 'vagina', 'vaginas', 'dildo', 'dildos', 'blowjob', 'blowjobs', 'handjob', 'rimjob', 'cum', 'cums', 'cumming', 'cumshot',
    'porn', 'porno', 'pornography', 'orgasm', 'orgasms', 'masturbate', 'masturbating', 'masturbation', 'jerkoff', 'jackoff', 'horny', 'boob', 'boobs', 'boobies', 'tits', 'titties',
    'nudes', 'milf', 'erection', 'boner', 'nipple', 'nipples', 'testicles', 'scrotum', 'clitoris', 'clit', 'fetish', 'incest', 'molest', 'molester', 'pedo', 'pedophile', 'paedophile', 'pedophilia',
    'rape', 'raped', 'raping', 'rapist', 'rapists', 'anus', 'butthole', 'buttsex', 'bukkake', 'hentai', 'smegma', 'gangbang', 'threesome', 'orgy', 'whorehouse'
  ],
  // racial / ethnic slurs
  racial: [
    'nigger', 'niggers', 'nigga', 'niggas', 'niggah', 'niggaz', 'nigguh', 'niggress', 'negro', 'negroes', 'coon', 'coons', 'darkie', 'darky', 'jigaboo', 'jiggaboo', 'pickaninny', 'sambo', 'porchmonkey',
    'spic', 'spick', 'spics', 'wetback', 'wetbacks', 'beaner', 'beaners', 'chink', 'chinks', 'gook', 'gooks', 'slanteye', 'zipperhead', 'chinaman', 'jap', 'japs',
    'kike', 'kikes', 'heeb', 'yid', 'yids', 'raghead', 'ragheads', 'towelhead', 'towelheads', 'sandnigger', 'camel jockey', 'paki', 'pakis',
    'redskin', 'redskins', 'squaw', 'injun', 'wop', 'wops', 'dago', 'dagos', 'honky', 'honkey', 'cracka', 'whitey', 'halfbreed'
  ],
  // slurs about sexuality, gender or disability
  identity: [
    'fag', 'fags', 'faggot', 'faggots', 'faggy', 'fagot', 'dyke', 'dykes', 'tranny', 'trannies', 'shemale', 'ladyboy', 'lesbo', 'lesbos',
    'retard', 'retards', 'retarded', 'retardation', 'tard', 'tards', 'spaz', 'spazz', 'spastic', 'mongoloid', 'sperg', 'downie'
  ],
  // hate groups and slogans
  hate: [
    'nazi', 'nazis', 'neonazi', 'kkk', 'klansman', 'heil', 'sieg', 'hitler', 'goebbels', 'swastika', 'holocaust denial', 'whitepower', 'whitepride', 'whitesupremacy', 'whitesupremacist', 'gaschamber'
  ],
  // telling someone to hurt themselves (violence inside the game's story is fine; this is aimed at a real person)
  selfharm: [
    'kys', 'kms', 'killyourself', 'killurself', 'killyoself', 'killyaself', 'killyourselfs', 'hangyourself', 'shootyourself', 'cutyourself', 'drinkbleach', 'gokillyourself', 'goandkillyourself',
    'nooseyourself', 'ropeyourself', 'unaliveyourself', 'unaliveurself', 'k y s'
  ],
  // optional: add milder words here (they are checked like the rest)
  mild: []
};

// Words that are still bad when they are the BEGINNING, MIDDLE or END of a longer glued-together word ("shithead",
// "bullshitter", "xXfuckXx", "fuckyou"), because no innocent word contains them. Short or ambiguous words (ass, cum, cock,
// rape, tit, sex, jap, homo, tard, anus...) are NOT here: they only count as whole words, so "class", "cocktail",
// "therapist", "grape", "title", "Essex", "mustard" and "Japan" are safe.
const INSIDE = [
  'fuck', 'motherfuck', 'shit', 'bitch', 'bastard', 'asshole', 'arsehole', 'cunt', 'dickhead', 'cocksuck', 'nigger', 'nigga', 'faggot', 'whore', 'pussy',
  'killyourself', 'killurself', 'hangyourself', 'heilhitler', 'whitepower', 'whitepride', 'jackass', 'dumbass', 'slut', 'blowjob', 'handjob', 'masturbat', 'pedophil', 'paedophil', 'cumshot', 'dildo'
];
// ...except where an innocent word genuinely contains one of them.
const INSIDE_OK = ['scunthorpe', 'cunthorpe', 'mishit', 'shiitake', 'cocksure', 'hitchcock', 'analyst', 'shitake', 'basshit', 'whorl', 'whorled', 'dickens', 'dickinson', 'dickson', 'yoshita', 'kinoshita', 'takeshita', 'matsushita', 'nishita', 'ishita', 'toshita', 'washita', 'hoshita', 'hashita'];

// Phrases (checked word by word, in order).
const PHRASES = [
  'kill yourself', 'kill your self', 'kill urself', 'kill ur self', 'kill yo self', 'go kill yourself', 'hang yourself', 'shoot yourself', 'end yourself', 'off yourself', 'neck yourself',
  'heil hitler', 'sieg heil', 'white power', 'white pride', 'white supremacy', 'gas the jews', 'gas chamber', 'blow job', 'hand job', 'rim job', 'jerk off', 'jack off', 'eat shit', 'suck my', 'suck a dick',
  'son of a bitch', 'go to hell fucker', 'die in a fire', 'hope you die', 'hope u die', 'go die', 'drink bleach', 'rope yourself'
];

// Words that are clearly a banned word with a space dropped into them ("fu ck", "sh it", "b itch", "pu ssy").
const JOINABLE = new Set(['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'douche', 'whore', 'slut', 'bastard', 'nigger', 'nigga', 'faggot', 'asshole', 'motherfucker', 'twat', 'wanker']);

// ---------------------------------------------------------------- cleaning
const CONFUSABLE = {   // letters from other alphabets that look like Latin ones
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'κ': 'k', 'ι': 'i', 'υ': 'u', 'ν': 'v', 'τ': 't', 'χ': 'x', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'ß': 'ss', 'æ': 'ae'
};
const LEET = { '@': 'a', '4': 'a', '^': 'a', '8': 'b', '(': 'c', '<': 'c', '{': 'c', '3': 'e', '€': 'e', '6': 'g', '#': 'h', '!': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's', '§': 's', '7': 't', '+': 't', '2': 'z', '£': 'e' };
const CENSOR = /[*#%&?~_.\-·•]/;   // characters people use to "bleep" a letter: f**k, sh*t

function baseClean(text) {
  let s = String(text == null ? '' : text);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');                 // accents off, fullwidth -> normal
  s = s.replace(/[​-‏‪-‮⁠-⁤﻿­͏؜ᅟᅠ឴឵᠎]/g, '');   // invisible characters
  s = s.toLowerCase();
  let out = '';
  for (const ch of s) out += CONFUSABLE[ch] !== undefined ? CONFUSABLE[ch] : ch;
  return out;
}
const hasLetter = w => /[a-z]/.test(w);

// all the ways a chunk of text might be a disguised word: leet-speak substituted, "1" as either i or l, repeats squeezed
function variants(chunk) {
  const out = new Set();
  const bare = chunk.replace(/^[(<{\[]+|[)>}\]]+$/g, '');       // "(ass)", "<shit>"
  if (bare !== chunk && bare) variants(bare).forEach(v => out.add(v));
  const core = chunk.replace(/^[^a-z0-9@$!|+(<{^#*]+|[^a-z0-9@$!|+(>}*)^#]+$/g, '').replace(/[!?.]+$/g, '').replace(/^[!?.]+/, '');
  if (!core) return out;
  if (!/[a-z@$]/.test(core)) return out;               // "455": numbers alone are not words (but "@$$" is)
  const make = (oneAs) => {
    let w = '';
    for (const ch of core) {
      if (/[a-z]/.test(ch)) w += ch;
      else if (ch === '1') w += oneAs;
      else if (LEET[ch]) w += LEET[ch];
      else if (CENSOR.test(ch)) w += '*';              // a bleeped-out letter: matches anything
    }
    return w;
  };
  [make('i'), make('l')].forEach(w => {
    if (!w) return;
    const forms = [w, w.replace(/(.)\1{2,}/g, '$1$1')];       // fuuuuck -> fuuck
    const one = w.replace(/(.)\1+/g, '$1');                   // fuuuuck -> fuck (only for longer words: "bbs" must not become "bs")
    if (one.length >= 4) forms.push(one);
    forms.slice().forEach(f => { forms.push(f.replace(/ph/g, 'f')); forms.push(f.replace(/vv/g, 'w')); forms.push(f.replace(/v/g, 'u')); });
    forms.forEach(f => out.add(f));
  });
  return out;
}

// ---------------------------------------------------------------- matching
const ALL = new Map();           // exact whole-word entries -> category
Object.keys(WORDS).forEach(cat => WORDS[cat].forEach(w => { const k = baseClean(w).replace(/[^a-z]/g, ''); if (k && !ALL.has(k)) ALL.set(k, cat); }));
const SUFFIXES = ['s', 'es', 'ed', 'er', 'ers', 'ing', 'ish', 'head', 'face'];
const SUFFIX_OK = new Set(['fuck', 'shit', 'bitch', 'dick', 'cock', 'pussy', 'cunt', 'whore', 'slut', 'piss', 'wank', 'douche', 'bastard', 'ass', 'arse', 'twat', 'skank', 'spaz', 'retard', 'nazi']);   // words that really take these endings

function wholeWord(w) {
  if (ALL.has(w)) return { cat: ALL.get(w), word: w };
  for (const suf of SUFFIXES) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const stem = w.slice(0, -suf.length);
      const stems = [stem]; if (stem.length > 3 && stem[stem.length - 1] === stem[stem.length - 2]) stems.push(stem.slice(0, -1));   // "slutted"
      for (const c of stems) if (SUFFIX_OK.has(c) && ALL.has(c)) return { cat: ALL.get(c), word: c };
    }
  }
  return null;
}
function inside(w) {
  if (w.length < 4) return null;
  for (const ok of INSIDE_OK) if (w.includes(ok)) w = w.split(ok).join(' ');
  for (const bad of INSIDE) if (w.includes(bad)) return { cat: 'profanity', word: bad };
  return null;
}
// a bleeped word: "f**k" matches "fuck" letter for letter, with each star matching one letter
const NO_BLEEP = new Set(['mf', 'bs', 'kys', 'kms', 'wtf', 'fml', 'yid', 'wop', 'jap', 'tit', 'cum', 'sex', 'fuc', 'dik', 'sht', 'azz']);   // too short / too ambiguous to guess at
function bleeped(w) {
  if (!w.includes('*')) return null;
  const real = w.replace(/\*/g, '').length;
  if (real < 2 || w.length < 4 && real < 2) return null;
  const re = new RegExp('^' + w.replace(/\*/g, '.') + '$');
  for (const [k, cat] of ALL) if (k.length === w.length && !NO_BLEEP.has(k) && re.test(k)) return { cat, word: k };
  return null;
}
const hitOf = v => (v.includes('*') ? bleeped(v) : (wholeWord(v) || inside(v)));

function check(text) {
  const cleaned = baseClean(text);
  if (!cleaned.trim()) return { ok: true };
  const chunks = cleaned.split(/\s+/).filter(Boolean);
  const plainWords = [];
  // 1. word by word (with every disguise undone)
  for (let i = 0; i < chunks.length; i++) {
    const first = variants(chunks[i]).values().next().value;
    const plain = (first && !first.includes('*')) ? first : chunks[i].replace(/[^a-z]/g, ''); if (plain) plainWords.push(plain);
    for (const v of variants(chunks[i])) { const hit = hitOf(v); if (hit) return { ok: false, reason: hit.cat, word: hit.word }; }
    // joined with a dash, dot or underscore: "fuck-you", "shit_head"
    const bits = chunks[i].split(/[-_./\\,|\u00b7\u2022]+/).filter(Boolean);
    if (bits.length > 1) for (const b of bits) for (const v of variants(b)) { const hit = hitOf(v); if (hit) return { ok: false, reason: hit.cat, word: hit.word }; }
    // spelled out with separators inside one chunk: f.u.c.k  f-u-c-k  f_u_c_k
    const parts = chunks[i].split(/[.\-_*,\/\\\u00b7\u2022|]+/).filter(Boolean);
    if (parts.length >= 3 && parts.every(p => p.length === 1)) for (const v of variants(parts.join(''))) { const hit = wholeWord(v); if (hit) return { ok: false, reason: hit.cat, word: hit.word }; }
  }
  // 2. letters spaced out: "f u c k", "s h i t", "a $ s"
  const single = c => { const k = c.replace(/[^a-z0-9@$!|+]/g, ''); return k.length === 1 ? k : null; };
  for (let i = 0; i < chunks.length; i++) {
    if (!single(chunks[i])) continue;
    let j = i, run = '';
    while (j < chunks.length && single(chunks[j])) { run += single(chunks[j]); j++; }
    if (run.length >= 3 && /[a-z]/.test(run)) {
      for (let a = 0; a + 3 <= run.length; a++) for (let b = a + 3; b <= Math.min(run.length, a + 12); b++) {      // a banned word anywhere inside the run of single letters
        for (const v of variants(run.slice(a, b))) { const hit = wholeWord(v); if (hit) return { ok: false, reason: hit.cat, word: hit.word }; }
      }
    }
    i = j - 1;
  }
  // 3. a banned word with a space dropped into it: "fu ck", "sh it", "b itch"
  for (let i = 0; i + 1 < chunks.length; i++) {
    for (let n = 2; n <= 3 && i + n <= chunks.length; n++) {
      const group = chunks.slice(i, i + n).map(c => c.replace(/[^a-z0-9@$!|+]/g, ''));
      if (group.some(g => !g) || group.every(g => g.length === 1)) continue;
      if (group.reduce((a, g) => a + g.length, 0) > 9 || group.every(g => g.length > 3)) continue;               // fragments, not two ordinary words
      for (const v of variants(group.join(''))) if (JOINABLE.has(v)) return { ok: false, reason: ALL.get(v) || 'profanity', word: v };
    }
  }
  // 4. phrases ("kill yourself", "white power")
  const sentence = ' ' + plainWords.join(' ') + ' ';
  for (const p of PHRASES) if (sentence.includes(' ' + p + ' ')) return { ok: false, reason: PHRASE_KIND(p), word: p };
  // 5. the same phrases glued together: "killyourself", "heilhitler"
  for (const w of plainWords) for (const p of GLUED) if (w.includes(p)) return { ok: false, reason: PHRASE_KIND(p), word: p };
  return { ok: true };
}
const PHRASE_KIND = p => (/heil|white|gas|sieg/.test(p) ? 'hate' : /kill|hang|shoot|end|off|neck|rope|bleach|die/.test(p) ? 'selfharm' : 'profanity');
const GLUED = ['killyourself', 'killurself', 'hangyourself', 'heilhitler', 'whitepower', 'whitepride'];

const isClean = text => check(text).ok;

module.exports = { check, isClean, WORDS, INSIDE, PHRASES };
