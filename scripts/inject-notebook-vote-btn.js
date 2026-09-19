// Crops the "Vote for this person" plate out of the notebook dossier page art
// (it's painted into main notebook page.png, so the live <button> on top of it
// has nothing of its own to restyle on hover) and adds it to DAYTIME_IMG as
// notebookVoteBtn. Rounded-corner alpha mask so the brightened hover copy
// doesn't carry a halo of parchment past the plate's own rounded corners.
// Region = the button's own box (.notebook-vote-btn: 7.94% / 73.76% / 37.75% /
// 11.53% of the 1536x1024 page).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const SRC = path.join(__dirname, '..', 'assets', 'Decorative assets', 'main notebook page.png');
const BOX = { left: 122, top: 755, width: 580, height: 118 };
const RADIUS = 9;

(async () => {
  const mask = Buffer.from(
    `<svg width="${BOX.width}" height="${BOX.height}"><rect width="${BOX.width}" height="${BOX.height}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`
  );
  const webp = await sharp(SRC)
    .extract(BOX)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .webp({ quality: 90 })
    .toBuffer();
  const uri = 'data:image/webp;base64,' + webp.toString('base64');

  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const existing = /notebookVoteBtn: '[^']*',/;
  if (existing.test(html)) {
    html = html.replace(existing, () => `notebookVoteBtn: '${uri}',`);
  } else {
    const anchor = /(notebookDossierBg: '[^']*',)/;
    if (!anchor.test(html)) throw new Error('notebookDossierBg anchor not found');
    html = html.replace(anchor, (m) => `${m}\n  notebookVoteBtn: '${uri}',`);
  }
  fs.writeFileSync(GAME_FILE, html);
  console.log('injected notebookVoteBtn,', webp.length, 'bytes');
})();
