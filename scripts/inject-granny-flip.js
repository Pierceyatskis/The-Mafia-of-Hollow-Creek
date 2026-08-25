const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const IMG_PATH = path.join(__dirname, '..', 'assets', 'characters', 'Crazy Granny Flipped.png');

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

if (html.includes('grannyFlipped:')) {
  console.log('grannyFlipped key already present, skipping.');
  process.exit(0);
}

const before = html.slice(0, closeIdx);
const after = html.slice(closeIdx);

const uri = toDataUri(IMG_PATH);
const insertLine = ',\n  grannyFlipped:\'' + uri + '\'';

fs.writeFileSync(GAME_FILE, before + insertLine + after, 'utf8');
console.log('Injected grannyFlipped image into IMG object.');
