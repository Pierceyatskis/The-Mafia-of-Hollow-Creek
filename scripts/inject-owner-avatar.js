// Adds the owner-only profile picture (IMG.avatarOwner1) from
// 371727d1-...png. Square crop around the figure (head to waist), downsized -
// it only ever renders as a small circle. Replace-in-place if already present.
// Usage: node scripts/inject-owner-avatar.js [preview.png]   (preview writes the crop and exits)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const SRC = path.join(__dirname, '..', 'assets', 'Decorative assets', '371727d1-97f5-41c5-87c0-069d97b24ec5.png');
const CROP = { left: 256, top: 0, width: 1024, height: 1024 };

(async () => {
  const base = sharp(SRC).extract(CROP).resize(256, 256);
  if (process.argv[2]) { await base.png().toFile(process.argv[2]); console.log('preview written'); return; }
  const webp = await base.webp({ quality: 88 }).toBuffer();
  const uri = 'data:image/webp;base64,' + webp.toString('base64');
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const existing = /avatarOwner1:'[^']*',/;
  if (existing.test(html)) {
    html = html.replace(existing, () => `avatarOwner1:'${uri}',`);
  } else {
    const anchor = 'var IMG = {\n';
    const crlfAnchor = 'var IMG = {\r\n';
    const eol = html.includes(crlfAnchor) ? '\r\n' : '\n';
    const a = 'var IMG = {' + eol;
    if (!html.includes(a)) throw new Error('IMG object not found');
    html = html.replace(a, () => a + `  avatarOwner1:'${uri}',` + eol);
  }
  fs.writeFileSync(GAME_FILE, html);
  console.log('avatarOwner1 injected,', webp.length, 'bytes');
})();
