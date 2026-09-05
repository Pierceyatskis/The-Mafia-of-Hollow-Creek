const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const IMAGE_FILE = path.join(__dirname, '..', 'assets', 'death-vigilante-guilt.jpg');
const KEY = 'deathVigilanteGuilt';

let html = fs.readFileSync(GAME_FILE, 'utf8');

if (html.includes(KEY + ':')) {
  console.log(KEY + ' already present, skipping.');
  process.exit(0);
}

const marker = 'var IMG = {';
const startIdx = html.indexOf(marker);
if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
const closeIdx = html.indexOf('\n};', startIdx);
if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

const buf = fs.readFileSync(IMAGE_FILE);
const uri = 'data:image/jpeg;base64,' + buf.toString('base64');

const beforeClose = html.slice(0, closeIdx);
const needsComma = !/,\s*$/.test(beforeClose);
const insertLine = (needsComma ? ',' : '') + '\n  ' + KEY + ':\'' + uri + '\'';

html = beforeClose + insertLine + html.slice(closeIdx);

fs.writeFileSync(GAME_FILE, html, 'utf8');
console.log('Injected IMG.' + KEY + ' (' + buf.length + ' bytes). New file size:', fs.statSync(GAME_FILE).size);
