const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const SRC_FILE = path.join(__dirname, '..', 'assets', 'OIG4.fUXmk0LI.jfif');

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const buf = await sharp(SRC_FILE).resize({ width: 1600 }).jpeg({ quality: 85 }).toBuffer();
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');

  const marker = 'class="poster-img" src="';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find poster-img marker');
  const valueStart = startIdx + marker.length;
  const valueEnd = html.indexOf('"', valueStart);
  if (valueEnd === -1) throw new Error('Could not find end of poster-img src value');

  html = html.slice(0, valueStart) + uri + html.slice(valueEnd);

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Replaced poster-img (' + buf.length + ' bytes). New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
