const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const MAP = {
  bountyWin: path.join(__dirname, '..', 'assets', 'bounty-win-scene.jpg'),
  townWin: path.join(__dirname, '..', 'assets', 'town-win-scene.jpg'),
  mafiaWin: path.join(__dirname, '..', 'assets', 'mafia-win-scene.jpg')
};

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const marker = 'var IMG = {';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
  const closeIdx = html.indexOf('\n};', startIdx);
  if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

  let insertLines = '';
  for (const key of Object.keys(MAP)) {
    if (html.includes(key + ":'data:image")) {
      console.log('IMG.' + key + ' already present, skipping.');
      continue;
    }
    const buf = await sharp(MAP[key]).resize({ width: 1000 }).jpeg({ quality: 84 }).toBuffer();
    const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
    insertLines += ',\n  ' + key + ':\'' + uri + '\'';
    console.log('Queued IMG.' + key + ' (' + buf.length + ' bytes)');
  }

  const before = html.slice(0, closeIdx);
  const after = html.slice(closeIdx);
  html = before + insertLines + after;

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Done. New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
