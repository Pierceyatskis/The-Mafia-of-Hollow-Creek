const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');

const IMAGES = [
  { file: path.join(__dirname, '..', 'assets', 'death-mafia-shadows.jpg'), key: 'deathMafia' },
  { file: path.join(__dirname, '..', 'assets', 'death-pointing-fingers.jpg'), key: 'deathVoted' }
];

let html = fs.readFileSync(GAME_FILE, 'utf8');

const marker = 'var IMG = {';
const startIdx = html.indexOf(marker);
if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
const closeIdx = html.indexOf('\n};', startIdx);
if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

if (html.includes('deathMafia:')) {
  console.log('Death images already present, skipping.');
  process.exit(0);
}

const before = html.slice(0, closeIdx);
const after = html.slice(closeIdx);

let insertLines = '';
for (const { file, key } of IMAGES) {
  const buf = fs.readFileSync(file);
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
  insertLines += ',\n  ' + key + ':\'' + uri + '\'';
}

fs.writeFileSync(GAME_FILE, before + insertLines + after, 'utf8');
console.log('Injected death screen images into IMG object.');
