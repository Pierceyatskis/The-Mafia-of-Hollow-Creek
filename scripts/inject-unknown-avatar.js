const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const SRC_FILE = path.join(__dirname, '..', 'assets', 'characters_v2', 'unknown-square.jpg');

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const buf = await sharp(SRC_FILE).resize({ width: 300 }).jpeg({ quality: 82 }).toBuffer();
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');

  const marker = 'var UNKNOWN_AVATAR_IMG = ';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find UNKNOWN_AVATAR_SVG marker');
  const valueStart = html.indexOf('"', startIdx) + 1;
  const valueEnd = html.indexOf('"', valueStart);
  html = html.slice(0, valueStart) + uri + html.slice(valueEnd);

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Replaced UNKNOWN_AVATAR_SVG value with painted icon (' + buf.length + ' bytes). New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
