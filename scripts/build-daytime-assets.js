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
      let left = Math.round(c * cellW), top = Math.round(r * cellH);
      let width = Math.min(Math.round(cellW), meta.width - left);
      let height = Math.min(Math.round(cellH), meta.height - top);
      // Optional inset (fraction of the cell) - lets a cell crop to just its
      // actual drawn content instead of the full grid cell, for sheets where
      // the cell is much taller/wider than the artwork itself (e.g. the
      // role-envelope sheet's cells are portrait-oriented but the envelope
      // art is a wide band in the middle).
      if (opts.insetFrac) {
        const f = opts.insetFrac;
        left = left + Math.round(f.left * cellW);
        top = top + Math.round(f.top * cellH);
        width = Math.round(f.width * cellW);
        height = Math.round(f.height * cellH);
      }
      let buf = await base.clone()
        .extract({ left: left, top: top, width: width, height: height })
        .resize({ width: opts.width || 500 })
        .webp({ quality: opts.quality || 85 })
        .toBuffer();
      out.push({ key, uri: 'data:image/webp;base64,' + buf.toString('base64'), bytes: buf.length });
    }
  }
  return out;
}

// Day page visual rebuild batch (2026-09-07) - this newer set of assets
// bakes in a LIGHTER checkerboard (near-white / light-gray, ~200-255) than
// the original batch's medium-gray one, confirmed by sampling raw pixels
// (the original dechecker's bands left the whole image opaque on these
// files). Same idea, wider band.
async function dechecker2(inputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const spread = maxc - minc;
    if (spread <= 12 && r >= 178) data[o + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels } });
}

// For standalone hero-shot assets (one object, lots of checker margin
// around it, no grid) - crops to the actual content bounding box instead
// of a fixed grid cell. Robust to isolated anti-aliasing/noise pixels:
// only counts a row/column as "content" once it has a real run of opaque
// pixels, same technique proven on the role-envelope crop (GAP_COMPARISON
// item 6) and the frame-window measurements (DAYTIME Step 3).
async function cropSingle(srcPath, key, bbox, opts) {
  opts = opts || {};
  const base = await (opts.decheckerFn || dechecker2)(srcPath);
  const buf = await base.clone()
    .extract({ left: bbox.left, top: bbox.top, width: bbox.w, height: bbox.h })
    .resize({ width: opts.width || 500 })
    .webp({ quality: opts.quality || 85 })
    .toBuffer();
  return { key, uri: 'data:image/webp;base64,' + buf.toString('base64'), bytes: buf.length };
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
    // GAP_COMPARISON Item 6 - each cell is a tall 434x724 box but the drawn
    // envelope (and, for the open states, the card poking out the top) only
    // occupies a band from ~7.6% to ~71% of the cell height - measured by
    // test-cropping cell 3 (envOpen, the tallest state) until nothing
    // clipped, then confirming the same window doesn't clip the smaller
    // closed states either. Without this, object-fit:contain on the full
    // portrait-oriented cell rendered the envelope as a tiny sliver.
    { width: 400, insetFrac: { left: 0, top: 0.076, width: 1, height: 0.635 } }
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
    ['navFolder', 'emptyNotes', 'emptyChat', 'emptyStage', null, null],
    { width: 260 }
  ));

  // Day page visual rebuild - the bottom nav gets 5 real hero-shot icons
  // (main case file/character stack/journal book/news paper/gear.png)
  // instead of small crops from a shared sheet. navFolder above stays as
  // the empty-state icon (case-log-empty etc.) - only the nav BUTTON now
  // points elsewhere. Bounding boxes measured with the robust per-row/
  // column opaque-count technique (see cropSingle).
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main case file.png'), 'navCaseFile',
    { left: 37, top: 152, w: 1598, h: 652 }, { width: 320 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main character stack.png'), 'navCharacterStack',
    { left: 38, top: 195, w: 1461, h: 690 }, { width: 320 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main journal book.png'), 'navJournalBook',
    { left: 104, top: 19, w: 1342, h: 980 }, { width: 260 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main news paper.png'), 'navNewspaperMain',
    { left: 90, top: 118, w: 1997, h: 496 }, { width: 320 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main gear.png'), 'navGearMain',
    { left: 37, top: 26, w: 1232, h: 1115 }, { width: 260 }
  ));

  // Day page visual rebuild Region 2 - side-column frame (Character Grid
  // and Town Talk), used as a CSS border-image so the brass corner plates
  // stay crisp while the middle stretches to fit each column's height.
  // Solid rectangle, no checker margin - no dechecker/crop needed.
  {
    const buf = await sharp(path.join(ASSETS_DIR, '7393c436-3dd3-47a6-b15a-aa917650278e.png'))
      .resize({ width: 900 }).webp({ quality: 88 }).toBuffer();
    entries.push({ key: 'sidePanelFrame', uri: 'data:image/webp;base64,' + buf.toString('base64'), bytes: buf.length });
  }

  // Day page visual rebuild Region 3 - the whole Bulletin+Stage+Voting
  // center column as one image (confirmed with the user: this replaces
  // the three separate CSS panels entirely). Uses the ORIGINAL dechecker -
  // this file's baked-in checker matches the older batch's medium-gray
  // tone, verified by a clean grid-overlay crop during measurement, unlike
  // the newer "main *.png" batch which needed dechecker2.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'c45610ee-ebd8-4102-86bd-feee6d109fd0.png'), 'bulletinCabinet',
    { left: 0, top: 0, w: 1145, h: 1374 }, { width: 900, decheckerFn: dechecker }
  ));

  // Step 9 - chat-stage-controls.png (37a04bae): 5x2 grid. Only the cells
  // with a real, existing hook in the chat/stage panel are wired up
  // (accusation pointer on the chat tag + Accusations filter tab, player-
  // tag card by the accusation select, phase-change bell on system-log
  // entries, mic active/muted swapped in for the stage speaker's emoji
  // mic badge). Row 2's settings gear/protection shield/stage chair and
  // row 1's speaking waveform/back arrow have no clean, non-redundant
  // hook yet (settings already uses navGear, the waveform bars are a
  // live CSS animation, no in-scope back button lives in the chat panel)
  // so they're left uncropped rather than added unused.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '37a04bae-6a55-4c63-9a41-48bf6b1c41be.png'), 5, 2,
    ['micActive', 'micMuted', null, 'phaseBell', null,
     'playerTagCard', null, 'accusationPointer', null, null],
    { width: 300 }
  ));

  // Step 9 - game-status-markers.png (61aab725): 4x3 grid. noteMarker
  // replaces the pencil-mark emoji badge on town tiles, redPin replaces
  // the notebook's pin-button emoji, trustedCheck/unknownMarker/
  // investigationMagnifier illustrate the notebook's existing Trusted/
  // Unknown/Suspicious marks. The rest (ribbon, speaking indicator, wax
  // seal, bell, shield, chain, eye) have no clean existing hook without
  // inventing new UI, so left uncropped.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, '61aab725-541b-414b-8854-18ec211f304a.png'), 4, 3,
    [null, 'noteMarker', null, 'redPin',
     'trustedCheck', 'unknownMarker', null, null,
     null, 'investigationMagnifier', null, null],
    { width: 200 }
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
