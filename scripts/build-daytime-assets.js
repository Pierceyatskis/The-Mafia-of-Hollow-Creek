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
  const base = await (opts.decheckerFn || dechecker)(srcPath);
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

// main hand.png (day layout rebuild bulletin icons) has a noisier/grainier
// checker than every other file in this project - not a flat 1-3 spread
// tone but per-pixel dithering with a light band running up to ~222 (past
// dechecker2's 212 cap) and a dark band down near 134 - confirmed by
// sampling raw corner pixels and finding 1000+ unique RGB tones in one
// 80x80 corner. Neither existing dechecker's band covers that whole range,
// which is why both left the image looking fully opaque (checker treated
// as content). Widened bands catch it; the hand's own art is solid black
// so a wide near-neutral-gray exclusion band is still safe.
async function decheckerWide(inputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const spread = maxc - minc;
    if (spread <= 25 && r >= 115 && r <= 232) data[o + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels } });
}

// 951dfbd1 (mute button) already has real alpha (hasAlpha:true, no baked-in
// checker) - dechecker2's color-band stripping would risk eating real light
// pixels in the button's own gold trim/highlights, so this just passes the
// pixels through untouched and lets cropSingle crop to the real alpha bbox.
async function passthroughAlpha(inputPath) {
  return sharp(inputPath).ensureAlpha();
}

// Strips every opaque pixel that isn't part of the single largest 4-
// connected opaque region. For an asset that's one big continuous shape
// (a full page, a filled silhouette) plus a checkerboard baked into the
// "should be transparent" pixels, this is a safe general cleanup pass
// AFTER a color-threshold dechecker: real content (the page, the ink on
// it) is always touching the page's own body, so it's all one giant
// component; anything left over from the checker - a lone square the
// color threshold's band didn't cover - sits isolated in the now-mostly-
// transparent field and forms its own tiny component, which this removes.
function keepLargestComponent(data, width, height, channels) {
  const total = width * height;
  const isOpaque = (idx) => data[idx * channels + 3] > 0;
  const componentId = new Int32Array(total).fill(-1);
  const stack = new Int32Array(total);
  const sizes = [];
  let label = 0;
  for (let start = 0; start < total; start++) {
    if (componentId[start] !== -1 || !isOpaque(start)) continue;
    let sp = 0;
    stack[sp++] = start;
    componentId[start] = label;
    let size = 0;
    while (sp > 0) {
      const idx = stack[--sp];
      size++;
      const x = idx % width, y = (idx - x) / width;
      if (x > 0) { const n = idx - 1; if (componentId[n] === -1 && isOpaque(n)) { componentId[n] = label; stack[sp++] = n; } }
      if (x < width - 1) { const n = idx + 1; if (componentId[n] === -1 && isOpaque(n)) { componentId[n] = label; stack[sp++] = n; } }
      if (y > 0) { const n = idx - width; if (componentId[n] === -1 && isOpaque(n)) { componentId[n] = label; stack[sp++] = n; } }
      if (y < height - 1) { const n = idx + width; if (componentId[n] === -1 && isOpaque(n)) { componentId[n] = label; stack[sp++] = n; } }
    }
    sizes[label] = size;
    label++;
  }
  let bestLabel = 0, bestSize = -1;
  for (let l = 0; l < sizes.length; l++) if (sizes[l] > bestSize) { bestSize = sizes[l]; bestLabel = l; }
  for (let i = 0; i < total; i++) {
    if (componentId[i] !== bestLabel && componentId[i] !== -1) data[i * channels + 3] = 0;
  }
}

// cropSingle's postProcessFn hook, for an asset whose dechecker already
// produces a clean binary (0/255) alpha mask at native resolution, but
// still shows a few faint flecks once resized down: resize's lanczos
// kernel rings slightly past a hard alpha edge, leaving a halo of very-
// low (but nonzero) alpha pixels beyond the real silhouette - each too
// faint on its own to flag as "opaque" by eye, but visible once
// composited over something dark. Zeroing anything below a mid alpha
// threshold drops that ringing while leaving the silhouette's own real
// (much higher-alpha) antialiased edge untouched; re-running
// keepLargestComponent afterward catches any leftover fleck the
// thresholding disconnected from the main shape but didn't fully zero.
function despeckleAlpha(data, width, height, channels) {
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const a = data[i * channels + 3];
    if (a > 0 && a < 100) data[i * channels + 3] = 0;
  }
  keepLargestComponent(data, width, height, channels);
}

// "main news paper open.png" bakes in a checkerboard that's anti-aliased
// at the tile boundaries, producing a continuous smear of neutral-gray
// intermediate tones between the two checker colors (~130 up to 255) -
// not just two flat bands. A first pass covering only 130-190 and
// 240-255 left the 191-239 gap fully opaque, which is invisible against
// this project's usual light checker backdrop but shows up as a clear
// grid halo once composited over something dark (confirmed by rendering
// exactly that composite before and after this fix).
//
// That still left a handful of visible flecks over a dark backdrop
// (confirmed by rendering the torn-edge corners specifically) - the
// checkerboard here alternates between a LIGHT tone (caught above) and a
// DARK/near-neutral tone landing in the same r~0-60 range as the paper's
// own body text, so widening the band to catch it would risk eating
// real ink. keepLargestComponent sidesteps that entirely: the paper and
// everything printed on it is one connected blob, so any surviving dark
// checker square - isolated in the transparent field around the torn
// edge - gets removed as its own tiny disconnected component instead.
async function decheckerNewsOpen(inputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const spread = maxc - minc;
    if (spread <= 16 && r >= 125) data[o + 3] = 0;
  }
  keepLargestComponent(data, width, height, channels);
  return sharp(data, { raw: { width, height, channels } });
}

// "main red line.png" - same checker family as decheckerNewsOpen but with
// enough residual speckle at that band that it was still visible over a
// dark composite (checked directly) - widened further until a fresh
// dark-backdrop composite came back clean. The red marker strokes
// themselves are nowhere near this neutral-gray band (high R vs G/B
// spread) so widening the band has no risk of eating into them.
async function decheckerRedLine(inputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const spread = maxc - minc;
    if (spread <= 22 && r >= 110) data[o + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels } });
}

// The oval and the underline are two separate strokes in the source
// drawing, but the underline sits INSIDE the oval's own bounding box
// (not below it), so cropping the oval's real bbox would also grab the
// underline at its fixed, wrong-for-any-other-layout position. Blanks
// the underline's own measured row band (y 385-450) after dechecking so
// the oval crop is clean - confirmed via a rendered alpha mask before
// use. The two pieces are then positioned independently in CSS instead
// of trying to force one fixed drawing's proportions onto the obituary
// layout.
// CORRECTION: blanking the full row width also erased the oval's own
// left/right edge strokes wherever they pass through that same y-band
// (measured: the oval's sides sit at roughly x 44-76 and x 954-987
// throughout y 385-450, never coming in past there - the underline
// itself only ever spans roughly x 102-934), leaving a visible gap/split
// in the oval outline at both sides. Narrowed the blanked band to
// x 85-950 - comfortably inside the oval's edges on both sides, still
// wide enough to cover the underline's full measured span.
async function decheckerRedLineOvalOnly(inputPath) {
  const base = await decheckerRedLine(inputPath);
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let y = 385; y < 450; y++) {
    for (let x = 85; x < 950; x++) {
      data[(y * width + x) * channels + 3] = 0;
    }
  }
  return sharp(data, { raw: { width, height, channels } });
}

// Untitled_design.png (the wide red banner button) sits on a plain WHITE
// canvas (hasAlpha:false), not a checkerboard - none of the checker-band
// dechecker functions above apply. Fades pixels to transparent as they
// approach pure white instead of a hard cutoff, so the banner's own soft
// drop-shadow tapers off naturally instead of ending in a visible white
// rectangle once it's composited onto the game's parchment/wood surfaces.
async function decheckerWhite(inputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const brightness = (r + g + b) / 3;
    if (brightness >= 248) data[o + 3] = 0;
    else if (brightness >= 200) data[o + 3] = Math.round(data[o + 3] * Math.pow((248 - brightness) / (248 - 200), 1.5));
  }
  return sharp(data, { raw: { width, height, channels } });
}

// The voting-controls-sheet's wax seal (c9ac3aec, row2/col3) is a plain
// blank blob - the mockup's version has a five-pointed star embossed into
// it and no separate starred asset exists anywhere in the decorative-
// assets folder, so this bakes one on at build time instead: a dark
// semi-transparent maroon polygon (not flat black) so the wax's own
// texture still shows through, the same way a real pressed emboss would.
async function addEmbossedStar(entry) {
  const mimeMatch = entry.uri.match(/^data:(image\/\w+);base64,/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
  const buf = Buffer.from(entry.uri.slice(entry.uri.indexOf(',') + 1), 'base64');
  const meta = await sharp(buf).metadata();
  const size = Math.round(Math.min(meta.width, meta.height) * 0.46);
  const c = size / 2;
  const outerR = size / 2, innerR = outerR * 0.42;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push((c + r * Math.cos(angle)).toFixed(1) + ',' + (c + r * Math.sin(angle)).toFixed(1));
  }
  const starSvg = '<svg width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">' +
    '<polygon points="' + pts.join(' ') + '" fill="#4a0d0e" fill-opacity="0.6" stroke="#2c0607" stroke-width="' + Math.max(1, size * 0.02) + '" stroke-opacity="0.55"/>' +
    '</svg>';
  const composited = await sharp(buf)
    .composite([{ input: Buffer.from(starSvg), gravity: 'center' }])
    .toFormat(mime === 'image/webp' ? 'webp' : 'png', { quality: 85 })
    .toBuffer();
  entry.uri = 'data:' + mime + ';base64,' + composited.toString('base64');
  entry.bytes = composited.length;
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
  let pipeline = base.clone()
    .extract({ left: bbox.left, top: bbox.top, width: bbox.w, height: bbox.h })
    .resize({ width: opts.width || 500 });
  // Optional cleanup pass run AFTER resize, on the resized raw pixels -
  // for a decheckerFn whose own despeckling only guarantees a clean
  // result at native resolution, since resize's own interpolation (a
  // lanczos kernel rings slightly past a hard alpha edge) can reintroduce
  // a faint halo of very-low-but-nonzero alpha around what was already a
  // clean silhouette, which then shows up again once composited.
  if (opts.postProcessFn) {
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    opts.postProcessFn(data, info.width, info.height, info.channels);
    pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  }
  const buf = await pipeline.webp({ quality: opts.quality || 85 }).toBuffer();
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

  // Step 5 - role-envelope-states.png: 5 states in a row. Same noisy-dither
  // checker as main timer.png/the game title (confirmed by rendering the
  // plain-dechecker alpha mask - dense un-stripped speckle everywhere,
  // the "spottiness" the envelope was flagged for) - decheckerWide cleans
  // it up the same way.
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
    { width: 400, insetFrac: { left: 0, top: 0.076, width: 1, height: 0.635 }, decheckerFn: decheckerWide }
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
  await addEmbossedStar(entries.find(e => e.key === 'ballotWaxSeal'));

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
  // Same crop, much bigger output - a rolled-newspaper desk prop (right
  // side of the desk, day page). Checked this bbox's alpha mask directly
  // before reusing it here: unlike several other assets from this same
  // batch, this one's dechecker2 pass came out clean (no noise speckle
  // needing decheckerWide), so the existing tight bbox is trustworthy at
  // a much larger render size too.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main news paper.png'), 'deskNewspaper',
    { left: 90, top: 118, w: 1997, h: 496 }, { width: 1400 }
  ));
  // Stack of case-file ledgers - a second desk prop, same treatment as
  // deskNewspaper above (dechecker2's default band, no speckle - checked
  // the alpha mask directly). Bbox is the tight content box (a
  // longest-opaque-run scan, >=20px, same technique as deskNewspaper's
  // own bbox) on the 1672x941 source.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main case file.png'), 'deskCaseFile',
    { left: 37, top: 152, w: 1599, h: 654 }, { width: 1400 }
  ));
  // Two more desk props (decorative only for now, no click behavior yet)
  // - same bboxes already measured for their nav-icon counterparts
  // (navJournalBook/navGearMain), just re-cropped bigger for the desk.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main journal book.png'), 'deskNotebook',
    { left: 104, top: 19, w: 1342, h: 980 }, { width: 1400 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main gear.png'), 'deskGear',
    { left: 37, top: 26, w: 1232, h: 1115 }, { width: 700 }
  ));
  // Full open front page ("Hollow Creek Chronicle"), shown large when the
  // desk newspaper prop is clicked. Bbox found via a longest-opaque-run
  // scan (>=20px) after decheckerNewsOpen - confirmed clean (torn-edge
  // silhouette, no clipping) by rendering the crop before wiring it in.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main news paper open.png'), 'newsOpen',
    { left: 13, top: 0, w: 1010, h: 1523 }, { width: 1000, decheckerFn: decheckerNewsOpen, postProcessFn: despeckleAlpha }
  ));
  // Newspaper-engraving versions of the anonymous game-icon set (avatar16-
  // 35), for the "found dead" obituary portrait. Same 5x2 grid as the
  // original color silhouette sheets in inject-silhouette-avatars.js, but
  // NOT the same cell order - the two sheets were generated independently
  // and the character-to-cell assignment doesn't line up 1:1 by position.
  // Confirmed by rendering both sheets side by side and matching each
  // cell's actual costume (hat shape, scarf/no-scarf, cap+vest+no-tie,
  // no-hat+glasses, brooch, flower-hat, etc) - the keys below are ordered
  // by the newspaper sheet's own grid position, pointing each cell at the
  // avatarNN it actually depicts, not at the position-matched number.
  // These sheets are full-bleed, no checker margin baked in (confirmed via
  // metadata - hasAlpha:false but the visible tiles butt edge-to-edge with
  // no padding), so no dechecker pass needed at all, just a plain
  // rectangular grid slice.
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, 'main game icons newspaper.png'), 5, 2,
    ['newsIconAvatar17', 'newsIconAvatar18', 'newsIconAvatar19', 'newsIconAvatar16', 'newsIconAvatar20',
     'newsIconAvatar22', 'newsIconAvatar21', 'newsIconAvatar24', 'newsIconAvatar23', 'newsIconAvatar25'],
    { width: 400, decheckerFn: passthroughAlpha }
  ));
  entries.push(...await cropGrid(
    path.join(ASSETS_DIR, 'main game icon newspaper 2.png'), 5, 2,
    ['newsIconAvatar29', 'newsIconAvatar26', 'newsIconAvatar27', 'newsIconAvatar28', 'newsIconAvatar30',
     'newsIconAvatar32', 'newsIconAvatar31', 'newsIconAvatar34', 'newsIconAvatar33', 'newsIconAvatar35'],
    { width: 400, decheckerFn: passthroughAlpha }
  ));
  // Newspaper-engraving version of the default/unknown game icon (a plain
  // silhouette with a "?"), used as the obituary portrait fallback for a
  // dead player who never picked a game icon - matches newsPortraitFor()'s
  // live-UI counterpart (UNKNOWN_AVATAR_IMG) but in the same sepia
  // engraving style as every other obituary portrait instead of the flat
  // color placeholder.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'eb3cf084-4a99-482b-bbb4-488ece42a6f3.png'), 'newsIconUnknown',
    { left: 0, top: 0, w: 1254, h: 1254 }, { width: 400, decheckerFn: passthroughAlpha }
  ));
  // Red marker annotation (underline + circle) for the obituary. Same
  // 1024x1536 canvas as newsOpen, but NOT pixel-aligned with it - the red
  // shape itself is drawn nearly full-canvas (measured bbox 958x1358 of
  // the 1024x1536 source), unlike the small, article-scoped circle in
  // the reference composite (07b41db4) it was apparently traced FROM at
  // a different scale. Confirmed by first trying newsOpen's own bbox
  // here: the circle rendered enormous, covering most of the page
  // instead of just the obituary. Split into two independent pieces
  // (oval + underline are separate strokes in the source, but the
  // underline sits INSIDE the oval's bbox at a fixed relative position
  // that doesn't line up with this specific headline/body layout) so
  // each can be positioned to actually match the obituary box, instead
  // of stretching one fixed combined drawing and hoping the proportions
  // happen to line up.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main red line.png'), 'newsMarkerCircle',
    { left: 24, top: 50, w: 978, h: 1378 }, { width: 700, decheckerFn: decheckerRedLineOvalOnly }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main red line.png'), 'newsMarkerUnderline',
    { left: 38, top: 380, w: 958, h: 74 }, { width: 700, decheckerFn: decheckerRedLine }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main gear.png'), 'navGearMain',
    { left: 37, top: 26, w: 1232, h: 1115 }, { width: 260 }
  ));

  // Day page visual rebuild Region 2 - side-column frame (Character Grid
  // and Town Talk), used as a CSS border-image so the brass corner plates
  // stay crisp while the middle stretches to fit each column's height.
  // CORRECTION: this file DOES have checker baked in - it's just confined
  // to the four corners (before the brass plate art starts, roughly the
  // outer ~90px), which a full-image sample of the solid dark middle
  // completely missed. Confirmed by sampling the actual corner pixels
  // (alternating ~205/~253 gray, matching the newer batch's light-
  // checker tone) - exactly where border-image-slice pulls its corners
  // from, which is why it showed up live even though the panel's own
  // fill looked fine. dechecker2, same as the other new-batch assets.
  {
    const base = await dechecker2(path.join(ASSETS_DIR, '7393c436-3dd3-47a6-b15a-aa917650278e.png'));
    const buf = await base.resize({ width: 900 }).webp({ quality: 88 }).toBuffer();
    entries.push({ key: 'sidePanelFrame', uri: 'data:image/webp;base64,' + buf.toString('base64'), bytes: buf.length });
  }

  // Day page visual rebuild Region 3, corrected - the user's follow-up
  // review caught two real bugs in the first pass: (1) this file needed
  // dechecker2, not the original - a corner-pixel sample (not just the
  // solid-looking middle) showed the same light checker tone as the
  // newer batch, which the original dechecker's bands don't cover, so a
  // faint checkerboard survived at the edges; (2) treating the whole
  // cabinet as ONE stretched image was wrong - the user wants Bulletin/
  // Stage/Voting as three separate, independently-aspect-ratio-preserved
  // assets with real gaps between them, not one image force-stretched to
  // fill an arbitrary container. Split at the two horizontal frame beams
  // (measured via grid overlay): 0-580 bulletin, 580-1035 stage,
  // 1035-1374 voting.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'c45610ee-ebd8-4102-86bd-feee6d109fd0.png'), 'cabinetBulletin',
    { left: 0, top: 0, w: 1145, h: 580 }, { width: 900 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'c45610ee-ebd8-4102-86bd-feee6d109fd0.png'), 'cabinetStage',
    { left: 0, top: 580, w: 1145, h: 455 }, { width: 900 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'c45610ee-ebd8-4102-86bd-feee6d109fd0.png'), 'cabinetVoting',
    { left: 0, top: 1035, w: 1145, h: 339 }, { width: 900 }
  ));

  // Day layout rebuild (2026-09-08), restart - the user wants to rebuild
  // the day page from scratch, one step at a time, starting with just this
  // single full cabinet illustration placed as one piece (not the 3-way
  // split above, which stays defined but unused for now).
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'c45610ee-ebd8-4102-86bd-feee6d109fd0.png'), 'cabinetFull',
    { left: 0, top: 0, w: 1145, h: 1374 }, { width: 1200 }
  ));

  // Day layout rebuild - the 4 bulletin-card icons (feather/hand/people-row/
  // announcement), matching the mockup's Recent News / Phase Instructions /
  // Players Remain / Public Announcement icons. Bounding boxes measured via
  // the same robust per-row/column opaque-pixel-count technique as the nav
  // icons above.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main feather.png'), 'iconFeather',
    { left: 279, top: 58, w: 1089, h: 1032 }, { width: 400 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main hand.png'), 'iconHand',
    { left: 70, top: 96, w: 1643, h: 679 }, { width: 500, decheckerFn: decheckerWide }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main people row icon.png'), 'iconPeopleRow',
    { left: 51, top: 161, w: 2069, h: 376 }, { width: 700 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main announcement icon.png'), 'iconAnnouncement',
    { left: 323, top: 166, w: 891, h: 692 }, { width: 400 }
  ));

  // Day layout rebuild - stage controls. stageRequestBtn (246bdfc3) already
  // has "REQUEST TO SPEAK" text baked in, ready to use as-is. stageMuteBtn
  // (951dfbd1) is blank on the right (icon only) - text gets overlaid via
  // CSS at render time, same pattern as the bulletin title over its plaque.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '951dfbd1-e917-4bde-989b-13e0c9fa26a7.png'), 'stageMuteBtn',
    { left: 68, top: 130, w: 2066, h: 448 }, { width: 700, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '246bdfc3-ad22-4520-839d-cd5f92db6a57.png'), 'stageRequestBtn',
    { left: 64, top: 141, w: 1959, h: 442 }, { width: 700 }
  ));
  // 9651ecaf already has real alpha (hasAlpha:true) - passthroughAlpha, same
  // as stageMuteBtn above, to avoid dechecker2 eating real light pixels in
  // the gold mic body.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '9651ecaf-5407-419d-aeb1-eab4feb5f2c2.png'), 'stageMicMutedOverlay',
    { left: 243, top: 77, w: 789, h: 1099 }, { width: 400, decheckerFn: passthroughAlpha }
  ));

  // Day layout rebuild - left column (character grid) placeholder frame.
  // Fourth pick (5bcf2925) - taller than the near-square ee01c8ac (trimmed
  // 1096x1217, ratio~0.901 w/h) so 12 cards at 4-per-row can be sized larger
  // and still readable, per explicit direction after ee01c8ac's fixed
  // height (506px interior) capped cards at ~82x165 no matter the gap
  // layout. Has its own header band (top ~11.5% of the trimmed box) above
  // a divider line, then the real card interior below - measured via the
  // same raw-pixel luminance-transition scan used for every prior frame
  // window (interior left/top/right/bottom fractions: 0.0347/0.1150/
  // 0.9672/0.9671 of the trimmed box).
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '5bcf2925-07bf-4942-be15-e4da8a3feee8.png'), 'rosterFrame',
    { left: 34, top: 51, w: 1096, h: 1217 }, { width: 700 }
  ));

  // Day layout rebuild - the 12 individual card slots inside the roster
  // frame above. Distinct key from 'frameNormal' (player-card-frames.png)
  // because that asset is already live in real gameplay (the town-tile
  // card frame at line ~6441) - this is a separate, taller-ratio (~1:1.45
  // vs frameNormal's 1:2) frame used only for this placeholder grid, so
  // reusing the same key would risk pulling in the wrong shape and
  // fighting frameNormal's own aspect-ratio CSS in unrelated code.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '6e005c5a-7a6d-46cc-bddc-3d19c0678b11.png'), 'rosterCardFrame',
    { left: 27, top: 28, w: 988, h: 1441 }, { width: 400 }
  ));

  // Day layout rebuild - frameNormal's exported cell (from cropGrid, no
  // insetFrac) is the RAW sheet cell, not the drawn card - the actual art
  // only fills left 12.2%-97.2%, top 16.3%-80.2% of that cell (confirmed
  // by an opaque-pixel bbox scan of the dechecker'd sheet). Every prior
  // roster-grid sizing pass computed tile boxes against the padded cell,
  // so the real card art always looked far smaller than the box, with a
  // big dead band above/below it that no grid `gap` value could remove -
  // that's the "giant gap" that kept recurring. Cropping to the tight
  // content bbox (44,118)-(352,581) fixes it: fills the tile box edge to
  // edge, and its ratio (308x463, ~1:1.503) happens to match the
  // requested ~115-125x175-190 target almost exactly with no distortion.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '7d9a6868-1668-4ac8-9a5f-24ca337bba99.png'), 'cardFrameTight',
    { left: 44, top: 118, w: 308, h: 463 }, { width: 400, decheckerFn: dechecker }
  ));

  // frameDead (cell index 4 of 6, left edge 4*362=1448) is NOT laid out at
  // the same offset within its cell as frameNormal - a column-opacity
  // scan (ignoring the low-count bleed from the adjacent cell at x<20)
  // found its real left border at x=20, not x=44, ~24px further left
  // than frameNormal's. Reusing frameNormal's bbox here clipped the left
  // edge of the dead card's own border. Used for dead players in the
  // roster grid.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '7d9a6868-1668-4ac8-9a5f-24ca337bba99.png'), 'cardFrameDeadTight',
    { left: 1448 + 20, top: 117, w: 305, h: 464 }, { width: 400, decheckerFn: dechecker }
  ));

  // Day layout rebuild - Title+Timer bar (wide pocket-watch + plaque),
  // top-center of the day page. This one's checker is a noisy dither
  // (like main hand.png), not a clean flat two-tone band - decheckerWide
  // needed. CORRECTED bbox - the original {11,62,2148,650} was itself
  // still noise-contaminated: a plain "opaque pixel count > threshold"
  // scan let isolated un-stripped checker specks count as "content" and
  // over-measured the box by ~2x (real content is 340px tall, not 650).
  // Same failure mode as frameNormal's padded cell earlier this session
  // - every gap/size computed against this box was computed against a
  // box far bigger than the actual bar, hence the "much space in
  // between" complaint. Fixed with a longest-contiguous-opaque-run scan
  // (>=15px) instead of a raw count, which a handful of isolated noise
  // pixels can't fake - confirmed by rendering the corrected crop and
  // checking it's tight with no clipping.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main timer.png'), 'timerBar',
    { left: 42, top: 169, w: 2091, h: 340 }, { width: 900, decheckerFn: decheckerWide }
  ));

  // Game title lockup ("THE MAFIA OF HOLLOW CREEK" + subtitle), goes
  // above the timer bar. Same noisy-dither checker as main timer.png -
  // decheckerWide needed here too. A plain min-count bbox scan (>N
  // opaque pixels per row/col) still let isolated noise specks through
  // since a single stray pixel can pass a low threshold - switched to a
  // longest-contiguous-run scan (>=12px straight opaque run) so an
  // isolated speck can't fake a hit, only real strokes/serifs/the arrow
  // line can. Confirmed no clipping by re-rendering the crop and
  // checking the tall letters' tops and the arrow ornaments on each end.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, '6b3cd272-49e2-4e68-913c-01380fbeca1b.png'), 'gameTitle',
    { left: 60, top: 215, w: 2058, h: 210 }, { width: 900, decheckerFn: decheckerWide }
  ));

  // Chat panel ("Town Talk", right column) - reuses ee01c8ac, the ORIGINAL
  // roster-frame pick from earlier this session (near-square, ratio~0.994)
  // before the roster swapped to 5bcf2925 for more card height. Never
  // wired up after that swap, so it's free to reuse here; same bbox/
  // interior fractions already measured for it back then (header band
  // + main interior, left/top/width/height fractions 0.0384/0.1279/
  // 0.9232/0.8340) - no new measurement needed.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'ee01c8ac-1ff2-48a0-b30a-ab46fc9a8fb8.png'), 'chatPanelFrame',
    { left: 13, top: 97, w: 1119, h: 1126 }, { width: 700 }
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

  // ==================== Private Notebook / Town Directory ====================
  // Two full-bleed painted book-page backgrounds - hasAlpha:false, and
  // (unlike main news paper open.png) NOT actually full-bleed: a light
  // neutral-gray checkerboard is baked into the corners around the book's
  // rounded/irregular silhouette (confirmed by sampling raw corner
  // pixels - a 180-250 neutral-gray band distinct from the leather's own
  // warm, high-spread tones). Plain dechecker2 (its default band already
  // covers 178-255) cleans it up with no extra tuning needed.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main character directory.png'), 'notebookDirectoryBg',
    { left: 0, top: 0, w: 1536, h: 1024 }, { width: 1600 }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main notebook page.png'), 'notebookDossierBg',
    { left: 0, top: 0, w: 1536, h: 1024 }, { width: 1600 }
  ));
  // Three private-judgment stamp icons - real alpha (hasAlpha:true), tight
  // bbox already measured via a plain per-pixel alpha scan (no dechecker
  // needed, these aren't checker-baked sheets).
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main trusted icon.png'), 'statusTrusted',
    { left: 103, top: 109, w: 1048, h: 1059 }, { width: 300, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main unknown icon.png'), 'statusUnknown',
    { left: 138, top: 130, w: 977, h: 988 }, { width: 300, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main suspicious icon.png'), 'statusSuspicious',
    { left: 88, top: 63, w: 1078, h: 1127 }, { width: 300, decheckerFn: passthroughAlpha }
  ));
  // Supporting UI chrome - pushpin (pin indicator), pencil (notes
  // decoration + indicator), close button, return-to-directory plaque,
  // and the reusable blank filter-tab background (real text rendered in
  // HTML on top of this one, per the brief - never baked in).
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'notebook-pushpin.png'), 'notebookPushpin',
    { left: 326, top: 156, w: 761, h: 869 }, { width: 300, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'notebook-pencil.png'), 'notebookPencil',
    { left: 73, top: 62, w: 1412, h: 883 }, { width: 700, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'notebook-close-button.png'), 'notebookCloseBtn',
    { left: 297, top: 308, w: 649, h: 619 }, { width: 240, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'return-to-directory-button.png'), 'notebookReturnBtn',
    { left: 132, top: 261, w: 1408, h: 419 }, { width: 700, decheckerFn: passthroughAlpha }
  ));
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'filter-tab-blank.png'), 'notebookFilterTab',
    { left: 30, top: 142, w: 2112, h: 417 }, { width: 700, decheckerFn: passthroughAlpha }
  ));
  // Four-corner brass picture-frame overlay - sits ON TOP of each
  // portrait (directory cards and the dossier's main photo) instead of
  // relying on pixel-matching the frame already painted into the
  // background. Full square canvas kept as-is (real alpha, corners only,
  // nothing to crop out) so it can be laid directly over a portrait box
  // of any size and its 4 corners land in the right place regardless of
  // any small remaining offset between the portrait and the painted
  // frame underneath.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'main notebook picture frame.png'), 'notebookPictureFrame',
    { left: 0, top: 0, w: 1254, h: 1254 }, { width: 600, decheckerFn: passthroughAlpha }
  ));

  // button-red-wide.png (Untitled_design.png) - wide red button background,
  // real HTML text goes on top, never baked in. Was a plain full-canvas
  // resize before (no crop at all) - the actual notched-banner art only
  // fills a 835x208 patch of the source's 1632x624 white canvas (measured
  // via non-white-pixel bbox scan), so every button using this asset via
  // background-size:100% 100% was stretching mostly blank white margin
  // into the button box instead of the banner. Tight bbox + a little
  // padding for the gold trim's own soft glow, decheckerWhite for the
  // canvas around it.
  entries.push(await cropSingle(
    path.join(ASSETS_DIR, 'Untitled_design.png'), 'buttonRedWide',
    { left: 369, top: 197, w: 855, h: 228 },
    { width: 700, decheckerFn: decheckerWhite, quality: 90 }
  ));

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
