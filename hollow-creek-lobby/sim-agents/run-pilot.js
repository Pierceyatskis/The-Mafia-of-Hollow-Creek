// Naive-AI pilot: several fresh Claude players learn the game from the tutorial text alone, then play a real
// game against each other on the real server, using only what a player can use in the app.
//
//   node sim-agents/run-pilot.js [--players=6] [--model=haiku] [--fake]
//
// What each AI player gets (and nothing else):
//   * the in-game tutorial text and its own role card (read straight from public/tutorial.js and index.html)
//   * a text version of its screen: roster, news, chat, timer, heat. It does NOT get vote history, notes or
//     older chat unless it opens them, exactly like the Notebook in the app.
//   * the app's own actions as tools: open the notebook / a player page / vote lookup, mark a player, write a note,
//     read older chat, talk in town chat, vote, use a night power.
// Each AI is a separate headless `claude -p` call with every Claude tool switched off (no files, no shell), and a
// fresh context every time, so the notebook is its only memory - if it does not write something down, or
// look at it again, it has forgotten it. Everything is logged so we can see what they tried, got wrong and learned.
// --fake replaces the model with a simple scripted player so the plumbing can be tested for free.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const ARG = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const FAKE = process.argv.includes('--fake');
const N = Number(ARG('players')) || 6;
const MODEL = ARG('model') || 'haiku';
const ROOT = path.join(__dirname, '..');
const PORT = 19000 + Math.floor(Math.random() * 900);
const OUT = path.join(ARG('out') || path.join(os.tmpdir(), 'hollow-pilot'), new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAMES = ['Ada', 'Bram', 'Cora', 'Dex', 'Edna', 'Finn', 'Gus', 'Hana'];
const DUR = FAKE
  ? { NIGHT_DURATION_MS: 12000, DAY_DISCUSS_DURATION_MS: 15000, DAY_VOTE_DURATION_MS: 10000, DAY_REVEAL_DURATION_MS: 3000 }
  : { NIGHT_DURATION_MS: 100000, DAY_DISCUSS_DURATION_MS: 150000, DAY_VOTE_DURATION_MS: 90000, DAY_REVEAL_DURATION_MS: 10000 };

// ---------------------------------------------------------------- game text the players are allowed to know
function stripHtml(s) {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<li>/gi, '- ').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&hellip;/g, '...').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ').replace(/\\'/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
function tutorialText() {
  const src = fs.readFileSync(path.join(ROOT, 'public/tutorial.js'), 'utf8');
  const out = [];
  const re = /add\(\{([\s\S]*?)\}\);?\s*(?=\n\s*(?:add\(|\/\/|\w|\}))/g;
  let m;
  const str = "'((?:[^'\\\\]|\\\\.)*)'";
  while ((m = re.exec(src))) {
    const body = m[1];
    const t = new RegExp('title:' + str).exec(body), x = new RegExp('(?:^|[ ,{])text:' + str).exec(body);
    if (t && x) out.push('* ' + stripHtml(t[1]) + ': ' + stripHtml(x[1]));
  }
  return out.join('\n');
}
function roleCards() {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const grab = name => { const m = new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\n\\});').exec(html); return m ? new Function('return ' + m[1])() : {}; };
  return { bio: grab('ROLE_BIO'), points: grab('ROLE_POINTS') };
}
const TUTORIAL = tutorialText();
const CARDS = roleCards();
const TEAM = r => (['Godfather', 'Mafia', 'DoubleAgent', 'Consigliere', 'Framer', 'Hitman'].includes(r) ? 'Mafia' : r === 'BountyHunter' ? 'Neutral (own win condition)' : 'Town');
const NIGHT_KEYS = { Godfather: ['kill', 'silence'], Mafia: ['kill'], DoubleAgent: ['kill'], Framer: ['kill', 'frameTarget'], Consigliere: ['kill', 'consigliereInvestigate'], Detective: ['investigate'], Doctor: ['protect'], Coward: ['hideBehind'], BountyHunter: ['bounty'], Vigilante: ['vigilanteKill'] };
const KEY_HELP = { kill: 'kill: pick who the family eliminates tonight', silence: 'silence (optional): stop one player speaking tomorrow', investigate: 'investigate: learn whether one player reads guilty / innocent / suspicious', protect: 'protect: shield one player from the mafia kill tonight (you may pick yourself)', hideBehind: 'hideBehind: hide behind someone', bounty: 'bounty: place a bounty on someone', frameTarget: 'frameTarget (optional): frame someone', consigliereInvestigate: 'consigliereInvestigate: learn one player\'s exact role', vigilanteKill: 'vigilanteKill (optional, once per game): kill someone' };

const SYSTEM = () => `You are playing a multiplayer social-deduction game on a computer called "The Mafia of Hollow Creek". You have never played it before. The only things you know about the game are the tutorial below, your role card, and what appears on your screen. You are a real player trying to win for your side; talk to the other players like a person would (short chat messages, natural, no walls of text).

IMPORTANT LIMITS
- You have no memory between turns. You only see your current screen. What you wrote in your Notebook, the town chat, and your own recent actions are the only things that carry over. If you want to remember something (a suspicion, a claim someone made, who voted for whom), write it in your Notebook.
- Vote history and older chat are NOT on your screen. Look them up with the tools below if you need them.
- You are not an assistant. Do not mention being an AI. Only use the tools listed.

THE TUTORIAL YOU WERE SHOWN (it describes the app's buttons and screens; your tools below are how you press them)
${TUTORIAL}

YOUR TOOLS - reply with ONLY a JSON array of tool calls (no other text). Each call is an object with "tool", its arguments, and an optional short "why" (your private reasoning, never shown to others).
 Looking things up (the result comes back and you get another go):
  {"tool":"open_notebook"}                         -> directory of every player with your mark (Trusted/Unknown/Suspicious) and note preview
  {"tool":"open_player","name":"Ada"}              -> that player's page: your mark and notes, who they voted for each day, known events, what they said in chat
  {"tool":"vote_lookup","day":1}                   -> who voted for whom on a given day
  {"tool":"read_chat","back":12}                   -> older town chat (skips back this many messages from the end)
  {"tool":"case_file"}                             -> public timeline of the game so far
 Writing in your notebook:
  {"tool":"mark","name":"Ada","mark":"suspicious"} -> mark is trusted, unknown or suspicious
  {"tool":"note","name":"Ada","text":"..."}        -> add a private note to a player's page
 Acting:
  {"tool":"say","text":"..."}                      -> speak in town chat (day only, living and not silenced)
  {"tool":"team_chat","text":"..."}                -> mafia only: speak in the private mafia chat
  {"tool":"night_action","choices":{"investigate":"Ada"}}  -> use your night power (the screen lists your options during the night)
  {"tool":"vote","name":"Ada"}                     -> cast your day vote (voting phase; you can change it until time runs out)
  {"tool":"end_turn"}                              -> you are done for now
Look-ups go first, then actions. Time is limited: the phase ends on the clock whether or not you have finished.`;

// ---------------------------------------------------------------- calling a model
function askClaude(system, user, timeoutMs = 120000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--tools', '', '--model', MODEL, '--system-prompt', system, '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--output-format', 'text'], { cwd: os.tmpdir() });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ text: '', ms: Date.now() - t0, error: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('close', () => { clearTimeout(timer); resolve({ text: out.trim(), ms: Date.now() - t0, error: out.trim() ? null : (err.trim().slice(0, 200) || 'empty') }); });
    child.stdin.end(user);
  });
}
function parseCalls(text) {
  const t = text.replace(/```json|```/g, '').trim();
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  try { if (a >= 0 && b > a) { const v = JSON.parse(t.slice(a, b + 1)); return Array.isArray(v) ? v : [v]; } } catch (e) { /* fall through */ }
  const c = t.indexOf('{'), d = t.lastIndexOf('}');
  try { if (c >= 0 && d > c) return [JSON.parse(t.slice(c, d + 1))]; } catch (e) { /* fall through */ }
  return null;
}
// a free, scripted stand-in used by --fake so the whole flow can be tested without spending anything
function fakeBrain(user) {
  const names = [...user.matchAll(/^\* (\w+)/gm)].map(m => m[1]);
  const pick = () => names[Math.floor(Math.random() * names.length)] || 'Ada';
  const calls = [];
  if (/PHASE: night/.test(user)) { const k = /investigate:/.test(user) ? 'investigate' : /protect:/.test(user) ? 'protect' : /kill:/.test(user) ? 'kill' : null; if (k) calls.push({ tool: 'night_action', choices: { [k]: pick() } }); }
  if (/PHASE: day-discuss/.test(user)) { calls.push({ tool: 'open_notebook' }); calls.push({ tool: 'say', text: 'I think ' + pick() + ' is suspicious.' }); calls.push({ tool: 'mark', name: pick(), mark: 'suspicious' }); }
  if (/PHASE: day-vote/.test(user)) calls.push({ tool: 'vote', name: pick() });
  calls.push({ tool: 'end_turn' });
  return JSON.stringify(calls);
}

// ---------------------------------------------------------------- the player
class Agent {
  constructor(name) {
    this.name = name; this.id = null; this.view = null; this.phaseEndsAt = 0;
    this.chat = []; this.mafiaChat = []; this.popups = []; this.myLog = []; this.errors = [];
    this.marks = {}; this.notes = {}; this.metrics = {};
    this.caseFile = []; this.prevAlive = null; this.prevNightReport = null; this.prevDetLen = 0; this.prevConsLen = 0; this.lastRevealKey = null;
    this.busy = false; this.turnsThisPhase = 0; this.lastTurnAt = 0; this.seenChatAtTurn = 0; this.phaseKey = '';
    this.transcript = fs.createWriteStream(path.join(OUT, name + '.jsonl'));
    this.ws = new WebSocket('ws://localhost:' + PORT);
    this.ready = new Promise(r => this.ws.on('open', r));
    this.ws.on('message', raw => this.onMessage(JSON.parse(raw)));
  }
  log(o) { this.transcript.write(JSON.stringify(Object.assign({ t: new Date().toISOString() }, o)) + '\n'); }
  count(k) { this.metrics[k] = (this.metrics[k] || 0) + 1; }
  send(o) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }
  nameOf(id) { const p = this.view && this.view.players.find(x => x.id === id); return p ? p.name : '?'; }
  byName(n) { const q = String(n || '').trim().toLowerCase(); return this.view && this.view.players.find(x => x.name.toLowerCase() === q); }

  onMessage(m) {
    if (m.type === 'joined' || m.type === 'created') this.id = m.playerId;
    else if (m.type === 'error') { this.errors.push(m.message); this.count('server_errors'); this.log({ ev: 'server_error', message: m.message }); }
    else if (m.type === 'mafiaChatMsg') this.mafiaChat.push(m);
    else if (m.type === 'chatMsg') { if (!this.chat.some(c => c.ts === m.ts && c.text === m.text && c.playerId === m.playerId)) this.chat.push(m); }
    else if (m.type === 'gameState') this.onState(m);
  }
  onState(m) {
    const v = m.view, prev = this.view;
    this.view = v; this.phaseEndsAt = m.phaseEndsAt || 0;
    v.chatLog.forEach(c => { if (!this.chat.some(x => x.ts === c.ts && x.text === c.text && x.playerId === c.playerId)) this.chat.push(c); });
    const key = v.night + ':' + v.phase;
    if (key !== this.phaseKey) {
      this.phaseKey = key; this.turnsThisPhase = 0; this.seenChatAtTurn = this.chat.length; this.lastTurnAt = 0;
      this.log({ ev: 'phase', key });
      if (v.phase === 'day-discuss') this.onDawn(prev, v);
      if (v.phase === 'day-reveal') this.onVoteResult(prev, v);
    }
    if (v.detectiveLog && v.detectiveLog.length > this.prevDetLen) { const e = v.detectiveLog[v.detectiveLog.length - 1]; this.popups.push(`Investigation result (private): ${e.name} reads ${e.read.toUpperCase()}.`); this.prevDetLen = v.detectiveLog.length; }
    if (v.consigliereLog && v.consigliereLog.length > this.prevConsLen) { const e = v.consigliereLog[v.consigliereLog.length - 1]; this.popups.push(`Look-into result (private): ${e.name} is the ${e.role}.`); this.prevConsLen = v.consigliereLog.length; }
    this.prevAlive = v.players.filter(p => p.alive).map(p => p.id);
  }
  onDawn(prev, v) {
    const died = v.players.filter(p => !p.alive && prev && prev.players.find(q => q.id === p.id && q.alive));
    const lines = [`Dawn, day ${v.night}. ${v.cachedOvernightReport || ''}`.trim()];
    died.forEach(p => lines.push(`${p.name} died in the night - they were ${p.role || 'unknown'}.`));
    this.popups.push(lines.join(' '));
    this.caseFile.push(`Day ${v.night} dawn: ${v.cachedOvernightReport || 'nothing reported'}${died.length ? ' (died: ' + died.map(p => p.name + '=' + p.role).join(', ') + ')' : ''}`);
  }
  onVoteResult(prev, v) {
    const died = v.players.filter(p => !p.alive && prev && prev.players.find(q => q.id === p.id && q.alive));
    const rows = (v.voteLog || []).map(r => `${r.name} -> ${r.target || (r.silenced ? '(silenced, no vote)' : 'no one')}`).join('; ');
    const out = died.length ? died.map(p => `${p.name} was voted out and was the ${p.role}.`).join(' ') : 'Nobody was voted out.';
    this.popups.push(`Vote results: ${rows}. ${out}`);
    this.caseFile.push(`Day ${v.night} vote: ${rows}. ${out}`);
  }

  // ---- the screen
  timeLeft() { return Math.max(0, Math.round((this.phaseEndsAt - Date.now()) / 1000)); }
  screen() {
    const v = this.view, me = v.players.find(p => p.id === this.id);
    const L = [];
    L.push(`PHASE: ${v.phase}   (day/night number ${v.night})   time left: about ${this.timeLeft()}s`);
    L.push(`You are ${this.name}. Your role: ${v.myRole}. Your side: ${TEAM(v.myRole)}.`);
    L.push(`Role card: ${CARDS.bio[v.myRole] || ''}`); L.push('  - ' + (CARDS.points[v.myRole] || []).join('\n  - '));
    if (!me.alive) L.push('You have been ELIMINATED: you can only watch.');
    if (me.silencedToday) L.push('You are SILENCED today: you cannot speak.');
    const mates = v.players.filter(p => p.alive && p.id !== this.id && p.align === 'mafia' && v.myAlign === 'mafia' && v.myRole !== 'Hitman');
    if (mates.length) L.push('Your family (mafia teammates): ' + mates.map(p => p.name).join(', '));
    L.push('Alive: ' + v.players.filter(p => p.alive).map(p => p.name).join(', '));
    const dead = v.players.filter(p => !p.alive); if (dead.length) L.push('Eliminated: ' + dead.map(p => `${p.name} (was ${p.role})`).join(', '));
    if (v.heat && v.heat.self) L.push(`Your Town Heat: ${v.heat.level} (${v.heat.percent}%)`);
    if (this.popups.length) { L.push('-- Pop-ups you saw since your last turn --'); this.popups.forEach(p => L.push('  ' + p)); }
    const shown = this.chat.filter(c => c.kind !== 'whisperAnnounce' && c.text).slice(-12);
    L.push(`-- Town chat (latest ${shown.length} of ${this.chat.length}) --`); shown.forEach(c => L.push(`  ${c.name}: ${c.text}`));
    if (v.myAlign === 'mafia' && v.myRole !== 'Hitman') { L.push('-- Mafia chat --'); this.mafiaChat.slice(-8).forEach(c => L.push(`  ${c.name || this.nameOf(c.playerId)}: ${c.text}`)); }
    if (v.phase === 'night' && me.alive) {
      const keys = NIGHT_KEYS[v.myRole] || [];
      L.push('-- Tonight --'); L.push(keys.length ? 'Your night options (use night_action with these keys):\n  ' + keys.map(k => KEY_HELP[k]).join('\n  ') : 'You have no night power. Just end your turn (you may use your notebook).');
    }
    if (v.phase === 'day-discuss') L.push('-- Now -- Discussion: talk, accuse, defend, ask questions. Voting opens when the timer ends.');
    if (v.phase === 'day-vote') L.push('-- Now -- Voting is open: cast your vote with the vote tool (you can change it until time runs out).');
    if (this.myLog.length) { L.push('-- Your own recent actions --'); this.myLog.slice(-6).forEach(x => L.push('  ' + x)); }
    return L.join('\n');
  }

  // ---- tools
  openNotebook() {
    const lines = this.view.players.filter(p => p.id !== this.id).map(p => `  * ${p.name} [${p.alive ? 'alive' : 'eliminated'}] mark: ${this.marks[p.id] || 'unknown'}${this.notes[p.id] ? ' | note: ' + this.notes[p.id].split('\n').pop().slice(0, 60) : ''}`);
    return 'NOTEBOOK DIRECTORY\n' + lines.join('\n');
  }
  openPlayer(name) {
    const p = this.byName(name); if (!p) return 'No such player.';
    const v = this.view, votes = (v.voteHistory || []).filter(x => x.voterId === p.id);
    const acc = (v.accusationLog || []).filter(a => a.accuserId === p.id || a.targetId === p.id);
    const quotes = this.chat.filter(c => c.playerId === p.id && c.text).slice(-6);
    const known = [];
    if (!p.alive) known.push(`Eliminated - they were the ${p.role}.`);
    acc.forEach(a => known.push(a.accuserId === p.id ? `Day ${a.night}: accused ${this.nameOf(a.targetId)}.` : `Day ${a.night}: was accused by ${this.nameOf(a.accuserId)}.`));
    ((v.detectiveLog || []).filter(e => e.name === p.name)).forEach(e => known.push(`Your investigation: reads ${e.read}.`));
    ((v.consigliereLog || []).filter(e => e.name === p.name)).forEach(e => known.push(`Your look-into: ${e.role}.`));
    return `${p.name.toUpperCase()}'S PAGE [${p.alive ? 'alive' : 'eliminated'}]\nYour mark: ${this.marks[p.id] || 'unknown'}\nYour private notes: ${this.notes[p.id] || '(none)'}\nVote history: ${votes.length ? votes.map(x => `day ${x.night}: voted for ${x.target || 'no one'}`).join('; ') : '(no votes yet)'}\nKnown events: ${known.length ? known.join(' ') : '(none)'}\nSaved quotes: ${quotes.length ? quotes.map(c => '"' + c.text + '"').join(' / ') : '(none yet)'}`;
  }
  voteLookup(day) {
    const rows = (this.view.voteHistory || []).filter(x => x.night === Number(day));
    return rows.length ? `VOTES ON DAY ${day}\n` + rows.map(x => `  ${x.name} -> ${x.target || 'no one'}`).join('\n') : `No votes recorded for day ${day} yet.`;
  }
  runTool(c) {
    const v = this.view, me = v.players.find(p => p.id === this.id), ph = v.phase;
    this.count('tool_' + c.tool);
    switch (c.tool) {
      case 'open_notebook': return { kind: 'look', text: this.openNotebook() };
      case 'open_player': return { kind: 'look', text: this.openPlayer(c.name) };
      case 'vote_lookup': return { kind: 'look', text: this.voteLookup(c.day) };
      case 'case_file': return { kind: 'look', text: 'CASE FILE\n' + (this.caseFile.length ? this.caseFile.join('\n') : '(nothing yet)') };
      case 'read_chat': { const back = Math.max(1, Math.min(60, Number(c.back) || 12)); const end = Math.max(0, this.chat.length - 12 + 0); const slice = this.chat.filter(x => x.text).slice(Math.max(0, this.chat.length - 12 - back), Math.max(0, this.chat.length - 12)); return { kind: 'look', text: slice.length ? 'OLDER CHAT\n' + slice.map(x => `  ${x.name}: ${x.text}`).join('\n') : 'Nothing older.' }; }
      case 'mark': { const p = this.byName(c.name); const mk = String(c.mark || '').toLowerCase(); if (!p || !['trusted', 'unknown', 'suspicious'].includes(mk)) return { kind: 'bad', text: 'Could not mark: pick a player and trusted / unknown / suspicious.' }; this.marks[p.id] = mk; this.myLog.push(`Marked ${p.name} ${mk}`); return { kind: 'act', text: `Marked ${p.name} ${mk}.` }; }
      case 'note': { const p = this.byName(c.name); if (!p || !c.text) return { kind: 'bad', text: 'Could not write note: need a player and text.' }; this.notes[p.id] = (this.notes[p.id] ? this.notes[p.id] + '\n' : '') + `Day ${v.night}: ` + String(c.text).slice(0, 200); this.myLog.push(`Wrote a note on ${p.name}`); return { kind: 'act', text: 'Note saved.' }; }
      case 'say': {
        if (!me.alive) return { kind: 'bad', text: 'You are eliminated and cannot speak in town chat.' };
        if (me.silencedToday) return { kind: 'bad', text: 'You are silenced today.' };
        if (ph !== 'day-discuss' && ph !== 'day-vote') return { kind: 'bad', text: 'Town chat is only open during the day.' };
        const text = String(c.text || '').slice(0, 280); if (!text) return { kind: 'bad', text: 'Empty message.' };
        this.send({ type: 'dayChat', text }); this.myLog.push(`Said: "${text.slice(0, 60)}"`); return { kind: 'act', text: 'Sent.' };
      }
      case 'team_chat': if (v.myAlign !== 'mafia') return { kind: 'bad', text: 'You are not in the mafia.' }; this.send({ type: 'mafiaChat', text: String(c.text || '').slice(0, 280) }); return { kind: 'act', text: 'Sent to the family.' };
      case 'night_action': {
        if (ph !== 'night') return { kind: 'bad', text: 'It is not night.' };
        const allowed = NIGHT_KEYS[v.myRole] || []; const action = {}; const bad = [];
        Object.entries(c.choices || {}).forEach(([k, name]) => { const p = this.byName(name); if (!allowed.includes(k)) bad.push(`"${k}" is not an option for your role`); else if (!p || !p.alive) bad.push(`"${name}" is not a living player`); else if (p.id === this.id && k !== 'protect') bad.push('you cannot pick yourself for that'); else action[k] = p.id; });
        if (bad.length) { this.count('invalid_actions'); return { kind: 'bad', text: 'Not submitted: ' + bad.join('; ') }; }
        if (!Object.keys(action).length) return { kind: 'bad', text: 'Nothing chosen.' };
        this.send({ type: 'nightAction', action }); this.myLog.push(`Night ${v.night}: ${Object.entries(c.choices).map(([k, n]) => k + ' ' + n).join(', ')}`); return { kind: 'act', text: 'Locked in.' };
      }
      case 'vote': {
        if (ph !== 'day-vote') { this.count('invalid_actions'); return { kind: 'bad', text: 'Voting is not open (it opens after discussion).' }; }
        const p = this.byName(c.name); if (!p || !p.alive || p.id === this.id) { this.count('invalid_actions'); return { kind: 'bad', text: 'Pick another living player.' }; }
        this.send({ type: 'dayVote', targetId: p.id }); this.myLog.push(`Day ${v.night}: voted ${p.name}`); this.votedLooked = this.metrics.tool_vote_lookup || 0; return { kind: 'act', text: `Vote for ${p.name} submitted.` };
      }
      case 'end_turn': return { kind: 'end', text: '' };
      default: this.count('unknown_tool'); return { kind: 'bad', text: `Unknown tool "${c.tool}".` };
    }
  }

  // ---- one turn: look things up, think, act
  async turn(reason) {
    if (this.busy || !this.view) return; this.busy = true;
    const startKey = this.phaseKey; this.lastTurnAt = Date.now(); this.turnsThisPhase++;
    let scratch = '';
    try {
      for (let step = 0; step < 5; step++) {
        const user = this.screen() + (scratch ? '\n\n== RESULTS OF YOUR LOOK-UPS THIS TURN ==\n' + scratch : '') + '\n\nYour move. Reply with ONLY a JSON array of tool calls.';
        const r = FAKE ? { text: fakeBrain(user), ms: 5 } : await askClaude(SYSTEM(), user);
        this.log({ ev: 'turn', reason, phase: this.phaseKey, step, ms: r.ms, error: r.error, reply: r.text });
        if (this.phaseKey !== startKey) this.count('phase_ended_mid_turn');
        const calls = parseCalls(r.text);
        if (!calls) { this.count('unparseable_replies'); break; }
        this.popups = []; let looked = false, ended = false; const results = [];
        for (const c of calls) {
          const res = this.runTool(c); this.log({ ev: 'tool', call: c, result: res.kind, text: res.text.slice(0, 400) });
          if (res.kind === 'look') { looked = true; results.push(`> ${c.tool} ${c.name || c.day || ''}\n${res.text}`); }
          else if (res.kind === 'bad') results.push(`> ${c.tool}: ${res.text}`);
          else if (res.kind === 'end') { ended = true; break; }
        }
        scratch += results.join('\n') + '\n';
        if (ended || (!looked && !results.some(x => x.startsWith('>')))) break;
        if (!looked) break;
      }
    } finally { this.busy = false; }
  }
  // decides when a new turn is worth taking, from the live state
  tick() {
    const v = this.view; if (!v || this.busy || v.gameOver) return;
    const me = v.players.find(p => p.id === this.id); if (!me) return;
    const sinceLast = Date.now() - this.lastTurnAt;
    if (v.phase === 'night' && me.alive && this.turnsThisPhase === 0) return this.turn('night');
    if (v.phase === 'day-discuss' && me.alive) {
      if (this.turnsThisPhase === 0) return this.turn('dawn');
      if (this.turnsThisPhase < 6 && sinceLast > 14000 && this.chat.length > this.seenChatAtTurn && this.timeLeft() > 15) { this.seenChatAtTurn = this.chat.length; return this.turn('new chat'); }
    }
    if (v.phase === 'day-vote' && me.alive && this.turnsThisPhase === 0) return this.turn('vote');
    if (!me.alive && v.phase === 'day-discuss' && this.turnsThisPhase === 0) { this.turnsThisPhase = 1; this.popups = []; }
  }
}

// ---------------------------------------------------------------- run
(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), NIGHT_EARLY_RESOLVE_DELAY_MS: '1500', DAY_VOTE_EARLY_RESOLVE_DELAY_MS: '1500' }, Object.fromEntries(Object.entries(DUR).map(([k, x]) => [k, String(x)]))), stdio: 'ignore' });
  await sleep(1500);
  const agents = NAMES.slice(0, N).map(n => new Agent(n));
  await Promise.all(agents.map(a => a.ready));
  // the host creates the room; the others join with its code
  const code = await new Promise(res => { agents[0].ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'created') res(m.roomCode); }); agents[0].send({ type: 'create', name: agents[0].name, isPublic: false }); });
  for (const a of agents.slice(1)) { a.send({ type: 'join', name: a.name, roomCode: code }); await sleep(250); }
  await sleep(800);

  // ---- before the game: show the tutorial, check what stuck
  const QUIZ = [
    ['win', 'In one sentence each: how does the Town win and how does the Mafia win?'],
    ['reveal', 'When a player is voted out, does everyone find out what role they had? (yes/no and why)'],
    ['heat', 'What is "Town Heat" and does it only depend on your own behaviour?'],
    ['history', 'Where would you look to see who a player voted for on an earlier day?'],
    ['suspicious', 'The Detective can get three results. What are they, and can "suspicious" mean more than one thing?'],
    ['marks', 'If you mark a player "Suspicious" in your notebook, who can see that?']
  ];
  const quiz = {};
  await Promise.all(agents.map(async a => {
    const user = 'Answer these questions about the game using only what you were shown in the tutorial. Reply ONLY with a JSON object mapping each key to a short answer.\n' + QUIZ.map(q => `${q[0]}: ${q[1]}`).join('\n');
    const r = FAKE ? { text: '{}' } : await askClaude('You are a new player who has just finished the game\'s tutorial. Here is everything it showed you:\n' + TUTORIAL, user);
    try { quiz[a.name] = JSON.parse(r.text.replace(/```json|```/g, '').trim()); } catch (e) { quiz[a.name] = { raw: r.text }; }
  }));
  fs.writeFileSync(path.join(OUT, 'quiz-before.json'), JSON.stringify(quiz, null, 2));
  console.log('quiz done; starting game in room', code);

  const gameCfg = { type: 'start', playerCount: N, mafiaCount: 0, roles: { Godfather: true, DoubleAgent: false, Detective: true, Doctor: true, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false, Vigilante: false, Consigliere: false, Mayor: false, Mortician: false, Framer: false, Hitman: false, CultLeader: false } };
  agents[0].send(gameCfg);

  const tickTimer = setInterval(() => agents.forEach(a => a.tick()), 1500);
  const t0 = Date.now();
  while (Date.now() - t0 < 40 * 60 * 1000) {
    await sleep(2000);
    if (agents.every(a => a.view && a.view.gameOver)) break;
  }
  clearInterval(tickTimer);
  await sleep(3000);

  // ---- after the game: what did they think?
  const final = agents[0].view;
  const debrief = {};
  const summary = {
    winner: final && final.winner, rounds: final && final.night,
    roles: final && final.players.map(p => `${p.name}=${p.role}${p.alive ? '' : ' (out)'}`),
    caseFile: agents[0].caseFile,
    metrics: Object.fromEntries(agents.map(a => [a.name + ' (' + (a.view && a.view.myRole) + ')', a.metrics]))
  };
  await Promise.all(agents.map(async a => {
    const user = `The game is over. Winner: ${summary.winner}. Everyone's roles: ${summary.roles.join(', ')}.\nYour notebook marks/notes at the end: ${JSON.stringify({ marks: Object.fromEntries(Object.entries(a.marks).map(([id, m]) => [a.nameOf(id), m])), notes: Object.fromEntries(Object.entries(a.notes).map(([id, t]) => [a.nameOf(id), t])) })}\nYour own actions: ${a.myLog.join(' | ') || '(none)'}\nPublic timeline:\n${a.caseFile.join('\n')}\n\nReflect honestly as a new player. Reply ONLY with a JSON object with keys: "confusing" (list: things in the game or interface that confused you or that you got wrong), "strategy" (list: the strategies/reasoning you actually used), "learned_late" (list: things you only understood late, or never), "wanted" (list: information or features you wished you had), "best_clue" (what helped you most).`;
    const r = FAKE ? { text: '{}' } : await askClaude('You just played The Mafia of Hollow Creek for the first time as ' + a.name + ', role ' + (a.view && a.view.myRole) + '. Tutorial you saw:\n' + TUTORIAL, user);
    try { debrief[a.name] = JSON.parse(r.text.replace(/```json|```/g, '').trim()); } catch (e) { debrief[a.name] = { raw: r.text }; }
  }));
  fs.writeFileSync(path.join(OUT, 'debrief.json'), JSON.stringify(debrief, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log('logs in', OUT);
  agents.forEach(a => a.ws.close()); server.kill(); process.exit(0);
})().catch(e => { console.error('PILOT CRASHED', e); process.exit(1); });
