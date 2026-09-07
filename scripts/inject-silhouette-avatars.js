const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'Decorative assets');

// User request: the two 10-portrait silhouette sheets become real avatar-
// picker choices (not a separate "unknown player" placeholder) - continuing
// the existing avatar1..avatar15 numbering as avatar16..avatar35 so the
// server's sanitizeAvatarKey(/^avatar[0-9]{1,3}$/) allowlist already
// accepts them with no server.js change needed.
const SHEETS = [
  { file: '18a4e798-12f5-4144-9071-3437f7ec26c1.png', startKey: 16 },
  { file: '5d385e8f-46ec-43c3-80c3-3bc944ef9238.png', startKey: 26 }
];
const COLS = 5, ROWS = 2;

async function main() {
  const entries = [];
  for (const sheet of SHEETS) {
    const srcPath = path.join(ASSETS_DIR, sheet.file);
    const meta = await sharp(srcPath).metadata();
    const cellW = Math.floor(meta.width / COLS);
    const cellH = Math.floor(meta.height / ROWS);
    let key = sheet.startKey;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const buf = await sharp(srcPath)
          .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
          .resize({ width: 260 })
          .jpeg({ quality: 82 })
          .toBuffer();
        entries.push({ key: 'avatar' + key, uri: 'data:image/jpeg;base64,' + buf.toString('base64'), bytes: buf.length });
        key++;
      }
    }
  }

  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const marker = 'var IMG = {';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find "var IMG = {" marker');
  const closeIdx = html.indexOf('\n};', startIdx);
  if (closeIdx === -1) throw new Error('Could not find closing "};" for IMG object');

  let insertLines = '';
  for (const e of entries) {
    if (html.includes(e.key + ':\'data:image')) {
      console.log('IMG.' + e.key + ' already present, skipping.');
      continue;
    }
    insertLines += ',\n  ' + e.key + ':\'' + e.uri + '\'';
    console.log('Queued IMG.' + e.key + ' (' + e.bytes + ' bytes)');
  }

  html = html.slice(0, closeIdx) + insertLines + html.slice(closeIdx);
  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Done -', entries.length, 'avatars queued. New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
