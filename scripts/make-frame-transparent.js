const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'characters', 'image 43.jpg');
const OUT = path.join(__dirname, '..', 'assets', 'frame-overlay.png');

async function main() {
  const img = sharp(SRC);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  const WHITE_HI = 250;
  const WHITE_LO = 195;

  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    const brightness = (r + g + b) / 3;

    let alpha;
    if (brightness >= WHITE_HI) alpha = 0;
    else if (brightness <= WHITE_LO) alpha = 255;
    else alpha = Math.round(255 * (1 - (brightness - WHITE_LO) / (WHITE_HI - WHITE_LO)));

    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = alpha;
  }

  await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(OUT);

  console.log('Wrote', OUT, width, height);
}

main().catch(e => { console.error(e); process.exit(1); });
