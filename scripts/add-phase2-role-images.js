const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const SRC_DIR = path.join(__dirname, '..', 'assets', 'characters_v2');

const NEW_IMAGES = [
  { file: 'framer.jpg', key: 'framer' },
  { file: 'hitman.jpg', key: 'hitman' },
  { file: 'cultleader.jpg', key: 'cultleader' }
];

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');

  const marker = 'var IMG = {';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
  const closeIdx = html.indexOf('\n};', startIdx);
  if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

  let insertLines = '';
  for (const { file, key } of NEW_IMAGES) {
    const srcFile = path.join(SRC_DIR, file);
    const buf = await sharp(srcFile).resize({ width: 360 }).jpeg({ quality: 82 }).toBuffer();
    const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
    insertLines += '  ' + key + ':\'' + uri + '\',\n';
    console.log('Encoded IMG.' + key + ' (' + buf.length + ' bytes)');
  }

  const beforeClose = html.slice(0, closeIdx);
  const needsComma = !/,\s*$/.test(beforeClose);
  html = beforeClose + (needsComma ? ',' : '') + html.slice(closeIdx, closeIdx + 1) + insertLines + html.slice(closeIdx + 1);

  const roleImgMarker = 'var ROLE_IMG = {';
  const riIdx = html.indexOf(roleImgMarker);
  if (riIdx === -1) throw new Error('Could not find "var ROLE_IMG = {" marker');
  const riInsertAt = riIdx + roleImgMarker.length;
  const roleImgInsert = 'Framer:IMG.framer, Hitman:IMG.hitman, CultLeader:IMG.cultleader, ';
  html = html.slice(0, riInsertAt) + roleImgInsert + html.slice(riInsertAt);

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Done. New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
