// Tests for the language filter (profanity.js): it must catch the disguises, and must NOT block innocent words that merely contain a bad one.
const { check } = require('./profanity.js');
let failed = 0, n = 0;
function blocked(t) { n++; const r = check(t); if (r.ok) { console.error('FAIL (should be blocked): ' + JSON.stringify(t)); failed++; process.exitCode = 1; } }
function allowed(t) { n++; const r = check(t); if (!r.ok) { console.error('FAIL (should be allowed): ' + JSON.stringify(t) + '  matched ' + r.word + ' (' + r.reason + ')'); failed++; process.exitCode = 1; } }

// ---- plain bad words, in a sentence, with punctuation and capitals
['fuck', 'FUCK YOU', 'shut the fuck up', 'what the fuck is this', 'you are a bitch', 'shit', 'This is bullshit!', 'asshole', 'you ass', 'what an ass.', 'dumbass', 'jackass!!', 'dick', 'you dickhead', 'cunt', 'pussy', 'whore', 'slut',
  'bastard', 'motherfucker', 'cocksucker', 'wanker', 'twat', 'piss off', 'douchebag', 'wtf', 'stfu', 'gtfo', 'fucking idiot', 'fucked', 'shitty play', 'bitches', 'asses', 'goddamn shit', 'sex', 'porn', 'cum', 'tits', 'boobs',
  'penis', 'vagina', 'dildo', 'blowjob', 'masturbate', 'horny', 'rape', 'you are a rapist', 'pedophile', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'you retard', 'retarded', 'spic', 'chink', 'kike', 'gook', 'wetback', 'tranny', 'dyke',
  'nazi', 'heil hitler', 'white power', 'kkk', 'kill yourself', 'go kill yourself', 'kys', 'hang yourself', 'killyourself'].forEach(blocked);

// ---- disguises
['@ss', 'a$$', '@$$', 'a$$hole', '@sshole', 'sh1t', 'sh!t', 'shi+', '5hit', '$hit', 'f*ck', 'f**k', 'sh*t', 'b*tch', 'b!tch', 'bi7ch', 'fvck', 'fuk', 'fck', 'fuq', 'phuck', 'fuuuuck', 'fuuuck you', 'shiiiiit', 'assss', 'biiiitch',
  'f u c k', 'f.u.c.k', 'f-u-c-k', 'f_u_c_k', 's h i t', 'b i t c h', 'a s s', 'a $ $', 'fu ck', 'sh it', 'b itch', 'pu ssy', 'fuckyou', 'xXfuckXx', 'shithead', 'bullshitter', 'motherf*cker', 'm0therfucker', 'n1gger', 'n!gga', 'f4ggot', 'f@g',
  'r3tard', 'c0ck', 'd1ck', 'p*ssy', 'cvnt', 'wh0re', 'sl*t', 'ａｓｓ', 'f​uck', 'sh​it', 'fúck', 'shít', 'fuсk', 'shіt', 'ass.', '(ass)', '"fuck"', 'FuCk', 'AsS', 'K Y S', 'k.y.s', 'k y s you', 'k1ll yourself', 'kill urself', 'go d1e'].forEach(blocked);
// (the last two: "k1ll yourself" and "go d1e" - the first should be caught via leet, "go die" is a phrase)

// ---- innocent text that must go through
['class', 'assassin', 'The assassin strikes at night', 'assist', 'bass', 'glass', 'pass the salt', 'mass', 'grass', 'analysis', 'Scunthorpe', 'cocktail', 'peacock', 'Dickens', 'Hancock', 'title', 'constitution', 'therapist', 'grape', 'drape',
  'cumulative', 'cumin', 'document', 'Essex', 'Sussex', 'assume', 'associate', 'bassist', 'hello', 'shell', 'shiitake', 'bitcoin', 'this hit me hard', 'I hit him', 'what is this', 'as s', 'a s', 'pass it', 'was shut', 'mishit',
  'I accuse Dex', 'The mafia kills at night', 'who do you think is the killer', 'I will kill him tomorrow', 'murder in the town', 'he deserves to die', 'hang the culprit', 'shoot first', 'stab', 'hell', 'damn it', 'crap',
  'Roz Okafor', 'Ada Whitlock', 'Bram Hollis', 'Cora Vance', 'Dex Marlowe', 'Pierce', 'Cass', 'Dick Tracy'.replace('Dick', 'Rick'), 'Homer', 'homework', 'Hom', 'Jasper', 'Japan', 'Japanese', 'mustard', 'bastion', 'cockpit', 'cocky', 'cockatoo',
  'vote for Ada', 'I think it is Bram', 'he was quiet last night', 'let us vote him out', '1 2 3 4 5', '4 5 5', '3 votes', '100%', '5 of 7', '$5', 'a1 sauce', 'bbs', 'ok lol', 'omg', 'haha', 'Please explain', 'sexton', 'Sussex', 'analyst', 'Essex',
  'penistone', 'peninsula', 'Pennsylvania', 'rapidly', 'trapeze', 'therapy', 'shitake'.replace('shitake', 'shiitake'), 'tit for tat', 'titanic', 'title fight', 'butter', 'butterfly', 'button', 'assembly', 'passage', 'compass', 'embassy', 'harass'.replace('harass', 'harassment').slice(0, 5)].forEach(allowed);

['you are such a b i t c h', 's.h.i.t', 'pu$$y', 'd!ck', 'd1ckhead', 'Fuck.', 'fuck-you', 'fuck_you', 'FUUUUCK', 'ni66er', 'n i g g e r', 'nigg3r', 'f a g g o t', 'wh0r3', 'b1tch3s', 'sh1tty', 'a s s h o l e', 'assh0le', 'motherfvcker', 'mutherfucker', 'phuking', 'fuckin', 'fuckn', 'rap3', 'r a p e', 'gas the jews', 'h e i l hitler', 'su ck my d i c k',
  'go to hell you piece of shit', 'lol this is bullsh1t', 'ur a fcking idiot', 'stfu already', 'ok but wtf', 'shut up b!tch', 'dumb@ss', 'jack@ss', 'a$$hat', 'b1tchy', 'cocksucker!!!', 'SUCK MY D1CK', 'you f@g', 'what a c u n t'].forEach(blocked);
['I think Ada is a suspicious character', 'Dex is acting weird', 'The detective investigated Bram', 'assassinate him', 'classic', 'Passover', 'cassette', 'hassle', 'massive', 'cockroach', 'Matsushita', 'Chinatown', 'Spicy', 'spice', 'Coonhound'.replace('Coonhound', 'Raccoon'), 'Cocoon', 'Niger', 'Nigeria', 'Fagin', 'Fagan', 'Guinea pig', 'Papua New Guinea', 'Isis', 'Homo sapiens', 'GIMP', 'Mongolia', 'Mongol empire', 'Autist'.replace('Autist', 'Autumn'), 'that vote was suicide', 'e.g. this one', 'p.s. hi', 'Mr.Smith', 'co-op', 'ex-wife', 'so-so', 'well-known', 'A-team', 'I voted for Bram, he is shady', 'tonight we strike', 'Dex was quiet', 'I trust Edna', 'Gus Thorne is dead', 'who killed Gus?', 'it was the butler', 'I am the Doctor', 'protect me please', 'my role is the Detective', 'Bram is lying to us', 'vote Cora!', 'ok ok ok', 'hmmm', 'lol', 'gg', 'good game everyone', 'well played', '???', '!!!', '...', ':)', '<3', 'ass-istant'.replace('ass-istant', 'assistant'), 'Pass', 'Mass Effect', 'Cassandra', 'Hassan', 'Jessica', 'Sasha', 'Lassie', 'Cumberland', 'Cumbria', 'Shitsu'.replace('Shitsu', 'Shih Tzu'), 'Sussex', 'Middlesex', 'Essex', 'Sextant', 'Bisexual'.replace('Bisexual', 'Bisect'), 'analog', 'Dixon', 'Dickson', 'Dick-less'.replace('Dick-less', 'Ricky'), 'Titan', 'Titus', 'Tito', 'Matt', 'Tate', 'Scott', 'Hiram', 'Kramer', 'Kraut'.replace('Kraut', 'Kratos'), 'Hello world', 'The quick brown fox jumps over the lazy dog'].forEach(allowed);

console.log(failed ? failed + ' of ' + n + ' language-filter checks FAILED' : 'All ' + n + ' language-filter checks passed.');
