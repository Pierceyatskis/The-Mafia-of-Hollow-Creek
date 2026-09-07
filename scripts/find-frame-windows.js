const sharp = require('sharp');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'Decorative assets');

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
  return { data, info };
}

// Finds the interior transparent window inside one cell: for each row,
// locate the transparent run that has opaque pixels on BOTH sides within
// this cell (so it's a hole punched in the frame, not the transparent
// margin around the frame graphic itself). Aggregates across rows.
function findInteriorWindow(data, info, cellLeft, cellRight, top, bottom) {
  const { width, channels } = info;
  let winLeft = Infinity, winRight = -Infinity, winTop = Infinity, winBottom = -Infinity;
  for (let y = top; y <= bottom; y++) {
    let x = cellLeft;
    let sawOpaqueBefore = false;
    let runStart = -1;
    let rowLeft = Infinity, rowRight = -Infinity;
    for (x = cellLeft; x <= cellRight; x++) {
      const o = (y * width + x) * channels;
      const opaque = data[o + 3] >= 50;
      if (opaque) {
        if (runStart !== -1 && sawOpaqueBefore) {
          // closed an interior transparent run
          if (runStart < rowLeft) rowLeft = runStart;
          if (x - 1 > rowRight) rowRight = x - 1;
        }
        sawOpaqueBefore = true;
        runStart = -1;
      } else {
        if (runStart === -1) runStart = x;
      }
    }
    if (rowRight > rowLeft) {
      if (rowLeft < winLeft) winLeft = rowLeft;
      if (rowRight > winRight) winRight = rowRight;
      if (y < winTop) winTop = y;
      if (y > winBottom) winBottom = y;
    }
  }
  return { left: winLeft - cellLeft, top: winTop, right: winRight - cellLeft, bottom: winBottom };
}

async function main() {
  const { data, info } = await dechecker(path.join(ASSETS_DIR, '7d9a6868-1668-4ac8-9a5f-24ca337bba99.png'));
  const { width } = info;
  const cellW = width / 6;
  const opaqueBboxes = [
    { top: 118, bottom: 582 }, { top: 114, bottom: 582 }, { top: 100, bottom: 602 },
    { top: 117, bottom: 582 }, { top: 116, bottom: 582 }, { top: 110, bottom: 582 }
  ];
  for (let cell = 0; cell < 6; cell++) {
    const cellLeft = Math.round(cell * cellW), cellRight = Math.round((cell + 1) * cellW) - 1;
    const win = findInteriorWindow(data, info, cellLeft, cellRight, opaqueBboxes[cell].top, opaqueBboxes[cell].bottom);
    console.log('cell', cell, 'window (relative to cell)', win, 'w=', win.right - win.left, 'h=', win.bottom - win.top);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
