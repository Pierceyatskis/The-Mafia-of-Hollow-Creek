const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const NIGHT_SRC = path.join(__dirname, '..', 'assets', 'characters', 'pG2ui.jpg');
const DAY_SRC = path.join(__dirname, '..', 'assets', 'characters', '52avp.jpg');

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

  const nightBuf = await sharp(NIGHT_SRC).resize({ width: 1400 }).jpeg({ quality: 84 }).toBuffer();
  const nightUri = 'data:image/jpeg;base64,' + nightBuf.toString('base64');
  html = replaceCssVar(html, 'bg-night', nightUri);
  console.log('Replaced --bg-night (' + nightBuf.length + ' bytes)');

  const dayBuf = await sharp(DAY_SRC).resize({ width: 1400 }).jpeg({ quality: 84 }).toBuffer();
  const dayUri = 'data:image/jpeg;base64,' + dayBuf.toString('base64');
  html = replaceCssVar(html, 'bg-day', dayUri);
  console.log('Replaced --bg-day (' + dayBuf.length + ' bytes)');

  fs.writeFileSync(GAME_FILE, html, 'utf8');
  console.log('New file size:', fs.statSync(GAME_FILE).size);
}

main().catch(e => { console.error(e); process.exit(1); });
