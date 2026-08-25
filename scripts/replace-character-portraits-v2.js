const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const SRC_DIR = path.join(__dirname, '..', 'assets', 'characters_v2');

const KEYS = ['bountyhunter', 'doubleagent', 'godfather', 'mafia', 'grannyFlipped'];

function replaceKeyValue(html, key, newUri) {
  const marker = '\n  ' + key + ':\'';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find IMG.' + key + ' entry');
  const valueStart = startIdx + marker.length;
  const valueEnd = html.indexOf('\'', valueStart);
  if (valueEnd === -1) throw new Error('Could not find closing quote for IMG.' + key);
  return html.slice(0, valueStart) + newUri + html.slice(valueEnd);
}

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');

  for (const key of KEYS) {
    const srcFile = path.join(SRC_DIR, key + '.jpg');
    const buf = await sharp(srcFile).resize({ width: 360 }).jpeg({ quality: 82 }).toBuffer();
    const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
    html = replaceKeyValue(html, key, uri);
    console.log('Replaced IMG.' + key + ' (' + buf.length + ' bytes)');
  }

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Done. New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
