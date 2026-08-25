const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const SRC = path.join(__dirname, '..', 'assets', 'characters', 'Mafia Henchman.jpg');

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  if (html.includes('mafia:\'data:image')) {
    console.log('IMG.mafia already present, skipping.');
    return;
  }

  const jpegBuf = await sharp(SRC).jpeg({ quality: 88 }).toBuffer();
  const uri = 'data:image/jpeg;base64,' + jpegBuf.toString('base64');

  const marker = 'var IMG = {';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
  const closeIdx = html.indexOf('\n};', startIdx);
  if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

  const before = html.slice(0, closeIdx);
  const after = html.slice(closeIdx);
  const insertLine = ',\n  mafia:\'' + uri + '\'';

  fs.writeFileSync(GAME_FILE, before + insertLine + after, 'utf8');
  console.log('Injected IMG.mafia.');
}

main().catch(e => { console.error(e); process.exit(1); });
