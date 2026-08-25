const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const SRC_FILE = path.join(__dirname, '..', 'assets', 'detective-office-scene.jpg');

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const buf = await sharp(SRC_FILE).resize({ width: 1400 }).jpeg({ quality: 84 }).toBuffer();
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');

  const marker = '--bg-leather: url(\'';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find --bg-leather marker');
  const valueStart = startIdx + marker.length;
  const valueEnd = html.indexOf('\')', valueStart);
  if (valueEnd === -1) throw new Error('Could not find end of --bg-leather value');

  html = html.slice(0, valueStart) + uri + html.slice(valueEnd);

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Replaced --bg-leather (' + buf.length + ' bytes). New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
