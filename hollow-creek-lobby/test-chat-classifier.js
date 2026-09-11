// Standalone battery for classifyChatMessage() - name resolution (fuzzy/
// partial names, multi-word role names) and cross-message context (bare
// self-IDs answering an earlier role question, pronouns resolving to
// whoever was last named). No server/socket involvement - pure function
// in, category string out, same convention as test-game.js.
const G = require('./game.js');

let total = 0, failed = 0;
function assert(cond, msg){
  total++;
  if(!cond){ failed++; console.error('FAIL: '+msg); process.exitCode = 1; }
  else console.log('ok - '+msg);
}

const NAMES = G.CHARACTERS.map(c => c.name);
// Sanity: the roster this whole file leans on actually has the title-
// prefixed / three-word names the fuzzy matcher needs to handle.
assert(NAMES.includes('Corky Wade'), 'fixture sanity: Corky Wade is in the real character roster');
assert(NAMES.includes('Sister Agatha Pruitt'), 'fixture sanity: Sister Agatha Pruitt is in the real character roster');
assert(NAMES.includes('Big Tom Yarrow'), 'fixture sanity: Big Tom Yarrow is in the real character roster');

function classify(text, context){
  return G.classifyChatMessage(text, NAMES, context);
}

// ============================================================
// SECTION A - single-message classification, no context needed
// ============================================================

// --- role_claim: direct role word in the same message, both spellings ---
assert(classify("I am the doctor") === 'role_claim', 'A1: "I am the doctor" -> role_claim');
assert(classify("i'm the detective, trust me") === 'role_claim', 'A2: "i\'m the detective, trust me" -> role_claim');
assert(classify("my role is mafia") === 'role_claim', 'A3: "my role is mafia" -> role_claim');
assert(classify("I'm the double agent") === 'role_claim', 'A4: multi-word role code name "double agent" spelled naturally -> role_claim');
assert(classify("i am doubleagent") === 'role_claim', 'A5: multi-word role typed as one word "doubleagent" -> role_claim');
assert(classify("I am the cult leader, don't kill me") === 'role_claim', 'A6: "cult leader" (two words) -> role_claim');
assert(classify("I'm the navy seal") === 'role_claim', 'A7: "navy seal" (two words) -> role_claim');
assert(classify("i am the bounty hunter and I need Corky dead") === 'role_claim', 'A8: "bounty hunter" (two words) -> role_claim');
assert(classify("I am town, not mafia") === 'role_claim', 'A9: "I am town" -> role_claim');
assert(classify("i'm just a civilian") === 'role_claim', 'A10: "i\'m just a civilian" -> role_claim');

// --- accusation: explicit + "I think it's X" + predicate patterns ---
assert(classify("I accuse Corky Wade") === 'accusation', 'A11: "I accuse Corky Wade" -> accusation');
assert(classify("i think it's Corky") === 'accusation', 'A12: "i think it\'s Corky" (first name only) -> accusation');
assert(classify("I think it's cork") === 'accusation', 'A13: "I think it\'s cork" (fuzzy truncated first name) -> accusation');
assert(classify("pretty sure it's Wade") === 'accusation', 'A14: "pretty sure it\'s Wade" (last name only) -> accusation');
assert(classify("i bet its agatha") === 'accusation', 'A15: "i bet its agatha" (middle given name, title word dropped) -> accusation');
assert(classify("Corky Wade is the mafia") === 'accusation', 'A16: "Corky Wade is the mafia" -> accusation');
assert(classify("Otis was lying to everyone") === 'accusation', 'A17: "Otis was lying to everyone" -> accusation');
assert(classify("vote for Corky") === 'accusation', 'A18: "vote for Corky" -> accusation');
assert(classify("vote Tom") === 'accusation', 'A19: "vote Tom" (first name of Big Tom Yarrow) -> accusation');
assert(classify("I think it's cold outside") === 'no_gameplay_meaning', 'A20: "I think it\'s cold outside" (no real name) -> no_gameplay_meaning, not a false accusation');

// --- defense ---
assert(classify("I defend myself here") === 'defense', 'A21: "I defend myself here" -> defense');
assert(classify("i'm not the mafia, I swear") === 'defense', 'A22: "i\'m not the mafia, I swear" -> defense');
assert(classify("that's not true, I didn't do anything") === 'defense', 'A23: "that\'s not true, I didn\'t do anything" -> defense');
assert(classify("you're wrong about me") === 'defense', 'A24: "you\'re wrong about me" -> defense');

// --- suspicion (no name required, vibe-only phrasing) ---
assert(classify("Corky is acting really suspicious") === 'suspicion', 'A25: "Corky is acting really suspicious" -> suspicion (not accusation)');
assert(classify("something's off about this round") === 'suspicion', 'A26: "something\'s off about this round" -> suspicion');
assert(classify("why would you say that") === 'suspicion', 'A27: "why would you say that" -> suspicion');
assert(classify("ida seems fishy today") === 'suspicion', 'A28: "ida seems fishy today" -> suspicion');

// --- trust_statement ---
assert(classify("I trust Nettie completely") === 'trust_statement', 'A29: "I trust Nettie completely" -> trust_statement');
assert(classify("Silas seems trustworthy") === 'trust_statement', 'A30: "Silas seems trustworthy" -> trust_statement');
assert(classify("Roz is clean, no doubt") === 'trust_statement', 'A31: "Roz is clean, no doubt" -> trust_statement');

// --- question ---
assert(classify("who is the doctor") === 'question', 'A32: "who is the doctor" -> question');
assert(classify("what do you think about Walt") === 'question', 'A33: "what do you think about Walt" -> question');
assert(classify("does anyone have a read on Dot?") === 'question', 'A34: "does anyone have a read on Dot?" -> question');

// --- no_gameplay_meaning (plain banter) ---
assert(classify("lol good morning everyone") === 'no_gameplay_meaning', 'A35: "lol good morning everyone" -> no_gameplay_meaning');
assert(classify("nice weather today") === 'no_gameplay_meaning', 'A36: "nice weather today" -> no_gameplay_meaning');
assert(classify("") === 'no_gameplay_meaning', 'A37: empty string -> no_gameplay_meaning');

// --- ambiguous / ambiguity-guard cases ---
// Deliberately add two fixture-only names that share a prefix to prove the
// "resolve to nobody rather than guess wrong" guard, without touching the
// real roster used everywhere else.
const AMBIG_NAMES = NAMES.concat(['Cora Blake']);
assert(G.classifyChatMessage("i think it's cor", AMBIG_NAMES) === 'no_gameplay_meaning',
  'A38: "cor" ambiguous between Corky Wade and Cora Blake -> resolves to neither, no_gameplay_meaning');
assert(G.classifyChatMessage("i think it's cork", AMBIG_NAMES) === 'accusation',
  'A39: "cork" still unambiguous (only Corky matches) even with Cora Blake also in the room -> accusation');

// ============================================================
// SECTION B - the two scenarios the request called out by name
// ============================================================

// Scenario 1: "who is doctor" then a bare "I am" reply from someone else.
{
  const msg1 = "who is doctor";
  const cat1 = classify(msg1, { recentTexts: [] });
  assert(cat1 === 'question', 'B1: "who is doctor" (first message, no context yet) -> question');

  const cat2 = classify("I am", { recentTexts: [msg1] });
  assert(cat2 === 'role_claim', 'B2: reply "I am" right after "who is doctor" -> role_claim (context-resolved)');

  // Same pairing but the reply used the explicit Reply-to feature instead
  // of just being the next line - the explicit signal should work too.
  const cat3 = classify("I am", { replyToText: msg1, recentTexts: [] });
  assert(cat3 === 'role_claim', 'B3: "I am" sent as an explicit Reply to "who is doctor" -> role_claim');

  // And the natural contraction/variant spellings of a bare self-ID.
  assert(classify("i'm", { recentTexts: [msg1] }) === 'role_claim', 'B4: "i\'m" alone after "who is doctor" -> role_claim');
  assert(classify("that's me", { recentTexts: [msg1] }) === 'role_claim', 'B5: "that\'s me" alone after "who is doctor" -> role_claim');
  assert(classify("me", { recentTexts: [msg1] }) === 'role_claim', 'B6: bare "me" alone after "who is doctor" -> role_claim');

  // Without that preceding question, "I am" alone stays meaningless - the
  // context upgrade must not fire unconditionally.
  assert(classify("I am") === 'no_gameplay_meaning', 'B7: "I am" with zero context -> no_gameplay_meaning (not assumed a role claim)');
  assert(classify("I am", { recentTexts: ['lol good morning everyone'] }) === 'no_gameplay_meaning',
    'B8: "I am" after unrelated small talk -> no_gameplay_meaning');

  // A question about a DIFFERENT role still resolves correctly (not just
  // hardcoded to "doctor").
  assert(classify("who's the mafia here", { recentTexts: [] }) === 'question', 'B9: "who\'s the mafia here" -> question');
  assert(classify("I am", { recentTexts: ["who's the mafia here"] }) === 'role_claim',
    'B10: "I am" after "who\'s the mafia here" -> role_claim (works for any role word, not just doctor)');
}

// Scenario 2: "i think its cork" names Corky Wade as the accusation target.
{
  const cat = classify("i think its cork");
  assert(cat === 'accusation', 'B11: "i think its cork" (no apostrophe, truncated name) -> accusation');
  // Confirm it's specifically the FUZZY NAME path doing the work, not the
  // predicate alone - swap in a token that matches nobody and the same
  // sentence shape should fall through.
  assert(classify("i think its blorp") === 'no_gameplay_meaning', 'B12: "i think its blorp" (matches no player) -> no_gameplay_meaning');
}

// Pronoun continuation: an accusation/trust aimed with "he/she/they" once
// someone's already been named earlier in the thread.
{
  const line1 = "Corky Wade has been acting really suspicious this whole round";
  assert(classify(line1) === 'suspicion', 'B13: "Corky Wade has been acting really suspicious..." -> suspicion');
  assert(classify("yeah he's definitely the mafia", { recentTexts: [line1] }) === 'accusation',
    'B14: "yeah he\'s definitely the mafia" right after naming Corky -> accusation (pronoun resolved via context)');
  assert(classify("vote him out", { recentTexts: [line1] }) === 'accusation',
    'B15: "vote him out" after naming Corky -> accusation (pronoun resolved)');
  assert(classify("she seems trustworthy though", { recentTexts: ["Nettie Calloway hasn't said much"] }) === 'trust_statement',
    'B16: "she seems trustworthy though" after mentioning Nettie -> trust_statement (pronoun resolved)');
  // No antecedent at all - the pronoun path must not invent a subject.
  assert(classify("they seem suspicious") === 'suspicion', 'B17: "they seem suspicious" alone -> suspicion (phrase itself carries the category, no name needed)');
  assert(classify("he is the mafia") === 'no_gameplay_meaning', 'B18: "he is the mafia" with zero prior context -> no_gameplay_meaning (nothing to resolve "he" to)');
}

// replyToText takes priority over recentTexts when they disagree.
{
  const older = "who is the doctor";
  const newer = "lol good morning everyone";
  assert(classify("I am", { replyToText: older, recentTexts: [newer] }) === 'role_claim',
    'B19: explicit reply-to a role question wins even when the most recent line is unrelated banter');
}

console.log('\n--- Section C: a full 50+ message simulated round, run through the same rolling context the server actually uses ---');

// ============================================================
// SECTION C - a full simulated round of day-chat, fed through the
// classifier message-by-message with a rolling 6-message context window
// (recentTexts), exactly like server.js's dayChat handler does. Every
// line gets a sanity check (valid category, never throws); the ones with
// an inline comment get an exact expected-category assertion.
// ============================================================
const transcript = [
  ['Mabel Finch', 'good morning everyone'],
  ['Otis Redwood', 'morning, rough night'],
  ['Sister Agatha Pruitt', 'who is the doctor', 'question'],
  ['Ida Wexford', 'I am', 'role_claim'],                         // answers Agatha's question
  ['Corky Wade', 'nice, glad someone spoke up', 'no_gameplay_meaning'],
  ['Nettie Calloway', 'who is the detective this round', 'question'],
  ['Silas Crane', "not saying, too risky yet", 'no_gameplay_meaning'],
  ['Dot Higgins', 'fair enough honestly'],
  ['Walt Pemberton', 'Otis has been quiet all game'],
  ['Roz Okafor', 'yeah he is acting weird', 'suspicion'],
  ['Big Tom Yarrow', 'i think its otis', 'accusation'],
  ['Mabel Finch', 'i accuse Otis Redwood', 'accusation'],
  ['Otis Redwood', "i'm not the mafia, I swear", 'defense'],
  ['Otis Redwood', 'that\'s not fair, I have done nothing', 'defense'],
  ['Corky Wade', 'I trust Otis actually', 'trust_statement'],
  ['Ida Wexford', 'Corky seems trustworthy too', 'trust_statement'],
  ['Sister Agatha Pruitt', 'does anyone have a read on Walt', 'question'],
  ['Silas Crane', 'Walt is clean, on our side', 'trust_statement'],
  ['Nettie Calloway', 'what about Dot though', 'question'],
  ['Dot Higgins', "i'm the miller, that's why my read looks off", 'role_claim'],
  ['Roz Okafor', 'oh that explains it'],
  ['Big Tom Yarrow', 'i think it\'s dot anyway', 'accusation'],
  ['Mabel Finch', 'Big Tom, chill, she just explained that'],
  ['Walt Pemberton', 'vote for tom then if you wont listen', 'accusation'],
  ['Otis Redwood', 'why would you vote him', 'accusation'],       // "vote him" wins the accusation/suspicion overlap - a live vote callout, not just a vibe
  ['Corky Wade', 'something is off about this whole round', 'suspicion'],
  ['Ida Wexford', 'my role is doctor actually, I protected someone last night', 'role_claim'],
  ['Silas Crane', 'wait i thought Ida already said that'],
  ['Sister Agatha Pruitt', "she's telling the truth, consistent story", 'trust_statement'],
  ['Nettie Calloway', 'who is the mafia here honestly', 'question'],
  ['Dot Higgins', "that's me", 'role_claim'],                    // answers Nettie's mafia question
  ['Roz Okafor', 'lol not funny'],
  ['Big Tom Yarrow', 'i defend myself, I did nothing wrong', 'defense'],
  ['Mabel Finch', 'Tom I did not accuse you', 'defense'],
  ['Walt Pemberton', 'pretty sure it\'s wade', 'accusation'],
  ['Otis Redwood', 'Corky, is that true?', 'question'],
  ['Corky Wade', 'i can prove it wasnt me', 'defense'],
  ['Ida Wexford', 'agatha have you seen anything suspicious', 'suspicion'],
  ['Sister Agatha Pruitt', 'she seems fine to me'],
  ['Silas Crane', 'i bet its agatha honestly', 'accusation'],
  ['Nettie Calloway', 'why would you say that about her', 'suspicion'],
  ['Dot Higgins', 'i am town, always have been', 'role_claim'],
  ['Roz Okafor', 'we should just vote already'],
  ['Big Tom Yarrow', 'vote wade', 'accusation'],
  ['Mabel Finch', 'seconding that, vote Corky', 'accusation'],
  ['Walt Pemberton', 'im not the mafia, this is ridiculous', 'defense'],
  ['Otis Redwood', 'who has the mayor role', 'question'],
  ['Corky Wade', 'I am', 'role_claim'],                          // answers Otis's mayor question
  ['Ida Wexford', 'okay good to know'],
  ['Sister Agatha Pruitt', 'i trust corky on this one', 'trust_statement'],
  ['Silas Crane', 'yeah he seems trustworthy actually', 'trust_statement'],
  ['Nettie Calloway', 'does that change the vote', 'question'],
  ['Dot Higgins', 'probably should reconsider then'],
  ['Roz Okafor', 'im just here for the chaos honestly'],
  ['Big Tom Yarrow', 'who is the double agent', 'question'],
  ['Mabel Finch', 'not telling, sorry'],
  ['Walt Pemberton', "that's me", 'role_claim'],                 // answers Tom's double-agent question
  ['Otis Redwood', 'wow ok did not expect that']
];

let ctxWindow = [];
transcript.forEach((row, i) => {
  const [speaker, text, expected] = row;
  const cat = classify(text, { recentTexts: ctxWindow.slice(-6) });
  assert(typeof cat === 'string' && cat.length > 0, 'C'+(i+1)+': line '+(i+1)+' ('+speaker+': "'+text+'") classifies without throwing, got "'+cat+'"');
  if (expected) {
    assert(cat === expected, 'C'+(i+1)+'b: line '+(i+1)+' ('+speaker+': "'+text+'") -> expected '+expected+', got '+cat);
  }
  ctxWindow.push(text);
});
assert(transcript.length >= 55, 'C-final: the simulated transcript itself has 55+ messages, as requested');

console.log('\n'+total+' checks run, '+(total-failed)+' passed, '+failed+' failed.');
if (failed > 0) { console.error('\n'+failed+' FAILED.'); } else { console.log('\nAll classifyChatMessage checks passed.'); }
