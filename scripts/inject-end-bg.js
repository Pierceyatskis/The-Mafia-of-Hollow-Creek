const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'hollow_creek_game.html');
const IMG_PATH = path.join(__dirname, '..', 'assets', 'end-screen-bg.jpg');

let html = fs.readFileSync(GAME_FILE, 'utf8');

if (html.includes('#panel-end{background-image')) {
  console.log('End background already present, skipping.');
  process.exit(0);
}

const sharedSelector = '#panel-night, #panel-day{';
if (!html.includes(sharedSelector)) throw new Error('Could not find shared panel selector');
html = html.replace(sharedSelector, '#panel-night, #panel-day, #panel-end{');

const dayMarker = "#panel-day{background-image:";
const dayIdx = html.indexOf(dayMarker);
if (dayIdx === -1) throw new Error('Could not find #panel-day background rule');
const dayRuleEnd = html.indexOf('}', dayIdx);
if (dayRuleEnd === -1) throw new Error('Could not find end of #panel-day rule');

const buf = fs.readFileSync(IMG_PATH);
const uri = 'data:image/jpeg;base64,' + buf.toString('base64');
const newRule = "\n#panel-end{background-image:linear-gradient(rgba(20,16,12,0.62), rgba(20,16,12,0.78)), url('" + uri + "');}";

html = html.slice(0, dayRuleEnd + 1) + newRule + html.slice(dayRuleEnd + 1);
fs.writeFileSync(GAME_FILE, html, 'utf8');
console.log('Injected #panel-end background rule.');
