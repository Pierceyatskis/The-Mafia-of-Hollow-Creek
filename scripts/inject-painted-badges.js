const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const X_SRC = path.join(__dirname, '..', 'assets', 'image (2).png');
const CHECK_SRC = path.join(__dirname, '..', 'assets', 'image (3).png');

function replaceVarValue(html, varName, newValue) {
  const marker = 'var ' + varName + ' = ';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('Could not find ' + varName + ' marker');
  const valueStart = html.indexOf('"', startIdx) + 1;
  const valueEnd = html.indexOf('";', valueStart);
  if (valueEnd === -1) throw new Error('Could not find end of ' + varName + ' value');
  return html.slice(0, valueStart) + newValue + html.slice(valueEnd);
}

async function main() {
  let html = fs.readFileSync(GAME_FILE, 'utf8');

  const checkBuf = await sharp(CHECK_SRC).trim().resize({ width: 160 }).png({ quality: 85, compressionLevel: 9 }).toBuffer();
  const xBuf = await sharp(X_SRC).trim().resize({ width: 220 }).png({ quality: 85, compressionLevel: 9 }).toBuffer();

  const checkUri = 'data:image/png;base64,' + checkBuf.toString('base64');
  const xUri = 'data:image/png;base64,' + xBuf.toString('base64');

  html = replaceVarValue(html, 'PAINTED_CHECK_SVG', checkUri);
  html = replaceVarValue(html, 'PAINTED_X_SVG', xUri);

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('Injected painted check (' + checkBuf.length + ' bytes) and X (' + xBuf.length + ' bytes).');
  console.log('New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
