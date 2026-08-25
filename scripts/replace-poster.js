const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const NEW_IMG = path.join(__dirname, '..', 'assets', 'home-poster-v2.jpg');

let html = fs.readFileSync(GAME_FILE, 'utf8');

const marker = 'class="poster-img" src="';
const startIdx = html.indexOf(marker);
if (startIdx === -1) throw new Error('poster-img marker not found');
const urlStart = startIdx + marker.length;
const urlEnd = html.indexOf('"', urlStart);
if (urlEnd === -1) throw new Error('closing quote not found');

const buf = fs.readFileSync(NEW_IMG);
const newUri = 'data:image/jpeg;base64,' + buf.toString('base64');

html = html.slice(0, urlStart) + newUri + html.slice(urlEnd);
fs.writeFileSync(GAME_FILE, html, 'utf8');
console.log('Replaced poster-img source. New size:', buf.length);
