// Adds the sheet's extra-wide pinned strip (two corner pins) to DAYTIME_IMG as
// voteRevealParchmentWide, for vote cards that end up much wider than tall.
// Same bounds the other vote-reveal parchment tiers were measured with
// (opaque-alpha bbox on 6e217f05: 699,84 792x217). Also registered in
// build-daytime-assets.js so a full rebuild keeps it.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const SRC = path.join(__dirname, '..', 'assets', 'Decorative assets', '6e217f05-a79b-4b4c-8adb-fa69551ff887.png');

(async () => {
  const webp = await sharp(SRC)
    .extract({ left: 699, top: 84, width: 792, height: 217 })
    .resize({ width: 640 })
    .webp({ quality: 90 })
    .toBuffer();
  const uri = 'data:image/webp;base64,' + webp.toString('base64');
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  // Replace-in-place if already injected; otherwise append after the Large tier
  // (which may be the object's last entry, i.e. have no trailing comma).
  const existing = /voteRevealParchmentWide: '[^']*'/;
  if (existing.test(html)) {
    html = html.replace(existing, () => `voteRevealParchmentWide: '${uri}'`);
  } else {
    const anchor = /(voteRevealParchmentLarge: '[^']*')(,?)/;
    if (!anchor.test(html)) throw new Error('voteRevealParchmentLarge anchor not found');
    html = html.replace(anchor, (m, entry, comma) => `${entry},
  voteRevealParchmentWide: '${uri}'${comma}`);
  }
  fs.writeFileSync(GAME_FILE, html);
  console.log('injected voteRevealParchmentWide,', webp.length, 'bytes');
})();
