// Re-injects DAYTIME_IMG.voteRevealBg from the current source art without
// rerunning the whole build-daytime-assets pipeline. Same crop/size/format
// the build script uses for this entry (full 1671x941 frame, resized to 1200
// wide, webp q90, source already has real alpha so no dechecker).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const SRC = path.join(__dirname, '..', 'assets', 'Decorative assets', '86f83b44-f86b-4fd7-a67e-302c653a88f9.png');

(async () => {
  const webp = await sharp(SRC)
    .ensureAlpha()
    .extract({ left: 0, top: 0, width: 1671, height: 941 })
    .resize({ width: 1200 })
    .webp({ quality: 90 })
    .toBuffer();
  const uri = 'data:image/webp;base64,' + webp.toString('base64');
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const re = /voteRevealBg: '[^']*'/;
  if (!re.test(html)) throw new Error('voteRevealBg entry not found');
  html = html.replace(re, () => `voteRevealBg: '${uri}'`);
  fs.writeFileSync(GAME_FILE, html);
  console.log('voteRevealBg replaced,', webp.length, 'bytes');
})();
