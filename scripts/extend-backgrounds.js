const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
let html = fs.readFileSync(GAME_FILE, 'utf8');

if (html.includes('--bg-leather:')) {
  console.log('Backgrounds already extracted to variables, skipping.');
  process.exit(0);
}

const dataUriMap = {};

function replaceUrlWithVar(marker, varName) {
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error('marker not found: ' + marker);
  const urlStart = html.indexOf("url('", idx);
  if (urlStart === -1) throw new Error('url(\' not found after marker: ' + marker);
  const dataStart = urlStart + 5;
  const dataEnd = html.indexOf("'", dataStart);
  if (dataEnd === -1) throw new Error('closing quote not found for: ' + marker);
  const dataUri = html.slice(dataStart, dataEnd);
  dataUriMap[varName] = dataUri;
  html = html.slice(0, urlStart) + 'var(' + varName + ')' + html.slice(dataEnd + 1);
}

replaceUrlWithVar("background:linear-gradient(180deg, rgba(21,18,15,0.74)", '--bg-leather');
replaceUrlWithVar("#panel-night{background-image:linear-gradient(rgba(8,7,6,0.8)", '--bg-night');
replaceUrlWithVar("#panel-day{background-image:linear-gradient(rgba(20,18,15,0.68)", '--bg-day');
replaceUrlWithVar("#panel-end{background-image:linear-gradient(rgba(20,16,12,0.62)", '--bg-end');

let rootBlock = ':root{\n';
for (const [k, v] of Object.entries(dataUriMap)) {
  rootBlock += '  ' + k + ": url('" + v + "');\n";
}
rootBlock += '}\n';

const firstRootClose = html.indexOf('}\n', html.indexOf(':root{'));
if (firstRootClose === -1) throw new Error('could not find end of first :root block');
const insertAt = firstRootClose + 2;
html = html.slice(0, insertAt) + rootBlock + html.slice(insertAt);

const bodyBgRules = `
body.bg-leather{background:linear-gradient(180deg, rgba(10,8,6,0.6) 0%, rgba(10,8,6,0.8) 100%), var(--bg-leather); background-size:cover; background-position:center; background-attachment:fixed;}
body.bg-night{background:linear-gradient(rgba(8,7,6,0.84), rgba(8,7,6,0.92)), var(--bg-night); background-size:cover; background-position:center; background-attachment:fixed;}
body.bg-day{background:linear-gradient(rgba(20,18,15,0.76), rgba(20,18,15,0.88)), var(--bg-day); background-size:cover; background-position:center; background-attachment:fixed;}
body.bg-end{background:linear-gradient(rgba(20,16,12,0.72), rgba(20,16,12,0.86)), var(--bg-end); background-size:cover; background-position:center; background-attachment:fixed;}
`;

const bodyRuleMarker = 'body{margin:0; min-height:100vh;';
const bodyRuleIdx = html.indexOf(bodyRuleMarker);
if (bodyRuleIdx === -1) throw new Error('could not find body{} rule');
const bodyRuleEnd = html.indexOf('}\n', bodyRuleIdx) + 2;
html = html.slice(0, bodyRuleEnd) + bodyBgRules + html.slice(bodyRuleEnd);

fs.writeFileSync(GAME_FILE, html, 'utf8');
console.log('Extracted 4 backgrounds to CSS variables and added body.bg-* rules.');
