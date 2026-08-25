const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const SRC_FILE = path.join(__dirname, '..', 'assets', 'nightkill-mafia-street.jpg');

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const buf = await sharp(SRC_FILE).resize({ width: 1000 }).jpeg({ quality: 84 }).toBuffer();
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');

  const marker = 'var IMG = {';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
  const closeIdx = html.indexOf('\n};', startIdx);
  if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

  if (html.includes("nightKillScene:'data:image")) {
    console.log('IMG.nightKillScene already present, skipping.');
    return;
  }

  const before = html.slice(0, closeIdx);
  const after = html.slice(closeIdx);
  const insertLine = ',\n  nightKillScene:\'' + uri + '\'';

  fs.writeFileSync(GAME_FILE, before + insertLine + after, 'utf8');
  console.log('Injected IMG.nightKillScene (' + buf.length + ' bytes). New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
