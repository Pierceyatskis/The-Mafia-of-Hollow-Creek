const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'characters');

const NEW_IMAGES = [
  { file: 'Crazy Granny.jpg', key: 'granny' },
  { file: 'godfather mafia.jpg', key: 'godfather' },
  { file: 'Miller.jpg', key: 'miller' },
  { file: 'The Double Agent.jpg', key: 'doubleagent' },
  { file: 'Townsperson.jpg', key: 'civilian' },
  { file: 'Coward.jpg', key: 'coward' },
  { file: 'Farmer.jpg', key: 'farmer' },
  { file: 'Navy Seal.jpg', key: 'navyseal' }
];

function toDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

let html = fs.readFileSync(GAME_FILE, 'utf8');

const marker = 'var IMG = {';
const startIdx = html.indexOf(marker);
if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');

const closeIdx = html.indexOf('\n};', startIdx);
if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

const before = html.slice(0, closeIdx);
const after = html.slice(closeIdx);

let insertLines = '';
for (const { file, key } of NEW_IMAGES) {
  const uri = toDataUri(path.join(ASSETS_DIR, file));
  insertLines += ',\n  ' + key + ':\'' + uri + '\'';
}

const newHtml = before + insertLines + after;
fs.writeFileSync(GAME_FILE, newHtml, 'utf8');
console.log('Injected', NEW_IMAGES.length, 'images into IMG object.');
