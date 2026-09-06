const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'Decorative assets');

// LAYOUT_AND_ASSETS.md task - resize + re-encode each composite sheet/texture
// so the embedded base64 stays reasonable (originals are 1-3.5MB PNGs at
// 1200-2200px wide). Sheets keep transparency (webp), opaque textures become
// jpeg. Sprite-sheet CSS (background-position stepping) references these by
// key, not individual cropped files - no slicing needed.
const JOBS = [
  { key: 'textureWood', file: '01fbc59c-6836-4bad-83c0-cf2348336e21.png', width: 640, format: 'jpeg', quality: 78 },
  { key: 'textureLeather', file: '132ed294-b901-4784-8977-3f2a95e7496f.png', width: 640, format: 'jpeg', quality: 78 },
  { key: 'textureCork', file: '04911599-699e-4466-afc4-4c6c587cdf09.png', width: 640, format: 'jpeg', quality: 78 },
  { key: 'textureParchment', file: '2b9b1875-ad75-42ea-9fe2-ab484be07def.png', width: 640, format: 'jpeg', quality: 78 },
  { key: 'portraitFrames', file: '7d9a6868-1668-4ac8-9a5f-24ca337bba99.png', width: 1400, format: 'webp', quality: 82 },
  { key: 'envelopeStates', file: '6e21f93e-1ae5-4d94-8764-7dd4cc95d149.png', width: 1400, format: 'webp', quality: 82 },
  { key: 'pocketWatch', file: '5a52c854-2bee-460f-8ea3-62cea7fcb008.png', width: 900, format: 'webp', quality: 85 },
  { key: 'ballotAssets', file: 'c9ac3aec-1393-4a1a-be0e-ecd8f4a801c0.png', width: 700, format: 'webp', quality: 85 },
  { key: 'stageCurtains', file: 'ad683cac-8b02-498c-ba5f-4112fa5769bc.png', width: 1000, format: 'webp', quality: 82 },
  { key: 'paperFolderSheet', file: '4c54f3e5-c5c8-4f35-8ee0-734efb5865bd.png', width: 900, format: 'webp', quality: 85 },
  { key: 'paperNotebookSheet', file: '5a39c4d8-da27-4c33-ae10-dd4b35d89fc4.png', width: 1000, format: 'webp', quality: 85 },
  { key: 'iconSheetA', file: '37a04bae-6a55-4c63-9a41-48bf6b1c41be.png', width: 1000, format: 'webp', quality: 85 }
];

async function main() {
  const entries = [];
  for (const job of JOBS) {
    const srcPath = path.join(ASSETS_DIR, job.file);
    let pipeline = sharp(srcPath).resize({ width: job.width, withoutEnlargement: true });
    let buf, mime;
    if (job.format === 'jpeg') {
      buf = await pipeline.flatten({ background: '#000' }).jpeg({ quality: job.quality }).toBuffer();
      mime = 'image/jpeg';
    } else {
      buf = await pipeline.webp({ quality: job.quality }).toBuffer();
      mime = 'image/webp';
    }
    const uri = 'data:' + mime + ';base64,' + buf.toString('base64');
    entries.push({ key: job.key, uri, bytes: buf.length });
    console.log(job.key, '->', buf.length, 'bytes (' + mime + ')');
  }

  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const marker = 'var LAYOUT_IMG = {';
  let startIdx = html.indexOf(marker);
  let objectBody = entries.map(e => '  ' + e.key + ': \'' + e.uri + '\'').join(',\n');
  const block = 'var LAYOUT_IMG = {\n' + objectBody + '\n};\n';

  if (startIdx === -1) {
    // First run - insert right before the final initGame(); call.
    const initMarker = 'initGame();';
    const initIdx = html.lastIndexOf(initMarker);
    if (initIdx === -1) throw new Error('Could not find initGame(); to anchor the new LAYOUT_IMG block');
    html = html.slice(0, initIdx) + block + '\n' + html.slice(initIdx);
  } else {
    const endIdx = html.indexOf('\n};', startIdx);
    if (endIdx === -1) throw new Error('Could not find closing "};" for existing LAYOUT_IMG object');
    html = html.slice(0, startIdx) + block.slice(0, -1) + html.slice(endIdx + 3);
  }

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  console.log('Injected/updated LAYOUT_IMG with', entries.length, 'assets, total', Math.round(totalBytes / 1024), 'KB. New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
