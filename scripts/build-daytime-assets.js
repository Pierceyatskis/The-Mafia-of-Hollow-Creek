const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'Decorative assets');

// DAYTIME_PAGE_BUILD_ORDER.md Step 3 - "crop each object or state into a
// separate transparent PNG", not sprite-position CSS on a whole sheet.
// Checker-pattern removal (dechecker) confirmed necessary per
// ASSET_GUIDE_CORRECTED.md's own production warning - these sheets have
// hasAlpha:false; the checkerboard is baked into the pixels.
async function dechecker(inputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const spread = maxc - minc;
    const isCheckerTone = spread <= 14 && ((r >= 95 && r <= 165) || (r >= 178 && r <= 212));
    if (isCheckerTone) data[o + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels } });
}

async function cropGrid(srcPath, cols, rows, keys, opts) {
  opts = opts || {};
  const base = await dechecker(srcPath);
  const meta = await base.clone().metadata();
  const cellW = meta.width / cols, cellH = meta.height / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= keys.length) continue;
      const key = keys[idx];
      if (!key) continue;
      let buf = await base.clone()
        .extract({ left: Math.round(c * cellW), top: Math.round(r * cellH), width: Math.round(cellW), height: Math.round(cellH) })
        .resize({ width: opts.width || 500 })
        .webp({ quality: opts.quality || 85 })
        .toBuffer();
      out.push({ key, uri: 'data:image/webp;base64,' + buf.toString('base64'), bytes: buf.length });
    }
  }
  return out;
}

async function main() {
  const entries = [];

  // Step 3 - player-card-frames.png: 6 states in a row, cropped individually.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '7d9a6868-1668-4ac8-9a5f-24ca337bba99.png'), 6, 1,
    ['frameNormal', 'frameHover', 'frameSelected', 'frameSpeaking', 'frameDead', 'frameNotification'],
    { width: 400 }
  ));

  // Step 5 - role-envelope-states.png: 5 states in a row.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '6e21f93e-1ae5-4d94-8764-7dd4cc95d149.png'), 5, 1,
    ['envClosed', 'envHover', 'envOpening', 'envOpen', 'envNotification'],
    { width: 400 }
  ));

  // Step 4 - pocket-watch-parts.png: 3x2 grid (case, dial, hour / minute, red(unused), glow).
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '5a52c854-2bee-460f-8ea3-62cea7fcb008.png'), 3, 2,
    ['watchCase', 'watchDial', 'watchHourHand', 'watchMinuteHand', null, 'watchGlow'],
    { width: 400 }
  ));

  // Step 7 - voting-controls-sheet.png (c9ac3aec): row1 = 3 paper/blank card
  // variants (unused here), row2 = box-closed, box-midslot, wax-seal,
  // row3 = padlock(locked), cancel(X), unavailable(minus).
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, 'c9ac3aec-1393-4a1a-be0e-ecd8f4a801c0.png'), 3, 3,
    [null, null, null, 'ballotClosed', 'ballotMidslot', 'ballotWaxSeal', 'ballotLocked', 'ballotCancel', 'ballotUnavailable'],
    { width: 300 }
  ));

  // Step 6 - stage-curtains.png, left+right halves as one piece each side
  // (already a matched pair side by side in the source).
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, 'ad683cac-8b02-498c-ba5f-4112fa5769bc.png'), 2, 1,
    ['curtainLeft', 'curtainRight'],
    { width: 500 }
  ));

  // Step 8 - navigation-objects-sheet.png (5a39c4d8): stack-of-papers(unused
  // here), closed-notebook, rolled-newspaper, gear - 4 in a row.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '5a39c4d8-da27-4c33-ae10-dd4b35d89fc4.png'), 4, 1,
    [null, 'navNotebook', 'navNewspaper', 'navGear'],
    { width: 260 }
  ));

  // Step 8 - the folder/case-file-stack nav icon actually lives on
  // interaction-controls-sheet.png per ASSET_GUIDE_CORRECTED (5dcbc76b),
  // NOT the empty-state sheet - reusing the wax-seal/envelope/ballot/pin
  // sheet's folder-like case icon would be wrong; the real folder icon is
  // on empty-state-icons-sheet.png (4c54f3e5) cell (0,0), which doubles as
  // both "empty case files" AND, per this project's existing convention
  // (SoundFX.playCaseFileOpen already ties folder art to case-file UI),
  // the nav icon itself.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '4c54f3e5-c5c8-4f35-8ee0-734efb5865bd.png'), 3, 2,
    ['navFolder', null, null, null, null, null],
    { width: 260 }
  ));

  // button-red-wide.png (Untitled_design.png) - wide red button background,
  // real HTML text goes on top, never baked in.
  {
    const buf = await sharp(path.join(ASSETS_DIR, 'Untitled_design.png'))
      .resize({ width: 600 }).png({ compressionLevel: 9 }).toBuffer();
    entries.push({ key: 'buttonRedWide', uri: 'data:image/png;base64,' + buf.toString('base64'), bytes: buf.length });
  }

  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const marker = 'var DAYTIME_IMG = {';
  let startIdx = html.indexOf(marker);
  const objectBody = entries.map(e => '  ' + e.key + ': \'' + e.uri + '\'').join(',\n');
  const block = 'var DAYTIME_IMG = {\n' + objectBody + '\n};\n';

  if (startIdx === -1) {
    const initIdx = html.lastIndexOf('initGame();');
    if (initIdx === -1) throw new Error('Could not find initGame();');
    html = html.slice(0, initIdx) + block + '\n' + html.slice(initIdx);
  } else {
    const endIdx = html.indexOf('\n};', startIdx);
    if (endIdx === -1) throw new Error('Could not find closing "};" for existing DAYTIME_IMG');
    html = html.slice(0, startIdx) + block.slice(0, -1) + html.slice(endIdx + 3);
  }
  fs.writeFileSync(GAME_FILE, html, 'utf8');
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  console.log('Injected DAYTIME_IMG with', entries.length, 'individually-cropped assets, total', Math.round(totalBytes / 1024), 'KB.');
  entries.forEach(e => console.log(' -', e.key, Math.round(e.bytes / 1024) + 'KB'));
}

main().catch(e => { console.error(e); process.exit(1); });
