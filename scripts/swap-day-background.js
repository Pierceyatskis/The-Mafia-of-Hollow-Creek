const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Day page visual rebuild, region 1 - swaps the outdoor street --bg-day
// for the new painted study/office scene. 2b0525c5 was the WRONG file -
// it's the rough hand-annotated sketch (visible scribble outlines/labels
// baked into the pixels). The user corrected this: 4b62eef2 is the real
// clean background with no annotations at all - the wireframe (786757b5)
// and the rough sketch (2b0525c5) are positioning references ONLY, never
// meant to ship.
const GAME_FILE = path.join(__dirname, '..', 'hollow-creek-lobby', 'public', 'index.html');
const BG_SRC = path.join(__dirname, '..', 'assets', 'Decorative assets', '4b62eef2-6103-4879-b437-b9025c60c69d.png');

function replaceCssVar(html, varName, uri) {
  const marker = '--' + varName + ": url('";
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find --' + varName + ' marker');
  const valueStart = startIdx + marker.length;
  const valueEnd = html.indexOf("')", valueStart);
  if (valueEnd === -1) throw new Error('Could not find end of --' + varName + ' value');
  return html.slice(0, valueStart) + uri + html.slice(valueEnd);
}

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');
  const buf = await sharp(BG_SRC).flatten({ background: '#000' }).resize({ width: 1800 }).jpeg({ quality: 86 }).toBuffer();
  const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
  html = replaceCssVar(html, 'bg-day', uri);
  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Replaced --bg-day with the new study/office scene (' + Math.round(buf.length / 1024) + ' KB).');
}

main().catch(e => { console.error(e); process.exit(1); });
