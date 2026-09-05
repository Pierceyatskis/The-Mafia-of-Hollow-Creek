const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const NEW_IMAGE = path.join(__dirname, '..', 'assets', 'end-screen-bg.png');

let html = fs.readFileSync(GAME_FILE, 'utf8');

const marker = "--bg-end: url('";
const startIdx = html.indexOf(marker);
if (startIdx === -1) throw new Error('Could not find "--bg-end:" marker');
const valueStart = startIdx + marker.length;
const closeIdx = html.indexOf("');", valueStart);
if (closeIdx === -1) throw new Error('Could not find closing \');\' for --bg-end value');

const buf = fs.readFileSync(NEW_IMAGE);
const uri = 'data:image/jpeg;base64,' + buf.toString('base64');

html = html.slice(0, valueStart) + uri + html.slice(closeIdx);
fs.writeFileSync(GAME_FILE, html, 'utf8');
console.log('Swapped --bg-end background image (' + buf.length + ' bytes). New file size:', fs.statSync(GAME_FILE).size);
